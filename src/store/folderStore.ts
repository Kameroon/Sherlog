import type { FolderHandle } from '../sources/folder';

/**
 * The folder the user kept, to read it again with one click (`SPEC.md` §4). It is kept in IndexedDB, the only place a
 * folder handle can live, one per identity: on a computer several invited people use, nobody sees another's folder
 * (as for the key, ADR-017). The handle gives no access by itself: the browser asks the user again in each session.
 */
export interface FolderStore {
  load(scope: string): Promise<{ readonly handle: FolderHandle | null; readonly warning: string | null }>;
  /** @returns why the folder was not kept, or `null`. */
  save(scope: string, handle: FolderHandle): Promise<string | null>;
  /** @returns why a folder may remain, or `null`. */
  forget(scope: string): Promise<string | null>;
}

const DATABASE = 'sherlog';
const STORE = 'folders';
const VERSION = 1;

const NOT_READ = 'Le dossier retenu n’a pas pu être lu : le navigateur refuse l’accès à son stockage.';
const NOT_KEPT = 'Le dossier n’a pas pu être retenu : le navigateur refuse de l’écrire dans son stockage.';
const MAY_REMAIN = 'Un dossier peut rester retenu dans le stockage du navigateur : il n’a pas pu être oublié.';

const keyOf = (scope: string): string => `folder:${scope}`;

/** What is read back is a folder only if it looks like one: a value of another kind under the key is not trusted. */
function isFolder(value: unknown): value is FolderHandle {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'directory' && typeof (value as { values?: unknown }).values === 'function';
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}

/**
 * @param factory - Gives the browser's `indexedDB` when it is used, not when this module loads: a browser that blocks
 * storage throws on the access itself.
 */
export function createFolderStore(factory: () => IDBFactory = () => indexedDB): FolderStore {
  /** Runs one operation on the store of folders, and closes the database whatever happens. */
  async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const open = factory().open(DATABASE, VERSION);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(STORE);
    };
    const database = await settled(open);
    try {
      const transaction = database.transaction(STORE, mode);
      // Both are awaited together: a failure of one must not leave the other's rejection without a listener.
      const [result] = await Promise.all([run(transaction.objectStore(STORE)), completed(transaction)]);
      return result;
    } finally {
      database.close();
    }
  }

  return {
    async load(scope) {
      try {
        const stored: unknown = await withStore('readonly', (store) => settled(store.get(keyOf(scope))));
        return { handle: isFolder(stored) ? stored : null, warning: null };
      } catch {
        return { handle: null, warning: NOT_READ };
      }
    },
    async save(scope, handle) {
      try {
        await withStore('readwrite', (store) => settled(store.put(handle, keyOf(scope))));
        return null;
      } catch {
        return NOT_KEPT;
      }
    },
    async forget(scope) {
      try {
        await withStore('readwrite', (store) => settled(store.delete(keyOf(scope))));
        return null;
      } catch {
        return MAY_REMAIN;
      }
    },
  };
}
