import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ErrorRecord } from '../src/core/scanLog';
import type { EntryPosition, EntryText } from '../src/sources/readEntryText';
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
const select = (position: number) => {
  fireEvent.click(within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option')[position] as HTMLElement);
};

describe('ErrorBrowser', () => {
  it('should ask to select an error before one is selected', () => {
    // Act
    render(<ErrorBrowser records={[record(0, 0)]} readText={readOk} limitReached={false} />);

    // Assert
    expect(screen.getByText(/Sélectionnez une erreur pour voir son détail/)).toBeInTheDocument();
  });

  it('should show the detail of the error that is selected, and that of another one when the selection moves', async () => {
    // Arrange
    render(<ErrorBrowser records={[record(0, 0), record(1, 1)]} readText={readOk} limitReached={false} />);

    // Act
    select(1);

    // Assert
    expect(await screen.findByLabelText('Texte de l’erreur 2')).toHaveTextContent('entry at 100');
    select(0);
    expect(await screen.findByLabelText('Texte de l’erreur 1')).toHaveTextContent('entry at 0');
  });

  it('should tell how many errors are identical to the selected one, from the first to the last', async () => {
    // Arrange
    const records = [record(0, 7), record(1, 8), record(2, 7), record(3, 7)];
    render(<ErrorBrowser records={records} readText={readOk} limitReached={false} />);

    // Act
    select(2);
    await screen.findByLabelText('Texte de l’erreur 3');

    // Assert
    expect(screen.getByText('3 erreurs identiques parmi les erreurs enregistrées.')).toBeInTheDocument();
    expect(screen.getByText('Première : 08:00:00 (erreur 1). Dernière : 08:00:03 (erreur 4), dans l’ordre de lecture du journal.')).toBeInTheDocument();
  });

  it('should say "at least" when the record limit was reached', async () => {
    // Arrange
    render(<ErrorBrowser records={[record(0, 7), record(1, 7)]} readText={readOk} limitReached />);

    // Act
    select(0);
    await screen.findByLabelText('Texte de l’erreur 1');

    // Assert
    expect(screen.getByText('Au moins 2 erreurs identiques parmi les erreurs enregistrées.')).toBeInTheDocument();
  });

  describe('when the detail cannot be shown', () => {
    const crashing = (position: EntryPosition): Promise<EntryText> => {
      if (position.offset === 0) {
        throw new Error('rendering failure with log content');
      }
      return readOk(position);
    };

    it('should keep the list in place and say the panel failed, without the failure message', () => {
      // Arrange: React reports the caught error itself, which is noise in the test output.
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      render(<ErrorBrowser records={[record(0, 0), record(1, 1)]} readText={crashing} limitReached={false} />);

      // Act
      select(0);

      // Assert
      expect(screen.getByRole('alert')).toHaveTextContent('Ce panneau n’a pas pu s’afficher');
      expect(screen.queryByText(/log content/)).not.toBeInTheDocument();
      expect(screen.getByRole('listbox', { name: 'Erreurs' })).toBeInTheDocument();
    });

    it('should show the detail again when another error is selected after the failure', async () => {
      // Arrange
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      render(<ErrorBrowser records={[record(0, 0), record(1, 1)]} readText={crashing} limitReached={false} />);
      select(0);

      // Act
      select(1);

      // Assert
      expect(await screen.findByLabelText('Texte de l’erreur 2')).toHaveTextContent('entry at 100');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
