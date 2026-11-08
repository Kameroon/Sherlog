import { fireEvent, render, screen } from '@testing-library/react';
import { expect } from 'vitest';
import type { ErrorRecord } from '../../src/core/scanLog';
import { LogWorkspace } from '../../src/ui/LogWorkspace';
import type { ScanDependencies } from '../../src/ui/useLogScan';
import { consoleLog, errorRecord, fakeScanner, scanResult } from './fakeScanner';

/** Renders the workspace with a fake worker; the other dependencies can be replaced. */
export function setup(dependencies: Partial<ScanDependencies> = {}) {
  const scanner = fakeScanner();
  render(<LogWorkspace dependencies={{ startScan: scanner.startScan, ...dependencies }} />);
  return scanner;
}

/** Chooses a file through the real input and waits until the format is recognised (or refused). */
export const chooseFile = async (text: string, name = 'app.log') => {
  fireEvent.change(screen.getByLabelText('Choisir un fichier'), { target: { files: [new File([text], name)] } });
  await screen.findByRole('button', { name: 'Choisir un autre journal' });
};

export const startAnalysis = async (scanner: ReturnType<typeof fakeScanner>) => {
  await chooseFile(consoleLog);
  fireEvent.click(screen.getByRole('button', { name: 'Analyser ce journal' }));
  expect(scanner.requests).toHaveLength(1);
};

export const finish = (scanner: ReturnType<typeof fakeScanner>, records: readonly ErrorRecord[] = [errorRecord], result = scanResult) => {
  scanner.emit({ type: 'errors', records });
  scanner.emit({ type: 'done', result });
};
