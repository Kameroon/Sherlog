import { useState } from 'react';
import type { StorageScope } from '../auth/storageScope';
import { FolderSource } from './FolderSource';
import type { FolderDependencies } from './FolderSource';
import { Tip } from './Tip';

interface SourcePickerProps {
  onFile: (file: File) => void;
  onText: (text: string) => void;
  /** Whose kept folder this is; `null` while the identity is being read. */
  scope?: StorageScope | null;
  /** Replaces the folder picker and its store; used by the tests. */
  folderDependencies?: Partial<FolderDependencies>;
}

/**
 * The ways to give Sherlog a log: a file, a folder (Chrome and Edge), or text pasted from a terminal or Docker.
 * Choosing only reads the beginning to recognise the format: nothing is analysed or sent.
 */
export function SourcePicker({ onFile, onText, scope = null, folderDependencies }: SourcePickerProps) {
  const [text, setText] = useState('');

  return (
    <div className="source-picker">
      <Tip text="Ouvre le sélecteur de fichiers. Le fichier est lu dans ce navigateur : il n’est ni envoyé, ni analysé, ni modifié.">
        {(describedBy) => (
          <label className="button-primary file-button">
            Choisir un fichier
            <input
              type="file"
              className="visually-hidden"
              aria-describedby={describedBy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) {
                  onFile(file);
                }
              }}
            />
          </label>
        )}
      </Tip>
      <p className="hint">Le fichier est lu dans ce navigateur : il n’est ni envoyé, ni modifié.</p>

      <p className="source-or">ou</p>

      <FolderSource scope={scope} onFile={onFile} {...folderDependencies} />

      <p className="source-or">ou</p>

      <div className="field">
        <label htmlFor="paste-input">Collez ici des logs que vous avez copiés</label>
        <textarea
          id="paste-input"
          className="text-area"
          rows={6}
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>
      <Tip text="Lit le texte du champ dans ce navigateur pour que vous puissiez le préparer. Il n’est ni envoyé ni analysé à ce stade.">
        {(describedBy) => (
          <button
            type="button"
            className="button-secondary"
            aria-describedby={describedBy}
            disabled={text.trim() === ''}
            onClick={() => {
              onText(text);
            }}
          >
            Lire le texte collé
          </button>
        )}
      </Tip>
    </div>
  );
}
