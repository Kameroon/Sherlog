import { useEffect, useId, useRef, useState } from 'react';
import { ALLOWED_STORAGE_HOSTS, DownloadError, MAX_DOWNLOAD_BYTES, checkSourceUrl, downloadLog } from '../sources/urlSource';
import { formatSize } from './format';
import { Tip } from './Tip';
import { downloadFailureMessage, refusalMessage } from './urlMessages';

/** What the URL source reaches for outside the page; replaced by the tests. */
export interface UrlDependencies {
  readonly fetchImpl: typeof fetch;
  /** The address of this site: the one the CORS rules of the storage have to allow. */
  readonly siteOrigin: string;
  readonly maxBytes: number;
}

interface UrlSourceProps extends Partial<UrlDependencies> {
  /** Gives the file that was downloaded: from there it is a file like any other (read, prepared, analysed on a click). */
  onFile: (file: File) => void;
}

type View =
  | { readonly status: 'idle' }
  | { readonly status: 'downloading'; readonly host: string; readonly name: string; readonly received: number; readonly total: number | null }
  | { readonly status: 'failed'; readonly message: string };

/**
 * Downloads a log from an allowed storage account, with a link that carries its own access token (a SAS). The link is
 * typed in a masked field, checked before anything is sent, and dropped from the screen as soon as the file is there:
 * only the host and the file name are shown, and the link is neither kept nor written anywhere. The file is held in
 * the memory of the page, within a limit of size, and nothing is read, analysed or sent before the user's next click.
 */
export function UrlSource({ onFile, fetchImpl = fetch, siteOrigin = window.location.origin, maxBytes = MAX_DOWNLOAD_BYTES }: UrlSourceProps) {
  const id = useId();
  const [address, setAddress] = useState('');
  const [view, setView] = useState<View>({ status: 'idle' });
  const controller = useRef<AbortController | null>(null);

  // Leaving the screen gives up a download that is still going.
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const download = async (): Promise<void> => {
    const checked = checkSourceUrl(address);
    if (!checked.ok) {
      setView({ status: 'failed', message: refusalMessage(checked.reason, ALLOWED_STORAGE_HOSTS) });
      return;
    }
    const current = new AbortController();
    controller.current = current;
    setView({ status: 'downloading', host: checked.host, name: checked.name, received: 0, total: null });
    let blob: Blob;
    try {
      blob = await downloadLog({
        url: checked.url,
        fetchImpl,
        signal: current.signal,
        maxBytes,
        onProgress: (received, total) => {
          setView({ status: 'downloading', host: checked.host, name: checked.name, received, total });
        },
      });
    } catch (error) {
      if (error instanceof DownloadError) {
        setView(error.kind === 'cancelled' ? { status: 'idle' } : { status: 'failed', message: downloadFailureMessage(error, { siteOrigin }) });
      } else {
        setView({ status: 'failed', message: 'Erreur inattendue pendant le téléchargement.' });
      }
      return;
    } finally {
      controller.current = null;
    }
    // The link has done its work: it leaves the screen and the memory of the page before the file goes on.
    setAddress('');
    setView({ status: 'idle' });
    onFile(new File([blob], checked.name, { lastModified: Date.now() }));
  };

  const busy = view.status === 'downloading';
  return (
    <div className="url-source">
      <div className="field">
        <label htmlFor={`${id}-url`}>Adresse du fichier, avec son jeton d’accès (lien SAS en lecture seule)</label>
        <input
          id={`${id}-url`}
          className="text-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={address}
          disabled={busy}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            setAddress(event.target.value);
            if (view.status === 'failed') {
              setView({ status: 'idle' });
            }
          }}
        />
      </div>
      <p className="hint" id={`${id}-help`}>
        Le fichier est téléchargé dans ce navigateur, directement depuis un compte de stockage autorisé ({ALLOWED_STORAGE_HOSTS.join(', ')}), jusqu’à {formatSize(maxBytes)}. Utilisez un
        jeton en lecture seule et de courte durée : il n’est ni affiché, ni gardé, ni envoyé ailleurs qu’à ce compte.
      </p>
      <div className="actions">
        <Tip text="Télécharge le fichier dans ce navigateur pour que vous puissiez le préparer. Il n’est ni analysé ni envoyé à l’IA à ce stade.">
          {(describedBy) => (
            <button type="button" className="button-secondary" aria-describedby={describedBy} disabled={busy || address.trim() === ''} onClick={() => void download()}>
              Télécharger et lire ce journal
            </button>
          )}
        </Tip>
        {busy && (
          <button
            type="button"
            className="button-link"
            onClick={() => {
              controller.current?.abort();
            }}
          >
            Annuler le téléchargement
          </button>
        )}
      </div>
      {view.status === 'downloading' && (
        <div className="url-progress">
          {/* Fixed text, announced once: the figures below change many times a second and stay out of the live region. */}
          <p role="status">
            Téléchargement de {view.name} depuis {view.host}…
          </p>
          <p>{view.total === null ? formatSize(view.received) : `${formatSize(view.received)} sur ${formatSize(view.total)}`}</p>
          <progress className="progress" aria-label="Progression du téléchargement" max={view.total ?? undefined} value={view.total === null ? undefined : view.received} />
        </div>
      )}
      {view.status === 'failed' && (
        <p className="notice notice-error" role="alert">
          {view.message}
        </p>
      )}
    </div>
  );
}
