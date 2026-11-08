import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FormatDetection, HeadRead } from '../src/sources/readHead';
import type { StartScan } from '../src/workers/scanProtocol';
import { EMPTY_PREPARATION } from '../src/core/preparation';
import { BUILT_IN_PROFILES } from '../src/core/profiles';
import { useLogScan } from '../src/ui/useLogScan';
import { consoleLog, errorRecord as record, fakeScanner, scanResult as result } from './helpers/fakeScanner';

const fileOf = (text: string, name = 'app.log'): File => new File([text], name);
const headOf = (detection: FormatDetection): HeadRead => ({ detection, head: new Uint8Array(), complete: true });

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

  it('should show why the analysis could not start when the worker cannot be created', async () => {
    // Arrange
    const startScan: StartScan = () => {
      throw new DOMException('refused by the policy', 'SecurityError');
    };
    const { result: hook } = renderHook(() => useLogScan({ startScan }));
    await act(() => hook.current.chooseFile(fileOf(consoleLog)));

    // Act
    act(() => {
      hook.current.analyse();
    });

    // Assert
    expect(hook.current.state).toEqual({
      phase: 'failed',
      message: 'L’analyse n’a pas pu démarrer dans ce navigateur (SecurityError).',
    });
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
    const readHead = vi.fn<() => Promise<HeadRead>>().mockRejectedValue(new DOMException('gone', 'NotFoundError'));
    const { result: hook } = renderHook(() => useLogScan({ startScan: fakeScanner().startScan, readHead }));

    // Act
    await act(() => hook.current.chooseFile(fileOf(consoleLog)));

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'failed', message: expect.stringContaining('modifié, déplacé') as unknown });
  });

  it('should keep the last chosen file when an earlier detection finishes after it', async () => {
    // Arrange
    const resolvers: ((read: HeadRead) => void)[] = [];
    const readHead = vi.fn<() => Promise<HeadRead>>(() => new Promise((resolve) => resolvers.push(resolve)));
    const { result: hook } = renderHook(() => useLogScan({ startScan: fakeScanner().startScan, readHead }));
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = hook.current.chooseFile(fileOf(consoleLog, 'old.log'));
      second = hook.current.chooseFile(fileOf(consoleLog, 'new.log'));
    });

    // Act
    await act(async () => {
      resolvers[1]?.(headOf({ status: 'unrecognized', reason: 'second' }));
      await second;
      resolvers[0]?.(headOf({ status: 'unrecognized', reason: 'first' }));
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
    const entry = await hook.current.readText(record);

    // Assert
    expect(entry).toEqual({ text: '[08:16:10 ERR] Failed', cut: false });
  });
});

describe('useLogScan preparation', () => {
  const health = { ...EMPTY_PREPARATION, ignoreTexts: ['/health'] };

  it('should keep the beginning of the source and start with nothing left out when a file is chosen', async () => {
    // Act
    const { result: hook } = await chooseRecognised();

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', complete: true, preparation: EMPTY_PREPARATION });
    expect(hook.current.state.phase === 'ready' && new TextDecoder().decode(hook.current.state.head)).toBe(consoleLog);
  });

  it('should send the preparation to the scan when the user analyses', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseRecognised();
    act(() => {
      hook.current.changePreparation(health);
    });

    // Act
    act(() => {
      hook.current.analyse();
    });

    // Assert
    expect(scanner.requests[0]).toMatchObject({ profileId: 'serilog-console', preparation: health });
  });

  it('should keep the preparation when the user cancels the analysis', async () => {
    // Arrange
    const { result: hook } = await chooseRecognised();
    act(() => {
      hook.current.changePreparation(health);
    });
    act(() => {
      hook.current.analyse();
    });

    // Act
    act(() => {
      hook.current.cancel();
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', preparation: health });
  });

  it('should forget the result and ask for a new analysis when a setting changes after the analysis', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseRecognised();
    act(() => {
      hook.current.analyse();
    });
    scanner.emit({ type: 'errors', records: [record] });
    scanner.emit({ type: 'done', result });

    // Act
    act(() => {
      hook.current.changePreparation(health);
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', preparation: health, settingsChanged: true });
    expect(hook.current.state).not.toHaveProperty('result');
    expect(hook.current.state).not.toHaveProperty('records');
  });

  it('should not say the settings changed when nothing was analysed yet', async () => {
    // Arrange
    const { result: hook } = await chooseRecognised();

    // Act
    act(() => {
      hook.current.changePreparation(health);
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', settingsChanged: false });
  });

  it('should ignore a change of settings while the analysis runs', async () => {
    // Arrange
    const { result: hook } = await chooseRecognised();
    act(() => {
      hook.current.analyse();
    });

    // Act
    act(() => {
      hook.current.changePreparation(health);
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'analysing', preparation: EMPTY_PREPARATION });
  });

  it('should start again from nothing left out when another log is chosen', async () => {
    // Arrange
    const { result: hook } = await chooseRecognised();
    act(() => {
      hook.current.changePreparation(health);
    });

    // Act
    await act(() => hook.current.chooseFile(fileOf(consoleLog, 'other.log')));

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', name: 'other.log', preparation: EMPTY_PREPARATION });
  });
});

describe('useLogScan format', () => {
  const [file, consoleFormat] = BUILT_IN_PROFILES;
  if (file === undefined || consoleFormat === undefined) {
    throw new Error('the built-in profiles are missing');
  }

  async function chooseUnrecognised() {
    const scanner = fakeScanner();
    const hook = renderHook(() => useLogScan({ startScan: scanner.startScan }));
    await act(() => hook.result.current.chooseText('hello\nworld\n'));
    return { ...hook, scanner };
  }

  it('should start with the recognised format as the chosen one', async () => {
    // Act
    const { result: hook } = await chooseRecognised();

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', profile: { id: 'serilog-console' } });
  });

  it('should start without a format when the log was not recognised, and refuse to analyse', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseUnrecognised();

    // Act
    act(() => {
      hook.current.analyse();
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', profile: null });
    expect(scanner.requests).toEqual([]);
  });

  it('should analyse with the format the user chose when the log was not recognised', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseUnrecognised();
    act(() => {
      hook.current.changeProfile(consoleFormat);
    });

    // Act
    act(() => {
      hook.current.analyse();
    });

    // Assert
    expect(scanner.requests[0]).toMatchObject({ profileId: 'serilog-console' });
  });

  it('should analyse with another format than the recognised one when the user changes it', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseRecognised();
    act(() => {
      hook.current.changeProfile(file);
    });

    // Act
    act(() => {
      hook.current.analyse();
    });

    // Assert
    expect(scanner.requests[0]).toMatchObject({ profileId: 'serilog-file' });
  });

  it('should keep the rules and forget the period when the format changes, since a period only fits its own format', async () => {
    // Arrange
    const { result: hook } = await chooseRecognised();
    act(() => {
      hook.current.changePreparation({ ignoreTexts: ['/health'], period: { from: '09:00', to: '10:00' } });
    });

    // Act
    act(() => {
      hook.current.changeProfile(file);
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', preparation: { ignoreTexts: ['/health'], period: { from: '', to: '' } } });
  });

  it('should forget the result and ask for a new analysis when the format changes after the analysis', async () => {
    // Arrange
    const { result: hook, scanner } = await chooseRecognised();
    act(() => {
      hook.current.analyse();
    });
    scanner.emit({ type: 'done', result });

    // Act
    act(() => {
      hook.current.changeProfile(file);
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', profile: { id: 'serilog-file' }, settingsChanged: true });
    expect(hook.current.state).not.toHaveProperty('result');
  });

  it('should ignore a change of format while the analysis runs', async () => {
    // Arrange
    const { result: hook } = await chooseRecognised();
    act(() => {
      hook.current.analyse();
    });

    // Act
    act(() => {
      hook.current.changeProfile(file);
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'analysing', profile: { id: 'serilog-console' } });
  });

  it('should not offer a format for a log that looks like JSON', async () => {
    // Arrange
    const scanner = fakeScanner();
    const { result: hook } = renderHook(() => useLogScan({ startScan: scanner.startScan }));
    await act(() => hook.current.chooseText('{"@t":"2026-11-04T08:16:10Z"}\n'));

    // Act
    act(() => {
      hook.current.changeProfile(consoleFormat);
    });

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', profile: null, detection: { status: 'structured' } });
  });

  it('should start again from the recognised format when another log is chosen', async () => {
    // Arrange
    const { result: hook } = await chooseRecognised();
    act(() => {
      hook.current.changeProfile(file);
    });

    // Act
    await act(() => hook.current.chooseFile(fileOf(consoleLog, 'other.log')));

    // Assert
    expect(hook.current.state).toMatchObject({ phase: 'ready', name: 'other.log', profile: { id: 'serilog-console' } });
  });
});
