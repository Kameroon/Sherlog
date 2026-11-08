import type { LogEntry } from './entryAssembler';

/**
 * What the user sets before the analysis. Plain data, so that it can be sent to the worker as it is. The source
 * file is never changed: a preparation only decides which entries are kept for the analysis (SPEC §3).
 */
export interface Preparation {
  /** Entries whose text contains one of these texts are left out; compared without regard to case. */
  readonly ignoreTexts: readonly string[];
  /** Entries outside this period are left out. */
  readonly period: Period;
}

/**
 * The part of the log to keep, by two bounds written the way the screen's fields give them: `HH:MM` for a log that
 * only has times of day, `YYYY-MM-DDTHH:MM` for one that has dates. An empty bound is no limit. The end minute is
 * included to its last second. The times are the ones written in the log: a UTC offset is not read.
 */
export interface Period {
  readonly from: string;
  readonly to: string;
}

export const NO_PERIOD: Period = { from: '', to: '' };

export const EMPTY_PREPARATION: Preparation = { ignoreTexts: [], period: NO_PERIOD };

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

const TIME_BOUND = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_TIME_BOUND = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)$/;

type BoundKind = 'time' | 'dateTime';

function kindOf(bound: string): BoundKind | null {
  if (TIME_BOUND.test(bound)) {
    return 'time';
  }
  return DATE_TIME_BOUND.test(bound) ? 'dateTime' : null;
}

/**
 * Tells why a period cannot be used, or `null` when it can. Refused: a bound that is not a time or a date with a
 * time, a time of day with a date, an end before the start. A passage through midnight is not guessed: it is refused.
 */
export function validatePeriod({ from, to }: Period): string | null {
  const bounds = [from, to].filter((bound) => bound !== '');
  const kinds = bounds.map(kindOf);
  if (kinds.includes(null)) {
    return 'Heure ou date invalide.';
  }
  if (new Set(kinds).size > 1) {
    return 'Le début et la fin doivent être du même type : des heures, ou des dates avec heure.';
  }
  // Seconds are added so that the end minute counts to its last second: 10:00 as an end keeps 10:00:59.
  if (from !== '' && to !== '' && `${from}:00` > `${to}:59`) {
    return 'La fin doit suivre le début : un passage de minuit n’est pas géré.';
  }
  return null;
}

const TIME_OF_DAY = /(\d{2}:\d{2}:\d{2})/;
const DATE_AND_TIME = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;

/** The timestamp as a string that sorts like time, in the shape of the period's bounds; `null` when it cannot be placed. */
function placeOf(timestamp: string | null, kind: BoundKind): string | null {
  if (timestamp === null) {
    return null;
  }
  if (kind === 'time') {
    return TIME_OF_DAY.exec(timestamp)?.[1] ?? null;
  }
  const found = DATE_AND_TIME.exec(timestamp);
  return found === null ? null : `${found[1] ?? ''}T${found[2] ?? ''}`;
}

/** Builds the test « is this entry outside the period », or `null` when there is nothing to test. */
function outsideTest(period: Period): ((entry: LogEntry) => boolean) | null {
  const first = [period.from, period.to].find((bound) => bound !== '');
  const kind = first === undefined ? null : kindOf(first);
  if (kind === null || validatePeriod(period) !== null) {
    return null;
  }
  // The bounds are written with the T of the date field; a time of day has none.
  const start = period.from === '' ? null : `${period.from}:00`;
  const end = period.to === '' ? null : `${period.to}:59`;
  return (entry) => {
    const place = placeOf(entry.timestamp, kind);
    if (place === null) {
      return false;
    }
    return (start !== null && place < start) || (end !== null && place > end);
  };
}

/** What a filter has left out so far. */
export interface FilterCounts {
  /** Entries left out, each counted once. */
  readonly ignored: number;
  /** For each « ignore » rule, in order, the entries it matches; an entry matched by two rules counts for both. */
  readonly ignoredPerRule: readonly number[];
  /** Entries outside the period, whether or not a rule also matches them. */
  readonly ignoredByPeriod: number;
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
 * an entry too long to be retained whole that is only its beginning (`LogEntry.truncated`). An entry whose
 * timestamp cannot be placed in the period (none, or a time where a date is needed) is kept: nothing says it is outside.
 *
 * A period that is not valid is not applied; callers refuse it first with {@link validatePeriod}.
 */
export function createEntryFilter(preparation: Preparation): EntryFilter {
  const rules = preparation.ignoreTexts.map((text) => text.toLowerCase());
  const perRule = rules.map(() => 0);
  const outside = outsideTest(preparation.period);
  let ignored = 0;
  let ignoredByPeriod = 0;

  return {
    ignores(entry) {
      let matched = false;
      if (rules.length > 0) {
        // Lower-cased once per entry, and only when there is a rule: this runs for every entry of a big file.
        const text = entry.text.toLowerCase();
        rules.forEach((rule, index) => {
          if (text.includes(rule)) {
            perRule[index] = (perRule[index] ?? 0) + 1;
            matched = true;
          }
        });
      }
      if (outside?.(entry) === true) {
        ignoredByPeriod += 1;
        matched = true;
      }
      if (matched) {
        ignored += 1;
      }
      return matched;
    },
    counts() {
      return { ignored, ignoredPerRule: [...perRule], ignoredByPeriod };
    },
  };
}
