/** The step the user is on: 1 choose the log, 2 prepare it, 3 analyse it, 4 send it to an AI. */
export type StepNumber = 1 | 2 | 3 | 4;

const STEPS: readonly string[] = ['Choisir le journal', 'Préparer (facultatif)', 'Analyser', 'Envoyer à l’IA'];

const SENDING_STEP: StepNumber = 4;

interface StepsProps {
  current: StepNumber;
}

/**
 * Where the user is on the way from a log to its errors and to an explanation. The last step is shown from the start so
 * that the whole path is visible, and says it cannot be reached yet; it is reached once the analysis has found errors,
 * which is where the provider is chosen and the errors are sent.
 */
export function Steps({ current }: StepsProps) {
  return (
    <ol className="steps" aria-label="Étapes">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const notReached = step === SENDING_STEP && current < SENDING_STEP;
        return (
          <li key={label} className={done ? 'is-done' : notReached ? 'is-unavailable' : undefined} aria-current={step === current ? 'step' : undefined}>
            {label}
            {done && <span className="visually-hidden"> (terminée)</span>}
            {notReached && (
              <>
                {' '}
                <span className="steps-note">(pas encore disponible)</span>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
