import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ErrorRecord } from '../src/core/scanLog';
import type { EntryPosition, EntryText } from '../src/sources/readEntryText';
import type { NeighbourLines } from '../src/sources/readNeighbourLines';
import type { IdenticalErrors } from '../src/core/identicalErrors';
import { ErrorDetail } from '../src/ui/ErrorDetail';

const neighbours = (overrides: Partial<NeighbourLines> = {}): NeighbourLines => ({
  before: [],
  after: [],
  beforeLimited: false,
  afterLimited: false,
  ...overrides,
});
const noNeighbours = (): Promise<NeighbourLines> => Promise.resolve(neighbours());

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
    render(<ErrorDetail readNeighbours={noNeighbours} record={null} position={1} readText={readText} />);

    // Assert
    expect(screen.getByText(/Sélectionnez une erreur pour voir son détail/)).toBeInTheDocument();
    expect(readText).not.toHaveBeenCalled();
  });

  it('should say the entry is being read while the file is read', () => {
    // Arrange
    const read = pendingRead();

    // Act
    render(<ErrorDetail readNeighbours={noNeighbours} record={record(0)} position={4} readText={() => read.promise} />);

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('Lecture de l’entrée dans le fichier');
    expect(screen.getByRole('heading', { name: 'Détail de l’erreur 4' })).toBeInTheDocument();
  });

  it('should show the whole text, stack included, as text and never as markup', async () => {
    // Arrange
    const text = '[ERR] Failed <img src=x onerror=alert(1)>\n   at Shop.Run() in /src/Run.cs:line 7';

    // Act
    render(<ErrorDetail readNeighbours={noNeighbours} record={record(0)} position={1} readText={() => Promise.resolve({ text, cut: false })} />);

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
    render(<ErrorDetail readNeighbours={noNeighbours} record={record(1234, 56)} position={1} readText={readText} />);
    await screen.findByLabelText('Texte de l’erreur 1');

    // Assert
    expect(readText).toHaveBeenCalledWith(expect.objectContaining({ offset: 1234, length: 56 }));
  });

  it('should say that only the beginning is shown when the entry is longer than what is read', async () => {
    // Act
    render(<ErrorDetail readNeighbours={noNeighbours} record={record(0, 3 * 1024 * 1024)} position={1} readText={() => Promise.resolve({ text: 'start', cut: true })} />);

    // Assert
    expect(await screen.findByText('Cette entrée fait 3 Mio : seul son début (1 Mio) est affiché.')).toBeInTheDocument();
  });

  it('should tell the user what happened when the file can no longer be read', async () => {
    // Act
    render(<ErrorDetail readNeighbours={noNeighbours} record={record(0)} position={1} readText={() => Promise.reject(new DOMException('gone', 'NotFoundError'))} />);

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Le fichier a été modifié, déplacé ou n’est plus lisible');
  });

  it('should drop the answer of an earlier read when another error is selected before it ends', async () => {
    // Arrange
    const first = pendingRead();
    const second = pendingRead();
    const readText = (position: EntryPosition) => (position.offset === 0 ? first.promise : second.promise);
    const { rerender } = render(<ErrorDetail readNeighbours={noNeighbours} key="a" record={record(0)} position={1} readText={readText} />);
    rerender(<ErrorDetail readNeighbours={noNeighbours} key="b" record={record(100)} position={2} readText={readText} />);

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
    const { rerender } = render(<ErrorDetail readNeighbours={noNeighbours} key="a" record={record(0)} position={1} readText={readText} />);
    rerender(<ErrorDetail readNeighbours={noNeighbours} key="b" record={record(100)} position={2} readText={readText} />);

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

describe('ErrorDetail identical errors', () => {
  const read = () => Promise.resolve({ text: 'x', cut: false });
  const group = (count: number, firstIndex: number, lastIndex: number, first: string | null, last: string | null): IdenticalErrors => ({
    count,
    first: { ...record(0), timestamp: first },
    last: { ...record(0), timestamp: last },
    firstIndex,
    lastIndex,
  });

  it('should say how many identical errors there are, with the first and the last in reading order', async () => {
    // Act
    render(<ErrorDetail readNeighbours={noNeighbours} record={record(0)} position={3} readText={read} identical={group(4, 0, 9, '08:00:00', '09:30:00')} countIsMinimum={false} />);
    await screen.findByLabelText('Texte de l’erreur 3');

    // Assert
    expect(screen.getByText('4 erreurs identiques parmi les erreurs enregistrées.')).toBeInTheDocument();
    expect(screen.getByText('Première : 08:00:00 (erreur 1). Dernière : 09:30:00 (erreur 10), dans l’ordre de lecture du journal.')).toBeInTheDocument();
  });

  it('should say "at least" when errors past the record limit were not recorded', async () => {
    // Act
    render(<ErrorDetail readNeighbours={noNeighbours} record={record(0)} position={1} readText={read} identical={group(4, 0, 3, '08:00:00', '08:00:09')} countIsMinimum />);
    await screen.findByLabelText('Texte de l’erreur 1');

    // Assert
    expect(screen.getByText('Au moins 4 erreurs identiques parmi les erreurs enregistrées.')).toBeInTheDocument();
  });

  it('should say nothing about identical errors when the error is alone', async () => {
    // Act
    render(<ErrorDetail readNeighbours={noNeighbours} record={record(0)} position={1} readText={read} identical={group(1, 0, 0, '08:00:00', '08:00:00')} countIsMinimum={false} />);
    await screen.findByLabelText('Texte de l’erreur 1');

    // Assert
    expect(screen.queryByText(/identiques/)).not.toBeInTheDocument();
  });

  it('should write « sans heure » for an end of the group that has no timestamp', async () => {
    // Act
    render(<ErrorDetail readNeighbours={noNeighbours} record={record(0)} position={1} readText={read} identical={group(2, 0, 1, null, null)} countIsMinimum={false} />);
    await screen.findByLabelText('Texte de l’erreur 1');

    // Assert
    expect(screen.getByText(/Première : sans heure \(erreur 1\)\. Dernière : sans heure \(erreur 2\)/)).toBeInTheDocument();
  });

  it('should announce once that the detail is ready, for a reader that cannot see it appear', async () => {
    // Act
    render(<ErrorDetail readNeighbours={noNeighbours} record={record(0)} position={5} readText={read} identical={undefined} countIsMinimum={false} />);

    // Assert
    expect(await screen.findByText('Détail de l’erreur 5 affiché.')).toBeInTheDocument();
  });
});

describe('ErrorDetail neighbour lines', () => {
  const read = () => Promise.resolve({ text: 'x', cut: false });
  const show = () => fireEvent.click(screen.getByRole('button', { name: 'Voir les lignes autour' }));

  it('should read nothing around the error until the user asks for it', async () => {
    // Arrange
    const readNeighbours = vi.fn<(position: EntryPosition) => Promise<NeighbourLines>>(noNeighbours);

    // Act
    render(<ErrorDetail record={record(0)} position={1} readText={read} readNeighbours={readNeighbours} />);
    await screen.findByLabelText('Texte de l’erreur 1');

    // Assert
    expect(readNeighbours).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Voir les lignes autour' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('should say the lines are being read, then show the lines before and after as text', async () => {
    // Arrange
    const readNeighbours = vi.fn<(position: EntryPosition) => Promise<NeighbourLines>>(() =>
      Promise.resolve(neighbours({ before: ['08:16:08 [INF] Start', '08:16:09 [WRN] Slow <b>db</b>'], after: ['08:16:11 [INF] Retry'] })),
    );
    render(<ErrorDetail record={record(1234, 56)} position={2} readText={read} readNeighbours={readNeighbours} />);

    // Act
    show();

    // Assert
    expect(screen.getByText('Lecture des lignes autour de l’erreur…')).toBeInTheDocument();
    const before = await screen.findByLabelText('Lignes avant l’erreur 2');
    expect(before).toHaveTextContent('08:16:08 [INF] Start');
    expect(before).toHaveTextContent('08:16:09 [WRN] Slow <b>db</b>');
    expect(before.querySelector('b')).toBeNull();
    expect(screen.getByLabelText('Lignes après l’erreur 2')).toHaveTextContent('08:16:11 [INF] Retry');
    expect(readNeighbours).toHaveBeenCalledWith(expect.objectContaining({ offset: 1234, length: 56 }));
    expect(screen.getByRole('button', { name: 'Masquer les lignes autour' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('should say that nothing comes before or after when the error is at the edge of the file', async () => {
    // Arrange
    render(<ErrorDetail record={record(0)} position={1} readText={read} readNeighbours={noNeighbours} />);

    // Act
    show();

    // Assert
    expect(await screen.findByText('Aucune ligne avant : l’erreur est au début du journal.')).toBeInTheDocument();
    expect(screen.getByText('Aucune ligne après : l’erreur est à la fin du journal.')).toBeInTheDocument();
  });

  it('should warn that lines may be missing on the side where the read limit was reached, and only there', async () => {
    // Arrange
    const readNeighbours = () => Promise.resolve(neighbours({ before: ['a'], after: ['b'], afterLimited: true }));
    render(<ErrorDetail record={record(0)} position={1} readText={read} readNeighbours={readNeighbours} />);

    // Act
    show();

    // Assert
    expect(await screen.findByText(/Lecture limitée aux 64 Kio qui suivent l’erreur/)).toBeInTheDocument();
    expect(screen.queryByText(/qui précèdent l’erreur/)).not.toBeInTheDocument();
  });

  it('should tell the user what happened when the lines can no longer be read, leaving the error text in place', async () => {
    // Arrange
    const readNeighbours = () => Promise.reject(new DOMException('gone', 'NotFoundError'));
    render(<ErrorDetail record={record(0)} position={1} readText={() => Promise.resolve({ text: 'the error', cut: false })} readNeighbours={readNeighbours} />);
    await screen.findByLabelText('Texte de l’erreur 1');

    // Act
    show();

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Le fichier a été modifié, déplacé ou n’est plus lisible');
    expect(screen.getByLabelText('Texte de l’erreur 1')).toHaveTextContent('the error');
  });

  it('should hide the lines again when the button is used a second time', async () => {
    // Arrange
    render(<ErrorDetail record={record(0)} position={1} readText={read} readNeighbours={() => Promise.resolve(neighbours({ before: ['a line'] }))} />);
    show();
    await screen.findByLabelText('Lignes avant l’erreur 1');

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Masquer les lignes autour' }));

    // Assert
    expect(screen.queryByLabelText('Lignes avant l’erreur 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voir les lignes autour' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('should drop an answer that arrives after the lines were hidden', async () => {
    // Arrange
    let resolve: (lines: NeighbourLines) => void = () => undefined;
    const late = new Promise<NeighbourLines>((done) => {
      resolve = done;
    });
    render(<ErrorDetail record={record(0)} position={1} readText={read} readNeighbours={() => late} />);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Masquer les lignes autour' }));

    // Act
    await act(async () => {
      resolve(neighbours({ before: ['too late'] }));
      await late;
    });

    // Assert
    expect(screen.queryByText('too late')).not.toBeInTheDocument();
  });
});
