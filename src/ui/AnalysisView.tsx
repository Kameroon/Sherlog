import { useId } from 'react';
import type { Analysis, Confidence, Severity } from '../ai/analysis';
import type { AnalysisEntry } from './analysisState';
import { formatCount } from './format';

const SEVERITY_LABELS: Readonly<Record<Severity, string>> = { low: 'faible', medium: 'moyenne', high: 'élevée', critical: 'critique' };
const CONFIDENCE_LABELS: Readonly<Record<Confidence, string>> = { low: 'faible', medium: 'moyenne', high: 'élevée' };

function TextList({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="analysis-block">
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => (
          // The model may repeat itself: the position is the only identity an item has.
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Structured({ analysis }: { analysis: Analysis }) {
  return (
    <>
      <p className="analysis-summary">{analysis.summary}</p>
      <p className="analysis-levels">
        <span className={`badge badge-severity-${analysis.severity}`}>Gravité : {SEVERITY_LABELS[analysis.severity]}</span>{' '}
        <span className="badge">Confiance : {CONFIDENCE_LABELS[analysis.confidence]}</span>
      </p>
      <div className="analysis-block">
        <h4>Cause probable</h4>
        <p>{analysis.probableCause}</p>
      </div>
      <TextList title="Éléments du journal qui l’appuient" items={analysis.evidence} />
      {analysis.suggestedFixes.length > 0 && (
        <div className="analysis-block">
          <h4>Pistes de correction, de la plus probable à la moins probable</h4>
          <ol>
            {analysis.suggestedFixes.map((fix, index) => (
              <li key={index}>
                <strong>{fix.title}</strong>
                <p>{fix.details}</p>
                {fix.codeHint !== null && <pre className="entry-text">{fix.codeHint}</pre>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <TextList title="Informations manquantes pour affiner" items={analysis.missingInfo} />
    </>
  );
}

/**
 * What the model said of the selected error. Every text is shown as text (React escapes it; there is no markdown and no
 * link): the answer of a model that read a log must never be able to put markup, a link or a form on the screen.
 */
export function AnalysisView({ entry, twins }: { entry: AnalysisEntry; twins: number }) {
  const titleId = useId();
  if (entry.status === 'running') {
    return (
      <p className="hint" role="status">
        Analyse en cours…
      </p>
    );
  }
  if (entry.status === 'failed') {
    return (
      <p className="notice notice-error" role="alert">
        {entry.message}
      </p>
    );
  }
  const { outcome } = entry;
  return (
    <section className="analysis" aria-labelledby={titleId}>
      <h3 id={titleId}>Analyse de l’IA</h3>
      <p className="small-note">
        Faite par {entry.by}, à partir de l’occurrence la plus récente.
        {twins > 1 && ` Elle vaut aussi pour les ${formatCount(twins)} erreurs identiques.`}
      </p>
      {outcome.kind === 'structured' ? (
        <Structured analysis={outcome.analysis} />
      ) : (
        <>
          <p className="notice notice-warning">Format non structuré : la réponse du modèle n’a pas pu être lue comme une analyse. La voici telle quelle.</p>
          <pre className="entry-text" role="region" aria-label="Réponse non structurée du modèle" tabIndex={0}>
            {outcome.text}
          </pre>
        </>
      )}
    </section>
  );
}
