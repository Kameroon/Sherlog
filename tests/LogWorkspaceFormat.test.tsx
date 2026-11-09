import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readSample } from './helpers/samples';
import { BUILT_IN_PROFILES } from '../src/core/profiles';
import { chooseFile, finish, setup, startAnalysis } from './helpers/workspace';

const realLog = readSample('real-serilog.log');
const mixedLog = readSample('real-mixed-formats.log');
const counters = (): (string | null)[] => [...document.querySelectorAll('.counter')].map((counter) => counter.textContent);
const FORMAT = 'Format du journal';
const FILE_FORMAT = 'Serilog fichier / horodatage ISO + niveau';
const CONSOLE_FORMAT = 'Serilog console (sans date)';

const pickFormat = (label: string) => {
  const select = screen.getByLabelText(FORMAT);
  const option = [...select.querySelectorAll('option')].find((candidate) => candidate.textContent === label);
  fireEvent.change(select, { target: { value: option?.value ?? '' } });
};

describe('LogWorkspace format of a recognised log', () => {
  it('should offer the known formats with the recognised one selected', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(realLog, 'real.log');

    // Assert
    const select = screen.getByLabelText<HTMLSelectElement>(FORMAT);
    expect([...select.options].map((option) => option.textContent)).toEqual([FILE_FORMAT, CONSOLE_FORMAT]);
    expect(select.selectedOptions[0]?.textContent).toBe(CONSOLE_FORMAT);
    expect(screen.getByText(`Format reconnu : ${CONSOLE_FORMAT}`)).toBeInTheDocument();
  });

  it('should say the format is the user’s choice, not a recognised one, once another is picked', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');

    // Act
    pickFormat(FILE_FORMAT);

    // Assert
    expect(screen.getByText(`Format choisi : ${FILE_FORMAT}`)).toBeInTheDocument();
    expect(screen.queryByText(/Format reconnu/)).not.toBeInTheDocument();
  });

  it('should read the preview again with the format picked and refuse the analysis when no line matches it', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');

    // Act
    pickFormat(FILE_FORMAT);

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent(/Aucune ligne du début ne correspond à ce format/);
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toBeDisabled();
    expect(document.querySelectorAll('.excerpt li').length).toBeGreaterThan(0);
  });

  it('should allow the analysis again when the right format is picked back', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');
    pickFormat(FILE_FORMAT);

    // Act
    pickFormat(CONSOLE_FORMAT);

    // Assert
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toBeEnabled();
    expect(screen.getByText(`Format reconnu : ${CONSOLE_FORMAT}`)).toBeInTheDocument();
  });

  it('should keep the rules and forget the period when the format changes, since the period fits its own format', async () => {
    // Arrange
    setup();
    await chooseFile(realLog, 'real.log');
    fireEvent.change(screen.getByLabelText('Ignorer les entrées qui contiennent'), { target: { value: '/health' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la règle' }));
    fireEvent.change(screen.getByLabelText('Heure de début'), { target: { value: '12:00' } });

    // Act
    pickFormat(FILE_FORMAT);

    // Assert
    expect(screen.getByText(/« \/health »/)).toBeInTheDocument();
    expect(screen.getByLabelText('Début (date et heure)')).toHaveValue('');
  });

  it('should drop the result and ask for a new analysis when the format changes after the analysis, keeping the focus', async () => {
    // Arrange
    const scanner = setup();
    await startAnalysis(scanner);
    finish(scanner);
    const select = screen.getByLabelText(FORMAT);
    select.focus();

    // Act
    pickFormat(FILE_FORMAT);

    // Assert
    expect(screen.queryByText(/Analyse terminée sur votre ordinateur/)).not.toBeInTheDocument();
    expect(screen.getByText('Vous avez changé les réglages : relancez l’analyse pour en tenir compte.')).toBeInTheDocument();
    expect(select).toHaveFocus();
  });
});

describe('LogWorkspace format of a log that was not recognised', () => {
  it('should say why, offer the formats and wait for a choice without a preview or an analysis', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile('hello\nworld\n', 'unknown.log');

    // Assert
    expect(screen.getByText(/Format non reconnu/)).toBeInTheDocument();
    expect(screen.getByText(/aucun profil/)).toBeInTheDocument();
    expect(screen.getByLabelText(FORMAT)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toBeDisabled();
    expect(document.querySelectorAll('.counter')).toHaveLength(0);
    expect(screen.queryByRole('list', { name: 'Premières lignes du journal' })).not.toBeInTheDocument();
  });

  it('should show the preview and allow the analysis once a format is picked, and analyse with it', async () => {
    // Arrange
    const scanner = setup();
    await chooseFile(mixedLog, 'mixed.log');

    // Act
    pickFormat(CONSOLE_FORMAT);
    fireEvent.click(screen.getByRole('button', { name: 'Analyser ce journal' }));

    // Assert
    expect(scanner.requests[0]).toMatchObject({ profileId: 'serilog-console' });
  });

  it('should warn about the lines that no entry header introduces when the picked format reads only part of the log', async () => {
    // Arrange
    setup();
    await chooseFile(mixedLog, 'mixed.log');

    // Act
    pickFormat(CONSOLE_FORMAT);

    // Assert
    expect(screen.getByText('1 ligne au début du fichier n’a ni date ni niveau : elle est gardée, mais ne compte jamais comme erreur.')).toBeInTheDocument();
    expect(counters()[0]).toContain('5entrées lues');
  });

  it('should say how many lines look like another format, and that they are read as the end of the entry before them', async () => {
    // Arrange
    setup();
    await chooseFile(mixedLog, 'mixed.log');

    // Act
    pickFormat(CONSOLE_FORMAT);

    // Assert
    expect(
      screen.getByText(`1 ligne du journal ressemble à un autre format (${FILE_FORMAT}) : elle est lue comme la suite de l’entrée qui la précède.`),
    ).toBeInTheDocument();
  });

  it('should say it for each format that the lines look like, in the plural', async () => {
    // Arrange
    setup();
    await chooseFile(mixedLog, 'mixed.log');
    pickFormat(CONSOLE_FORMAT);

    // Act
    pickFormat(FILE_FORMAT);

    // Assert
    expect(
      screen.getByText(`4 lignes du journal ressemblent à un autre format (${CONSOLE_FORMAT}) : elles sont lues comme la suite de l’entrée qui les précède.`),
    ).toBeInTheDocument();
  });

  it('should say nothing about another format when no line looks like one', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile(realLog, 'real.log');

    // Assert
    expect(screen.queryByText(/ressemble.* à un autre format/)).not.toBeInTheDocument();
  });

  it('should say the lines are those of the beginning when only the beginning of a big file was read', async () => {
    // Arrange
    const mixed = new TextEncoder().encode(mixedLog);
    const consoleProfile = BUILT_IN_PROFILES.find((profile) => profile.id === 'serilog-console');
    if (consoleProfile === undefined) {
      throw new Error('the console profile is missing');
    }
    setup({ readHead: () => Promise.resolve({ detection: { status: 'unrecognized', reason: 'x' }, head: mixed, complete: false }) });
    const big = new File(['x'], 'big.log');
    Object.defineProperty(big, 'size', { value: 300 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Choisir un fichier'), { target: { files: [big] } });
    await screen.findByRole('button', { name: 'Choisir un autre journal' });

    // Act
    pickFormat(CONSOLE_FORMAT);

    // Assert
    expect(screen.getByText(/1 ligne du début ressemble à un autre format/)).toBeInTheDocument();
  });

  it('should say that the preview is read with the format picked, which is not the same as recognised', async () => {
    // Arrange
    setup();
    await chooseFile(mixedLog, 'mixed.log');

    // Act
    pickFormat(CONSOLE_FORMAT);

    // Assert
    expect(screen.getByText(`Format choisi : ${CONSOLE_FORMAT}`)).toBeInTheDocument();
  });

  it('should offer no format for a log that looks like JSON', async () => {
    // Arrange
    setup();

    // Act
    await chooseFile('{"@t":"2026-11-04T08:16:10Z"}\n', 'events.json');

    // Assert
    expect(screen.getByText(/JSON/)).toBeInTheDocument();
    expect(screen.queryByLabelText(FORMAT)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyser ce journal' })).not.toBeInTheDocument();
  });
});
