import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Analysis } from '../src/ai/analysis';
import { AnalysisView } from '../src/ui/AnalysisView';
import type { AnalysisEntry } from '../src/ui/analysisState';

const analysis: Analysis = {
  summary: 'Le paiement échoue.',
  probableCause: 'Le délai de la passerelle est dépassé.',
  severity: 'high',
  confidence: 'medium',
  evidence: ['TimeoutException après 30 s', 'Aucune réponse de la passerelle'],
  suggestedFixes: [
    { title: 'Augmenter le délai', details: 'Passer à 60 s.', codeHint: 'timeout: 60' },
    { title: 'Ajouter une relance', details: 'Réessayer deux fois.', codeHint: null },
  ],
  missingInfo: ['La configuration réseau'],
};
const done = (value: Analysis = analysis): AnalysisEntry => ({ status: 'done', outcome: { kind: 'structured', analysis: value }, by: 'claude-haiku-5-5 (Anthropic)' });
const unstructured: AnalysisEntry = { status: 'done', outcome: { kind: 'unstructured', text: 'x' }, by: 'llama3:8b (Ollama)' };
const show = (entry: AnalysisEntry, twins = 1) => render(<AnalysisView entry={entry} twins={twins} />);

describe('AnalysisView structured analysis', () => {
  it('should show the summary, the cause, the severity and the confidence', () => {
    // Act
    show(done());

    // Assert
    const region = screen.getByRole('region', { name: 'Analyse de l’IA' });
    expect(within(region).getByText('Le paiement échoue.')).toBeInTheDocument();
    expect(within(region).getByText('Le délai de la passerelle est dépassé.')).toBeInTheDocument();
    expect(within(region).getByText(/Gravité : élevée/)).toBeInTheDocument();
    expect(within(region).getByText(/Confiance : moyenne/)).toBeInTheDocument();
  });

  it('should list the evidence, the fixes with their code, and what is missing', () => {
    // Act
    show(done());

    // Assert
    expect(screen.getByText('TimeoutException après 30 s')).toBeInTheDocument();
    expect(screen.getByText('Augmenter le délai')).toBeInTheDocument();
    expect(screen.getByText('Passer à 60 s.')).toBeInTheDocument();
    expect(screen.getByText('timeout: 60')).toBeInTheDocument();
    expect(screen.getByText('Ajouter une relance')).toBeInTheDocument();
    expect(screen.getByText('La configuration réseau')).toBeInTheDocument();
  });

  it('should leave out a list that is empty, rather than show an empty heading', () => {
    // Act
    show(done({ ...analysis, evidence: [], suggestedFixes: [], missingInfo: [] }));

    // Assert
    expect(screen.queryByRole('heading', { name: /Éléments du journal/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Pistes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Informations manquantes/ })).not.toBeInTheDocument();
  });

  it('should say which model made it, and for how many identical errors it holds', () => {
    // Act
    show(done(), 5);

    // Assert
    expect(screen.getByText(/claude-haiku-5-5 \(Anthropic\)/)).toBeInTheDocument();
    expect(screen.getByText(/vaut aussi pour les 5 erreurs identiques/)).toBeInTheDocument();
  });

  it('should not talk of identical errors when there are none', () => {
    // Act
    show(done(), 1);

    // Assert
    expect(screen.queryByText(/erreurs identiques/)).not.toBeInTheDocument();
  });

  it('should show every text as text: markup written by the model never becomes elements', () => {
    // Arrange
    const hostile = '<img src=x onerror=alert(1)><b>bold</b>';

    // Act
    const { container } = show(done({ ...analysis, summary: hostile, probableCause: hostile, evidence: [hostile], suggestedFixes: [{ title: hostile, details: hostile, codeHint: hostile }], missingInfo: [hostile] }));

    // Assert
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getAllByText(hostile).length).toBeGreaterThanOrEqual(6);
  });

  it.each([
    ['a structured analysis', done()],
    ['an unstructured answer', unstructured],
  ])('should remind that %s is the work of a model that read an untrusted log, to check before acting', (_name, entry) => {
    // Act
    show(entry);

    // Assert
    expect(screen.getByText(/à vérifier avant d’agir/)).toBeInTheDocument();
  });

  it('should not turn a link written by the model into a link', () => {
    // Act
    const { container } = show(done({ ...analysis, summary: '[clic](https://evil.example) https://evil.example' }));

    // Assert
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('AnalysisView other states', () => {
  it('should say the analysis is under way', () => {
    // Act
    show({ status: 'running' });

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('Analyse en cours');
  });

  it('should say why it failed', () => {
    // Act
    show({ status: 'failed', message: 'La clé est refusée par Anthropic.' });

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('La clé est refusée par Anthropic.');
  });

  it('should show the answer as it is, said to be unstructured, when it does not follow the schema', () => {
    // Act
    const { container } = show({ status: 'done', outcome: { kind: 'unstructured', text: 'Ça échoue <img src=x onerror=alert(1)>' }, by: 'llama3:8b (Ollama)' });

    // Assert
    expect(screen.getByText(/Format non structuré/)).toBeInTheDocument();
    expect(screen.getByLabelText('Réponse non structurée du modèle')).toHaveTextContent('Ça échoue <img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/llama3:8b \(Ollama\)/)).toBeInTheDocument();
  });
});
