import { useEffect, useMemo, useState } from 'react';
import type { IdenticalErrors } from '../core/identicalErrors';
import type { RedactionRuleId } from '../core/redact';
import type { ErrorRecord } from '../core/scanLog';
import { buildSendPayload } from '../core/sendPayload';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import { readFailureMessage } from '../sources/readFailure';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import { countOf } from './format';
import { sendSourceOf } from './sendSource';

/** What the panel shows of the log it reads for one error: the reads in progress, the text, or why it could not be read. */
type Reading =
  | { readonly status: 'loading' }
  | { readonly status: 'done'; readonly entry: EntryText; readonly lines: NeighbourLines }
  | { readonly status: 'failed'; readonly message: string };

export interface ExactTextProps {
  /** The most recent occurrence of the error, which is the one that is sent. */
  record: ErrorRecord;
  /** Number of the error in the log, from 1. */
  number: number;
  group: IdenticalErrors;
  fileName: string;
  /** The masking rules the user chose in the preparation; the ones on by default are applied whatever they are. */
  masking: ReadonlySet<RedactionRuleId>;
  /** `true` when errors past the record limit were not recorded, so that counts are minimums. */
  countIsMinimum: boolean;
  readText: (position: EntryPosition) => Promise<EntryText>;
  readNeighbours: (position: EntryPosition) => Promise<NeighbourLines>;
}

/** The text that would be sent for one error, read from the log when the user asks to see it, masked and cut like a request would. */
export function ExactText({ record, number, group, fileName, masking, countIsMinimum, readText, readNeighbours }: ExactTextProps) {
  const [reading, setReading] = useState<Reading>({ status: 'loading' });

  useEffect(() => {
    // The user may hide the text or change the error before the reads end: an answer that comes late is dropped.
    let current = true;
    Promise.all([readText(record), readNeighbours(record)]).then(
      ([entry, lines]) => {
        if (current) {
          setReading({ status: 'done', entry, lines });
        }
      },
      (error: unknown) => {
        if (current) {
          setReading({ status: 'failed', message: readFailureMessage(error) });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [record, readText, readNeighbours]);

  // Masking is applied here, not when reading: a change of the rules in the preparation shows at once, with no new read.
  const payload = useMemo(
    () =>
      reading.status === 'done'
        ? buildSendPayload(sendSourceOf({ fileName, group, countIsMinimum, entry: reading.entry, lines: reading.lines }), masking)
        : null,
    [reading, fileName, group, countIsMinimum, masking],
  );

  if (reading.status === 'loading') {
    return (
      <p className="hint" role="status">
        Lecture du texte dans le fichier…
      </p>
    );
  }
  if (reading.status === 'failed') {
    return (
      <p className="notice notice-error" role="alert">
        {reading.message}
      </p>
    );
  }
  if (payload === null) {
    return null;
  }
  return (
    <>
      <p className="small-note">
        {payload.maskedCount === 0 ? 'Aucune donnée masquée dans ce texte.' : `${countOf(payload.maskedCount, 'donnée masquée', 'données masquées')} dans ce texte.`}
      </p>
      <pre className="entry-text" role="region" aria-label={`Texte exact envoyé pour l’erreur ${number}`} tabIndex={0}>
        {payload.text}
      </pre>
      {payload.note !== null && <p className="notice notice-warning">{payload.note}</p>}
    </>
  );
}
