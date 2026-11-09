import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StorageScope } from '../src/auth/storageScope';
import type { FolderHandle } from '../src/sources/folder';
import type { FolderStore } from '../src/store/folderStore';
import { LogWorkspace } from '../src/ui/LogWorkspace';
import { consoleLog, fakeScanner } from './helpers/fakeScanner';

const scope: StorageScope = { name: 'github/1', identified: true };

const folderOf = (name: string, files: Record<string, string>): FolderHandle => ({
  kind: 'directory',
  name,
  values: async function* () {
    for (const [fileName, text] of Object.entries(files)) {
      await Promise.resolve();
      yield { kind: 'file', name: fileName, getFile: () => Promise.resolve(new File([text], fileName, { lastModified: 1 })) };
    }
  },
});

function setup(folder: FolderHandle) {
  const scanner = fakeScanner();
  const saved: string[] = [];
  const store: FolderStore = {
    load: () => Promise.resolve({ handle: null, warning: null }),
    save: (key) => {
      saved.push(key);
      return Promise.resolve(null);
    },
    forget: () => Promise.resolve(null),
  };
  render(<LogWorkspace dependencies={{ startScan: scanner.startScan }} storageScope={scope} folderDependencies={{ picker: () => Promise.resolve(folder), store }} />);
  return { scanner, saved };
}

describe('LogWorkspace folder source', () => {
  it('should go from a folder to the preparation of the file chosen in it, with nothing analysed', async () => {
    // Arrange
    const { scanner } = setup(folderOf('logs', { 'app.log': consoleLog }));

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Choisir un dossier' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Lire app.log' }));

    // Assert
    expect(await screen.findByRole('button', { name: 'Choisir un autre journal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'app.log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toBeInTheDocument();
    expect(scanner.requests).toHaveLength(0);
  });

  it('should keep the folder for the identity of the signed-in user', async () => {
    // Arrange
    const { saved } = setup(folderOf('logs', { 'app.log': consoleLog }));

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Choisir un dossier' }));
    await screen.findByRole('button', { name: 'Lire app.log' });

    // Assert
    expect(saved).toEqual(['github/1']);
  });

  it('should still offer the file and the pasted text next to the folder', () => {
    // Act
    setup(folderOf('logs', {}));

    // Assert
    expect(screen.getByLabelText('Choisir un fichier')).toBeInTheDocument();
    expect(screen.getByLabelText('Collez ici des logs que vous avez copiés')).toBeInTheDocument();
  });
});
