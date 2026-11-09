import { useId } from 'react';
import { REDACTION_RULES } from '../core/redact';
import type { RedactionRuleId } from '../core/redact';
import { countOf } from './format';

interface MaskToolProps {
  /** The rules that are on. */
  masking: ReadonlySet<RedactionRuleId>;
  onChange: (masking: ReadonlySet<RedactionRuleId>) => void;
  /** What each rule finds in the entries that are kept, whether or not it is on. */
  occurrences: Readonly<Record<RedactionRuleId, number>>;
  /** `true` when `occurrences` only cover the beginning of the source. */
  forTheBeginning: boolean;
  /** `true` while the preview shows the text as it is in the log. */
  showingOriginal: boolean;
  onShowOriginalChange: (showing: boolean) => void;
}

/**
 * Chooses what is hidden before anything is shown or sent: one box per rule, with what it would hide, and a way to
 * see the original text. Hiding is a best effort (the preview of what is sent is the real control, ADR-015) and the
 * rules that are on by default are applied to what is sent whatever is ticked here.
 */
export function MaskTool({ masking, onChange, occurrences, forTheBeginning, showingOriginal, onShowOriginalChange }: MaskToolProps) {
  const id = useId();
  const toggle = (ruleId: RedactionRuleId, on: boolean): void => {
    const next = new Set(masking);
    if (on) {
      next.add(ruleId);
    } else {
      next.delete(ruleId);
    }
    onChange(next);
  };

  return (
    <section className="panel mask-tool" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Masquer les données sensibles</h2>
      <p className="period-help">
        Les données cochées sont remplacées par une étiquette dans l’aperçu et dans ce qui sera envoyé. C’est un meilleur effort : l’aperçu de ce qui est envoyé fait foi.
      </p>
      <ul className="mask-rules" role="group" aria-label="Masquer les données sensibles">
        {REDACTION_RULES.map((rule) => {
          const found = occurrences[rule.id];
          return (
            <li key={rule.id} className="mask-rule">
              <label className="mask-rule-label">
                <input
                  type="checkbox"
                  checked={masking.has(rule.id)}
                  onChange={(event) => {
                    toggle(rule.id, event.target.checked);
                  }}
                />
                <span>
                  {rule.label} <span className="mask-placeholder">{rule.placeholder}</span>
                  {!rule.enabledByDefault && <span className="mask-option"> (option)</span>}
                </span>
              </label>
              <span className="rule-count">
                {found === 0 ? 'aucune trouvée' : countOf(found, 'trouvée', 'trouvées')}
                {found > 0 && forTheBeginning ? ' dans le début du fichier' : ''}
              </span>
              <span className="small-note">{rule.description}</span>
            </li>
          );
        })}
      </ul>
      {masking.size === 0 && (
        <p className="notice notice-warning">
          Aucun masquage choisi : le texte est montré tel qu’il est dans le journal. Les adresses e-mail, les jetons, clés et mots de passe, les adresses IP et les cartes seront tout de même masqués à l’envoi.
        </p>
      )}
      <button
        type="button"
        className="button-secondary"
        aria-pressed={showingOriginal}
        onClick={() => {
          onShowOriginalChange(!showingOriginal);
        }}
      >
        Afficher le texte d’origine
      </button>
      {showingOriginal && <p className="small-note">Le texte d’origine reste sur cet écran : il n’est ni envoyé ni gardé. Il disparaît quand vous quittez la préparation.</p>}
    </section>
  );
}
