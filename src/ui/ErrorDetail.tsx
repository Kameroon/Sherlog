import { useEffect, useId, useState } from 'react';
import type { IdenticalErrors } from '../core/identicalErrors';
import type { ErrorRecord } from '../core/scanLog';
import { MAX_ENTRY_TEXT_BYTES } from '../sources/readEntryText';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import { readFailureMessage } from '../sources/readFailure';
import { formatCount, formatSize } from './format';

/** What the panel shows of the selected entry: the read in progress, the text, or why it could not be read. */
type Reading =
  | { readonly status: 'loading' }
  | ({ readonly status: 'done' } & EntryText)
  | { readonly status: 'failed'; readonly message: string };

interface ErrorDetailProps {
  /** The selected error, or `null` when none is. Give the panel a `key` that changes with it: each error is its own read. */
  record: ErrorRecord | null;
  /** Position of the error in the list, from 1. */
  position: number;
  readText: (position: EntryPosition) => Promise<EntryText>;
  /** The errors that share the fingerprint of this one, if any. */
  identical?: IdenticalErrors;
  /** `true` when errors past the record limit were not recorded: the count of identical errors is then a minimum. */
  countIsMinimum?: boolean;
}

/** `08:00:00`, or « sans heure » for an entry that has none. */
const timeOf = (record: ErrorRecord): string => record.timestamp ?? 'sans heure';

function IdenticalSummary({ identical, countIsMinimum }: { identical: IdenticalErrors; countIsMinimum: boolean }) {
  return (
    <div className="identical">
      <p>
        {countIsMinimum ? 'Au moins ' : ''}
        {formatCount(identical.count)} erreurs identiques parmi les erreurs enregistrées.
      </p>
      <p className="small-note">
        {`Première : ${timeOf(identical.first)} (erreur ${formatCount(identical.firstIndex + 1)}). Dernière : ${timeOf(identical.last)} (erreur ${formatCount(identical.lastIndex + 1)}), dans l’ordre de lecture du journal.`}
      </p>
    </div>
  );
}

function EntryReading({ record, position, readText }: { record: ErrorRecord; position: number; readText: ErrorDetailProps['readText'] }) {
  const [reading, setReading] = useState<Reading>({ status: 'loading' });

  useEffect(() => {
    // The user may select another error before this read ends: an answer that comes late is dropped.
    let current = true;
    readText(record).then(
      (read) => {
        if (current) {
          setReading({ status: 'done', ...read });
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
  }, [record, readText]);

  switch (reading.status) {
    case 'loading':
      return (
        <p className="hint" role="status">
          Lecture de l’entrée dans le fichier…
        </p>
      );
    case 'failed':
      return (
        <p className="notice notice-error" role="alert">
          {reading.message}
        </p>
      );
    case 'done':
      return (
        <>
          <p className="visually-hidden" role="status">
            Détail de l’erreur {position} affiché.
          </p>
          {reading.cut && (
            <p className="notice notice-warning">
              Cette entrée fait {formatSize(record.length)} : seul son début ({formatSize(MAX_ENTRY_TEXT_BYTES)}) est affiché.
            </p>
          )}
          <pre className="entry-text" role="region" aria-label={`Texte de l’erreur ${position}`} tabIndex={0}>
            {reading.text}
          </pre>
        </>
      );
  }
}

/** The whole text of the selected error, with its stack, read again from the file; text only, never markup. */
export function ErrorDetail({ record, position, readText, identical, countIsMinimum = false }: ErrorDetailProps) {
  const titleId = useId();
  return (
    <section className="error-detail" aria-labelledby={titleId}>
      <h2 id={titleId}>{record === null ? 'Détail' : `Détail de l’erreur ${position}`}</h2>
      {record === null ? (
        <p className="hint">Sélectionnez une erreur pour voir son détail : Entrée ou Espace dans la liste, ou un clic.</p>
      ) : (
        <>
          <p className="error-meta">
            {record.timestamp !== null && <span className="error-time">{record.timestamp}</span>}
            <span className="error-level">{record.level}</span>
          </p>
          {identical !== undefined && identical.count > 1 && <IdenticalSummary identical={identical} countIsMinimum={countIsMinimum} />}
          <EntryReading record={record} position={position} readText={readText} />
        </>
      )}
    </section>
  );
}
