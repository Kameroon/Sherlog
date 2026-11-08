import { useId } from 'react';
import { BUILT_IN_PROFILES } from '../core/profiles';
import type { OtherFormatLines } from '../core/previewHead';
import type { LogProfile } from '../core/profiles';

interface FormatPanelProps {
  /** The format the log is read with; `null` when none was recognised and none was picked yet. */
  profile: LogProfile | null;
  /** The format the detection recognised, if any: tells a recognised format from one the user picked. */
  recognised: LogProfile | null;
  /** Why no format was recognised, when that is the case. */
  unrecognisedReason: string | null;
  /** Lines before the first entry header: kept, but never counted as errors. */
  orphanLines: number;
  /** `true` when no line of the beginning is an entry header of the format. */
  readsNothing: boolean;
  /** Lines that look like another known format, to point out a log that mixes layouts. */
  otherFormat: OtherFormatLines;
  /** `true` when the lines are those of the whole log, not only of its beginning. */
  complete: boolean;
  onChange: (profile: LogProfile) => void;
}

/** The format the log is read with, a way to pick another one, and what that means for what follows. */
export function FormatPanel({ profile, recognised, unrecognisedReason, orphanLines, readsNothing, otherFormat, complete, onChange }: FormatPanelProps) {
  const selectId = useId();

  return (
    <section className="panel" aria-labelledby={`${selectId}-title`}>
      <h2 id={`${selectId}-title`}>Format</h2>
      {profile === null && unrecognisedReason !== null && (
        <>
          <p className="notice notice-warning">Format non reconnu : {unrecognisedReason}.</p>
          <p className="hint">Choisissez le format du journal : l’aperçu est lu avec lui, et l’analyse devient possible.</p>
        </>
      )}
      {profile !== null && (
        <p>
          <span className="chip">
            {profile === recognised ? 'Format reconnu' : 'Format choisi'} : {profile.label}
          </span>
        </p>
      )}
      {profile?.limited === true && <p className="hint">Ce format ne contient que l’heure, pas la date.</p>}
      <div className="field-row">
        <label htmlFor={selectId}>Format du journal</label>
        <select
          id={selectId}
          className="select"
          value={profile?.id ?? ''}
          onChange={(event) => {
            const picked = BUILT_IN_PROFILES.find((candidate) => candidate.id === event.target.value);
            if (picked !== undefined) {
              onChange(picked);
            }
          }}
        >
          {profile === null && <option value="">Choisir un format</option>}
          {BUILT_IN_PROFILES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {profile !== null && <p className="small-note">Ce n’est pas le bon format ? Choisissez-en un autre : l’aperçu est lu de nouveau avec lui.</p>}
      {readsNothing && (
        <p className="notice notice-warning" role="status">
          Aucune ligne du début ne correspond à ce format : choisissez-en un autre.
        </p>
      )}
      {otherFormat.lines > 0 && (
        <p className="small-note is-warning">
          {otherFormat.lines > 1
            ? `${otherFormat.lines} lignes du ${complete ? 'journal' : 'début'} ressemblent à un autre format (${otherFormat.labels.join(' ; ')}) : elles sont lues comme la suite de l’entrée qui les précède.`
            : `1 ligne du ${complete ? 'journal' : 'début'} ressemble à un autre format (${otherFormat.labels.join(' ; ')}) : elle est lue comme la suite de l’entrée qui la précède.`}
        </p>
      )}
      {orphanLines > 0 && (
        <p className="small-note is-warning">
          {orphanLines > 1
            ? `${orphanLines} lignes au début du fichier n’ont ni date ni niveau : elles sont gardées, mais ne comptent jamais comme erreur.`
            : '1 ligne au début du fichier n’a ni date ni niveau : elle est gardée, mais ne compte jamais comme erreur.'}
        </p>
      )}
    </section>
  );
}
