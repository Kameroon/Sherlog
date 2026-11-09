import type { SendPayload } from '../core/sendPayload';
import type { Analysis } from './analysis';
import { createNonce } from './analysisPrompt';
import type { RandomBytes } from './analysisPrompt';
import systemTemplate from './prompts/chat-system.md?raw';
import type { Message } from './provider';

/**
 * The most characters of one request of the chat, instructions and the whole conversation included. Past it the chat
 * says so and asks to start again: nothing is dropped from the conversation without the user knowing.
 */
export const MAX_CHAT_CHARS = 60_000;

/** The most characters of one question typed by the user. */
export const MAX_QUESTION_CHARS = 4_000;

const MAX_NONCE_ATTEMPTS = 5;

/** What the chat knows of the error: the text that comes from the log (masked and cut) and the analysis, if there is one. */
export interface ChatContext {
  readonly payload: SendPayload;
  readonly analysis: Analysis | null;
}

/** One question and the answer it got; only complete exchanges are kept in the conversation. */
export interface ChatTurn {
  /** The question as it was sent: masked. */
  readonly question: string;
  readonly answer: string;
}

export interface ChatRequest {
  readonly system: string;
  readonly messages: readonly Message[];
}

export type BuiltChatRequest = { readonly ok: true; readonly request: ChatRequest } | { readonly ok: false; readonly reason: 'too-long' };

interface ChatRequestInput {
  readonly context: ChatContext;
  /** The exchanges so far, oldest first. */
  readonly turns: readonly ChatTurn[];
  /** The new question, already masked. */
  readonly question: string;
  readonly random?: RandomBytes;
}

/** The text of the data block: what comes from the log, then the analysis that was made from it. */
function blockText(context: ChatContext): string {
  return context.analysis === null ? context.payload.text : `${context.payload.text}\n\n--- Analyse précédente ---\n${JSON.stringify(context.analysis, null, 2)}`;
}

/**
 * Builds the request that asks the next question of the conversation about one error. The whole conversation is sent
 * each time, so the context is wrapped again for each request, between delimiters that carry a value drawn for this
 * request (as for the analysis, `buildAnalysisPrompt`): a log, or an analysis written by a model that read it, cannot
 * know the value and cannot close the block. The context is in the first message only, followed by the first question;
 * the questions come from the user and are outside the block (they are masked before they get here).
 *
 * @returns `too-long` when the request would pass `MAX_CHAT_CHARS`: nothing is cut.
 * @throws Error when a delimiter the context does not hold cannot be found: nothing is built rather than a block that could be closed.
 */
export function buildChatRequest({ context, turns, question, random }: ChatRequestInput): BuiltChatRequest {
  const block = blockText(context);
  for (let attempt = 0; attempt < MAX_NONCE_ATTEMPTS; attempt += 1) {
    const nonce = createNonce(random);
    if (block.includes(nonce)) {
      continue;
    }
    const tag = `log_data_${nonce}`;
    const note = context.payload.note === null ? '' : `${context.payload.note}\n\n`;
    const exchanges: { question: string; answer: string | null }[] = [...turns, { question, answer: null }];
    const messages: Message[] = exchanges.flatMap(({ question: asked, answer }, index): Message[] => {
      const content = index === 0 ? `<${tag}>\n${block}\n</${tag}>\n\n${note}${asked}` : asked;
      return answer === null ? [{ role: 'user', content }] : [{ role: 'user', content }, { role: 'assistant', content: answer }];
    });
    const system = systemTemplate.replaceAll('{{nonce}}', nonce).trimEnd();
    const size = system.length + messages.reduce((total, message) => total + message.content.length, 0);
    return size > MAX_CHAT_CHARS ? { ok: false, reason: 'too-long' } : { ok: true, request: { system, messages } };
  }
  throw new Error('Aucun délimiteur sûr n’a pu être tiré : la requête n’est pas construite.');
}
