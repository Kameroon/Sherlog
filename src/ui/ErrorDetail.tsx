import { useEffect, useId, useState } from 'react';
import type { ErrorRecord } from '../core/scanLog';
import { MAX_ENTRY_TEXT_BYTES } from '../sources/readEntryText';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import { readFailureMessage } from '../sources/readFailure';
import { formatSize } from './format';

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
export function ErrorDetail({ record, position, readText }: ErrorDetailProps) {
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
          <EntryReading record={record} position={position} readText={readText} />
        </>
      )}
    </section>
  );
}
