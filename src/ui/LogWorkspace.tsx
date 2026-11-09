import { useCallback, useEffect, useRef } from 'react';
import type { Preparation } from '../core/preparation';
import type { LogProfile } from '../core/profiles';
import type { RedactionRuleId } from '../core/redact';
import type { ScanResult } from '../core/scanLog';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import { ErrorBrowser } from './ErrorBrowser';
import { countOf, formatCount } from './format';
import { PreparationScreen } from './PreparationScreen';
import { SourcePicker } from './SourcePicker';
import { Steps } from './Steps';
import type { StepNumber } from './Steps';
import { Tip } from './Tip';
import { useLogScan } from './useLogScan';
import type { ScanDependencies, ScanState } from './useLogScan';

interface LogWorkspaceProps {
  /** Replaces the worker and the format detection; used by the tests. */
  dependencies?: Partial<ScanDependencies>;
}


interface ScanSummaryProps {
  result: ScanResult;
  recorded: number;
  focusTarget: (element: HTMLElement | null) => void;
}

function ScanSummary({ result, recorded, focusTarget }: ScanSummaryProps) {
  // Past the record limit the later errors were counted but not fingerprinted, so the distinct count is a minimum.
  const distinct = `${result.limitReached ? 'au moins ' : ''}${countOf(result.fingerprints.length, 'distincte', 'distinctes')}`;
  return (
    <>
      <p className="result-title" ref={focusTarget} tabIndex={-1}>
        Analyse terminée sur votre ordinateur.
      </p>
      <p className="result-sentence">
        {countOf(result.entries, 'entrée lue', 'entrées lues')}
        {result.errors === 0 ? ', aucune erreur.' : `, ${countOf(result.errors, 'erreur', 'erreurs')} (${distinct}).`}
      </p>
      {result.errors === 0 && <p>Aucune erreur trouvée dans ce journal.</p>}
      {result.limitReached && (
        <p className="notice notice-warning">
          {formatCount(result.errors)} erreurs ont été trouvées, seules les {formatCount(recorded)} premières sont enregistrées.
        </p>
      )}
      {result.truncatedEntries > 0 && (
        <p className="notice notice-warning">
          {result.truncatedEntries > 1
            ? `${formatCount(result.truncatedEntries)} entrées très longues : seul leur début`
            : '1 entrée très longue : seul son début'}{' '}
          a servi à regrouper les erreurs identiques{result.ignoredPerRule.length > 0 ? ' et à appliquer vos règles' : ''}.
        </p>
      )}
    </>
  );
}

/** The step shown as current for each stage of the path from a log to its errors. */
function stepOf(phase: ScanState['phase']): StepNumber {
  switch (phase) {
    case 'idle':
    case 'detecting':
    case 'failed':
      return 1;
    case 'ready':
      return 2;
    case 'analysing':
    case 'analysed':
      return 3;
  }
}

/**
 * The page's working area: choose a log, prepare it, analyse it on demand, read the errors.
 * Each stage is the user's decision; nothing is analysed or sent by itself.
 */
export function LogWorkspace({ dependencies }: LogWorkspaceProps) {
  const { state, chooseFile, chooseText, changePreparation, changeMasking, changeProfile, analyse, cancel, reset, readText, readNeighbours } = useLogScan(dependencies);

  // Each stage replaces the previous one, and the button that was clicked goes away: without moving the focus to the
  // new stage, a keyboard user lands on the page body. Not on the first render, which must not steal the focus, and not
  // when a setting changes after an analysis: the screen stays as it is and the user is in the middle of editing it.
  const focusTarget = useRef<HTMLElement | null>(null);
  const shownPhase = useRef(state.phase);
  useEffect(() => {
    if (shownPhase.current !== state.phase) {
      shownPhase.current = state.phase;
      if (!(state.phase === 'ready' && state.settingsChanged)) {
        focusTarget.current?.focus();
      }
    }
  }, [state]);
  const setFocusTarget = useCallback((element: HTMLElement | null): void => {
    focusTarget.current = element;
  }, []);

  return (
    <>
      <Steps current={stepOf(state.phase)} />
      <Stage
        state={state}
        setFocusTarget={setFocusTarget}
        onFile={(file) => void chooseFile(file)}
        onText={(text) => void chooseText(text)}
        onPreparationChange={changePreparation}
        onMaskingChange={changeMasking}
        onProfileChange={changeProfile}
        onAnalyse={analyse}
        onCancel={cancel}
        onReset={reset}
        readText={readText}
        readNeighbours={readNeighbours}
      />
    </>
  );
}

interface StageProps {
  state: ScanState;
  setFocusTarget: (element: HTMLElement | null) => void;
  onFile: (file: File) => void;
  onText: (text: string) => void;
  onPreparationChange: (preparation: Preparation) => void;
  onMaskingChange: (masking: ReadonlySet<RedactionRuleId>) => void;
  onProfileChange: (profile: LogProfile) => void;
  onAnalyse: () => void;
  onCancel: () => void;
  onReset: () => void;
  readText: (position: EntryPosition) => Promise<EntryText>;
  readNeighbours: (position: EntryPosition) => Promise<NeighbourLines>;
}

function Stage({ state, setFocusTarget, onFile, onText, onPreparationChange, onMaskingChange, onProfileChange, onAnalyse, onCancel, onReset, readText, readNeighbours }: StageProps) {
  switch (state.phase) {
    case 'idle':
      return (
        <>
          <p className="empty" ref={setFocusTarget} tabIndex={-1}>
            Aucune source de logs chargée pour le moment.
            <span className="cursor" aria-hidden="true" />
          </p>
          <SourcePicker onFile={onFile} onText={onText} />
        </>
      );
    case 'detecting':
      return (
        <p className="hint" role="status" ref={setFocusTarget} tabIndex={-1}>
          Lecture du début du journal…
        </p>
      );
    case 'failed':
      return (
        <>
          <p className="notice notice-error" role="alert" ref={setFocusTarget} tabIndex={-1}>
            {state.message}
          </p>
          <SourcePicker onFile={onFile} onText={onText} />
        </>
      );
    case 'ready':
    case 'analysed': {
      if (state.detection.status === 'structured') {
        return (
          <section className="panel" aria-label="Journal choisi">
            <h2 ref={setFocusTarget} tabIndex={-1}>
              {state.name}
            </h2>
            <p className="notice notice-warning">Ce journal semble être du JSON, un format pas encore pris en charge.</p>
            <div className="actions">
              <Tip text="Revient au choix du journal et vide le champ de texte collé.">
                {(describedBy) => (
                  <button type="button" className="button-link" aria-describedby={describedBy} onClick={onReset}>
                    Choisir un autre journal
                  </button>
                )}
              </Tip>
            </div>
          </section>
        );
      }
      const analysed = state.phase === 'analysed';
      return (
        <>
          <PreparationScreen
            name={state.name}
            source={state.source}
            head={state.head}
            complete={state.complete}
            profile={state.profile}
            recognised={state.detection.status === 'detected' ? state.detection.profile : null}
            unrecognisedReason={state.detection.status === 'unrecognized' ? state.detection.reason : null}
            onProfileChange={onProfileChange}
            preparation={state.preparation}
            onPreparationChange={onPreparationChange}
            masking={state.masking}
            onMaskingChange={onMaskingChange}
            result={analysed ? state.result : null}
            settingsChanged={state.phase === 'ready' && state.settingsChanged}
            onAnalyse={analysed ? undefined : onAnalyse}
            onReset={onReset}
            titleRef={analysed ? undefined : setFocusTarget}
          />
          {analysed && (
            <section className="panel" aria-label="Résultat de l’analyse">
              <ScanSummary result={state.result} recorded={state.records.length} focusTarget={setFocusTarget} />
              {state.records.length > 0 && <ErrorBrowser records={state.records} readText={readText} readNeighbours={readNeighbours} limitReached={state.result.limitReached} />}
            </section>
          )}
        </>
      );
    }
    case 'analysing': {
      const total = state.source.size;
      const percent = total === 0 ? 0 : Math.floor((state.bytesRead / total) * 100);
      return (
        <section className="panel" aria-label="Analyse en cours">
          <h2 ref={setFocusTarget} tabIndex={-1}>
            {state.name}
          </h2>
          {/* Fixed text, announced once: the figures below change ten times a second and stay out of the live region. */}
          <p role="status">Analyse en cours…</p>
          <p>
            {percent} %, {countOf(state.records.length, 'erreur trouvée', 'erreurs trouvées')}.
          </p>
          <progress className="progress" aria-label="Progression de l’analyse" max={total} value={state.bytesRead} />
          <div className="actions">
            <button type="button" className="button-secondary" onClick={onCancel}>
              Annuler
            </button>
          </div>
        </section>
      );
    }
  }
}
