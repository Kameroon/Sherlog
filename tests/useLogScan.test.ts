import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ErrorRecord, ScanResult } from '../src/core/scanLog';
import type { FormatDetection } from '../src/sources/detectFormat';
import { useLogScan } from '../src/ui/useLogScan';
import type { ScanMessage, ScanRequest, StartScan } from '../src/workers/scanProtocol';

const consoleLog = '[08:16:10 ERR] Failed\n[08:16:11 INF] Next\n';
const fileOf = (text: string, name = 'app.log'): File => new File([text], name);

const record: ErrorRecord = {
  offset: 0,
  length: 22,
  timestamp: '08:16:10',
  level: 'ERR',
  firstLine: '[08:16:10 ERR] Failed',
  firstLineCut: false,
  lineCount: 1,
  fingerprintId: 0,
};
const result: ScanResult = {
  bytes: 44,
  encoding: 'utf-8',
  entries: 2,
  errors: 1,
  truncatedEntries: 0,
  limitReached: false,
  fingerprints: ['ERR\nFailed\n'],
};

/** A fake worker: remembers the request and lets the test send messages and see the stop. */
function fakeScanner() {
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

async function chooseRecognised(scanner = fakeScanner()) {
  const hook = renderHook(() => useLogScan({ startScan: scanner.startScan }));
  await act(() => hook.result.current.chooseFile(fileOf(consoleLog)));
  return { ...hook, scanner };
}

describe('useLogScan', () => {
  it('should start idle', () => {
    // Act
    const { result: hook } = renderHook(() => useLogScan({ startScan: fakeScanner().startScan }));

    // Assert
    expect(hook.current.state).toEqual({ phase: 'idle' });
  });

  it('should recognise the format and wait for the user without starting any scan when a file is chosen', async () => {
    // Act
    const { result: hook, scanner } = await chooseRecognised();

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', name: 'app.log', detection: { status: 'detected', profile: { id: 'serilog-console' } } });
    expect(scanner.requests).toEqual([]);
  });

  it('should wait the same way when text is pasted', async () => {
    // Arrange
    const scanner = fakeScanner();
    const { result: hook } = renderHook(() => useLogScan({ startScan: scanner.startScan }));

    // Act
    await act(() => hook.current.chooseText(consoleLog));

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', name: 'Texte collé', detection: { status: 'detected' } });
    expect(scanner.requests).toEqual([]);
  });

  it('should keep the reason and refuse to analyse when the format is not recognised', async () => {
    // Arrange
    const scanner = fakeScanner();
    const { result: hook } = renderHook(() => useLogScan({ startScan: scanner.startScan }));
    await act(() => hook.current.chooseText('hello\nworld\n'));

    // Act
    act(() => {
      hook.current.analyse();
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', detection: { status: 'unrecognized' } });
    expect(scanner.requests).toEqual([]);
  });

  it('should start the scan of the chosen source with the recognised profile when the user analyses', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseRecognised();

    // Act
    act(() => {
      hook.current.analyse();
    });

    // Assert
    expect(scanner.requests).toHaveLength(1);
    expect(scanner.requests[0]).toMatchObject({ profileId: 'serilog-console' });
    expect(hook.current.state).toMatchObject({ phase: 'analysing', bytesRead: 0, records: [] });
  });

  it('should follow the progress and the errors found while the scan runs, then keep the result', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseRecognised();
    act(() => {
      hook.current.analyse();
    });

    // Act
    scanner.emit({ type: 'progress', bytesRead: 10 });
    scanner.emit({ type: 'errors', records: [record] });
    const during = hook.current.state;
    scanner.emit({ type: 'done', result });

    // Assert
    expect(during).toMatchObject({ phase: 'analysing', bytesRead: 10, records: [record] });
    expect(hook.current.state).toMatchObject({ phase: 'analysed', result, records: [record] });
    expect(scanner.stop).toHaveBeenCalledTimes(1);
  });

  it('should go back to the recognised file and stop the scan when the user cancels', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseRecognised();
    act(() => {
      hook.current.analyse();
    });

    // Act
    act(() => {
      hook.current.cancel();
    });
    scanner.emit({ type: 'done', result });

    // Assert
    expect(scanner.stop).toHaveBeenCalledTimes(1);
    expect(hook.current.state).toMatchObject({ phase: 'ready', name: 'app.log' });
  });

  it('should show the message and stop the worker when the scan fails', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseRecognised();
    act(() => {
      hook.current.analyse();
    });

    // Act
    scanner.emit({ type: 'failed', message: 'Lecture impossible : boom.' });

    // Assert
    expect(hook.current.state).toEqual({ phase: 'failed', message: 'Lecture impossible : boom.' });
    expect(scanner.stop).toHaveBeenCalledTimes(1);
  });

  it('should return to idle and stop a running scan when the user starts over', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseRecognised();
    act(() => {
      hook.current.analyse();
    });

    // Act
    act(() => {
      hook.current.reset();
    });

    // Assert
    expect(hook.current.state).toEqual({ phase: 'idle' });
    expect(scanner.stop).toHaveBeenCalledTimes(1);
  });

  it('should stop a running scan when the component goes away', async () => {
    // Arrange
    const { result: hook, scanner, unmount } = await chooseRecognised();
    act(() => {
      hook.current.analyse();
    });

    // Act
    unmount();

    // Assert
    expect(scanner.stop).toHaveBeenCalledTimes(1);
  });

  it('should show the reason when the chosen file cannot be read', async () => {
    // Arrange
    const detect = vi.fn<() => Promise<FormatDetection>>().mockRejectedValue(new DOMException('gone', 'NotFoundError'));
    const { result: hook } = renderHook(() => useLogScan({ startScan: fakeScanner().startScan, detect }));

    // Act
    await act(() => hook.current.chooseFile(fileOf(consoleLog)));

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'failed', message: expect.stringContaining('modifié, déplacé') as unknown });
  });

  it('should keep the last chosen file when an earlier detection finishes after it', async () => {
    // Arrange
    const resolvers: ((detection: FormatDetection) => void)[] = [];
    const detect = vi.fn<() => Promise<FormatDetection>>(() => new Promise((resolve) => resolvers.push(resolve)));
    const { result: hook } = renderHook(() => useLogScan({ startScan: fakeScanner().startScan, detect }));
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = hook.current.chooseFile(fileOf(consoleLog, 'old.log'));
      second = hook.current.chooseFile(fileOf(consoleLog, 'new.log'));
    });

    // Act
    await act(async () => {
      resolvers[1]?.({ status: 'unrecognized', reason: 'second' });
      await second;
      resolvers[0]?.({ status: 'unrecognized', reason: 'first' });
      await first;
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', name: 'new.log', detection: { reason: 'second' } });
  });

  it('should read the text of an error again from the source once the scan is done', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseRecognised();
    act(() => {
      hook.current.analyse();
    });
    scanner.emit({ type: 'errors', records: [record] });
    scanner.emit({ type: 'done', result });

    // Act
    const text = await hook.current.readText(record);

    // Assert
    expect(text).toBe('[08:16:10 ERR] Failed');
  });
});
