import type { IdenticalErrors } from './identicalErrors';
import type { ErrorRecord } from './scanLog';

export type SortKey = 'reading' | 'time' | 'severity' | 'count';
export type SortDirection = 'asc' | 'desc';

/** How the list of errors is narrowed and ordered. Nothing here changes the records themselves. */
export interface ErrorViewOptions {
  /** Text to find in the time, the level and the message of an error; blank means no search. */
  readonly search: string;
  /** Level, exactly as written in the log, to keep; `null` keeps every level. */
  readonly level: string | null;
  readonly sortKey: SortKey;
  readonly direction: SortDirection;
}

export const DEFAULT_ERROR_VIEW: ErrorViewOptions = { search: '', level: null, sortKey: 'reading', direction: 'asc' };

// The two kinds of timestamp the built-in profiles can give; the same shapes as the period of the preparation, with
// the fraction of second kept so that two errors in the same second still sort. The offset (`+01:00`) is not read.
const DATE_AND_TIME = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/;
const TIME_OF_DAY = /(\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/;

/** A string that sorts like time, or `null` when the timestamp is missing or cannot be placed. */
function timeKey(timestamp: string | null): string | null {
  if (timestamp === null) {
    return null;
  }
  const dated = DATE_AND_TIME.exec(timestamp);
  const key = dated === null ? TIME_OF_DAY.exec(timestamp)?.[1] : `${dated[1] ?? ''}T${dated[2] ?? ''}`;
  return key === undefined ? null : key.replace(',', '.');
}

const FATAL_LEVELS: ReadonlySet<string> = new Set(['FATAL', 'FTL', 'CRITICAL']);

/** 2 for the levels above « error » (fatal, critical), 1 for the others, which are all errors. */
const severityOf = (level: string): number => (FATAL_LEVELS.has(level.toUpperCase()) ? 2 : 1);

/** The levels present in the errors, each once as written, in the order they first appear. */
export function distinctLevels(records: readonly ErrorRecord[]): readonly string[] {
  return [...new Set(records.map((record) => record.level))];
}

function matchesSearch(record: ErrorRecord, needle: string): boolean {
  return `${record.timestamp ?? ''} ${record.level} ${record.message}`.toLowerCase().includes(needle);
}

/** Orders the indices by a key worked out once per index, not once per comparison: the lists hold up to 100 000 errors. */
function sortByKey<Key>(indices: number[], keyOf: (index: number) => Key, compare: (left: Key, right: Key) => number): void {
  const entries = indices.map((index) => ({ index, key: keyOf(index) }));
  entries.sort((left, right) => compare(left.key, right.key));
  entries.forEach((entry, position) => {
    indices[position] = entry.index;
  });
}

/** Compares numbers, the direction applying to them. */
const byNumber =
  (direction: SortDirection) =>
  (left: number, right: number): number =>
    (direction === 'asc' ? 1 : -1) * (left - right);

/** Compares times; the errors without a usable time stay at the end, whatever the direction. */
const byTime =
  (direction: SortDirection) =>
  (left: string | null, right: string | null): number => {
    if (left === null || right === null) {
      return left === right ? 0 : left === null ? 1 : -1;
    }
    if (left === right) {
      return 0;
    }
    return (left < right ? -1 : 1) * (direction === 'asc' ? 1 : -1);
  };

/**
 * Chooses which errors the list shows and in what order: the search and the level filter first, then the sort.
 * Equal errors keep their reading order (the sort of arrays is stable).
 *
 * @returns Positions in `records`, so the caller can tell an error by its place in the whole list. The search covers
 * what the records hold, that is the time, the level and the message cut at its limit; the stack is not read.
 */
export function buildErrorView(records: readonly ErrorRecord[], groups: ReadonlyMap<number, IdenticalErrors>, options: ErrorViewOptions): readonly number[] {
  const needle = options.search.trim().toLowerCase();
  const indices: number[] = [];
  records.forEach((record, index) => {
    if ((options.level === null || record.level === options.level) && (needle === '' || matchesSearch(record, needle))) {
      indices.push(index);
    }
  });

  switch (options.sortKey) {
    case 'reading':
      if (options.direction === 'desc') {
        indices.reverse();
      }
      break;
    case 'time':
      sortByKey(indices, (index) => timeKey(records[index]?.timestamp ?? null), byTime(options.direction));
      break;
    case 'severity':
      sortByKey(indices, (index) => severityOf(records[index]?.level ?? ''), byNumber(options.direction));
      break;
    case 'count':
      sortByKey(indices, (index) => groups.get(records[index]?.fingerprintId ?? -1)?.count ?? 1, byNumber(options.direction));
      break;
  }
  return indices;
}
