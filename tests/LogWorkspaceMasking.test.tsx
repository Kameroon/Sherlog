import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as entrySource from '../src/sources/readEntryText';
import { errorRecord } from './helpers/fakeScanner';
import { BUILT_IN_PROFILES } from '../src/core/profiles';
import type { HeadRead } from '../src/sources/readHead';
import { readSample } from './helpers/samples';
import { chooseFile, finish, setup, startAnalysis } from './helpers/workspace';

const sample = readSample('sample.log');
const realLog = readSample('real-serilog.log');
const box = (label: string) => screen.getByRole('checkbox', { name: new RegExp(`^${label}`) });
const excerpt = (): string => document.querySelector('.excerpt')?.textContent ?? '';
const counters = (): (string | null)[] => [...document.querySelectorAll('.counter')].map((counter) => counter.textContent);

describe('LogWorkspace masking tool', () => {
  it('should offer six rules, with e-mails, secrets, addresses and cards ticked and the GUID and host options not', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(sample, 'dated.log');

    // Assert
    const boxes = within(screen.getByRole('region', { name: 'Masquer les données sensibles' })).getAllByRole('checkbox');
    expect(boxes.map((item) => (item as HTMLInputElement).checked)).toEqual([true, true, true, true, false, false]);
  });

  it('should list the rules as a list, so that a screen reader says how many there are', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(sample, 'dated.log');

    // Assert
    const region = screen.getByRole('region', { name: 'Masquer les données sensibles' });
    // A list item needs a list around it: a role on the <ul> would take that away from the six rules.
    expect(within(within(region).getByRole('list')).getAllByRole('listitem')).toHaveLength(6);
  });

  it('should say how many times each rule finds something in the log', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(sample, 'dated.log');

    // Assert
    expect(box('Adresses e-mail').closest('li')).toHaveTextContent('1 trouvée');
    expect(box('Adresses IP').closest('li')).toHaveTextContent('aucune trouvée');
  });

  it('should say that the figures are for the beginning of the file when the source is big', async () => {
    // Arrange
    const profile = BUILT_IN_PROFILES.find((candidate) => candidate.id === 'serilog-console');
    if (profile === undefined) {
      throw new Error('the console profile is missing');
    }
    const head: HeadRead = {
      detection: { status: 'detected', profile, encoding: 'utf-8' },
      head: new TextEncoder().encode('[08:16:10 ERR] mail a@b.example.org\n'),
      complete: false,
    };
    setup({ readHead: () => Promise.resolve(head) });
    const big = new File(['x'], 'big.log');
    Object.defineProperty(big, 'size', { value: 300 * 1024 * 1024 });

    // Act
    fireEvent.change(screen.getByLabelText('Choisir un fichier'), { target: { files: [big] } });
    await screen.findByRole('button', { name: 'Choisir un autre journal' });

    // Assert
    expect(box('Adresses e-mail').closest('li')).toHaveTextContent('1 trouvée dans le début du fichier');
    expect(counters().at(-1)).toContain('1donnée masquée dans le début');
  });

  it('should show the preview with the sensitive data replaced by their labels', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(sample, 'dated.log');

    // Assert
    expect(excerpt()).toContain('Password=[SECRET]');
    expect(excerpt()).toContain('[EMAIL]');
    expect(excerpt()).not.toContain('S3cr3t!');
    expect(excerpt()).not.toContain('john.doe@example.com');
  });

  it('should count what was masked', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(sample, 'dated.log');

    // Assert
    expect(counters().at(-1)).toContain('2données masquées');
  });

  it('should show no masked-data counter when nothing sensitive is found', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(realLog, 'real.log');

    // Assert
    expect(counters().some((counter) => counter?.includes('masquées'))).toBe(false);
  });

  it('should show a rule\'s data again when the user unticks it', async () => {
    // Arrange
    setup();
    await chooseFile(sample, 'dated.log');

    // Act
    fireEvent.click(box('Jetons, clés et mots de passe'));

    // Assert
    expect(excerpt()).toContain('Password=S3cr3t!');
    expect(excerpt()).toContain('[EMAIL]');
  });

  it('should mask the identifiers of the real sample once the GUID option is ticked, and show how many there are before', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');
    expect(box('Identifiants GUID').closest('li')).not.toHaveTextContent('aucune trouvée');

    // Act
    fireEvent.click(box('Identifiants GUID'));

    // Assert
    expect(excerpt()).toContain('[GUID]');
    expect(excerpt()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('should show the original text on demand, and mask it again on a second click', async () => {
    // Arrange
    setup();
    await chooseFile(sample, 'dated.log');
    const toggle = screen.getByRole('button', { name: 'Afficher le texte d’origine' });

    // Act
    fireEvent.click(toggle);

    // Assert
    expect(excerpt()).toContain('Password=S3cr3t!');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(excerpt()).toContain('Password=[SECRET]');
  });

  it('should say the original text stays on this screen while it is shown', async () => {
    // Arrange
    setup();
    await chooseFile(sample, 'dated.log');

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Afficher le texte d’origine' }));

    // Assert
    expect(screen.getByText(/reste sur cet écran/)).toBeInTheDocument();
  });

  it('should warn when no rule is ticked, and say what is hidden anyway when something is sent', async () => {
    // Arrange
    setup();
    await chooseFile(sample, 'dated.log');

    // Act
    for (const label of ['Adresses e-mail', 'Jetons, clés et mots de passe', 'Adresses IP', 'Numéros de carte bancaire probables']) {
      fireEvent.click(box(label));
    }

    // Assert
    expect(screen.getByText(/Aucun masquage choisi/)).toBeInTheDocument();
    expect(screen.getByText(/seront tout de même masqués/)).toBeInTheDocument();
  });

  it('should not warn while a rule is ticked', async () => {
    // Act
    setup();
    await chooseFile(sample, 'dated.log');

    // Assert
    expect(screen.queryByText(/Aucun masquage choisi/)).not.toBeInTheDocument();
  });

  it('should keep the result of an analysis when the masking changes, since the errors are the same', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);
    finish(scanner);

    // Act
    fireEvent.click(box('Adresses IP'));

    // Assert
    expect(screen.getByText(/Analyse terminée sur votre ordinateur/)).toBeInTheDocument();
    expect(screen.queryByText(/relancez l’analyse/)).not.toBeInTheDocument();
  });

  it('should go back to the default rules when another log is chosen', async () => {
    // Arrange
    setup();
    await chooseFile(sample, 'dated.log');
    fireEvent.click(box('Adresses IP'));
    fireEvent.click(screen.getByRole('button', { name: 'Choisir un autre journal' }));

    // Act
    await chooseFile(sample, 'again.log');

    // Assert
    expect(box('Adresses IP')).toBeChecked();
  });

  it('should not read the log again when a masking box is changed after the analysis, and follow the change at once', async () => {
    // Arrange
    const reads = vi.spyOn(entrySource, 'readEntryText');
    const scanner = setup();
    await startAnalysis(scanner);
    finish(scanner, [{ ...errorRecord, offset: 0, length: 20 }]);
    fireEvent.click(within(await screen.findByRole('listbox', { name: 'Erreurs' })).getAllByRole('option')[0] as HTMLElement);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Voir le texte exact' }));
    await screen.findByLabelText(/Texte exact envoyé/);
    const readsBefore = reads.mock.calls.length;

    // Act
    fireEvent.click(box('Adresses IP'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert
    expect(reads.mock.calls.length).toBe(readsBefore);
    reads.mockRestore();
  });
});
