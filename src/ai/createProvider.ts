import { createAnthropicProvider } from './anthropic';
import { createOllamaProvider } from './ollama';
import type { AiProvider, ProviderId } from './provider';

/**
 * What the user chose in the settings, once it is usable: the provider, the key (Anthropic only) and the model.
 * It is held in memory for the length of a request and goes nowhere else.
 */
export interface ProviderChoice {
  readonly provider: ProviderId;
  readonly apiKey: string;
  readonly model: string;
}

/**
 * The most the model may write for one analysis: the JSON of `docs/PROMPTS.md` is a few hundred to a thousand tokens,
 * so this leaves room for several fixes. An analysis cut by this limit is not valid JSON, and is then asked for again
 * and, failing that, shown as unstructured text.
 */
export const ANALYSIS_MAX_TOKENS = 4_096;

export function createProvider(choice: ProviderChoice, fetchImpl?: typeof fetch): AiProvider {
  return choice.provider === 'anthropic'
    ? createAnthropicProvider({ apiKey: choice.apiKey, model: choice.model, maxTokens: ANALYSIS_MAX_TOKENS, fetchImpl })
    : createOllamaProvider({ model: choice.model, fetchImpl });
}
