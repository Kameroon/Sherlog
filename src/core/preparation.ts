import type { LogEntry } from './entryAssembler';

/**
 * What the user sets before the analysis. Plain data, so that it can be sent to the worker as it is. The source
 * file is never changed: a preparation only decides which entries are kept for the analysis (SPEC §3).
 */
export interface Preparation {
  /** Entries whose text contains one of these texts are left out; compared without regard to case. */
  readonly ignoreTexts: readonly string[];
}

export const EMPTY_PREPARATION: Preparation = { ignoreTexts: [] };

/** Longest text of an « ignore » rule. A rule is a few words; this stops a whole pasted log from becoming one. */
export const MAX_IGNORE_TEXT_CHARS = 200;

/** Most « ignore » rules at once: each one is compared with every entry of the source. */
export const MAX_IGNORE_TEXTS = 20;

/** Outcome of a change to a preparation: the new preparation, or why the change was refused (for the user). */
export type PreparationEdit =
  | { readonly ok: true; readonly preparation: Preparation }
  | { readonly ok: false; readonly reason: string };

/**
 * Adds an « ignore » rule. Refused, with the reason, when the text is empty, too long, already a rule (case
 * does not matter) or when there are too many rules.
 */
export function addIgnoreText(preparation: Preparation, text: string): PreparationEdit {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'Écrivez d’abord le texte à ignorer, par exemple /health.' };
  }
  if (trimmed.length > MAX_IGNORE_TEXT_CHARS) {
    return { ok: false, reason: `Ce texte dépasse ${MAX_IGNORE_TEXT_CHARS} caractères.` };
  }
  const lowered = trimmed.toLowerCase();
  if (preparation.ignoreTexts.some((existing) => existing.toLowerCase() === lowered)) {
    return { ok: false, reason: 'Cette règle existe déjà.' };
  }
  if (preparation.ignoreTexts.length >= MAX_IGNORE_TEXTS) {
    return { ok: false, reason: `${MAX_IGNORE_TEXTS} règles au maximum : retirez-en une avant d’en ajouter.` };
  }
  return { ok: true, preparation: { ...preparation, ignoreTexts: [...preparation.ignoreTexts, trimmed] } };
}

/** Removes the « ignore » rule at `index`. */
export function removeIgnoreText(preparation: Preparation, index: number): Preparation {
  return { ...preparation, ignoreTexts: preparation.ignoreTexts.filter((_, position) => position !== index) };
}

/** What a filter has left out so far. */
export interface FilterCounts {
  /** Entries left out, each counted once. */
  readonly ignored: number;
  /** For each « ignore » rule, in order, the entries it matches; an entry matched by two rules counts for both. */
  readonly ignoredPerRule: readonly number[];
}

/**
 * Decides, entry by entry, what a preparation leaves out. It keeps the counts of the entries it was asked about,
 * so use one filter per pass over a source (the scan and the preview each make their own).
 */
export interface EntryFilter {
  /** `true` when the entry is left out. */
  ignores(entry: LogEntry): boolean;
  counts(): FilterCounts;
}

/**
 * Builds the filter of a preparation. A rule looks at the whole retained text of an entry, stack included; for
 * an entry too long to be retained whole that is only its beginning (`LogEntry.truncated`).
 */
export function createEntryFilter(preparation: Preparation): EntryFilter {
  const rules = preparation.ignoreTexts.map((text) => text.toLowerCase());
  const perRule = rules.map(() => 0);
  let ignored = 0;

  return {
    ignores(entry) {
      if (rules.length === 0) {
        return false;
      }
      // Lower-cased once per entry, and only when there is a rule: this runs for every entry of a big file.
      const text = entry.text.toLowerCase();
      let matched = false;
      rules.forEach((rule, index) => {
        if (text.includes(rule)) {
          perRule[index] = (perRule[index] ?? 0) + 1;
          matched = true;
        }
      });
      if (matched) {
        ignored += 1;
      }
      return matched;
    },
    counts() {
      return { ignored, ignoredPerRule: [...perRule] };
    },
  };
}
