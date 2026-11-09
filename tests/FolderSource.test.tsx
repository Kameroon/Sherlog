import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StorageScope } from '../src/auth/storageScope';
import { MAX_FOLDER_FILES } from '../src/sources/folder';
import type { DirectoryPicker, FolderEntry, FolderHandle } from '../src/sources/folder';
import type { FolderStore } from '../src/store/folderStore';
import { FolderSource } from '../src/ui/FolderSource';

const scope: StorageScope = { name: 'github/1', identified: true };

interface Spec {
  name: string;
  size?: number;
  modified?: number;
  kind?: 'file' | 'directory';
  broken?: boolean;
}

function handleOf(name: string, specs: readonly Spec[], extras: Partial<FolderHandle> = {}): FolderHandle {
  return {
    kind: 'directory',
    name,
    values: async function* () {
      for (const spec of specs) {
        await Promise.resolve();
        const entry: FolderEntry =
          spec.kind === 'directory'
            ? { kind: 'directory', name: spec.name }
            : {
                kind: 'file',
                name: spec.name,
                getFile: () => (spec.broken === true ? Promise.reject(new DOMException('gone', 'NotFoundError')) : Promise.resolve(new File(['x'.repeat(spec.size ?? 1)], spec.name, { lastModified: spec.modified ?? 0 }))),
              };
        yield entry;
      }
    },
    ...extras,
  };
}

/** A store in memory that remembers what it is asked, and can fail. */
function memoryStore(initial: Record<string, FolderHandle> = {}, failures: { load?: string; save?: string; forget?: string } = {}) {
  const kept = new Map<string, FolderHandle>(Object.entries(initial));
  const calls: string[] = [];
  const store: FolderStore = {
    load: (key) => {
      calls.push(`load ${key}`);
      return Promise.resolve({ handle: kept.get(key) ?? null, warning: failures.load ?? null });
    },
    save: (key, handle) => {
      calls.push(`save ${key}`);
      if (failures.save === undefined) {
        kept.set(key, handle);
      }
      return Promise.resolve(failures.save ?? null);
    },
    forget: (key) => {
      calls.push(`forget ${key}`);
      if (failures.forget === undefined) {
        kept.delete(key);
      }
      return Promise.resolve(failures.forget ?? null);
    },
  };
  return { store, kept, calls };
}

interface Options {
  picker?: DirectoryPicker | null;
  chooses?: FolderHandle | null;
  scope?: StorageScope | null;
  store?: ReturnType<typeof memoryStore>;
}

function show(options: Options = {}) {
  const asked: unknown[] = [];
  const picker: DirectoryPicker | null =
    options.picker === undefined
      ? (asking) => {
          asked.push(asking);
          return options.chooses === null || options.chooses === undefined ? Promise.reject(new DOMException('The user aborted a request.', 'AbortError')) : Promise.resolve(options.chooses);
        }
      : options.picker;
  const memory = options.store ?? memoryStore();
  const chosen: File[] = [];
  render(<FolderSource scope={options.scope === undefined ? scope : options.scope} picker={picker} store={memory.store} onFile={(file) => chosen.push(file)} />);
  return { asked, chosen, memory };
}

const choose = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Choisir un dossier' }));
};
const filesList = () => screen.getByRole('list', { name: 'Fichiers du dossier' });
const names = () => within(filesList()).getAllByRole('listitem').map((item) => item.querySelector('.folder-file-name')?.textContent);

describe('FolderSource availability', () => {
  it('should not offer the folder in a browser that cannot choose one, and say so', () => {
    // Act
    show({ picker: null });

    // Assert
    expect(screen.queryByRole('button', { name: 'Choisir un dossier' })).not.toBeInTheDocument();
    expect(screen.getByText(/Chrome ou Edge/)).toBeInTheDocument();
  });

  it('should offer to choose a folder, and say that it is read here and never changed', () => {
    // Act
    show({ chooses: handleOf('logs', []) });

    // Assert
    expect(screen.getByRole('button', { name: 'Choisir un dossier' })).toBeInTheDocument();
    expect(screen.getByText(/lu dans ce navigateur/)).toBeInTheDocument();
  });
});

describe('FolderSource choosing a folder', () => {
  it('should ask the browser for the folder to read only, on the click, and list its files, the newest first, with their sizes', async () => {
    // Arrange
    const { asked } = show({ chooses: handleOf('logs', [{ name: 'old.log', size: 2048, modified: 1000 }, { name: 'new.log', size: 4096, modified: 9000 }]) });
    expect(asked).toHaveLength(0);

    // Act
    choose();

    // Assert
    expect(await screen.findByRole('list', { name: 'Fichiers du dossier' })).toBeInTheDocument();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ mode: 'read' });
    expect(names()).toEqual(['new.log', 'old.log']);
    expect(within(filesList()).getByText(/^4 Kio/)).toBeInTheDocument();
    expect(screen.getByText(/Dossier « logs »/)).toBeInTheDocument();
  });

  it('should say that one level is read: the sub-folders are not entered', async () => {
    // Arrange
    show({ chooses: handleOf('logs', [{ name: 'archive', kind: 'directory' }, { name: 'a.log' }]) });

    // Act
    choose();

    // Assert
    await screen.findByRole('list', { name: 'Fichiers du dossier' });
    expect(names()).toEqual(['a.log']);
    expect(screen.getByText(/Un seul niveau est lu/)).toBeInTheDocument();
  });

  it('should do nothing, and show no error, when the user closes the dialog', async () => {
    // Arrange
    show({ chooses: null });

    // Act
    choose();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choisir un dossier' })).toBeEnabled();
    });

    // Assert
    expect(screen.queryByRole('list', { name: 'Fichiers du dossier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should give the file to read when the user chooses it, and read nothing before', async () => {
    // Arrange
    const { chosen } = show({ chooses: handleOf('logs', [{ name: 'a.log' }, { name: 'b.log' }]) });
    choose();
    await screen.findByRole('list', { name: 'Fichiers du dossier' });
    expect(chosen).toHaveLength(0);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Lire b.log' }));

    // Assert
    expect(chosen.map((file) => file.name)).toEqual(['b.log']);
  });

  it('should show a file name as text: markup in a name is never interpreted', async () => {
    // Arrange
    const name = '<img src=x onerror=alert(1)>.log';
    show({ chooses: handleOf('logs', [{ name }]) });

    // Act
    choose();

    // Assert
    await screen.findByRole('list', { name: 'Fichiers du dossier' });
    expect(within(filesList()).getByText(name)).toBeInTheDocument();
    expect(filesList().querySelector('img')).toBeNull();
  });

  it('should say when the folder has no file', async () => {
    // Arrange
    show({ chooses: handleOf('empty', [{ name: 'archive', kind: 'directory' }]) });

    // Act
    choose();

    // Assert
    expect(await screen.findByText(/Aucun fichier dans ce dossier/)).toBeInTheDocument();
  });

  // A thousand rows rendered in jsdom take seconds on a busy machine; the cost in a real browser is measured by the e2e check.
  it('should say when the folder has more files than are listed, rather than list them silently cut', { timeout: 30_000 }, async () => {
    // Arrange
    show({ chooses: handleOf('big', Array.from({ length: MAX_FOLDER_FILES + 1 }, (_, index) => ({ name: `f${index}.log`, modified: index }))) });

    // Act
    choose();

    // Assert
    expect(await screen.findByText(/plus de 1\s000 fichiers/)).toBeInTheDocument();
    expect(within(filesList()).getAllByRole('listitem')).toHaveLength(MAX_FOLDER_FILES);
  });

  it('should say how many files could not be read, rather than hide them', async () => {
    // Arrange
    show({ chooses: handleOf('logs', [{ name: 'gone.log', broken: true }, { name: 'a.log' }]) });

    // Act
    choose();

    // Assert
    expect(await screen.findByText(/1 fichier n’a pas pu être lu/)).toBeInTheDocument();
  });

  it('should say why a folder could not be read, without its path', async () => {
    // Arrange
    const refusing: FolderHandle = {
      kind: 'directory',
      name: 'secret-project',
      // eslint-disable-next-line require-yield
      values: async function* () {
        await Promise.resolve();
        throw new DOMException('denied', 'NotAllowedError');
      },
    };
    show({ chooses: refusing });

    // Act
    choose();

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/n’a pas autorisé la lecture/);
  });

  it('should refresh the list on request', async () => {
    // Arrange
    const specs: Spec[] = [{ name: 'a.log' }];
    show({ chooses: handleOf('logs', specs) });
    choose();
    await screen.findByRole('list', { name: 'Fichiers du dossier' });
    specs.push({ name: 'b.log', modified: 5 });

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser la liste' }));

    // Assert
    await waitFor(() => {
      expect(names()).toEqual(['b.log', 'a.log']);
    });
  });
});

describe('FolderSource keeping the folder', () => {
  it('should keep the folder chosen, for this identity, and say so', async () => {
    // Arrange
    const handle = handleOf('logs', [{ name: 'a.log' }]);
    const { memory } = show({ chooses: handle });

    // Act
    choose();

    // Assert
    await screen.findByRole('list', { name: 'Fichiers du dossier' });
    await waitFor(() => {
      expect(memory.kept.get('github/1')).toBe(handle);
    });
    expect(screen.getByText(/Dossier retenu/)).toBeInTheDocument();
  });

  it('should not keep it when the user cannot be told from another, and say so', async () => {
    // Arrange
    const { memory } = show({ chooses: handleOf('logs', [{ name: 'a.log' }]), scope: { name: 'sans-identite', identified: false } });

    // Act
    choose();

    // Assert
    await screen.findByRole('list', { name: 'Fichiers du dossier' });
    expect(memory.calls).toEqual([]);
    expect(screen.getByText(/identité n’a pas pu être lue/)).toBeInTheDocument();
  });

  it('should wait for the identity before looking for a kept folder, and keep nothing meanwhile', async () => {
    // Arrange
    const { memory } = show({ chooses: handleOf('logs', [{ name: 'a.log' }]), scope: null });

    // Act
    choose();

    // Assert
    await screen.findByRole('list', { name: 'Fichiers du dossier' });
    expect(memory.calls).toEqual([]);
  });

  it('should say so when the folder could not be kept, and still list it', async () => {
    // Arrange
    show({ chooses: handleOf('logs', [{ name: 'a.log' }]), store: memoryStore({}, { save: 'Le dossier n’a pas pu être retenu : refusé.' }) });

    // Act
    choose();

    // Assert
    expect(await screen.findByText('Le dossier n’a pas pu être retenu : refusé.')).toBeInTheDocument();
    expect(names()).toEqual(['a.log']);
  });

  it('should offer the folder kept before, without reading it, and without asking the browser', async () => {
    // Arrange
    const { asked } = show({ store: memoryStore({ 'github/1': handleOf('logs', [{ name: 'a.log' }]) }) });

    // Assert
    expect(await screen.findByText(/Dossier retenu : logs/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Relire ce dossier' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Fichiers du dossier' })).not.toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });

  it('should list the kept folder in one click when it is still allowed', async () => {
    // Arrange
    show({ store: memoryStore({ 'github/1': handleOf('logs', [{ name: 'a.log' }], { queryPermission: () => Promise.resolve('granted') }) }) });
    await screen.findByText(/Dossier retenu : logs/);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Relire ce dossier' }));

    // Assert
    expect(await screen.findByRole('list', { name: 'Fichiers du dossier' })).toBeInTheDocument();
    expect(names()).toEqual(['a.log']);
  });

  it('should ask the user to allow the kept folder again, on the click, and list it once they do', async () => {
    // Arrange
    const asks: string[] = [];
    const handle = handleOf('logs', [{ name: 'a.log' }], {
      queryPermission: () => Promise.resolve('prompt'),
      requestPermission: () => {
        asks.push('request');
        return Promise.resolve('granted');
      },
    });
    show({ store: memoryStore({ 'github/1': handle }) });
    await screen.findByText(/Dossier retenu : logs/);
    expect(asks).toEqual([]);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Relire ce dossier' }));

    // Assert
    await screen.findByRole('list', { name: 'Fichiers du dossier' });
    expect(asks).toEqual(['request']);
  });

  it('should say the folder is not allowed when the user refuses, and offer to choose it again', async () => {
    // Arrange
    show({ store: memoryStore({ 'github/1': handleOf('logs', [], { queryPermission: () => Promise.resolve('prompt'), requestPermission: () => Promise.resolve('denied') }) }) });
    await screen.findByText(/Dossier retenu : logs/);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Relire ce dossier' }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/n’a pas autorisé la lecture/);
    expect(screen.getByRole('button', { name: 'Choisir un dossier' })).toBeInTheDocument();
  });

  it('should forget the kept folder on request, and offer to choose one again', async () => {
    // Arrange
    const { memory } = show({ store: memoryStore({ 'github/1': handleOf('logs', [{ name: 'a.log' }]) }) });
    await screen.findByText(/Dossier retenu : logs/);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Oublier ce dossier' }));

    // Assert
    await waitFor(() => {
      expect(screen.queryByText(/Dossier retenu : logs/)).not.toBeInTheDocument();
    });
    expect(memory.kept.size).toBe(0);
    expect(screen.getByRole('button', { name: 'Choisir un dossier' })).toBeInTheDocument();
  });

  it('should say so when forgetting fails, and when the kept folder cannot be read', async () => {
    // Arrange
    show({ store: memoryStore({ 'github/1': handleOf('logs', []) }, { forget: 'Un dossier peut rester retenu dans le stockage du navigateur : il n’a pas pu être oublié.' }) });
    await screen.findByText(/Dossier retenu : logs/);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Oublier ce dossier' }));

    // Assert
    expect(await screen.findByText(/peut rester retenu/)).toBeInTheDocument();
  });

  it('should say so when the kept folder cannot be looked for', async () => {
    // Arrange
    show({ store: memoryStore({}, { load: 'Le dossier retenu n’a pas pu être lu : le navigateur refuse l’accès à son stockage.' }) });

    // Assert
    expect(await screen.findByText(/n’a pas pu être lu : le navigateur refuse/)).toBeInTheDocument();
  });
});
