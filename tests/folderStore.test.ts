// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { FolderHandle } from '../src/sources/folder';
import { createFolderStore } from '../src/store/folderStore';
import type { FolderStore } from '../src/store/folderStore';
import { fakeIndexedDb } from './helpers/fakeIndexedDb';
import type { FakeIndexedDb } from './helpers/fakeIndexedDb';

const SCOPE = 'github/1234';
const handleNamed = (name: string): FolderHandle => ({ kind: 'directory', name, values: async function* () {} });

let idb: FakeIndexedDb;
let store: FolderStore;

beforeEach(() => {
  idb = fakeIndexedDb();
  store = createFolderStore(() => idb.factory);
});

describe('folder store', () => {
  it('should have no folder at first', async () => {
    // Act & Assert
    expect(await store.load(SCOPE)).toEqual({ handle: null, warning: null });
  });

  it('should give back the folder that was kept', async () => {
    // Arrange
    const handle = handleNamed('logs');

    // Act
    const warning = await store.save(SCOPE, handle);

    // Assert
    expect(warning).toBeNull();
    expect(await store.load(SCOPE)).toEqual({ handle, warning: null });
  });

  it('should keep one folder for an identity: keeping another replaces it', async () => {
    // Arrange
    await store.save(SCOPE, handleNamed('first'));

    // Act
    await store.save(SCOPE, handleNamed('second'));

    // Assert
    expect((await store.load(SCOPE)).handle?.name).toBe('second');
    expect(idb.data.size).toBe(1);
  });

  it('should not give the folder of one identity to another, which may share the browser', async () => {
    // Arrange
    await store.save('github/1', handleNamed('logs'));

    // Act
    const other = await store.load('github/2');

    // Assert
    expect(other.handle).toBeNull();
  });

  it('should forget the folder of one identity and only that one', async () => {
    // Arrange
    await store.save('github/1', handleNamed('mine'));
    await store.save('github/2', handleNamed('yours'));

    // Act
    const warning = await store.forget('github/1');

    // Assert
    expect(warning).toBeNull();
    expect((await store.load('github/1')).handle).toBeNull();
    expect((await store.load('github/2')).handle?.name).toBe('yours');
  });

  it('should not take for a folder something that is not one, whatever was stored under the key', async () => {
    // Arrange
    await store.save(SCOPE, handleNamed('logs'));
    const [key] = [...idb.data.keys()];
    idb.data.set(key ?? '', { name: 'not a handle' });

    // Act
    const loaded = await store.load(SCOPE);

    // Assert
    expect(loaded.handle).toBeNull();
  });
});

describe('folder store that fails', () => {
  it.each(['open', 'request', 'transaction'])('should say so when reading fails at the %s, and give no folder', async (step) => {
    // Arrange
    idb.failing.add(step);

    // Act
    const loaded = await store.load(SCOPE);

    // Assert
    expect(loaded.handle).toBeNull();
    expect(loaded.warning).toMatch(/dossier retenu/);
  });

  it.each(['open', 'request', 'transaction'])('should say the folder was not kept when keeping fails at the %s', async (step) => {
    // Arrange
    idb.failing.add(step);

    // Act
    const warning = await store.save(SCOPE, handleNamed('logs'));

    // Assert
    expect(warning).toMatch(/n’a pas pu être retenu/);
  });

  it.each(['open', 'request', 'transaction'])('should say a folder may remain when forgetting fails at the %s', async (step) => {
    // Arrange
    idb.failing.add(step);

    // Act
    const warning = await store.forget(SCOPE);

    // Assert
    expect(warning).toMatch(/peut rester/);
  });

  it('should say so, without throwing, when the browser refuses even the access to its databases', async () => {
    // Arrange
    const blocked = createFolderStore(() => {
      throw new DOMException('Access is denied.', 'SecurityError');
    });

    // Act & Assert
    expect((await blocked.load(SCOPE)).warning).toMatch(/dossier retenu/);
    expect(await blocked.save(SCOPE, handleNamed('logs'))).toMatch(/n’a pas pu être retenu/);
    expect(await blocked.forget(SCOPE)).toMatch(/peut rester/);
  });

  it('should keep nothing of a folder in a message', async () => {
    // Arrange
    idb.failing.add('open');

    // Act
    const warning = await store.save(SCOPE, handleNamed('secret-project'));

    // Assert
    expect(warning).not.toContain('secret-project');
  });
});
