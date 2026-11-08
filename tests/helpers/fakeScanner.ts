import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { ErrorRecord, ScanResult } from '../../src/core/scanLog';
import type { ScanMessage, ScanRequest, StartScan } from '../../src/workers/scanProtocol';

/** A two-entry console log whose first entry is an error; `errorRecord` and `scanResult` describe it. */
export const consoleLog = '[08:16:10 ERR] Failed\n[08:16:11 INF] Next\n';

export const errorRecord: ErrorRecord = {
  offset: 0,
  length: 22,
  timestamp: '08:16:10',
  level: 'ERR',
  message: 'Failed',
  messageCut: false,
  lineCount: 1,
  fingerprintId: 0,
};

export const scanResult: ScanResult = {
  bytes: 44,
  encoding: 'utf-8',
  entries: 2,
  ignored: 0,
  ignoredPerRule: [],
  ignoredByPeriod: 0,
  errors: 1,
  truncatedEntries: 0,
  limitReached: false,
  fingerprints: ['ERR\nFailed\n'],
};

/** A fake worker: remembers the requests and lets the test send messages and see the stop. */
export function fakeScanner() {
  const requests: ScanRequest[] = [];
  const stop = vi.fn<() => void>();
  let send: (message: ScanMessage) => void = () => undefined;
  const startScan: StartScan = (request, onMessage) => {
    requests.push(request);
    send = onMessage;
    return stop;
  };
  const emit = (message: ScanMessage): void => {
    act(() => send(message));
  };
  return { startScan, requests, stop, emit };
}
