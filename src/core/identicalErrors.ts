import type { ErrorRecord } from './scanLog';
import { timeKey } from './timeKey';

/** The errors that share one fingerprint: how many, and where the first and the last one are. */
export interface IdenticalErrors {
  readonly count: number;
  /** First one in reading order. */
  readonly first: ErrorRecord;
  /** Last one in reading order, which is not always the latest in time: a log is not always in time order. */
  readonly last: ErrorRecord;
  /** Position of `first` in the list of records. */
  readonly firstIndex: number;
  /** Position of `last` in the list of records. */
  readonly lastIndex: number;
}

/**
 * Groups the recorded errors by fingerprint, in one pass. The counts are those of the errors that were recorded: past
 * the record limit the later ones were counted but not kept, so a count can be lower than the real one.
 *
 * @returns The group of each fingerprint id that has at least one error.
 */
export function summariseIdentical(records: readonly ErrorRecord[]): ReadonlyMap<number, IdenticalErrors> {
  const groups = new Map<number, { count: number; first: ErrorRecord; last: ErrorRecord; firstIndex: number; lastIndex: number }>();
  records.forEach((record, index) => {
    const group = groups.get(record.fingerprintId);
    if (group === undefined) {
      groups.set(record.fingerprintId, { count: 1, first: record, last: record, firstIndex: index, lastIndex: index });
    } else {
      group.count += 1;
      group.last = record;
      group.lastIndex = index;
    }
  });
  return groups;
}

/** The error that stands for a fingerprint, and why it was chosen. */
export interface LatestOccurrence {
  /** Position in the list of records. */
  readonly index: number;
  /** `true` when it has the greatest time; `false` when it is only the last one read. */
  readonly byTime: boolean;
}

/**
 * The most recent error of a fingerprint (SPEC §3): the greatest time, the last one read when times are equal. Without
 * a date in the format the times of a day cannot be compared (a log can pass midnight), and when no error has a time
 * that can be placed there is nothing to compare: the last one read stands in, and `byTime` says so.
 *
 * @returns `null` when no recorded error has this fingerprint.
 */
export function latestOccurrence(records: readonly ErrorRecord[], fingerprintId: number, hasDate: boolean): LatestOccurrence | null {
  let lastRead = -1;
  let latest = -1;
  let latestKey: string | null = null;
  records.forEach((record, index) => {
    if (record.fingerprintId !== fingerprintId) {
      return;
    }
    lastRead = index;
    const key = hasDate ? timeKey(record.timestamp) : null;
    if (key !== null && (latestKey === null || key >= latestKey)) {
      latest = index;
      latestKey = key;
    }
  });
  if (lastRead === -1) {
    return null;
  }
  return latest === -1 ? { index: lastRead, byTime: false } : { index: latest, byTime: true };
}
