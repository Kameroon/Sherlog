import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogWorkspace } from '../src/ui/LogWorkspace';
import { MAX_DISPLAYED_ERRORS } from '../src/ui/ErrorList';
import type { StartScan } from '../src/workers/scanProtocol';
import { consoleLog, errorRecord, scanResult } from './helpers/fakeScanner';
import { chooseFile, finish, setup, startAnalysis } from './helpers/workspace';

describe('LogWorkspace choosing a source', () => {
  it('should offer a file and a paste field and say that no source is loaded', () => {
    // Act
    setup();

    // Assert
    expect(screen.getByText(/Aucune source de logs chargée/)).toBeInTheDocument();
    expect(screen.getByLabelText('Choisir un fichier')).toBeInTheDocument();
    expect(screen.getByLabelText('Collez ici des logs que vous avez copiés')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyser ce journal' })).not.toBeInTheDocument();
  });

  it('should not allow reading an empty paste field', () => {
    // Act
    setup();

    // Assert
    expect(screen.getByRole('button', { name: 'Lire le texte collé' })).toBeDisabled();
  });

  it('should show the recognised format and wait for the click without scanning when a file is chosen', async () => {
    // Arrange
    const scanner = setup();

    // Act
    await chooseFile(consoleLog);

    // Assert
    expect(screen.getByText(/Format reconnu : Serilog console/)).toBeInTheDocument();
    expect(screen.getByText(/ne contient que l’heure/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toBeEnabled();
    expect(scanner.requests).toEqual([]);
  });

  it('should recognise pasted text the same way and name it as pasted text', async () => {
    // Arrange
    const scanner = setup();
    fireEvent.change(screen.getByLabelText('Collez ici des logs que vous avez copiés'), { target: { value: consoleLog } });

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Lire le texte collé' }));
    await screen.findByText(/Format reconnu/);

    // Assert
    expect(screen.getByRole('heading', { name: 'Texte collé' })).toBeInTheDocument();
    expect(scanner.requests).toEqual([]);
  });

  it('should explain that the format is not recognised and offer no analysis when no profile reads the file', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile('hello\nworld\n');

    // Assert
    expect(screen.getByText(/Format non reconnu/)).toBeInTheDocument();
    expect(screen.getByText(/aucun profil/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyser ce journal' })).not.toBeInTheDocument();
  });

  it('should say that JSON is not supported yet when the file is JSON lines', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile('{"@t":"2026-11-04T08:16:10Z"}\n');

    // Assert
    expect(screen.getByText(/JSON/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyser ce journal' })).not.toBeInTheDocument();
  });

  it('should go back to the choice and empty the paste field when the user chooses another log', async () => {
    // Arrange
    setup();
    fireEvent.change(screen.getByLabelText('Collez ici des logs que vous avez copiés'), { target: { value: consoleLog } });
    fireEvent.click(screen.getByRole('button', { name: 'Lire le texte collé' }));
    await screen.findByRole('button', { name: 'Choisir un autre journal' });

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Choisir un autre journal' }));

    // Assert
    expect(screen.getByLabelText('Collez ici des logs que vous avez copiés')).toHaveValue('');
  });
});

describe('LogWorkspace analysing', () => {
  it('should show a progress bar, the errors found so far and a cancel button while the scan runs', async () => {
    // Arrange
    const scanner = setup();

    // Act
    await startAnalysis(scanner);
    scanner.emit({ type: 'progress', bytesRead: 22 });
    scanner.emit({ type: 'errors', records: [errorRecord] });

    // Assert
    expect(screen.getByRole('progressbar', { name: 'Progression de l’analyse' })).toHaveAttribute('value', '22');
    expect(screen.getByText(/1 erreur trouvée/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Erreurs' })).not.toBeInTheDocument();
  });

  it('should go back to the recognised file when the user cancels', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    // Assert
    expect(scanner.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toBeInTheDocument();
  });

  it('should show the message and let the user choose again when the scan fails', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    scanner.emit({ type: 'failed', message: 'Lecture impossible : boom.' });

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('Lecture impossible : boom.');
    expect(screen.getByLabelText('Choisir un fichier')).toBeInTheDocument();
  });
});

describe('LogWorkspace when the worker cannot start', () => {
  it('should say why and let the user choose again instead of staying on the progress screen', async () => {
    // Arrange
    const startScan: StartScan = () => {
      throw new DOMException('refused by the policy', 'SecurityError');
    };
    render(<LogWorkspace dependencies={{ startScan }} />);
    await chooseFile(consoleLog);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Analyser ce journal' }));

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('L’analyse n’a pas pu démarrer dans ce navigateur (SecurityError).');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Choisir un fichier')).toBeInTheDocument();
  });
});

describe('LogWorkspace keyboard and screen reader', () => {
  it('should move the focus to the file name once the format is recognised', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(consoleLog, 'app.log');

    // Assert
    expect(screen.getByRole('heading', { name: 'app.log' })).toHaveFocus();
  });

  it('should move the focus into the progress screen when the analysis starts, not leave it on the page', async () => {
    // Arrange
    const scanner = setup();

    // Act
    await startAnalysis(scanner);

    // Assert
    expect(screen.getByRole('heading', { name: 'app.log' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('should move the focus to the result sentence when the analysis is done', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    finish(scanner);

    // Assert
    expect(screen.getByText('Analyse terminée sur votre ordinateur.')).toHaveFocus();
  });

  it('should move the focus to the message when the scan fails', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    scanner.emit({ type: 'failed', message: 'Lecture impossible : boom.' });

    // Assert
    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('should not steal the focus when the page first opens', () => {
    // Act
    setup();

    // Assert
    expect(document.body).toHaveFocus();
  });

  it('should keep the percentage out of the live region so that a reader does not announce it ten times a second', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    scanner.emit({ type: 'progress', bytesRead: 22 });

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('Analyse en cours');
    expect(screen.getByRole('status')).not.toHaveTextContent('%');
    expect(screen.getByText(new RegExp(`${Math.floor((22 / consoleLog.length) * 100)} %`))).toBeInTheDocument();
  });
});

describe('LogWorkspace result', () => {
  it('should summarise the scan and list the errors once it is done', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    finish(scanner);

    // Assert
    expect(screen.getByText(/Analyse terminée sur votre ordinateur/)).toBeInTheDocument();
    expect(screen.getByText(/2 entrées lues/)).toBeInTheDocument();
    expect(screen.getByText(/1 erreur\b/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Erreurs' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('[08:16:10 ERR] Failed')).toBeInTheDocument();
  });

  it('should show the first line of an error as text and never as markup', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);
    const hostile = '<img src=x onerror=alert(1)>';

    // Act
    finish(scanner, [{ ...errorRecord, firstLine: hostile }]);

    // Assert
    expect(screen.getByText(hostile)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('should mark a first line that was cut for display with an ellipsis', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    finish(scanner, [{ ...errorRecord, firstLine: 'abc', firstLineCut: true }]);

    // Assert
    expect(screen.getByText('abc…')).toBeInTheDocument();
  });

  it('should limit the rows shown and say how many errors were recorded when there are too many', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);
    const many = Array.from({ length: MAX_DISPLAYED_ERRORS + 50 }, (_, index) => ({ ...errorRecord, offset: index * 22 }));

    // Act
    finish(scanner, many, { ...scanResult, errors: many.length });

    // Assert
    expect(within(screen.getByRole('list', { name: 'Erreurs' })).getAllByRole('listitem')).toHaveLength(MAX_DISPLAYED_ERRORS);
    expect(screen.getByText(new RegExp(`${MAX_DISPLAYED_ERRORS} premières erreurs sur ${many.length}`))).toBeInTheDocument();
  });

  it('should say that errors were counted but not recorded when the record limit was reached', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    finish(scanner, [errorRecord], { ...scanResult, errors: 120_000, limitReached: true });

    // Assert
    expect(screen.getByText(/120.000 erreurs ont été trouvées, seules les 1 premières sont enregistrées/)).toBeInTheDocument();
  });

  it('should say "at least" for the distinct errors when only the first errors were fingerprinted', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    finish(scanner, [errorRecord], { ...scanResult, errors: 120_000, limitReached: true });

    // Assert
    expect(screen.getByText(/au moins 1 distincte/)).toBeInTheDocument();
  });

  it('should give the exact count of distinct errors when every error was fingerprinted', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    finish(scanner);

    // Assert
    expect(screen.getByText(/1 erreur \(1 distincte\)/)).toBeInTheDocument();
  });

  it('should warn that very long entries were only partly used to group identical errors', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    finish(scanner, [errorRecord], { ...scanResult, truncatedEntries: 2 });

    // Assert
    expect(screen.getByText(/2 entrées très longues/)).toBeInTheDocument();
  });

  it('should also say that the rules only read the beginning of very long entries when rules were used', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    finish(scanner, [errorRecord], { ...scanResult, truncatedEntries: 1, ignoredPerRule: [3] });

    // Assert
    expect(screen.getByText(/1 entrée très longue : seul son début a servi à regrouper les erreurs identiques et à appliquer vos règles/)).toBeInTheDocument();
  });

  it('should say that no error was found when the log has none', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);

    // Act
    finish(scanner, [], { ...scanResult, errors: 0, fingerprints: [] });

    // Assert
    expect(screen.getByText(/Aucune erreur trouvée/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Erreurs' })).not.toBeInTheDocument();
  });
});

describe('LogWorkspace reading an entry again', () => {
  it('should show the text read again from the file when the user asks for it', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);
    finish(scanner);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /Voir le texte/ }));

    // Assert
    expect(await screen.findByLabelText(/Texte de l’entrée/)).toHaveTextContent('[08:16:10 ERR] Failed');
    expect(screen.getByRole('button', { name: /Masquer le texte/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('should say that only the beginning is shown when the entry is bigger than the limit', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);
    finish(scanner, [{ ...errorRecord, length: 3 * 1024 * 1024 }]);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /Voir le texte/ }));

    // Assert
    expect(await screen.findByText(/Cette entrée fait 3 Mio : seul son début \(1 Mio\) est affiché/)).toBeInTheDocument();
  });

  it('should not warn about a cut when the whole entry is shown', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);
    finish(scanner);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /Voir le texte/ }));
    await screen.findByLabelText(/Texte de l’entrée/);

    // Assert
    expect(screen.queryByText(/seul son début/)).not.toBeInTheDocument();
  });

  it('should tell the user to choose the file again when it can no longer be read', async () => {
    // Arrange
    const scanner = setup();
    const file = new File([consoleLog], 'app.log');
    const slice = file.slice.bind(file);
    let reads = 0;
    // The first read (format detection) works; the file then disappears.
    file.slice = (...args: Parameters<File['slice']>) => {
      reads += 1;
      return reads === 1 ? slice(...args) : ({ arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotFoundError')) } as unknown as Blob);
    };
    fireEvent.change(screen.getByLabelText('Choisir un fichier'), { target: { files: [file] } });
    await screen.findByRole('button', { name: 'Analyser ce journal' });
    fireEvent.click(screen.getByRole('button', { name: 'Analyser ce journal' }));
    finish(scanner);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /Voir le texte/ }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('modifié, déplacé ou n’est plus lisible');
  });
});
