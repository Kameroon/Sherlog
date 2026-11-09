// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_FOLDER_FILES, directoryPickerOf, listFolder, pickFolder, readPermission } from '../src/sources/folder';
import type { FolderEntry, FolderHandle } from '../src/sources/folder';

interface Spec {
  name: string;
  kind?: 'file' | 'directory';
  size?: number;
  modified?: number;
  /** `true` when reading the file fails, as for a file removed since the listing began. */
  broken?: boolean;
}

function entryOf(spec: Spec): FolderEntry {
  if (spec.kind === 'directory') {
    // Given a way to be read, so that only its kind keeps it out of the list.
    return { kind: 'directory', name: spec.name, getFile: () => Promise.resolve(new File(['x'], spec.name)) };
  }
  return {
    kind: 'file',
    name: spec.name,
    getFile: () =>
      spec.broken === true
        ? Promise.reject(new DOMException('gone', 'NotFoundError'))
        : Promise.resolve(new File(['x'.repeat(spec.size ?? 1)], spec.name, { lastModified: spec.modified ?? 0 })),
  };
}

function folder(name: string, specs: readonly Spec[], extras: Partial<FolderHandle> = {}): FolderHandle {
  return {
    kind: 'directory',
    name,
    values: async function* () {
      for (const spec of specs) {
        await Promise.resolve();
        yield entryOf(spec);
      }
    },
    ...extras,
  };
}

describe('listFolder', () => {
  it('should list the files with their name, size and date, the most recent first', async () => {
    // Arrange
    const handle = folder('logs', [
      { name: 'old.log', size: 10, modified: 1000 },
      { name: 'new.log', size: 30, modified: 3000 },
      { name: 'middle.log', size: 20, modified: 2000 },
    ]);

    // Act
    const listing = await listFolder(handle);

    // Assert
    expect(listing.folderName).toBe('logs');
    expect(listing.files.map((file) => [file.name, file.size, file.modified])).toEqual([
      ['new.log', 30, 3000],
      ['middle.log', 20, 2000],
      ['old.log', 10, 1000],
    ]);
    expect(listing).toMatchObject({ moreThanListed: false, unreadable: 0 });
  });

  it('should keep the file itself, to be read later by the pipeline of files', async () => {
    // Act
    const listing = await listFolder(folder('logs', [{ name: 'a.log', size: 5 }]));

    // Assert
    expect(listing.files[0]?.file).toBeInstanceOf(File);
    expect(listing.files[0]?.file.name).toBe('a.log');
  });

  it('should list one level only: a sub-folder is not listed, and nothing in it', async () => {
    // Act
    const listing = await listFolder(folder('logs', [{ name: 'archive', kind: 'directory' }, { name: 'a.log' }]));

    // Assert
    expect(listing.files.map((file) => file.name)).toEqual(['a.log']);
  });

  it('should count a file that cannot be read rather than hide it, and list the others', async () => {
    // Act
    const listing = await listFolder(folder('logs', [{ name: 'gone.log', broken: true }, { name: 'a.log' }, { name: 'also-gone.log', broken: true }]));

    // Assert
    expect(listing.files.map((file) => file.name)).toEqual(['a.log']);
    expect(listing.unreadable).toBe(2);
  });

  it('should list a folder of exactly the limit, with nothing left out', async () => {
    // Arrange
    const specs = Array.from({ length: MAX_FOLDER_FILES }, (_, index) => ({ name: `f${index}.log`, modified: index }));

    // Act
    const listing = await listFolder(folder('logs', specs));

    // Assert
    expect(listing.files).toHaveLength(MAX_FOLDER_FILES);
    expect(listing.moreThanListed).toBe(false);
  });

  it('should stop at the limit and say there are more, rather than list a folder without end', async () => {
    // Arrange
    const specs = Array.from({ length: MAX_FOLDER_FILES + 1 }, (_, index) => ({ name: `f${index}.log`, modified: index }));

    // Act
    const listing = await listFolder(folder('logs', specs));

    // Assert
    expect(listing.files).toHaveLength(MAX_FOLDER_FILES);
    expect(listing.moreThanListed).toBe(true);
  });

  it('should not read the files that come after the limit', async () => {
    // Arrange
    let reads = 0;
    const handle: FolderHandle = {
      kind: 'directory',
      name: 'logs',
      values: async function* () {
        for (let index = 0; index < MAX_FOLDER_FILES * 3; index += 1) {
          await Promise.resolve();
          yield {
            kind: 'file',
            name: `f${index}.log`,
            getFile: () => {
              reads += 1;
              return Promise.resolve(new File(['x'], `f${index}.log`));
            },
          };
        }
      },
    };

    // Act
    await listFolder(handle);

    // Assert
    expect(reads).toBe(MAX_FOLDER_FILES);
  });

  it('should stop when the caller cancels', async () => {
    // Arrange
    const controller = new AbortController();
    controller.abort();

    // Act
    const listing = listFolder(folder('logs', [{ name: 'a.log' }]), controller.signal);

    // Assert
    await expect(listing).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('should pass on the error when the folder cannot be read', async () => {
    // Arrange
    const handle: FolderHandle = {
      kind: 'directory',
      name: 'logs',
      // eslint-disable-next-line require-yield
      values: async function* () {
        await Promise.resolve();
        throw new DOMException('denied', 'NotAllowedError');
      },
    };

    // Act & Assert
    await expect(listFolder(handle)).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});

describe('pickFolder', () => {
  it('should ask the browser for a folder in read mode only, never for writing', async () => {
    // Arrange
    const asked: unknown[] = [];
    const handle = folder('logs', []);

    // Act
    const picked = await pickFolder((options) => {
      asked.push(options);
      return Promise.resolve(handle);
    });

    // Assert
    expect(picked).toBe(handle);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ mode: 'read' });
    expect(JSON.stringify(asked[0])).not.toContain('readwrite');
  });

  it('should give nothing when the user closes the dialog', async () => {
    // Act
    const picked = await pickFolder(() => Promise.reject(new DOMException('The user aborted a request.', 'AbortError')));

    // Assert
    expect(picked).toBeNull();
  });

  it('should pass on any other failure', async () => {
    // Act & Assert
    await expect(pickFolder(() => Promise.reject(new DOMException('blocked', 'SecurityError')))).rejects.toMatchObject({ name: 'SecurityError' });
  });
});

describe('directoryPickerOf', () => {
  it('should give nothing in a browser without the picker', () => {
    // Act & Assert
    expect(directoryPickerOf({})).toBeNull();
  });

  it('should call the picker of the window as a method of the window: called apart it refuses, as in the browser', async () => {
    // Arrange
    const handle = folder('logs', []);
    const scope = {
      showDirectoryPicker(this: unknown): Promise<FolderHandle> {
        if (this !== scope) {
          throw new TypeError('Illegal invocation');
        }
        return Promise.resolve(handle);
      },
    };

    // Act
    const picker = directoryPickerOf(scope);

    // Assert
    expect(picker).not.toBeNull();
    await expect(picker?.({ mode: 'read', id: 'x' })).resolves.toBe(handle);
  });
});

describe('readPermission', () => {
  const withPermission = (query: PermissionState, request: PermissionState = 'granted') => {
    const calls: string[] = [];
    const handle = folder('logs', [], {
      queryPermission: () => {
        calls.push('query');
        return Promise.resolve(query);
      },
      requestPermission: () => {
        calls.push('request');
        return Promise.resolve(request);
      },
    });
    return { handle, calls };
  };

  it('should say the folder is readable when the permission is already granted, without asking again', async () => {
    // Arrange
    const { handle, calls } = withPermission('granted');

    // Act
    const state = await readPermission(handle, true);

    // Assert
    expect(state).toBe('granted');
    expect(calls).toEqual(['query']);
  });

  it('should only look, not ask, when it is not allowed to ask: asking needs a click', async () => {
    // Arrange
    const { handle, calls } = withPermission('prompt');

    // Act
    const state = await readPermission(handle, false);

    // Assert
    expect(state).toBe('prompt');
    expect(calls).toEqual(['query']);
  });

  it('should ask the user when it is allowed to and the permission is to be asked', async () => {
    // Arrange
    const { handle, calls } = withPermission('prompt', 'granted');

    // Act
    const state = await readPermission(handle, true);

    // Assert
    expect(state).toBe('granted');
    expect(calls).toEqual(['query', 'request']);
  });

  it('should say when the user refuses', async () => {
    // Act & Assert
    expect(await readPermission(withPermission('prompt', 'denied').handle, true)).toBe('denied');
  });

  it('should not ask again for a permission the user refused', async () => {
    // Arrange
    const { handle, calls } = withPermission('denied');

    // Act
    const state = await readPermission(handle, true);

    // Assert
    expect(state).toBe('denied');
    expect(calls).toEqual(['query']);
  });

  it('should take a handle that knows nothing of permissions as readable (the origin-private folder)', async () => {
    // Act & Assert
    expect(await readPermission(folder('logs', []), true)).toBe('granted');
  });
});
