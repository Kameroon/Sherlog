import { AiRequestError } from './errors';
import type { AiFailureKind } from './errors';
import type { AiProvider, ConnectionResult, Message } from './provider';
import { readAnswer } from './provider';
import { interruptionOf, send } from './request';
import { readServerSentEvents } from './serverSentEvents';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

/** The API version the requests are written for (ADR-002): it refuses `temperature`, `top_p` and `top_k`, which are never sent. */
export const ANTHROPIC_VERSION = '2026-10-21';

/** The model a new user starts with: the lightest one, since an explanation does not need more (the user can change it). */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';

/** What "Tester la connexion" sends: a fixed sentence, never a word of a log. */
export const CONNECTION_TEST_MESSAGE = 'Réponds uniquement par le mot : OK';

/** The test only needs a word back: a few tokens, so that it costs next to nothing. */
const CONNECTION_TEST_MAX_TOKENS = 16;

/** The longest key accepted: a real one is about a hundred characters. */
const MAX_API_KEY_CHARS = 512;

export interface AnthropicConfig {
  readonly apiKey: string;
  readonly model: string;
  /** The most the model may write in one answer. */
  readonly maxTokens: number;
  readonly fetchImpl?: typeof fetch;
  readonly headersTimeoutMs?: number;
}

/**
 * `true` when a key can be written in a header: visible ASCII only, no space. Anything else would make the browser
 * refuse the request with an error that looks like a network failure. Only the form is checked, never the start of
 * the key: whether it is valid is the provider's answer.
 */
export function isPlausibleApiKey(key: string): boolean {
  return key.length <= MAX_API_KEY_CHARS && /^[\x21-\x7E]+$/.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The explanation in the body of an error answer: `{ "type": "error", "error": { "type": …, "message": … } }`. */
function explanationOf(body: unknown): string | undefined {
  const error = isRecord(body) ? body['error'] : undefined;
  const message = isRecord(error) ? error['message'] : undefined;
  return typeof message === 'string' ? message : undefined;
}

const FAILURE_OF_ERROR_TYPE: Readonly<Record<string, AiFailureKind>> = {
  authentication_error: 'unauthorized',
  permission_error: 'forbidden',
  not_found_error: 'not-found',
  invalid_request_error: 'rejected',
  request_too_large: 'rejected',
  rate_limit_error: 'rate-limited',
};

/** The failure an `error` event stands for; what is not known is taken for the provider's trouble, not guessed further. */
function failureOfErrorEvent(data: unknown): AiRequestError {
  const error = isRecord(data) ? data['error'] : undefined;
  const type = isRecord(error) ? error['type'] : undefined;
  const kind = typeof type === 'string' ? FAILURE_OF_ERROR_TYPE[type] : undefined;
  return new AiRequestError(kind ?? 'unavailable', { detail: explanationOf(data) });
}

/** The text a `content_block_delta` carries, or `null` for the other kinds of delta (tool input, for instance). */
function textOf(data: unknown): string | null {
  const delta = isRecord(data) ? data['delta'] : undefined;
  if (isRecord(delta) && delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
    return delta['text'];
  }
  return null;
}

function parseEventData(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    throw new AiRequestError('protocol', { detail: 'événement illisible' });
  }
}

/**
 * Anthropic's messages API, called straight from the browser with the user's key and read as server-sent events.
 * The answer is complete only when its last event (`message_stop`) came: a stream that ends before is an
 * `interrupted` failure, never a shorter answer taken for a whole one.
 *
 * @throws AiRequestError, whatever the way the request fails.
 */
export function createAnthropicProvider(config: AnthropicConfig): AiProvider {
  const { apiKey, model, maxTokens, fetchImpl = fetch } = config;
  return {
    async *stream(messages: readonly Message[], options = {}): AsyncGenerator<string> {
      if (!isPlausibleApiKey(apiKey)) {
        throw new AiRequestError('rejected', { detail: 'la clé contient des caractères que le navigateur ne peut pas envoyer' });
      }
      const response = await send({
        url: MESSAGES_URL,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
          // Without it the answer is not readable by the page (ADR-002).
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: { model, max_tokens: maxTokens, stream: true, messages },
        signal: options.signal,
        fetchImpl,
        headersTimeoutMs: config.headersTimeoutMs,
        secret: apiKey,
        explain: explanationOf,
      });
      if (response.body === null) {
        throw new AiRequestError('protocol', { detail: 'réponse sans contenu' });
      }
      try {
        for await (const event of readServerSentEvents(response.body)) {
          const data = parseEventData(event.data);
          if (event.event === 'error') {
            throw failureOfErrorEvent(data);
          }
          if (event.event === 'message_stop') {
            return;
          }
          const text = event.event === 'content_block_delta' ? textOf(data) : null;
          if (text !== null) {
            yield text;
          }
        }
      } catch (error) {
        throw interruptionOf(error, options.signal);
      }
      throw new AiRequestError('interrupted');
    },
  };
}

/**
 * "Tester la connexion": asks the model for one word with a fixed sentence and says whether it answered. Nothing from
 * a log is sent, and the key is only ever used for this request.
 */
export async function testAnthropicConnection(config: Omit<AnthropicConfig, 'maxTokens'>, signal?: AbortSignal): Promise<ConnectionResult> {
  const provider = createAnthropicProvider({ ...config, maxTokens: CONNECTION_TEST_MAX_TOKENS });
  try {
    await readAnswer(provider.stream([{ role: 'user', content: CONNECTION_TEST_MESSAGE }], { signal }));
    return { ok: true };
  } catch (error) {
    if (error instanceof AiRequestError) {
      return { ok: false, failure: error };
    }
    throw error;
  }
}
