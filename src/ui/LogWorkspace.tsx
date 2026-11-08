import { useCallback, useEffect, useRef } from 'react';
import type { ScanResult } from '../core/scanLog';
import type { FormatDetection } from '../sources/readHead';
import { ErrorList } from './ErrorList';
import { countOf, formatCount } from './format';
import { SourcePicker } from './SourcePicker';
import { useLogScan } from './useLogScan';
import type { ScanDependencies } from './useLogScan';

interface LogWorkspaceProps {
  /** Replaces the worker and the format detection; used by the tests. */
  dependencies?: Partial<ScanDependencies>;
}

function FormatNotice({ detection }: { detection: FormatDetection }) {
  switch (detection.status) {
    case 'detected':
      return (
        <>
          <p>
            <span className="chip">Format reconnu : {detection.profile.label}</span>
          </p>
          {detection.profile.limited && <p className="hint">Ce format ne contient que l’heure, pas la date.</p>}
        </>
      );
    case 'structured':
      return <p className="notice notice-warning">Ce journal semble être du JSON, un format pas encore pris en charge.</p>;
    case 'unrecognized':
      return (
        <>
          <p className="notice notice-warning">Format non reconnu : {detection.reason}.</p>
          <p className="hint">Ce journal ne peut pas être analysé pour l’instant : le choix manuel du format n’est pas encore disponible.</p>
        </>
      );
  }
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
          a servi à regrouper les erreurs identiques.
        </p>
      )}
    </>
  );
}

/**
 * The page's working area: choose a log, see how it was recognised, analyse it on demand, read the errors.
 * Each stage is the user's decision; nothing is analysed or sent by itself.
 */
export function LogWorkspace({ dependencies }: LogWorkspaceProps) {
  const { state, chooseFile, chooseText, analyse, cancel, reset, readText } = useLogScan(dependencies);

  // Each stage replaces the previous one, and the button that was clicked goes away: without moving the focus to the
  // new stage, a keyboard user lands on the page body. Not on the first render, which must not steal the focus.
  const focusTarget = useRef<HTMLElement | null>(null);
  const shownPhase = useRef(state.phase);
  useEffect(() => {
    if (shownPhase.current !== state.phase) {
      shownPhase.current = state.phase;
      focusTarget.current?.focus();
    }
  }, [state.phase]);
  const setFocusTarget = useCallback((element: HTMLElement | null): void => {
    focusTarget.current = element;
  }, []);

  switch (state.phase) {
    case 'idle':
      return (
        <>
          <p className="empty" ref={setFocusTarget} tabIndex={-1}>
            Aucune source de logs chargée pour le moment.
            <span className="cursor" aria-hidden="true" />
          </p>
          <SourcePicker onFile={(file) => void chooseFile(file)} onText={(text) => void chooseText(text)} />
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
          <SourcePicker onFile={(file) => void chooseFile(file)} onText={(text) => void chooseText(text)} />
        </>
      );
    case 'ready':
      return (
        <section className="panel" aria-label="Journal choisi">
          <h2 ref={setFocusTarget} tabIndex={-1}>
            {state.name}
          </h2>
          <FormatNotice detection={state.detection} />
          <div className="actions">
            {state.detection.status === 'detected' && (
              <button type="button" className="button-primary" onClick={analyse}>
                Analyser ce journal
              </button>
            )}
            <button type="button" className="button-link" onClick={reset}>
              Choisir un autre journal
            </button>
          </div>
          {state.detection.status === 'detected' && (
            <p className="hint">L’analyse se fait sur cet ordinateur. Rien n’est envoyé sur Internet.</p>
          )}
        </section>
      );
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
            <button type="button" className="button-secondary" onClick={cancel}>
              Annuler
            </button>
          </div>
        </section>
      );
    }
    case 'analysed':
      return (
        <section className="panel" aria-label="Résultat de l’analyse">
          <h2>{state.name}</h2>
          <ScanSummary result={state.result} recorded={state.records.length} focusTarget={setFocusTarget} />
          {state.records.length > 0 && <ErrorList records={state.records} readText={readText} />}
          <div className="actions">
            <button type="button" className="button-link" onClick={reset}>
              Choisir un autre journal
            </button>
          </div>
        </section>
      );
  }
}
