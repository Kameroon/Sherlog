import { useEffect, useId, useMemo, useState } from 'react';
import type { IdenticalErrors } from '../core/identicalErrors';
import { latestOccurrence } from '../core/identicalErrors';
import { REDACTION_RULES, rulesForSending } from '../core/redact';
import type { RedactionRuleId } from '../core/redact';
import type { ErrorRecord } from '../core/scanLog';
import { buildSendPayload } from '../core/sendPayload';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import { readFailureMessage } from '../sources/readFailure';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import { countOf, formatCount } from './format';

/** What the panel shows of the log it reads for one error: the reads in progress, the text, or why it could not be read. */
type Reading =
  | { readonly status: 'loading' }
  | { readonly status: 'done'; readonly entry: EntryText; readonly lines: NeighbourLines }
  | { readonly status: 'failed'; readonly message: string };

interface SendPanelProps {
  records: readonly ErrorRecord[];
  groups: ReadonlyMap<number, IdenticalErrors>;
  /** The fingerprints the user chose, in the order they were chosen. */
  chosen: ReadonlySet<number>;
  fileName: string;
  /** The masking rules the user chose in the preparation; the ones on by default are applied whatever they are. */
  masking: ReadonlySet<RedactionRuleId>;
  /** `true` when the format has dates: otherwise the most recent occurrence cannot be told from the times. */
  hasDate: boolean;
  /** `true` when errors past the record limit were not recorded, so that counts are minimums. */
  countIsMinimum: boolean;
  readText: (position: EntryPosition) => Promise<EntryText>;
  readNeighbours: (position: EntryPosition) => Promise<NeighbourLines>;
  onRemove: (fingerprintId: number) => void;
  onClear: () => void;
}

interface ItemProps extends Pick<SendPanelProps, 'fileName' | 'masking' | 'countIsMinimum' | 'readText' | 'readNeighbours'> {
  record: ErrorRecord;
  /** Number of the error in the log, from 1. */
  number: number;
  group: IdenticalErrors;
  byTime: boolean;
  hasDate: boolean;
  onRemove: () => void;
}

/** The text that would be sent for one error, read from the log when the user asks to see it, masked and cut like a request would. */
function ExactText({ record, number, group, fileName, masking, countIsMinimum, readText, readNeighbours }: Omit<ItemProps, 'byTime' | 'hasDate' | 'onRemove'>) {
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
        ? buildSendPayload(
            {
              fileName,
              count: group.count,
              countIsMinimum,
              firstSeen: group.first.timestamp,
              lastSeen: group.last.timestamp,
              entry: reading.entry.text,
              entryReadLimitReached: reading.entry.cut,
              before: reading.lines.before,
              after: reading.lines.after,
            },
            masking,
          )
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

function SendItem({ record, number, group, byTime, hasDate, onRemove, ...reading }: ItemProps) {
  const [shown, setShown] = useState(false);
  const textId = useId();
  const time = record.timestamp ?? 'sans heure';
  const which = group.count > 1 ? `, ${byTime ? 'la plus récente' : `la dernière lue (${hasDate ? 'aucune heure exploitable' : 'ce format n’a pas de date'})`}` : '';
  return (
    <li className="send-item">
      <p>
        <strong>Erreur {formatCount(number)}</strong> · {time} · {record.message}
        {group.count > 1 && ` · ${formatCount(group.count)} erreurs identiques`}
      </p>
      <p className="small-note">{`Occurrence envoyée : erreur ${formatCount(number)} (${time})${which}.`}</p>
      <div className="actions">
        <button type="button" className="button-secondary" aria-expanded={shown} aria-controls={textId} onClick={() => setShown(!shown)}>
          {shown ? 'Masquer le texte exact' : 'Voir le texte exact'}
        </button>
        <button type="button" className="button-link" aria-label={`Retirer l’erreur ${formatCount(number)} de l’envoi`} onClick={onRemove}>
          Retirer
        </button>
      </div>
      <div id={textId}>{shown && <ExactText record={record} number={number} group={group} {...reading} />}</div>
    </li>
  );
}

/**
 * The errors the user chose to have explained, and for each the exact text that would leave the browser: masked,
 * the lines around the error included, cut to the limit with the cut said. Nothing is sent from here: the choice of
 * the provider and the sending come with the next step, and the button says so. This text is what comes from the log;
 * the instructions to the model and a random delimiter are added at sending time (`docs/PROMPTS.md`).
 */
export function SendPanel({ records, groups, chosen, fileName, masking, hasDate, countIsMinimum, readText, readNeighbours, onRemove, onClear }: SendPanelProps) {
  const id = useId();
  const items = useMemo(
    () =>
      [...chosen].flatMap((fingerprintId) => {
        const latest = latestOccurrence(records, fingerprintId, hasDate);
        const group = groups.get(fingerprintId);
        const record = latest === null ? undefined : records[latest.index];
        return latest === null || group === undefined || record === undefined ? [] : [{ fingerprintId, record, number: latest.index + 1, group, byTime: latest.byTime }];
      }),
    [chosen, records, groups, hasDate],
  );
  const applied = REDACTION_RULES.filter((rule) => rulesForSending(masking).has(rule.id)).map((rule) => rule.label);

  return (
    <section className="panel send-panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Envoi à l’IA</h2>
      <p className="small-note">
        Vous choisissez les erreurs à faire expliquer, une par erreur distincte ; le texte envoyé est celui de l’occurrence retenue. Il est tout ce qui vient de votre journal : les consignes données au modèle s’y ajoutent au moment de l’envoi.
      </p>
      {masking.size === 0 && (
        <p className="notice notice-warning">
          Aucun masquage choisi dans la préparation : seuls les masquages automatiques sont appliqués à l’envoi.
        </p>
      )}
      <p className="small-note">Masquages appliqués : {applied.join(', ')}.</p>
      {items.length === 0 ? (
        <p>Aucune erreur choisie.</p>
      ) : (
        <>
          <ul className="send-items">
            {items.map((item) => (
              <SendItem
                key={item.fingerprintId}
                record={item.record}
                number={item.number}
                group={item.group}
                byTime={item.byTime}
                hasDate={hasDate}
                fileName={fileName}
                masking={masking}
                countIsMinimum={countIsMinimum}
                readText={readText}
                readNeighbours={readNeighbours}
                onRemove={() => {
                  onRemove(item.fingerprintId);
                }}
              />
            ))}
          </ul>
          {items.length > 1 && (
            <button type="button" className="button-link" onClick={onClear}>
              Tout retirer
            </button>
          )}
        </>
      )}
      <div className="actions">
        <button type="button" className="button-primary" disabled>
          Envoyer à l’IA
        </button>
      </div>
      <p className="small-note">Pas encore disponible : le fournisseur (Anthropic ou Ollama) se choisit à l’étape suivante. Rien n’a été envoyé.</p>
    </section>
  );
}
