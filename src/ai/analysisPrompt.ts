import type { SendPayload } from '../core/sendPayload';
import systemTemplate from './prompts/analysis-system.md?raw';
import type { Message } from './provider';

/** What `crypto.getRandomValues` does: fills the bytes with random ones. Replaced by the tests. */
export type RandomBytes = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

const NONCE_BYTES = 16;

/** How many nonces are tried before giving up: one that the log already holds is a one in 2^128 chance, or an attack that cannot know it. */
const MAX_NONCE_ATTEMPTS = 5;

/** What is said to the model when its answer was not valid JSON (`docs/PROMPTS.md` §4). */
export const RETRY_MESSAGE = 'Ta réponse n’était pas du JSON valide. Renvoie uniquement l’objet JSON, sans texte autour.';

export interface AnalysisPrompt {
  readonly system: string;
  readonly messages: readonly Message[];
  readonly nonce: string;
}

const secureRandom: RandomBytes = (bytes) => crypto.getRandomValues(bytes);

/** A fresh unguessable value, drawn for each request: 128 random bits in hexadecimal. */
export function createNonce(random: RandomBytes = secureRandom): string {
  return [...random(new Uint8Array(NONCE_BYTES))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds the request that asks for the analysis of one error: the instructions in the system prompt, and the text that
 * comes from the log (`buildSendPayload`, already masked and cut) in the user message, between delimiters that carry a
 * random value drawn for this request. A log is untrusted: it cannot know the value, so it cannot close the block and
 * speak as the instructions (`docs/PROMPTS.md`, SPEC §6). The file name, the counts and the lines around the error are
 * inside the block too: they come from the log or from the user's disk. The note about a cut is ours, so it follows
 * the block.
 *
 * @throws Error when a nonce the log does not hold cannot be found: nothing is built rather than a block that could be closed.
 */
export function buildAnalysisPrompt(payload: SendPayload, random: RandomBytes = secureRandom): AnalysisPrompt {
  for (let attempt = 0; attempt < MAX_NONCE_ATTEMPTS; attempt += 1) {
    const nonce = createNonce(random);
    if (payload.text.includes(nonce)) {
      continue;
    }
    const tag = `log_data_${nonce}`;
    const block = `<${tag}>\n${payload.text}\n</${tag}>`;
    return {
      system: systemTemplate.replaceAll('{{nonce}}', nonce).trimEnd(),
      messages: [{ role: 'user', content: payload.note === null ? block : `${block}\n\n${payload.note}` }],
      nonce,
    };
  }
  throw new Error('Aucun délimiteur sûr n’a pu être tiré : la requête n’est pas construite.');
}
