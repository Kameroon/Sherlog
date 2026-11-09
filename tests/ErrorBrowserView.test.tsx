import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ErrorRecord } from '../src/core/scanLog';
import type { EntryPosition, EntryText } from '../src/sources/readEntryText';
import type { NeighbourLines } from '../src/sources/readNeighbourLines';
import { ErrorBrowser } from '../src/ui/ErrorBrowser';

const record = (index: number, overrides: Partial<ErrorRecord> = {}): ErrorRecord => ({
  offset: index * 100,
  length: 90,
  timestamp: `08:00:${String(index).padStart(2, '0')}`,
  level: 'ERR',
  message: `failure ${index}`,
  messageCut: false,
  lineCount: 1,
  fingerprintId: index,
  ...overrides,
});

const readOk = (position: EntryPosition): Promise<EntryText> => Promise.resolve({ text: `entry at ${position.offset}`, cut: false });
const noNeighbours = (): Promise<NeighbourLines> => Promise.resolve({ before: [], after: [], beforeLimited: false, afterLimited: false });

const show = (records: readonly ErrorRecord[]) =>
  render(<ErrorBrowser readNeighbours={noNeighbours} records={records} readText={readOk} limitReached={false} />);

const rows = (): string[] => within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option').map((option) => option.textContent ?? '');
const search = (text: string): void => {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher' }), { target: { value: text } });
};
const sortBy = (label: string): void => {
  fireEvent.change(screen.getByRole('combobox', { name: 'Trier par' }), { target: { value: label } });
};

describe('ErrorBrowser search', () => {
  it('should show only the errors that contain the text, and how many of the whole', () => {
    // Arrange
    show([record(0, { message: 'Disk full' }), record(1, { message: 'Timeout' }), record(2, { message: 'disk almost full' })]);

    // Act
    search('disk');

    // Assert
    expect(rows()).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('2 erreurs affichées sur 3');
  });

  it('should say that the search does not cover the stack', () => {
    // Act
    show([record(0)]);

    // Assert
    expect(screen.getByText(/pas dans la pile/)).toBeInTheDocument();
  });

  it('should say that nothing matches, and give back every error when the filters are reset', () => {
    // Arrange
    show([record(0), record(1)]);
    search('nothing like this');

    // Act
    expect(screen.getByText('Aucune erreur ne correspond à la recherche et aux filtres.')).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Erreurs' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));

    // Assert
    expect(rows()).toHaveLength(2);
    expect(screen.getByRole('searchbox', { name: 'Rechercher' })).toHaveValue('');
  });

  it('should not offer to reset while nothing is narrowed or sorted', () => {
    // Act
    show([record(0)]);

    // Assert
    expect(screen.queryByRole('button', { name: 'Réinitialiser' })).toBeNull();
  });
});

describe('ErrorBrowser level filter', () => {
  it('should keep only the errors of the chosen level', () => {
    // Arrange
    show([record(0, { level: 'ERR' }), record(1, { level: 'FTL' }), record(2, { level: 'ERR' })]);

    // Act
    fireEvent.change(screen.getByRole('combobox', { name: 'Niveau' }), { target: { value: 'FTL' } });

    // Assert
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('FTL');
  });

  it('should offer the levels that are in the errors, and "Tous"', () => {
    // Act
    show([record(0, { level: 'ERR' }), record(1, { level: 'FTL' })]);

    // Assert
    const options = within(screen.getByRole('combobox', { name: 'Niveau' })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Tous', 'ERR', 'FTL']);
  });

  it('should not offer a level filter when every error has the same level', () => {
    // Act
    show([record(0), record(1)]);

    // Assert
    expect(screen.queryByRole('combobox', { name: 'Niveau' })).toBeNull();
  });
});

describe('ErrorBrowser sort', () => {
  it('should list the errors in reading order at first', () => {
    // Act
    show([record(0), record(1), record(2)]);

    // Assert
    expect(rows().map((row) => row.slice(-9))).toEqual(['failure 0', 'failure 1', 'failure 2']);
    expect(screen.getByRole('combobox', { name: 'Trier par' })).toHaveValue('reading:asc');
  });

  it('should list the most recent first when asked', () => {
    // Arrange
    show([record(0, { timestamp: '08:00:00' }), record(1, { timestamp: '10:00:00' }), record(2, { timestamp: '09:00:00' })]);

    // Act
    sortBy('time:desc');

    // Assert
    expect(rows().map((row) => row.slice(-9))).toEqual(['failure 1', 'failure 2', 'failure 0']);
  });

  it('should list the errors repeated most often first when asked', () => {
    // Arrange
    show([record(0, { fingerprintId: 1 }), record(1, { fingerprintId: 2 }), record(2, { fingerprintId: 2 })]);

    // Act
    sortBy('count:desc');

    // Assert
    expect(rows()[0]).toContain('×2');
  });

  it('should show the detail of the error that was clicked, by its number in the log, whatever the order', async () => {
    // Arrange
    show([record(0, { timestamp: '08:00:00' }), record(1, { timestamp: '10:00:00' })]);
    sortBy('time:desc');

    // Act
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option')[0] as HTMLElement);

    // Assert
    expect(await screen.findByLabelText('Texte de l’erreur 2')).toHaveTextContent('entry at 100');
  });

  it('should keep the selected error selected when the order changes', async () => {
    // Arrange
    show([record(0, { timestamp: '08:00:00' }), record(1, { timestamp: '10:00:00' })]);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option')[0] as HTMLElement);
    await screen.findByLabelText('Texte de l’erreur 1');

    // Act
    sortBy('time:desc');

    // Assert
    const selected = within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option')[1];
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveTextContent('failure 0');
  });

  it('should keep the detail of an error that a search hides', async () => {
    // Arrange
    show([record(0, { message: 'Disk full' }), record(1, { message: 'Timeout' })]);
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option')[0] as HTMLElement);
    await screen.findByLabelText('Texte de l’erreur 1');

    // Act
    search('timeout');

    // Assert
    expect(screen.getByLabelText('Texte de l’erreur 1')).toBeInTheDocument();
    expect(within(screen.getByRole('listbox', { name: 'Erreurs' })).getByRole('option')).toHaveAttribute('aria-selected', 'false');
  });

  it('should give back the reading order, the search and the level when reset', () => {
    // Arrange
    show([record(0, { level: 'ERR' }), record(1, { level: 'FTL' })]);
    sortBy('reading:desc');
    fireEvent.change(screen.getByRole('combobox', { name: 'Niveau' }), { target: { value: 'FTL' } });

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));

    // Assert
    expect(screen.getByRole('combobox', { name: 'Trier par' })).toHaveValue('reading:asc');
    expect(screen.getByRole('combobox', { name: 'Niveau' })).toHaveValue('');
    expect(rows()).toHaveLength(2);
  });
});
