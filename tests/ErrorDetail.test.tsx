import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ErrorRecord } from '../src/core/scanLog';
import type { EntryPosition, EntryText } from '../src/sources/readEntryText';
import { ErrorDetail } from '../src/ui/ErrorDetail';

const record = (offset: number, length = 90): ErrorRecord => ({
  offset,
  length,
  timestamp: '08:16:10',
  level: 'ERR',
  message: 'Failed',
  messageCut: false,
  lineCount: 3,
  fingerprintId: 0,
});

/** A read the test finishes by hand, to be able to select another error while it is still running. */
function pendingRead() {
  let resolve: (text: EntryText) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<EntryText>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('ErrorDetail', () => {
  it('should ask to select an error when none is selected, and read nothing', () => {
    // Arrange
    const readText = vi.fn<(position: EntryPosition) => Promise<EntryText>>();

    // Act
    render(<ErrorDetail record={null} position={1} readText={readText} />);

    // Assert
    expect(screen.getByText(/Sélectionnez une erreur pour voir son détail/)).toBeInTheDocument();
    expect(readText).not.toHaveBeenCalled();
  });

  it('should say the entry is being read while the file is read', () => {
    // Arrange
    const read = pendingRead();

    // Act
    render(<ErrorDetail record={record(0)} position={4} readText={() => read.promise} />);

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('Lecture de l’entrée dans le fichier');
    expect(screen.getByRole('heading', { name: 'Détail de l’erreur 4' })).toBeInTheDocument();
  });

  it('should show the whole text, stack included, as text and never as markup', async () => {
    // Arrange
    const text = '[ERR] Failed <img src=x onerror=alert(1)>\n   at Shop.Run() in /src/Run.cs:line 7';

    // Act
    render(<ErrorDetail record={record(0)} position={1} readText={() => Promise.resolve({ text, cut: false })} />);

    // Assert
    const region = await screen.findByLabelText('Texte de l’erreur 1');
    expect(region).toHaveTextContent('at Shop.Run() in /src/Run.cs:line 7');
    expect(region.querySelector('img')).toBeNull();
    expect(screen.queryByText(/seul son début/)).not.toBeInTheDocument();
  });

  it('should read the entry at the position of the error', async () => {
    // Arrange
    const readText = vi.fn<(position: EntryPosition) => Promise<EntryText>>(() => Promise.resolve({ text: 'x', cut: false }));

    // Act
    render(<ErrorDetail record={record(1234, 56)} position={1} readText={readText} />);
    await screen.findByLabelText('Texte de l’erreur 1');

    // Assert
    expect(readText).toHaveBeenCalledWith(expect.objectContaining({ offset: 1234, length: 56 }));
  });

  it('should say that only the beginning is shown when the entry is longer than what is read', async () => {
    // Act
    render(<ErrorDetail record={record(0, 3 * 1024 * 1024)} position={1} readText={() => Promise.resolve({ text: 'start', cut: true })} />);

    // Assert
    expect(await screen.findByText('Cette entrée fait 3 Mio : seul son début (1 Mio) est affiché.')).toBeInTheDocument();
  });

  it('should tell the user what happened when the file can no longer be read', async () => {
    // Act
    render(<ErrorDetail record={record(0)} position={1} readText={() => Promise.reject(new DOMException('gone', 'NotFoundError'))} />);

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Le fichier a été modifié, déplacé ou n’est plus lisible');
  });

  it('should drop the answer of an earlier read when another error is selected before it ends', async () => {
    // Arrange
    const first = pendingRead();
    const second = pendingRead();
    const readText = (position: EntryPosition) => (position.offset === 0 ? first.promise : second.promise);
    const { rerender } = render(<ErrorDetail key="a" record={record(0)} position={1} readText={readText} />);
    rerender(<ErrorDetail key="b" record={record(100)} position={2} readText={readText} />);

    // Act: the second read ends first, then the first one, late.
    await act(async () => {
      second.resolve({ text: 'second error', cut: false });
      await second.promise;
      first.resolve({ text: 'first error', cut: false });
      await first.promise;
    });

    // Assert
    expect(screen.getByLabelText('Texte de l’erreur 2')).toHaveTextContent('second error');
    expect(screen.queryByText('first error')).not.toBeInTheDocument();
  });

  it('should drop the failure of an earlier read when another error is selected before it ends', async () => {
    // Arrange
    const first = pendingRead();
    const readText = (position: EntryPosition) => (position.offset === 0 ? first.promise : Promise.resolve({ text: 'second error', cut: false }));
    const { rerender } = render(<ErrorDetail key="a" record={record(0)} position={1} readText={readText} />);
    rerender(<ErrorDetail key="b" record={record(100)} position={2} readText={readText} />);

    // Act
    await act(async () => {
      first.reject(new DOMException('gone', 'NotFoundError'));
      await first.promise.catch(() => undefined);
    });

    // Assert
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Texte de l’erreur 2')).toHaveTextContent('second error');
  });
});
