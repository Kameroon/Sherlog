import { useState } from 'react';
import type { ErrorRecord } from '../core/scanLog';
import type { EntryPosition } from '../sources/readEntryText';
import { readFailureMessage } from '../sources/readFailure';

/**
 * Rows shown at once. The list is not virtualised yet (step 5): showing every error of a big file would freeze
 * the page, so the limit is stated on screen. Provisional, to be set from a measurement.
 */
export const MAX_DISPLAYED_ERRORS = 200;

type EntryText =
  | { readonly status: 'closed' }
  | { readonly status: 'loading' }
  | { readonly status: 'open'; readonly text: string }
  | { readonly status: 'failed'; readonly message: string };

interface ErrorRowProps {
  record: ErrorRecord;
  position: number;
  readText: (position: EntryPosition) => Promise<string>;
}

function ErrorRow({ record, position, readText }: ErrorRowProps) {
  const [entry, setEntry] = useState<EntryText>({ status: 'closed' });
  const textId = `entry-text-${position}`;
  const isOpen = entry.status === 'open';

  function toggle(): void {
    if (isOpen) {
      setEntry({ status: 'closed' });
      return;
    }
    setEntry({ status: 'loading' });
    readText(record).then(
      (text) => {
        setEntry({ status: 'open', text });
      },
      (error: unknown) => {
        setEntry({ status: 'failed', message: readFailureMessage(error) });
      },
    );
  }

  return (
    <li className="error-row">
      <div className="error-line">
        {record.timestamp !== null && <span className="error-time">{record.timestamp}</span>}
        <span className="error-level">{record.level}</span>
        <span className="error-first-line">{`${record.firstLine}${record.firstLineCut ? '…' : ''}`}</span>
        <button
          type="button"
          className="button-link"
          aria-expanded={isOpen}
          aria-controls={isOpen ? textId : undefined}
          disabled={entry.status === 'loading'}
          onClick={toggle}
        >
          {isOpen ? 'Masquer le texte' : 'Voir le texte'}
          <span className="visually-hidden"> de l’entrée {position}</span>
        </button>
      </div>
      {entry.status === 'open' && (
        <pre id={textId} className="entry-text" role="region" aria-label={`Texte de l’entrée ${position}`} tabIndex={0}>
          {entry.text}
        </pre>
      )}
      {entry.status === 'failed' && (
        <p className="notice notice-error" role="alert">
          {entry.message}
        </p>
      )}
    </li>
  );
}

interface ErrorListProps {
  records: readonly ErrorRecord[];
  readText: (position: EntryPosition) => Promise<string>;
}

/** Plain list of the errors found: when, how bad, first line, and the whole text on demand. Text only, never markup. */
export function ErrorList({ records, readText }: ErrorListProps) {
  const shown = records.slice(0, MAX_DISPLAYED_ERRORS);
  return (
    <>
      {records.length > shown.length && (
        <p className="notice notice-warning">
          Les {shown.length} premières erreurs sur {records.length} sont affichées.
        </p>
      )}
      <ol className="error-list" aria-label="Erreurs">
        {shown.map((record, index) => (
          <ErrorRow key={record.offset} record={record} position={index + 1} readText={readText} />
        ))}
      </ol>
    </>
  );
}
