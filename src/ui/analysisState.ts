import type { AnalysisOutcome } from '../ai/analyseError';

/** What the screen knows of the analysis of one fingerprint: under way, done, or why it failed. */
export type AnalysisEntry =
  | { readonly status: 'running' }
  /** `by` names who made it, for the screen: « claude-haiku-5-5 (Anthropic) ». */
  | { readonly status: 'done'; readonly outcome: AnalysisOutcome; readonly by: string }
  | { readonly status: 'failed'; readonly message: string };

/** The analyses of an analysis session, by fingerprint; an error that is not in it has none. */
export type AnalysisByFingerprint = ReadonlyMap<number, AnalysisEntry>;
