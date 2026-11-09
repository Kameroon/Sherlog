import { AiRequestError } from './errors';

/** The two providers a user can choose from. */
export type ProviderId = 'anthropic' | 'ollama';

export interface Message {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface StreamOptions {
  /** The instructions to the model, apart from the conversation (what the log says is never in it). */
  readonly system?: string;
  /** Cancels the request, and the reading of its answer if it has begun. */
  readonly signal?: AbortSignal;
}

/** What a model provider offers: the text of an answer, piece by piece, as it is written. */
export interface AiProvider {
  stream(messages: readonly Message[], options?: StreamOptions): AsyncIterable<string>;
}

/** The outcome of "Tester la connexion": always a value, never a throw, so that the screen can say why. */
export type ConnectionResult = { readonly ok: true } | { readonly ok: false; readonly failure: AiRequestError };

/** The longest answer read as a whole: an analysis is a few thousand characters, and an answer that never ends must not fill the page's memory. */
export const MAX_ANSWER_CHARS = 60_000;

/**
 * Reads an answer to its end and gives the whole text.
 *
 * @throws AiRequestError of kind `protocol` when the answer is longer than `maxChars`: it is refused, not cut.
 */
export async function readAnswer(pieces: AsyncIterable<string>, maxChars: number = MAX_ANSWER_CHARS): Promise<string> {
  let answer = '';
  for await (const piece of pieces) {
    answer += piece;
    if (answer.length > maxChars) {
      throw new AiRequestError('protocol', { detail: 'réponse trop longue' });
    }
  }
  return answer;
}

/** The longest model name accepted, in characters. */
const MAX_MODEL_NAME_CHARS = 100;

/**
 * `true` when a model name can be sent as it is: letters, digits and `. _ - : /` (an Ollama name looks like
 * `library/llama3:8b`), starting with a letter or a digit. Only the form is checked: whether the model exists is the
 * provider's answer, shown by the connection test.
 */
export function isValidModelName(name: string): boolean {
  return name.length <= MAX_MODEL_NAME_CHARS && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(name);
}
