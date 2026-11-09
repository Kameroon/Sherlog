/** The keys of an analysis, as the system prompt names them (`prompts/analysis-system.md`). */
export const ANALYSIS_KEYS = ['summary', 'probableCause', 'severity', 'confidence', 'evidence', 'suggestedFixes', 'missingInfo'] as const;

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const CONFIDENCES = ['low', 'medium', 'high'] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Confidence = (typeof CONFIDENCES)[number];

/**
 * The longest text of an analysis and the most items of a list. Generous for a real analysis, and a bound for an answer
 * that is not one: past it the answer is refused, never cut, since a cut analysis would be taken for a whole one.
 */
export const MAX_TEXT_CHARS = 4_000;
export const MAX_LIST_ITEMS = 20;

export interface SuggestedFix {
  readonly title: string;
  readonly details: string;
  /** An extract of code, or `null`. */
  readonly codeHint: string | null;
}

/** What the model says of an error (`docs/PROMPTS.md` §1), once checked: every field is present and of the right kind. */
export interface Analysis {
  readonly summary: string;
  readonly probableCause: string;
  readonly severity: Severity;
  readonly confidence: Confidence;
  /** What in the log supports the analysis, and the attempts of the log to give orders, which the model was asked to name. */
  readonly evidence: readonly string[];
  readonly suggestedFixes: readonly SuggestedFix[];
  readonly missingInfo: readonly string[];
}

export type ParsedAnalysis = { readonly ok: true; readonly analysis: Analysis } | { readonly ok: false; readonly reason: string };

/** Why an answer is not an analysis; carries the sentence that says it. */
class NotAnAnalysis extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textField(value: unknown, field: string, options: { allowEmpty: boolean }): string {
  if (typeof value !== 'string') {
    throw new NotAnAnalysis(`le champ « ${field} » n’est pas un texte`);
  }
  if (value.length > MAX_TEXT_CHARS) {
    throw new NotAnAnalysis(`le champ « ${field} » dépasse ${MAX_TEXT_CHARS} caractères`);
  }
  if (!options.allowEmpty && value.trim() === '') {
    throw new NotAnAnalysis(`le champ « ${field} » est vide`);
  }
  return value;
}

function choiceField<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  const choice = choices.find((candidate) => candidate === value);
  if (choice === undefined) {
    throw new NotAnAnalysis(`le champ « ${field} » est absent ou hors des valeurs admises (${choices.join(', ')})`);
  }
  return choice;
}

function listOf(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new NotAnAnalysis(`le champ « ${field} » n’est pas une liste`);
  }
  if (value.length > MAX_LIST_ITEMS) {
    throw new NotAnAnalysis(`le champ « ${field} » a plus de ${MAX_LIST_ITEMS} éléments`);
  }
  return value as readonly unknown[];
}

function fixOf(value: unknown): SuggestedFix {
  if (!isRecord(value)) {
    throw new NotAnAnalysis('une piste de correction n’est pas un objet');
  }
  const { codeHint } = value;
  return {
    title: textField(value['title'], 'suggestedFixes.title', { allowEmpty: false }),
    details: textField(value['details'], 'suggestedFixes.details', { allowEmpty: true }),
    codeHint: codeHint === undefined || codeHint === null ? null : textField(codeHint, 'suggestedFixes.codeHint', { allowEmpty: true }),
  };
}

/** The text without the code fence a model puts around JSON; any other text around it is left, and refused later. */
function withoutFence(answer: string): string {
  const trimmed = answer.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

/**
 * Checks that the answer of the model is an analysis (`docs/PROMPTS.md` §1) and builds it field by field: what the
 * schema does not name is dropped, so that nothing the model adds (or a log made it add) reaches the screen. Nothing is
 * guessed: JSON with prose around it, an unknown severity, a text over the limit are refused, and the caller decides
 * what to do (a second try, then the raw text said to be unstructured).
 */
export function parseAnalysis(answer: string): ParsedAnalysis {
  try {
    let data: unknown;
    try {
      data = JSON.parse(withoutFence(answer));
    } catch {
      throw new NotAnAnalysis('la réponse n’est pas du JSON seul');
    }
    if (!isRecord(data)) {
      throw new NotAnAnalysis('la réponse n’est pas un objet JSON');
    }
    return {
      ok: true,
      analysis: {
        summary: textField(data['summary'], 'summary', { allowEmpty: false }),
        probableCause: textField(data['probableCause'], 'probableCause', { allowEmpty: false }),
        severity: choiceField(data['severity'], 'severity', SEVERITIES),
        confidence: choiceField(data['confidence'], 'confidence', CONFIDENCES),
        evidence: listOf(data['evidence'], 'evidence').map((item) => textField(item, 'evidence', { allowEmpty: true })),
        suggestedFixes: listOf(data['suggestedFixes'], 'suggestedFixes').map(fixOf),
        missingInfo: listOf(data['missingInfo'], 'missingInfo').map((item) => textField(item, 'missingInfo', { allowEmpty: true })),
      },
    };
  } catch (error) {
    if (error instanceof NotAnAnalysis) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}
