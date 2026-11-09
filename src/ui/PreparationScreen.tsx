import { useMemo, useState } from 'react';
import { parseHead, previewHead } from '../core/previewHead';
import { validatePeriod } from '../core/preparation';
import type { Preparation } from '../core/preparation';
import type { LogProfile } from '../core/profiles';
import type { RedactionRuleId } from '../core/redact';
import type { ScanResult } from '../core/scanLog';
import { FormatPanel } from './FormatPanel';
import { formatCount, formatSize } from './format';
import { IgnoreTool } from './IgnoreTool';
import { MaskTool } from './MaskTool';
import { PeriodTool } from './PeriodTool';
import { PreparedPreview } from './PreparedPreview';
import { Tip } from './Tip';

interface PreparationScreenProps {
  name: string;
  source: Blob;
  head: Uint8Array;
  /** `true` when `head` is the whole source. */
  complete: boolean;
  /** The format the log is read with; `null` when none was recognised and none was picked yet. */
  profile: LogProfile | null;
  /** The format the detection recognised, if any. */
  recognised: LogProfile | null;
  /** Why no format was recognised, when that is the case. */
  unrecognisedReason: string | null;
  onProfileChange: (profile: LogProfile) => void;
  preparation: Preparation;
  onPreparationChange: (preparation: Preparation) => void;
  /** The masking rules that are on. */
  masking: ReadonlySet<RedactionRuleId>;
  onMaskingChange: (masking: ReadonlySet<RedactionRuleId>) => void;
  /** The exact figures of the last analysis, shown instead of the figures computed on the beginning. */
  result: ScanResult | null;
  /** `true` when the user changed a setting after an analysis: its result is gone and the analysis is to be run again. */
  settingsChanged: boolean;
  /** Absent once analysed: the result is up to date, there is nothing to start. */
  onAnalyse?: () => void;
  onReset: () => void;
  /** Receives the title, so that the page can move the focus there when this screen appears. */
  titleRef?: (element: HTMLElement | null) => void;
}

/**
 * Where the user prepares a log before analysing it: what was read, the format, the settings, a preview of the log as
 * these settings leave it. Figures come from the beginning of the source until an analysis gives the exact ones.
 * Without a format there is nothing to read the log with: only the choice of a format is shown.
 */
export function PreparationScreen({
  name,
  source,
  head,
  complete,
  profile,
  recognised,
  unrecognisedReason,
  onProfileChange,
  preparation,
  onPreparationChange,
  masking,
  onMaskingChange,
  result,
  settingsChanged,
  onAnalyse,
  onReset,
  titleRef,
}: PreparationScreenProps) {
  // Reading the text is the costly part: done once per format, then each change of a rule only filters the entries again.
  const parsed = useMemo(() => (profile === null ? null : parseHead(head, profile)), [head, profile]);
  const preview = useMemo(() => (parsed === null ? null : previewHead(parsed, preparation, masking)), [parsed, preparation, masking]);
  // The original text is shown on request and stays on this screen: leaving it, or choosing another log, hides it again.
  const [showingOriginal, setShowingOriginal] = useState(false);

  const counts =
    result !== null
      ? {
          read: result.entries,
          ignored: result.ignored,
          ignoredPerRule: result.ignoredPerRule,
          ignoredByPeriod: result.ignoredByPeriod,
          ready: result.entries - result.ignored,
        }
      : (preview?.counts ?? null);
  // A period that cannot be used is shown with its reason and not applied; the analysis waits until it is fixed.
  const periodProblem = validatePeriod(preparation.period);
  const forTheBeginning = result === null && !complete;
  const nothingLeft = result === null && counts !== null && counts.read > 0 && counts.ready === 0;
  const readsNothing = preview !== null && preview.headerCount === 0;
  const cannotAnalyse = profile === null || readsNothing || periodProblem !== null || (nothingLeft && complete);

  return (
    <section aria-label="Préparation du journal">
      <div className="panel prep-head">
        <div className="detected">
          <h2 ref={titleRef} tabIndex={-1}>
            {name}
          </h2>
          <span className="chip">Lu sur cet ordinateur</span>
        </div>
        {counts !== null && (
          <>
            <ul className="counters" aria-label="Chiffres" aria-live="polite">
              <li className="counter">
                <strong>{formatCount(counts.read)}</strong>
                <span>{counts.read > 1 ? 'entrées lues' : 'entrée lue'}</span>
              </li>
              <li className="counter">
                <strong>{formatCount(counts.ignored)}</strong>
                <span>{counts.ignored > 1 ? 'écartées par vos réglages' : 'écartée par vos réglages'}</span>
              </li>
              <li className="counter is-ok">
                <strong>{formatCount(counts.ready)}</strong>
                <span>{counts.ready > 1 ? 'prêtes à analyser' : 'prête à analyser'}</span>
              </li>
              {preview !== null && preview.masking.masked > 0 && (
                <li className="counter">
                  <strong>{formatCount(preview.masking.masked)}</strong>
                  <span>{`${preview.masking.masked > 1 ? 'données masquées' : 'donnée masquée'}${complete ? '' : ' dans le début'}`}</span>
                </li>
              )}
            </ul>
            {result !== null && <p className="small-note">Chiffres exacts de l’analyse.</p>}
            {forTheBeginning && (
              <p className="small-note">
                Chiffres calculés sur le début du fichier ({formatSize(head.length)} sur {formatSize(source.size)}) : les chiffres exacts viennent avec l’analyse.
              </p>
            )}
            {nothingLeft && complete && (
              <p className="notice notice-warning">Rien à analyser : toutes les entrées sont écartées par vos réglages.</p>
            )}
            {nothingLeft && !complete && (
              <p className="notice notice-warning">
                Aucune entrée du début ne reste avec ces réglages. Le reste du fichier n’a pas été lu : lancez l’analyse pour le savoir.
              </p>
            )}
          </>
        )}
      </div>

      <div className="prep-layout">
        <div className="prep-tools">
          <FormatPanel
            profile={profile}
            recognised={recognised}
            unrecognisedReason={unrecognisedReason}
            orphanLines={preview?.orphanLines ?? 0}
            readsNothing={readsNothing}
            otherFormat={preview?.otherFormat ?? { lines: 0, labels: [] }}
            complete={complete}
            onChange={onProfileChange}
          />
          {profile !== null && counts !== null && (
            <>
              <IgnoreTool
                preparation={preparation}
                onChange={onPreparationChange}
                counts={counts.ignoredPerRule}
                countsAreForTheBeginning={forTheBeginning}
              />
              <PeriodTool
                preparation={preparation}
                onChange={onPreparationChange}
                withDate={!profile.limited}
                range={preview?.timeRange ?? null}
                forTheBeginning={!complete}
                ignoredByPeriod={counts.ignoredByPeriod}
                problem={periodProblem}
              />
              <MaskTool
                masking={masking}
                onChange={onMaskingChange}
                occurrences={preview?.masking.occurrences ?? { email: 0, secret: 0, ip: 0, card: 0, guid: 0, urlHost: 0 }}
                forTheBeginning={!complete}
                showingOriginal={showingOriginal}
                onShowOriginalChange={setShowingOriginal}
              />
            </>
          )}
        </div>
        {preview !== null && (
          <PreparedPreview preview={preview} name={name} headBytes={head.length} sourceBytes={source.size} complete={complete} showOriginal={showingOriginal} />
        )}
      </div>

      <div className="actions">
        {onAnalyse !== undefined && (
          <Tip text="Lance l’analyse sur votre ordinateur avec les réglages ci-dessus et liste les erreurs. Rien n’est envoyé sur Internet.">
            {(describedBy) => (
              <button type="button" className="button-primary" aria-describedby={describedBy} disabled={cannotAnalyse} onClick={onAnalyse}>
                Analyser ce journal
              </button>
            )}
          </Tip>
        )}
        <Tip text="Revient au choix du journal et vide le champ de texte collé. Les réglages de préparation sont oubliés.">
          {(describedBy) => (
            <button type="button" className="button-link" aria-describedby={describedBy} onClick={onReset}>
              Choisir un autre journal
            </button>
          )}
        </Tip>
      </div>
      {onAnalyse !== undefined && <p className="hint">L’analyse se fait sur cet ordinateur. Rien n’est envoyé sur Internet.</p>}
      {settingsChanged && (
        <p className="hint" role="status">
          Vous avez changé les réglages : relancez l’analyse pour en tenir compte.
        </p>
      )}
    </section>
  );
}
