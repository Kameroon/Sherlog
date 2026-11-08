import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PROFILES } from '../src/core/profiles';
import type { HeadRead } from '../src/sources/readHead';
import { consoleLog, scanResult } from './helpers/fakeScanner';
import { readSample } from './helpers/samples';
import { chooseFile, finish, setup, startAnalysis } from './helpers/workspace';

const realLog = readSample('real-serilog.log');
const text = (selector: string): string => document.querySelector(selector)?.textContent ?? '';
const counters = (): (string | null)[] => [...document.querySelectorAll('.counter')].map((counter) => counter.textContent);
const addRule = (rule: string) => {
  fireEvent.change(screen.getByLabelText('Ignorer les entrées qui contiennent'), { target: { value: rule } });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter la règle' }));
};

describe('LogWorkspace preparing', () => {
  it('should show the steps with the preparation as the current one and the sending as not available yet', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(realLog, 'real.log');

    // Assert
    const steps = within(screen.getByRole('list', { name: 'Étapes' })).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining('Choisir le journal') as unknown,
      expect.stringContaining('Préparer') as unknown,
      expect.stringContaining('Analyser') as unknown,
      expect.stringContaining('pas encore disponible') as unknown,
    ]);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
  });

  it('should count the entries read, left out and ready before anything is analysed', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(realLog, 'real.log');

    // Assert
    expect(counters()).toEqual([
      expect.stringContaining('21entrées lues') as unknown,
      expect.stringContaining('0écartée') as unknown,
      expect.stringContaining('21prêtes') as unknown,
    ]);
  });

  it('should leave out the entries of a new rule, count them and show them struck in the preview', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');

    // Act
    addRule('/health');

    // Assert
    expect(counters()).toEqual([
      expect.stringContaining('21entrées lues') as unknown,
      expect.stringContaining('15écartées') as unknown,
      expect.stringContaining('6prêtes') as unknown,
    ]);
    expect(screen.getByText(/« \/health »/)).toBeInTheDocument();
    expect(screen.getByText(/15 entrées écartées/)).toBeInTheDocument();
    expect(document.querySelectorAll('.excerpt .is-ignored')).toHaveLength(15);
  });

  it('should empty the field once the rule is added', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');

    // Act
    addRule('/health');

    // Assert
    expect(screen.getByLabelText('Ignorer les entrées qui contiennent')).toHaveValue('');
  });

  it('should say what is wrong and change nothing when the rule is empty', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');

    // Act
    addRule('   ');

    // Assert
    expect(screen.getByText('Écrivez d’abord le texte à ignorer, par exemple /health.')).toBeInTheDocument();
    expect(counters()[1]).toContain('0écartée');
  });

  it('should refuse a rule that already exists and say so', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');
    addRule('/health');

    // Act
    addRule('/HEALTH');

    // Assert
    expect(screen.getByText('Cette règle existe déjà.')).toBeInTheDocument();
    expect(document.querySelectorAll('.rule')).toHaveLength(1);
  });

  it('should bring the entries back when the rule is removed', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');
    addRule('/health');

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la règle /health' }));

    // Assert
    expect(counters()[1]).toContain('0écartée');
    expect(screen.queryByText(/« \/health »/)).not.toBeInTheDocument();
  });

  it('should show the first lines of the log as text, never as markup', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile('[08:16:10 ERR] Failed <img src=x onerror=alert(1)>\n', 'hostile.log');

    // Assert
    expect(document.querySelector('.excerpt img')).toBeNull();
    expect(text('.excerpt')).toContain('<img src=x onerror=alert(1)>');
  });

  it('should send the rules to the scan when the user analyses', async () => {
    // Arrange
    const scanner = setup();
    await chooseFile(realLog, 'real.log');
    addRule('/health');

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Analyser ce journal' }));

    // Assert
    expect(scanner.requests[0]).toMatchObject({ preparation: { ignoreTexts: ['/health'] } });
  });

  it('should keep the settings on screen after the analysis and show its exact figures', async () => {
    // Arrange
    const scanner = setup();
    await chooseFile(realLog, 'real.log');
    addRule('/health');
    fireEvent.click(screen.getByRole('button', { name: 'Analyser ce journal' }));

    // Act
    scanner.emit({ type: 'done', result: { ...scanResult, entries: 1000, ignored: 400, ignoredPerRule: [400], errors: 0, fingerprints: [] } });

    // Assert
    expect(counters()).toEqual([
      expect.stringMatching(/^1\s000entrées lues/) as unknown,
      expect.stringContaining('400écartées') as unknown,
      expect.stringContaining('600prêtes') as unknown,
    ]);
    expect(screen.getByText(/Analyse terminée sur votre ordinateur/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retirer la règle /health' })).toBeInTheDocument();
  });

  it('should drop the result and ask for a new analysis when a setting changes after the analysis', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);
    finish(scanner);

    // Act
    addRule('/health');

    // Assert
    expect(screen.queryByText(/Analyse terminée sur votre ordinateur/)).not.toBeInTheDocument();
    expect(screen.getByText('Vous avez changé les réglages : relancez l’analyse pour en tenir compte.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toBeEnabled();
  });

  it('should keep the focus where the user was when a setting changes after the analysis', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);
    finish(scanner);
    const field = screen.getByLabelText('Ignorer les entrées qui contiennent');
    field.focus();

    // Act
    addRule('/health');

    // Assert
    expect(field).toHaveFocus();
  });

  it('should explain that nothing is left to analyse and refuse the analysis when every entry of a small log is left out', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');

    // Act
    addRule('INF');
    addRule('ERR');
    addRule('DBG');

    // Assert
    expect(screen.getByText(/Rien à analyser : toutes les entrées sont écartées/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toBeDisabled();
  });

  it('should describe the analysis button in a tooltip', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(realLog, 'real.log');

    // Assert
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toHaveAccessibleDescription(/Rien n’est envoyé sur Internet/);
  });
});

describe('LogWorkspace preparing when only the beginning of a big file was read', () => {
  const consoleProfile = BUILT_IN_PROFILES.find((profile) => profile.id === 'serilog-console');
  if (consoleProfile === undefined) {
    throw new Error('the console profile is missing');
  }
  const bigHead: HeadRead = {
    detection: { status: 'detected', profile: consoleProfile, encoding: 'utf-8' },
    head: new TextEncoder().encode(consoleLog),
    complete: false,
  };

  async function chooseBig() {
    setup({ readHead: () => Promise.resolve(bigHead) });
    const big = new File(['x'], 'big.log');
    Object.defineProperty(big, 'size', { value: 300 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Choisir un fichier'), { target: { files: [big] } });
    await screen.findByRole('button', { name: 'Choisir un autre journal' });
  }

  it('should say the figures are computed on the beginning and that the exact ones come with the analysis', async () => {
    // Act
    await chooseBig();

    // Assert
    expect(screen.getByText(/calculés sur le début du fichier \(1 Kio sur 300 Mio\)/)).toBeInTheDocument();
    expect(screen.getByText(/chiffres exacts viennent avec l’analyse/)).toBeInTheDocument();
  });

  it('should not refuse the analysis when no entry of the beginning is left, since the rest was not read', async () => {
    // Arrange
    await chooseBig();

    // Act
    addRule('ERR');
    addRule('INF');

    // Assert
    expect(screen.getByText(/Aucune entrée du début ne reste avec ces réglages/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toBeEnabled();
  });

  it('should say that the count of a rule is for the beginning', async () => {
    // Arrange
    await chooseBig();

    // Act
    addRule('ERR');

    // Assert
    expect(screen.getByText(/1 entrée écartée dans le début/)).toBeInTheDocument();
  });
});
