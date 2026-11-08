import type { ErrorRecord } from './scanLog';

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
