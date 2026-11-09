import type { SendPayload } from '../core/sendPayload';
import { parseAnalysis } from './analysis';
import type { Analysis } from './analysis';
import { RETRY_MESSAGE, buildAnalysisPrompt } from './analysisPrompt';
import type { RandomBytes } from './analysisPrompt';
import { readAnswer } from './provider';
import type { AiProvider, Message } from './provider';

/** What the model gave for an error: an analysis that follows the schema, or, when it did not after a second try, its text. */
export type AnalysisOutcome =
  | { readonly kind: 'structured'; readonly analysis: Analysis }
  /** Shown as text, and said to be unstructured (`docs/PROMPTS.md` §4). */
  | { readonly kind: 'unstructured'; readonly text: string };

export interface AnalyseOptions {
  readonly signal?: AbortSignal;
  /** Replaces the random source of the delimiter; used by the tests. */
  readonly random?: RandomBytes;
}

/**
 * Asks the provider to analyse one error and checks the answer. The text that comes from the log is already masked and
 * cut (`buildSendPayload`) and is sent as data between delimiters that carry a random value (`buildAnalysisPrompt`).
 * An answer that is not a valid analysis is asked for once more, with the reminder; if the second one is not valid
 * either, its text is given as it is, to be shown as text. A failure of the provider is not retried: it is passed on.
 *
 * @throws AiRequestError when a request fails, or when no safe delimiter could be drawn (Error).
 */
export async function analyseError(provider: AiProvider, payload: SendPayload, options: AnalyseOptions = {}): Promise<AnalysisOutcome> {
  const prompt = buildAnalysisPrompt(payload, options.random);
  const ask = (messages: readonly Message[]): Promise<string> => readAnswer(provider.stream(messages, { system: prompt.system, signal: options.signal }));

  const first = await ask(prompt.messages);
  const parsedFirst = parseAnalysis(first);
  if (parsedFirst.ok) {
    return { kind: 'structured', analysis: parsedFirst.analysis };
  }

  const second = await ask([...prompt.messages, { role: 'assistant', content: first }, { role: 'user', content: RETRY_MESSAGE }]);
  const parsedSecond = parseAnalysis(second);
  return parsedSecond.ok ? { kind: 'structured', analysis: parsedSecond.analysis } : { kind: 'unstructured', text: second };
}
