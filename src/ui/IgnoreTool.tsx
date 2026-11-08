import { useId, useState } from 'react';
import { addIgnoreText, removeIgnoreText } from '../core/preparation';
import type { Preparation } from '../core/preparation';
import { countOf } from './format';
import { Tip } from './Tip';

interface IgnoreToolProps {
  preparation: Preparation;
  onChange: (preparation: Preparation) => void;
  /** Entries each rule matches, in the order of the rules. */
  counts: readonly number[];
  /** `true` when the counts only cover the beginning of the source. */
  countsAreForTheBeginning: boolean;
}

/** Leaves out the entries that contain a text (for example the health calls), one rule at a time. */
export function IgnoreTool({ preparation, onChange, counts, countsAreForTheBeginning }: IgnoreToolProps) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [refusal, setRefusal] = useState('');

  function add(): void {
    const edit = addIgnoreText(preparation, text);
    if (!edit.ok) {
      setRefusal(edit.reason);
      return;
    }
    setRefusal('');
    setText('');
    onChange(edit.preparation);
  }

  return (
    <section className="panel" aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`}>Ignorer des entrées</h2>
      <p>
        Écartez ce qui n’a pas d’intérêt, par exemple les appels de santé (<code>/health</code>).
      </p>
      <form
        className="field-row"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label htmlFor={inputId}>Ignorer les entrées qui contiennent</label>
        <input
          id={inputId}
          className="text-input"
          type="text"
          placeholder="/health"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setRefusal('');
          }}
        />
        <Tip text="Écarte de l’analyse les entrées qui contiennent ce texte, majuscules ou non. Votre fichier n’est pas modifié.">
          {(describedBy) => (
            <button type="submit" className="button-secondary" aria-describedby={describedBy}>
              Ajouter la règle
            </button>
          )}
        </Tip>
      </form>
      {refusal !== '' && (
        <p className="small-note is-warning" role="status">
          {refusal}
        </p>
      )}
      {preparation.ignoreTexts.length > 0 && (
        <ul className="rules" aria-label="Règles pour ignorer">
          {preparation.ignoreTexts.map((rule, index) => (
            <li key={rule} className="rule">
              <span className="chip">« {rule} »</span>
              <span className="rule-count">
                {countOf(counts[index] ?? 0, 'entrée écartée', 'entrées écartées')}
                {countsAreForTheBeginning ? ' dans le début' : ''}
              </span>
              <Tip text="Retire cette règle : les entrées reviennent dans la liste. Votre fichier n’est pas modifié.">
                {(describedBy) => (
                  <button
                    type="button"
                    className="button-link"
                    aria-label={`Retirer la règle ${rule}`}
                    aria-describedby={describedBy}
                    onClick={() => {
                      onChange(removeIgnoreText(preparation, index));
                    }}
                  >
                    Retirer
                  </button>
                )}
              </Tip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
