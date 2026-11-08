import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startScanWorker } from '../src/workers/startScanWorker';
import type { ScanMessage, ScanRequest } from '../src/workers/scanProtocol';

/** Stands in for the browser `Worker`, which jsdom does not have: records what the page does with it. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static postMessageError: Error | null = null;

  onmessage: ((event: MessageEvent<ScanMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: unknown[] = [];
  readonly terminate = vi.fn<() => void>();

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    if (FakeWorker.postMessageError !== null) {
      throw FakeWorker.postMessageError;
    }
    this.posted.push(message);
  }
}

const request: ScanRequest = {
  source: new Blob(['[08:16:10 ERR] Failed\n']),
  profileId: 'serilog-console',
  preparation: { ignoreTexts: [] },
};

function start() {
  const received: ScanMessage[] = [];
  const stop = startScanWorker(request, (message) => received.push(message));
  const worker = FakeWorker.instances[0];
  if (worker === undefined) {
    throw new Error('no worker was created');
  }
  return { received, stop, worker };
}

describe('startScanWorker', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.postMessageError = null;
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should load the worker as a module script of the same site and send it the request', () => {
    // Act
    const { worker } = start();

    // Assert
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.url.pathname).toMatch(/scan\.worker\.ts$/);
    expect(worker.posted).toEqual([request]);
  });

  it('should pass on what the worker answers', () => {
    // Arrange
    const { received, worker } = start();

    // Act
    worker.onmessage?.({ data: { type: 'progress', bytesRead: 7 } } as MessageEvent<ScanMessage>);

    // Assert
    expect(received).toEqual([{ type: 'progress', bytesRead: 7 }]);
  });

  it('should terminate the worker when stopped', () => {
    // Arrange
    const { stop, worker } = start();

    // Act
    stop();

    // Assert
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('should turn an error raised inside the worker into a message', () => {
    // Arrange
    const { received, worker } = start();

    // Act
    worker.onerror?.({ message: 'Uncaught RangeError: boom' } as ErrorEvent);

    // Assert
    expect(received).toEqual([{ type: 'failed', message: 'Lecture impossible : Uncaught RangeError: boom.' }]);
  });

  it('should say that the worker could not start when its error carries no message', () => {
    // Arrange: a missing or refused worker script raises an `error` event without a message.
    const { received, worker } = start();

    // Act
    worker.onerror?.({ message: '' } as ErrorEvent);

    // Assert
    expect(received).toEqual([
      { type: 'failed', message: 'Le traitement n’a pas pu démarrer (script introuvable ou refusé).' },
    ]);
  });

  it('should turn an unreadable answer into a message', () => {
    // Arrange
    const { received, worker } = start();

    // Act
    worker.onmessageerror?.();

    // Assert
    expect(received).toEqual([{ type: 'failed', message: 'Lecture impossible : réponse illisible du traitement.' }]);
  });

  it('should terminate the worker and report the error when the request cannot be sent', () => {
    // Arrange
    FakeWorker.postMessageError = new DOMException('not cloneable', 'DataCloneError');

    // Act
    const act = () => startScanWorker(request, () => undefined);

    // Assert
    expect(act).toThrow('not cloneable');
    expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledTimes(1);
  });
});
