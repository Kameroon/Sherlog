import type { LogProfile } from '../core/profiles';

interface FormatPanelProps {
  profile: LogProfile;
  /** Lines before the first entry header: kept, but never counted as errors. */
  orphanLines: number;
}

/** The format the log was read with, and what it means for what follows. */
export function FormatPanel({ profile, orphanLines }: FormatPanelProps) {
  return (
    <section className="panel" aria-labelledby="format-title">
      <h2 id="format-title">Format</h2>
      <p>
        <span className="chip">Format reconnu : {profile.label}</span>
      </p>
      {profile.limited && <p className="hint">Ce format ne contient que l’heure, pas la date.</p>}
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
