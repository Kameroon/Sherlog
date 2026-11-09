import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ErrorRecord } from '../src/core/scanLog';
import type { EntryPosition, EntryText } from '../src/sources/readEntryText';
import type { NeighbourLines } from '../src/sources/readNeighbourLines';
import { ErrorBrowser } from '../src/ui/ErrorBrowser';

const record = (index: number, fingerprintId: number): ErrorRecord => ({
  offset: index * 100,
  length: 90,
  timestamp: `08:00:${String(index).padStart(2, '0')}`,
  level: 'ERR',
  message: `failure ${index}`,
  messageCut: false,
  lineCount: 1,
  fingerprintId,
});

const readOk = (position: EntryPosition): Promise<EntryText> => Promise.resolve({ text: `entry at ${position.offset}`, cut: false });
const noNeighbours = (): Promise<NeighbourLines> => Promise.resolve({ before: [], after: [], beforeLimited: false, afterLimited: false });

const show = (records: readonly ErrorRecord[]) =>
  render(<ErrorBrowser readNeighbours={noNeighbours} records={records} readText={readOk} limitReached={false} />);

const options = () => within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option');
const rows = (): string[] => options().map((option) => option.textContent ?? '');
const select = (row: number): void => {
  fireEvent.click(options()[row] as HTMLElement);
};
const setStatus = (label: string): void => {
  fireEvent.change(screen.getByRole('combobox', { name: 'Statut de cette erreur' }), { target: { value: label } });
};
const filterByStatus = (value: string): void => {
  fireEvent.change(screen.getByRole('combobox', { name: 'Statut' }), { target: { value } });
};

describe('ErrorBrowser statuses', () => {
  it('should offer the status of the selected error, new at first', () => {
    // Arrange
    show([record(0, 0)]);

    // Act
    select(0);

    // Assert
    expect(screen.getByRole('combobox', { name: 'Statut de cette erreur' })).toHaveValue('new');
  });

  it('should not offer a status before an error is selected', () => {
    // Act
    show([record(0, 0)]);

    // Assert
    expect(screen.queryByRole('combobox', { name: 'Statut de cette erreur' })).toBeNull();
  });

  it('should mark the error in the list with its status once the user sets it', () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    select(0);

    // Act
    setStatus('resolved');

    // Assert
    expect(rows()[0]).toContain('Résolu');
    expect(rows()[1]).not.toContain('Résolu');
  });

  it('should show nothing for the errors that are new', () => {
    // Arrange
    show([record(0, 0)]);

    // Assert
    expect(rows()[0]).not.toContain('Nouveau');
  });

  it('should give the same status to the identical errors, and say so', () => {
    // Arrange
    show([record(0, 5), record(1, 6), record(2, 5)]);
    select(0);

    // Act
    setStatus('ignored');

    // Assert
    expect(rows().map((row) => row.includes('Ignoré'))).toEqual([true, false, true]);
    expect(screen.getByText('Ce statut vaut aussi pour les 2 erreurs identiques.')).toBeInTheDocument();
  });

  it('should not talk about identical errors for an error that is alone', () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);

    // Act
    select(0);

    // Assert
    expect(screen.queryByText(/erreurs identiques\./)).toBeNull();
  });

  it('should show the status of an error when it is selected again', () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    select(0);
    setStatus('resolved');
    select(1);

    // Act
    select(0);

    // Assert
    expect(screen.getByRole('combobox', { name: 'Statut de cette erreur' })).toHaveValue('resolved');
  });

  it('should go back to new when the user chooses it again', () => {
    // Arrange
    show([record(0, 0)]);
    select(0);
    setStatus('ignored');

    // Act
    setStatus('new');

    // Assert
    expect(rows()[0]).not.toContain('Ignoré');
  });
});

describe('ErrorBrowser status filter', () => {
  it('should keep only the errors of the chosen status', () => {
    // Arrange
    show([record(0, 0), record(1, 1), record(2, 2)]);
    select(1);
    setStatus('resolved');

    // Act
    filterByStatus('resolved');

    // Assert
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('failure 1');
  });

  it('should keep the errors that are new when « Nouveau » is chosen', () => {
    // Arrange
    show([record(0, 0), record(1, 1), record(2, 2)]);
    select(1);
    setStatus('resolved');

    // Act
    filterByStatus('new');

    // Assert
    expect(rows().map((row) => row.slice(-9))).toEqual(['failure 0', 'failure 2']);
  });

  it('should offer every status and « Tous »', () => {
    // Act
    show([record(0, 0)]);

    // Assert
    const labels = within(screen.getByRole('combobox', { name: 'Statut' })).getAllByRole('option').map((option) => option.textContent);
    expect(labels).toEqual(['Tous', 'Nouveau', 'Ignoré', 'Résolu']);
  });

  it('should take the error out of the list but keep its detail when its new status no longer fits the filter', () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    filterByStatus('new');
    select(0);

    // Act
    setStatus('resolved');

    // Assert
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('failure 1');
    expect(screen.getByRole('combobox', { name: 'Statut de cette erreur' })).toHaveValue('resolved');
  });

  it('should say how many errors are shown when the filter narrows the list', () => {
    // Arrange
    show([record(0, 0), record(1, 1), record(2, 2)]);
    select(1);
    setStatus('ignored');

    // Act
    filterByStatus('ignored');

    // Assert
    expect(document.querySelector('.error-toolbar-count')).toHaveTextContent('1 erreur affichée sur 3');
  });

  it('should keep the statuses when the filter is reset', () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    select(0);
    setStatus('resolved');
    filterByStatus('resolved');

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));

    // Assert
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toContain('Résolu');
    expect(screen.getByRole('combobox', { name: 'Statut' })).toHaveValue('');
  });

  it('should keep the statuses when the order changes', () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    select(0);
    setStatus('resolved');

    // Act
    fireEvent.change(screen.getByRole('combobox', { name: 'Trier par' }), { target: { value: 'reading:desc' } });

    // Assert
    expect(rows()[1]).toContain('Résolu');
  });
});
