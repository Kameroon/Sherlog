import { AiRequestError } from './errors';
import type { AiProvider, Message } from './provider';
import { interruptionOf, send } from './request';
import { readLines } from './streamLines';

/** Where Ollama listens on the user's computer: the only address the CSP lets the page reach for it (ADR-002). */
export const OLLAMA_URL = 'http://localhost:11434';

export interface OllamaConfig {
  readonly model: string;
  readonly fetchImpl?: typeof fetch;
  readonly headersTimeoutMs?: number;
}

/** What "Tester la connexion" gives for Ollama: the models installed, or why they could not be read. */
export type OllamaConnectionResult = { readonly ok: true; readonly models: readonly string[] } | { readonly ok: false; readonly failure: AiRequestError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The explanation in the body of an error answer: `{ "error": "…" }`. */
function explanationOf(body: unknown): string | undefined {
  const message = isRecord(body) ? body['error'] : undefined;
  return typeof message === 'string' ? message : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiRequestError('protocol', { detail: 'réponse illisible' });
  }
}

/** The names in an answer of `GET /api/tags`: `{ "models": [{ "name": "llama3:8b", … }] }`. */
function modelNamesOf(answer: unknown): string[] {
  const models = isRecord(answer) ? answer['models'] : undefined;
  if (!Array.isArray(models)) {
    throw new AiRequestError('protocol', { detail: 'liste de modèles absente' });
  }
  return models.map((model: unknown) => {
    const name = isRecord(model) ? model['name'] : undefined;
    if (typeof name !== 'string' || name === '') {
      throw new AiRequestError('protocol', { detail: 'modèle sans nom' });
    }
    return name;
  });
}

/**
 * "Tester la connexion" for Ollama: reads the list of the installed models. It does not run a model, which would load
 * it in memory and slow the computer down (ADR-002); a model that is not installed shows when it is chosen.
 * Never throws an `AiRequestError`: the failure is in the result.
 */
export async function listOllamaModels(config: Omit<OllamaConfig, 'model'>, signal?: AbortSignal): Promise<OllamaConnectionResult> {
  try {
    const response = await send({
      url: `${OLLAMA_URL}/api/tags`,
      method: 'GET',
      headers: {},
      signal,
      fetchImpl: config.fetchImpl ?? fetch,
      headersTimeoutMs: config.headersTimeoutMs,
      explain: explanationOf,
    });
    const models = modelNamesOf(parseJson(await response.text()));
    return { ok: true, models: models.sort((left, right) => left.localeCompare(right)) };
  } catch (error) {
    if (error instanceof AiRequestError) {
      return { ok: false, failure: error };
    }
    // Reading the answer broke off, or the call was cancelled while it was read.
    return { ok: false, failure: interruptionOf(error, signal) };
  }
}

/** One line of the answer of `POST /api/chat`: the text so far, or `done`, or an `error`. */
function readChatLine(text: string): { piece: string; done: boolean } {
  const line = parseJson(text);
  const failure = explanationOf(line);
  if (failure !== undefined) {
    throw new AiRequestError('unavailable', { detail: failure });
  }
  const message = isRecord(line) ? line['message'] : undefined;
  const content = isRecord(message) ? message['content'] : undefined;
  return { piece: typeof content === 'string' ? content : '', done: isRecord(line) && line['done'] === true };
}

/**
 * Ollama's chat API on the user's computer, read as one JSON object per line. As with Anthropic, the answer is
 * complete only when the line that says `done` came: a stream that ends before is an `interrupted` failure.
 *
 * @throws AiRequestError, whatever the way the request fails.
 */
export function createOllamaProvider(config: OllamaConfig): AiProvider {
  const { model, fetchImpl = fetch } = config;
  return {
    async *stream(messages: readonly Message[], options = {}): AsyncGenerator<string> {
      const response = await send({
        url: `${OLLAMA_URL}/api/chat`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { model, messages: options.system === undefined ? messages : [{ role: 'system', content: options.system }, ...messages], stream: true },
        signal: options.signal,
        fetchImpl,
        headersTimeoutMs: config.headersTimeoutMs,
        explain: explanationOf,
      });
      if (response.body === null) {
        throw new AiRequestError('protocol', { detail: 'réponse sans contenu' });
      }
      try {
        for await (const text of readLines(response.body)) {
          if (text.trim() === '') {
            continue;
          }
          const { piece, done } = readChatLine(text);
          if (piece !== '') {
            yield piece;
          }
          if (done) {
            return;
          }
        }
      } catch (error) {
        throw interruptionOf(error, options.signal);
      }
      throw new AiRequestError('interrupted');
    },
  };
}
