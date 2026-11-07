import { useState } from 'react';

interface SourcePickerProps {
  onFile: (file: File) => void;
  onText: (text: string) => void;
}

/**
 * The two ways to give Sherlog a log: a file, or text pasted from a terminal or Docker.
 * Choosing only reads the beginning to recognise the format: nothing is analysed or sent.
 */
export function SourcePicker({ onFile, onText }: SourcePickerProps) {
  const [text, setText] = useState('');

  return (
    <div className="source-picker">
      <label className="button-primary file-button">
        Choisir un fichier
        <input
          type="file"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              onFile(file);
            }
          }}
        />
      </label>
      <p className="hint">Le fichier est lu dans ce navigateur : il n’est ni envoyé, ni modifié.</p>

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
      <button
        type="button"
        className="button-secondary"
        disabled={text.trim() === ''}
        onClick={() => {
          onText(text);
        }}
      >
        Lire le texte collé
      </button>
    </div>
  );
}
