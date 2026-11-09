import { useEffect, useMemo, useState } from 'react';
import type { StorageScope } from '../auth/storageScope';
import { MAX_FOLDER_FILES, directoryPickerOf, listFolder, pickFolder, readPermission } from '../sources/folder';
import type { DirectoryPicker, FolderHandle, FolderListing } from '../sources/folder';
import { createFolderStore } from '../store/folderStore';
import type { FolderStore } from '../store/folderStore';
import { countOf, formatCount, formatSize } from './format';

/** What the folder source reaches for outside the page; replaced by the tests. */
export interface FolderDependencies {
  /** The browser's folder picker, or `null` in a browser that has none. */
  readonly picker: DirectoryPicker | null;
  readonly store: FolderStore;
}

interface FolderSourceProps extends Partial<FolderDependencies> {
  /** Whose kept folder this is; `null` while the identity is being read. */
  scope: StorageScope | null;
  /** Gives the file the user chose: from there it is a file like any other (read, prepared, analysed on a click). */
  onFile: (file: File) => void;
}

type View =
  | { readonly status: 'idle' }
  | { readonly status: 'listing' }
  | { readonly status: 'listed'; readonly listing: FolderListing }
  | { readonly status: 'failed'; readonly message: string };

const NOT_ALLOWED = 'Le navigateur n’a pas autorisé la lecture de ce dossier : choisissez-le à nouveau.';

/** The sentence for a failure of the browser: only its name is shown, never a path or anything of the folder. */
const failureOf = (error: unknown): string => (error instanceof DOMException && error.name === 'NotAllowedError' ? NOT_ALLOWED : `Le dossier n’a pas pu être lu${error instanceof DOMException ? ` (${error.name})` : ''}.`);

/**
 * Reads the log from a folder of the user's computer (Chrome and Edge). The folder is asked for to read only; its files
 * are listed, one level deep, and the user chooses one: nothing is read before that, and nothing is analysed or sent.
 * The folder is kept, for this identity, to be listed again in one click (the browser asks to allow it again in each session).
 */
export function FolderSource({ scope, onFile, picker: givenPicker, store: givenStore }: FolderSourceProps) {
  const picker = useMemo(() => (givenPicker === undefined ? directoryPickerOf(window) : givenPicker), [givenPicker]);
  const store = useMemo(() => givenStore ?? createFolderStore(), [givenStore]);
  const [view, setView] = useState<View>({ status: 'idle' });
  const [current, setCurrent] = useState<FolderHandle | null>(null);
  const [remembered, setRemembered] = useState<FolderHandle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const identity = scope?.identified === true ? scope.name : null;

  // Looks for the folder kept from an earlier visit once the identity is known; the answer of a lookup that was replaced is dropped.
  useEffect(() => {
    if (identity === null) {
      return undefined;
    }
    let replaced = false;
    void store.load(identity).then(({ handle, warning }) => {
      if (!replaced) {
        setRemembered(handle);
        setNotice(warning);
      }
    });
    return () => {
      replaced = true;
    };
  }, [store, identity]);

  const list = async (handle: FolderHandle): Promise<void> => {
    setCurrent(handle);
    setView({ status: 'listing' });
    try {
      setView({ status: 'listed', listing: await listFolder(handle) });
    } catch (error) {
      setView({ status: 'failed', message: failureOf(error) });
    }
  };

  const choose = async (): Promise<void> => {
    if (picker === null) {
      return;
    }
    let handle: FolderHandle | null;
    try {
      handle = await pickFolder(picker);
    } catch (error) {
      setView({ status: 'failed', message: failureOf(error) });
      return;
    }
    if (handle === null) {
      return;
    }
    await list(handle);
    if (identity !== null) {
      const warning = await store.save(identity, handle);
      setNotice(warning);
      if (warning === null) {
        setRemembered(handle);
      }
    }
  };

  const listAgain = async (): Promise<void> => {
    if (remembered === null) {
      return;
    }
    try {
      // Asking the user again is allowed here: this runs from the click on "Relire ce dossier".
      if ((await readPermission(remembered, true)) !== 'granted') {
        setView({ status: 'failed', message: NOT_ALLOWED });
        return;
      }
    } catch (error) {
      setView({ status: 'failed', message: failureOf(error) });
      return;
    }
    await list(remembered);
  };

  const forget = async (): Promise<void> => {
    if (identity === null) {
      return;
    }
    setNotice(await store.forget(identity));
    setRemembered(null);
    setCurrent(null);
    setView({ status: 'idle' });
  };

  if (picker === null) {
    return <p className="hint">Le choix d’un dossier n’est pas disponible dans ce navigateur : il demande Chrome ou Edge. Choisissez un fichier.</p>;
  }

  const busy = view.status === 'listing';
  return (
    <div className="folder-source">
      <div className="actions">
        {remembered !== null && (
          <button type="button" className="button-primary" disabled={busy} onClick={() => void listAgain()}>
            Relire ce dossier
          </button>
        )}
        <button type="button" className={remembered === null ? 'button-primary' : 'button-secondary'} disabled={busy} onClick={() => void choose()}>
          Choisir un dossier
        </button>
      </div>
      <p className="hint">Le dossier est lu dans ce navigateur, en lecture seule : rien n’est envoyé, rien n’est modifié. Vous choisissez ensuite un fichier.</p>
      {remembered !== null && (
        <p className="small-note">
          Dossier retenu : {remembered.name}.{' '}
          <button type="button" className="button-link" disabled={busy} onClick={() => void forget()}>
            Oublier ce dossier
          </button>
        </p>
      )}
      {scope !== null && !scope.identified && <p className="small-note">Votre identité n’a pas pu être lue : le dossier n’est pas retenu pour la prochaine visite.</p>}
      {notice !== null && (
        <p className="notice notice-warning" role="status">
          {notice}
        </p>
      )}

      {view.status === 'listing' && (
        <p className="hint" role="status">
          Lecture de la liste des fichiers…
        </p>
      )}
      {view.status === 'failed' && (
        <p className="notice notice-error" role="alert">
          {view.message}
        </p>
      )}
      {view.status === 'listed' && (
        <section className="folder-listing" aria-label="Contenu du dossier">
          <p>
            <strong>Dossier « {view.listing.folderName} »</strong> : {countOf(view.listing.files.length, 'fichier', 'fichiers')}, du plus récent au plus ancien.{' '}
            {current !== null && (
              <button type="button" className="button-link" onClick={() => void list(current)}>
                Actualiser la liste
              </button>
            )}
          </p>
          <p className="small-note">Un seul niveau est lu : les sous-dossiers ne sont pas parcourus.</p>
          {view.listing.moreThanListed && (
            <p className="notice notice-warning">
              Ce dossier contient plus de {formatCount(MAX_FOLDER_FILES)} fichiers : seuls les {formatCount(MAX_FOLDER_FILES)} premiers, dans l’ordre du dossier, sont listés.
            </p>
          )}
          {view.listing.unreadable > 0 && (
            <p className="notice notice-warning">
              {countOf(view.listing.unreadable, 'fichier n’a pas pu être lu', 'fichiers n’ont pas pu être lus')} (supprimé ou verrouillé depuis le début de la liste).
            </p>
          )}
          {view.listing.files.length === 0 ? (
            <p>Aucun fichier dans ce dossier.</p>
          ) : (
            <ul className="folder-files" aria-label="Fichiers du dossier">
              {view.listing.files.map((file) => (
                <li key={file.name} className="folder-file">
                  <span className="folder-file-name">{file.name}</span>
                  <span className="folder-file-meta">
                    {formatSize(file.size)} · {new Date(file.modified).toLocaleString('fr-FR')}
                  </span>
                  <button
                    type="button"
                    className="button-secondary"
                    aria-label={`Lire ${file.name}`}
                    onClick={() => {
                      onFile(file.file);
                    }}
                  >
                    Lire
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
