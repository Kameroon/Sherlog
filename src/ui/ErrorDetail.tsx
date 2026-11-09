import { useEffect, useId, useState } from 'react';
import type { ErrorStatus } from '../core/errorStatus';
import type { IdenticalErrors } from '../core/identicalErrors';
import type { ErrorRecord } from '../core/scanLog';
import { MAX_ENTRY_TEXT_BYTES } from '../sources/readEntryText';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import { readFailureMessage } from '../sources/readFailure';
import { MAX_NEIGHBOUR_BYTES, NEIGHBOUR_LINES } from '../sources/readNeighbourLines';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import { formatCount, formatSize } from './format';
import { STATUS_CHOICES } from './statusLabels';

/** What the panel shows of the selected entry: the read in progress, the text, or why it could not be read. */
type Reading =
  | { readonly status: 'loading' }
  | ({ readonly status: 'done' } & EntryText)
  | { readonly status: 'failed'; readonly message: string };

/** What the panel shows of the lines around the error, like {@link Reading} for the entry. */
type NeighbourReadingState =
  | { readonly status: 'loading' }
  | ({ readonly status: 'done' } & NeighbourLines)
  | { readonly status: 'failed'; readonly message: string };

interface ErrorDetailProps {
  /** The selected error, or `null` when none is. Give the panel a `key` that changes with it: each error is its own read. */
  record: ErrorRecord | null;
  /** Position of the error in the list, from 1. */
  position: number;
  readText: (position: EntryPosition) => Promise<EntryText>;
  /** Reads the lines around the error; called only when the user asks to see them. */
  readNeighbours: (position: EntryPosition) => Promise<NeighbourLines>;
  /** The errors that share the fingerprint of this one, if any. */
  identical?: IdenticalErrors;
  /** `true` when errors past the record limit were not recorded: the count of identical errors is then a minimum. */
  countIsMinimum?: boolean;
  /** Status of the selected error; it is shared by the errors identical to it. */
  status?: ErrorStatus;
  onStatusChange?: (status: ErrorStatus) => void;
  /** The choice to have the error explained by the model, which holds for the errors identical to it. */
  sendChoice?: SendChoice;
}

/** The choice to send an error, and the occurrence of its fingerprint that would be sent. */
export interface SendChoice {
  readonly chosen: boolean;
  readonly onChange: (chosen: boolean) => void;
  /** `true` when the format has dates, so that the most recent occurrence can be told from the times. */
  readonly hasDate: boolean;
  /** The most recent occurrence: its number in the log, its time, and whether the time decided it. `null` when unknown. */
  readonly latest: { readonly number: number; readonly time: string | null; readonly byTime: boolean } | null;
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

/** The status of the error, which the user sets; it holds for every error that has the same fingerprint. */
function StatusPicker({ status, onChange, twins }: { status: ErrorStatus; onChange: (status: ErrorStatus) => void; twins: number }) {
  const id = useId();
  return (
    <div className="status-picker">
      <label htmlFor={id}>Statut de cette erreur</label>
      <select
        id={id}
        className="select"
        value={status}
        onChange={(event) => {
          onChange(STATUS_CHOICES.find((choice) => choice.status === event.target.value)?.status ?? 'new');
        }}
      >
        {STATUS_CHOICES.map((choice) => (
          <option key={choice.status} value={choice.status}>
            {choice.label}
          </option>
        ))}
      </select>
      {twins > 1 && <p className="small-note">{`Ce statut vaut aussi pour les ${formatCount(twins)} erreurs identiques.`}</p>}
    </div>
  );
}

/** « Faire expliquer par l'IA »: nothing is chosen by default, and choosing sends nothing yet. */
function SendChoicePicker({ choice, twins }: { choice: SendChoice; twins: number }) {
  const id = useId();
  return (
    <div className="send-choice">
      <label className="mask-rule-label" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={choice.chosen}
          onChange={(event) => {
            choice.onChange(event.target.checked);
          }}
        />
        <span>Faire expliquer cette erreur par l’IA</span>
      </label>
      <p className="small-note">
        {twins > 1 ? `Ce choix vaut pour les ${formatCount(twins)} erreurs identiques. ` : ''}Rien n’est envoyé sans votre décision, après l’aperçu du texte exact.
      </p>
      {twins > 1 && choice.latest !== null && (
        <p className="small-note">
          {`Occurrence retenue pour l’analyse : erreur ${formatCount(choice.latest.number)} (${choice.latest.time ?? 'sans heure'}), ${choice.latest.byTime ? 'la plus récente' : `la dernière lue${choice.hasDate ? '' : ' : ce format n’a pas de date'}`}.`}
        </p>
      )}
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

/** One side of the neighbour lines: the lines, or why there are none, and a warning when the read limit hid some. */
function NeighbourSide({ side, lines, limited, position }: { side: 'before' | 'after'; lines: readonly string[]; limited: boolean; position: number }) {
  const isBefore = side === 'before';
  const title = isBefore ? 'Lignes avant' : 'Lignes après';
  return (
    <div className="neighbour-side">
      <h3>{title}</h3>
      {lines.length > 0 ? (
        <pre className="entry-text" role="region" aria-label={`${title} l’erreur ${position}`} tabIndex={0}>
          {lines.join('\n')}
        </pre>
      ) : (
        <p className="hint">
          {isBefore ? 'Aucune ligne avant : l’erreur est au début du journal.' : 'Aucune ligne après : l’erreur est à la fin du journal.'}
        </p>
      )}
      {limited && (
        <p className="notice notice-warning">
          {`Lecture limitée aux ${formatSize(MAX_NEIGHBOUR_BYTES)} qui ${isBefore ? 'précèdent' : 'suivent'} l’erreur : il peut manquer des lignes (${NEIGHBOUR_LINES} demandées).`}
        </p>
      )}
    </div>
  );
}

function NeighbourReading({ record, position, readNeighbours }: { record: ErrorRecord; position: number; readNeighbours: ErrorDetailProps['readNeighbours'] }) {
  const [reading, setReading] = useState<NeighbourReadingState>({ status: 'loading' });

  useEffect(() => {
    // The user may hide the lines before this read ends: an answer that comes late is dropped.
    let current = true;
    readNeighbours(record).then(
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
  }, [record, readNeighbours]);

  switch (reading.status) {
    case 'loading':
      return (
        <p className="hint" role="status">
          Lecture des lignes autour de l’erreur…
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
            Lignes autour de l’erreur {position} affichées.
          </p>
          <p className="small-note">Lignes du fichier, quelle que soit l’entrée à laquelle elles appartiennent.</p>
          <NeighbourSide side="before" lines={reading.before} limited={reading.beforeLimited} position={position} />
          <NeighbourSide side="after" lines={reading.after} limited={reading.afterLimited} position={position} />
        </>
      );
  }
}

/** « Voir les lignes autour »: the lines of the file around the error, read only when asked for. */
function NeighbourPanel({ record, position, readNeighbours }: { record: ErrorRecord; position: number; readNeighbours: ErrorDetailProps['readNeighbours'] }) {
  const [shown, setShown] = useState(false);
  const panelId = useId();
  return (
    <div className="neighbours">
      <button type="button" className="button-secondary" aria-expanded={shown} aria-controls={panelId} onClick={() => setShown(!shown)}>
        {shown ? 'Masquer les lignes autour' : 'Voir les lignes autour'}
      </button>
      <div id={panelId} className="neighbour-lines">
        {shown && <NeighbourReading record={record} position={position} readNeighbours={readNeighbours} />}
      </div>
    </div>
  );
}

/** The whole text of the selected error, with its stack, read again from the file; text only, never markup. */
export function ErrorDetail({ record, position, readText, readNeighbours, identical, countIsMinimum = false, status = 'new', onStatusChange, sendChoice }: ErrorDetailProps) {
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
          {onStatusChange !== undefined && <StatusPicker status={status} onChange={onStatusChange} twins={identical?.count ?? 1} />}
          {sendChoice !== undefined && <SendChoicePicker choice={sendChoice} twins={identical?.count ?? 1} />}
          {identical !== undefined && identical.count > 1 && <IdenticalSummary identical={identical} countIsMinimum={countIsMinimum} />}
          <EntryReading record={record} position={position} readText={readText} />
          <NeighbourPanel record={record} position={position} readNeighbours={readNeighbours} />
        </>
      )}
    </section>
  );
}
