import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ENABLED_RULES } from '../src/core/redact';
import type { RedactionRuleId } from '../src/core/redact';
import type { ErrorRecord } from '../src/core/scanLog';
import { MAX_INPUT_CHARS } from '../src/core/sendPayload';
import type { EntryPosition, EntryText } from '../src/sources/readEntryText';
import type { NeighbourLines } from '../src/sources/readNeighbourLines';
import { ErrorBrowser } from '../src/ui/ErrorBrowser';

const record = (index: number, fingerprintId: number, timestamp: string | null = `2026-11-04 08:00:${String(index).padStart(2, '0')}`): ErrorRecord => ({
  offset: index * 100,
  length: 90,
  timestamp,
  level: 'ERR',
  message: `failure ${index}`,
  messageCut: false,
  lineCount: 1,
  fingerprintId,
});

const entryOf = (position: EntryPosition): EntryText => ({ text: `entry at ${position.offset}`, cut: false });
const noLines: NeighbourLines = { before: [], after: [], beforeLimited: false, afterLimited: false };

interface Options {
  readText?: (position: EntryPosition) => Promise<EntryText>;
  readNeighbours?: (position: EntryPosition) => Promise<NeighbourLines>;
  masking?: ReadonlySet<RedactionRuleId>;
  hasDate?: boolean;
  fileName?: string;
}

function show(records: readonly ErrorRecord[], options: Options = {}) {
  const readText = options.readText ?? ((position: EntryPosition) => Promise.resolve(entryOf(position)));
  const readNeighbours = options.readNeighbours ?? (() => Promise.resolve(noLines));
  const ui = (masking: ReadonlySet<RedactionRuleId>) => (
    <ErrorBrowser
      records={records}
      readText={readText}
      readNeighbours={readNeighbours}
      limitReached={false}
      masking={masking}
      hasDate={options.hasDate ?? true}
      fileName={options.fileName ?? 'app.log'}
    />
  );
  const view = render(ui(options.masking ?? DEFAULT_ENABLED_RULES));
  return { rerenderWith: (masking: ReadonlySet<RedactionRuleId>) => view.rerender(ui(masking)) };
}

const rows = () => within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option');
const select = (row: number): void => {
  fireEvent.click(rows()[row] as HTMLElement);
};
const choose = (): void => {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' }));
};
const panel = () => screen.getByRole('region', { name: 'Envoi à l’IA' });
const open = async (number: number) => {
  fireEvent.click(within(panel()).getByRole('button', { name: 'Voir le texte exact' }));
  return screen.findByLabelText(`Texte exact envoyé pour l’erreur ${number}`);
};

describe('ErrorBrowser choice of the errors to send', () => {
  it('should have no error chosen at first, and say that nothing is sent', () => {
    // Act
    show([record(0, 0)]);

    // Assert
    expect(within(panel()).getByText('Aucune erreur choisie.')).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Envoyer à l’IA' })).toBeDisabled();
    expect(within(panel()).getByText(/Rien n’a été envoyé/)).toBeInTheDocument();
  });

  it('should offer to choose the selected error, not chosen at first', () => {
    // Arrange
    show([record(0, 0)]);

    // Act
    select(0);

    // Assert
    expect(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' })).not.toBeChecked();
  });

  it('should list an error in the panel once it is chosen, and mark it in the list', () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    select(1);

    // Act
    choose();

    // Assert
    expect(within(panel()).getByText(/failure 1/)).toBeInTheDocument();
    expect(rows()[1]).toHaveTextContent('À envoyer');
    expect(rows()[0]).not.toHaveTextContent('À envoyer');
  });

  it('should choose every identical error at once and list them as one', () => {
    // Arrange
    show([record(0, 5), record(1, 6), record(2, 5)]);
    select(0);

    // Act
    choose();

    // Assert
    expect(rows().map((row) => row.textContent?.includes('À envoyer'))).toEqual([true, false, true]);
    expect(within(panel()).getAllByRole('listitem')).toHaveLength(1);
    expect(within(panel()).getByText(/2 erreurs identiques/)).toBeInTheDocument();
  });

  it('should take the error out of the panel when the user unticks it', () => {
    // Arrange
    show([record(0, 0)]);
    select(0);
    choose();

    // Act
    choose();

    // Assert
    expect(within(panel()).getByText('Aucune erreur choisie.')).toBeInTheDocument();
    expect(rows()[0]).not.toHaveTextContent('À envoyer');
  });

  it('should take an error out with its own button in the panel, and untick it in the detail', () => {
    // Arrange
    show([record(0, 0)]);
    select(0);
    choose();

    // Act
    fireEvent.click(within(panel()).getByRole('button', { name: 'Retirer l’erreur 1 de l’envoi' }));

    // Assert
    expect(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' })).not.toBeChecked();
  });

  it('should take every error out at once', () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    select(0);
    choose();
    select(1);
    choose();

    // Act
    fireEvent.click(within(panel()).getByRole('button', { name: 'Tout retirer' }));

    // Assert
    expect(within(panel()).getByText('Aucune erreur choisie.')).toBeInTheDocument();
  });

  it('should not offer « Tout retirer » for a single error', () => {
    // Arrange
    show([record(0, 0)]);
    select(0);

    // Act
    choose();

    // Assert
    expect(within(panel()).queryByRole('button', { name: 'Tout retirer' })).toBeNull();
  });
});

describe('ErrorBrowser occurrence that is sent', () => {
  it('should send the most recent occurrence by time, which is not always the last one read, and say so', async () => {
    // Arrange: read in the order 09:00, 11:00, 10:00.
    show([record(0, 7, '2026-11-04 09:00:00'), record(1, 7, '2026-11-04 11:00:00'), record(2, 7, '2026-11-04 10:00:00')]);
    select(0);
    choose();

    // Act
    const text = await open(2);

    // Assert
    expect(text).toHaveTextContent('entry at 100');
    expect(within(panel()).getByText(/la plus récente/)).toBeInTheDocument();
    expect(screen.getByText(/Occurrence retenue pour l’analyse : erreur 2/)).toBeInTheDocument();
  });

  it('should send the last one read when the format has no date, and say why', async () => {
    // Arrange
    show([record(0, 7, '23:00:00'), record(1, 7, '01:00:00')], { hasDate: false });
    select(0);
    choose();

    // Act
    const text = await open(2);

    // Assert
    expect(text).toHaveTextContent('entry at 100');
    expect(within(panel()).getByText(/la dernière lue/)).toBeInTheDocument();
  });
});

describe('ErrorBrowser text that would be sent', () => {
  const sensitiveEntry = (): Promise<EntryText> => Promise.resolve({ text: 'failed for john.doe@example.com with Password=S3cr3t!', cut: false });
  const sensitiveLines = (): Promise<NeighbourLines> => Promise.resolve({ before: ['call from 10.0.4.17'], after: ['Authorization: Bearer abc123.def456 sent'], beforeLimited: false, afterLimited: false });

  it('should show the exact text, masked, with the lines around the error masked too', async () => {
    // Arrange
    show([record(0, 0)], { readText: sensitiveEntry, readNeighbours: sensitiveLines });
    select(0);
    choose();

    // Act
    const text = await open(1);

    // Assert
    expect(text).toHaveTextContent('failed for [EMAIL] with Password=[SECRET]');
    expect(text).toHaveTextContent('call from [IP]');
    expect(text).toHaveTextContent('Authorization: Bearer [SECRET]');
    expect(text.textContent).not.toMatch(/john\.doe|S3cr3t|10\.0\.4\.17|abc123/);
  });

  it('should show the occurrences and the file name at the head of the text', async () => {
    // Arrange
    show([record(0, 5), record(1, 5)], { fileName: 'orders.log' });
    select(0);
    choose();

    // Act
    const text = await open(2);

    // Assert
    expect(text).toHaveTextContent('Occurrences : 2');
    expect(text).toHaveTextContent('Fichier : orders.log');
  });

  it('should count what was masked', async () => {
    // Arrange
    show([record(0, 0)], { readText: sensitiveEntry, readNeighbours: sensitiveLines });
    select(0);
    choose();

    // Act
    await open(1);

    // Assert
    expect(within(panel()).getByText('4 données masquées dans ce texte.')).toBeInTheDocument();
  });

  it('should warn when the user chose no masking, and say what is hidden anyway', async () => {
    // Arrange
    show([record(0, 0)], { readText: sensitiveEntry, readNeighbours: sensitiveLines, masking: new Set() });
    select(0);
    choose();

    // Act
    const text = await open(1);

    // Assert
    expect(within(panel()).getByText(/Aucun masquage choisi dans la préparation/)).toBeInTheDocument();
    expect(text).toHaveTextContent('[EMAIL]');
  });

  it('should not warn when a masking rule is chosen', () => {
    // Arrange
    show([record(0, 0)]);
    select(0);

    // Act
    choose();

    // Assert
    expect(within(panel()).queryByText(/Aucun masquage choisi/)).toBeNull();
  });

  it('should name the rules that are applied, the default ones always included', () => {
    // Arrange
    show([record(0, 0)], { masking: new Set<RedactionRuleId>(['guid']) });
    select(0);

    // Act
    choose();

    // Assert
    const applied = within(panel()).getByText(/Masquages appliqués/);
    expect(applied).toHaveTextContent('Adresses e-mail');
    expect(applied).toHaveTextContent('Identifiants GUID');
    expect(applied).not.toHaveTextContent('Noms d’hôte');
  });

  it('should follow a change of the masking without reading the log again', async () => {
    // Arrange
    const readText = vi.fn<(position: EntryPosition) => Promise<EntryText>>(() => Promise.resolve({ text: 'request 7ecb1df3-8db1-4137-8038-9584ac6f3083 failed', cut: false }));
    const view = show([record(0, 0)], { readText });
    select(0);
    choose();
    const text = await open(1);
    expect(text).toHaveTextContent('7ecb1df3-8db1-4137-8038-9584ac6f3083');
    const readsBefore = readText.mock.calls.length;

    // Act
    view.rerenderWith(new Set<RedactionRuleId>(['guid']));

    // Assert
    expect(screen.getByLabelText('Texte exact envoyé pour l’erreur 1')).toHaveTextContent('request [GUID] failed');
    expect(readText.mock.calls.length).toBe(readsBefore);
  });

  it('should say the text was cut, and where, when it is too long', async () => {
    // Arrange
    show([record(0, 0)], { readText: () => Promise.resolve({ text: 'e'.repeat(MAX_INPUT_CHARS * 2), cut: false }) });
    select(0);
    choose();

    // Act
    const text = await open(1);

    // Assert
    expect(text.textContent?.length).toBeLessThanOrEqual(MAX_INPUT_CHARS);
    expect(within(panel()).getByText(`Note : le contenu a été tronqué à ${MAX_INPUT_CHARS} caractères.`)).toBeInTheDocument();
  });

  it('should say the entry itself is cut when it was longer than what is read', async () => {
    // Arrange
    show([record(0, 0)], { readText: () => Promise.resolve({ text: 'short', cut: true }) });
    select(0);
    choose();

    // Act
    await open(1);

    // Assert
    expect(within(panel()).getByText(/Note : le contenu a été tronqué/)).toBeInTheDocument();
  });

  it('should say why the log could not be read, and show no text', async () => {
    // Arrange
    show([record(0, 0)], { readText: () => Promise.reject(new Error('boom')) });
    select(0);
    choose();

    // Act
    fireEvent.click(within(panel()).getByRole('button', { name: 'Voir le texte exact' }));

    // Assert
    expect(await within(panel()).findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText('Texte exact envoyé pour l’erreur 1')).toBeNull();
  });

  it('should read the log only when the user asks to see the text', () => {
    // Arrange
    const readText = vi.fn<(position: EntryPosition) => Promise<EntryText>>(() => Promise.resolve({ text: 'x', cut: false }));
    show([record(0, 0)], { readText });

    // Act
    select(0);
    choose();

    // Assert: the detail reads the selected entry once; the panel reads nothing until « Voir le texte exact ».
    expect(readText.mock.calls.filter(([position]) => position.offset === 0)).toHaveLength(1);
  });

  it('should hide the text again with the same button', async () => {
    // Arrange
    show([record(0, 0)]);
    select(0);
    choose();
    await open(1);

    // Act
    fireEvent.click(within(panel()).getByRole('button', { name: 'Masquer le texte exact' }));

    // Assert
    expect(screen.queryByLabelText('Texte exact envoyé pour l’erreur 1')).toBeNull();
  });

  it('should say that sending is not available yet, since it comes with the analysis', () => {
    // Act
    show([record(0, 0)]);

    // Assert
    expect(within(panel()).getByText(/l’envoi des erreurs choisies arrive avec l’analyse/)).toBeInTheDocument();
  });

  it('should show what it is given between the errors chosen and the button', () => {
    // Arrange
    render(
      <ErrorBrowser records={[record(0, 0)]} readText={(position) => Promise.resolve(entryOf(position))} readNeighbours={() => Promise.resolve(noLines)} limitReached={false} sendSettings={<p>Réglages du fournisseur</p>} />,
    );

    // Assert
    expect(within(panel()).getByText('Réglages du fournisseur')).toBeInTheDocument();
  });
});
