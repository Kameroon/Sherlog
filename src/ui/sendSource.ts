import type { IdenticalErrors } from '../core/identicalErrors';
import type { SendSource } from '../core/sendPayload';
import type { EntryText } from '../sources/readEntryText';
import type { NeighbourLines } from '../sources/readNeighbourLines';

interface SendSourceInput {
  readonly fileName: string;
  /** The errors that share the fingerprint of the one sent. */
  readonly group: IdenticalErrors;
  readonly countIsMinimum: boolean;
  /** The entry of the most recent occurrence, as read from the log. */
  readonly entry: EntryText;
  readonly lines: NeighbourLines;
}

/**
 * What is known of the error that is sent, from what was read of the log. The preview of the exact text and the real
 * sending both start from here, so that what the user saw is what leaves (ADR-016, ADR-018).
 */
export function sendSourceOf({ fileName, group, countIsMinimum, entry, lines }: SendSourceInput): SendSource {
  return {
    fileName,
    count: group.count,
    countIsMinimum,
    firstSeen: group.first.timestamp,
    lastSeen: group.last.timestamp,
    entry: entry.text,
    entryReadLimitReached: entry.cut,
    before: lines.before,
    after: lines.after,
  };
}
