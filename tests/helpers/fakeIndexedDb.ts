/**
 * The small part of IndexedDB that `folderStore` uses, in memory, with the same event shape: requests answer later
 * (never in the call that made them) through `onsuccess` and `onerror`. It stands in for the real one in unit tests;
 * the real one is exercised in Chrome by the end-to-end check.
 */
type Handler = (() => void) | null;

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;

  succeed(result: T): void {
    queueMicrotask(() => {
      this.result = result;
      this.onsuccess?.();
    });
  }

  fail(error: DOMException): void {
    queueMicrotask(() => {
      this.error = error;
      this.onerror?.();
    });
  }
}

class FakeTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: DOMException | null = null;

  constructor(private readonly data: Map<string, unknown>, private readonly failing: Set<string>) {}

  complete(): void {
    queueMicrotask(() => {
      if (this.failing.has('transaction')) {
        this.error = new DOMException('The transaction failed.', 'UnknownError');
        this.onerror?.();
        this.onabort?.();
        return;
      }
      this.oncomplete?.();
    });
  }

  objectStore(): unknown {
    const request = <T,>(run: () => T): FakeRequest<T> => {
      const fake = new FakeRequest<T>();
      if (this.failing.has('request')) {
        fake.fail(new DOMException('The request failed.', 'UnknownError'));
      } else {
        fake.succeed(run());
      }
      this.complete();
      return fake;
    };
    return {
      get: (key: string) => request(() => this.data.get(key)),
      put: (value: unknown, key: string) =>
        request(() => {
          this.data.set(key, value);
          return key;
        }),
      delete: (key: string) =>
        request(() => {
          this.data.delete(key);
        }),
    };
  }
}

export interface FakeIndexedDb {
  readonly factory: IDBFactory;
  /** What is stored, by key, to see what was written. */
  readonly data: Map<string, unknown>;
  /** What fails: `open`, `request` or `transaction`. */
  readonly failing: Set<string>;
}

export function fakeIndexedDb(): FakeIndexedDb {
  const data = new Map<string, unknown>();
  const failing = new Set<string>();
  const factory = {
    open(): unknown {
      const request = new FakeRequest<unknown>();
      if (failing.has('open')) {
        request.fail(new DOMException('The database could not be opened.', 'UnknownError'));
        return request;
      }
      const database = {
        createObjectStore: () => undefined,
        transaction: () => new FakeTransaction(data, failing),
        close: () => undefined,
      };
      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, data, failing };
}
