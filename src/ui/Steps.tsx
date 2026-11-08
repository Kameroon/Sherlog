/** The step the user is on: 1 choose the log, 2 prepare it, 3 analyse it. */
export type StepNumber = 1 | 2 | 3;

const STEPS: readonly string[] = ['Choisir le journal', 'Préparer (facultatif)', 'Analyser'];

interface StepsProps {
  current: StepNumber;
}

/**
 * Where the user is on the way from a log to its errors. The last step, sending to an AI, is shown so that the whole
 * path is visible, but it is not available yet and says so (it needs the masking and a provider, steps 6 and 7).
 */
export function Steps({ current }: StepsProps) {
  return (
    <ol className="steps" aria-label="Étapes">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        return (
          <li key={label} className={done ? 'is-done' : undefined} aria-current={step === current ? 'step' : undefined}>
            {label}
            {done && <span className="visually-hidden"> (terminée)</span>}
          </li>
        );
      })}
      <li className="is-unavailable">
        Envoyer à l’IA <span className="steps-note">(pas encore disponible)</span>
      </li>
    </ol>
  );
}
