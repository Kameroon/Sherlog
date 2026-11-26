import type { IdenticalErrors } from '../core/identicalErrors';
import { latestOccurrence } from '../core/identicalErrors';
import type { RedactionRuleId } from '../core/redact';
import type { ErrorRecord } from '../core/scanLog';
import { buildSendPayload } from '../core/sendPayload';
import type { SendPayload } from '../core/sendPayload';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import { readFailureMessage } from '../sources/readFailure';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import { sendSourceOf } from './sendSource';

/** How a screen reaches the log of an analysis: the errors found, and the reads of their text in the file. */
export interface LogAccess {
  readonly records: readonly ErrorRecord[];
  readonly groups: ReadonlyMap<number, IdenticalErrors>;
  readonly fileName: string;
  readonly hasDate: boolean;
  readonly countIsMinimum: boolean;
  readonly readText: (position: EntryPosition) => Promise<EntryText>;
  readonly readNeighbours: (position: EntryPosition) => Promise<NeighbourLines>;
}

export interface PayloadInputs extends LogAccess {
  readonly fingerprintId: number;
}

export type ReadPayload =
  | { readonly ok: true; readonly payload: SendPayload }
  /** `aborted` is `true` when the read was given up: there is then nothing to tell the user. */
  | { readonly ok: false; readonly aborted: boolean; readonly message: string };

/**
 * Reads, from the log, the most recent occurrence of a fingerprint and the lines around it, and builds what would be
 * sent of it (`buildSendPayload`: masked, then cut). The analysis and the chat both start here, from the same function
 * as the preview of the exact text, so that what the user saw is what leaves (ADR-016, ADR-018).
 */
export async function readPayload(inputs: PayloadInputs, masking: ReadonlySet<RedactionRuleId>, signal: AbortSignal): Promise<ReadPayload> {
  const { records, groups, fingerprintId, hasDate, fileName, countIsMinimum, readText, readNeighbours } = inputs;
  const found = latestOccurrence(records, fingerprintId, hasDate);
  const record = found === null ? undefined : records[found.index];
  const group = groups.get(fingerprintId);
  if (record === undefined || group === undefined) {
    return { ok: false, aborted: false, message: 'Cette erreur n’est plus dans la liste.' };
  }
  try {
    const [entry, lines] = await Promise.all([readText(record), readNeighbours(record)]);
    return { ok: true, payload: buildSendPayload(sendSourceOf({ fileName, group, countIsMinimum, entry, lines }), masking) };
  } catch (error) {
    return signal.aborted ? { ok: false, aborted: true, message: '' } : { ok: false, aborted: false, message: readFailureMessage(error) };
  }
}
