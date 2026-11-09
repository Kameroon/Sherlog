/** The step the user is on: 1 choose the log, 2 prepare it, 3 analyse it, 4 send it to an AI. */
export type StepNumber = 1 | 2 | 3 | 4;

const STEPS: readonly string[] = ['Choisir le journal', 'Préparer (facultatif)', 'Analyser', 'Envoyer à l’IA'];

const SENDING_STEP: StepNumber = 4;

interface StepsProps {
  current: StepNumber;
}

/**
 * Where the user is on the way from a log to its errors and to an explanation. The last step is shown from the start so
 * that the whole path is visible; it is reached once errors were found, where the provider is chosen. Its note says what
 * cannot be done there yet: the errors are not sent before the analysis step exists.
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
            {step === SENDING_STEP && (
              <>
                {' '}
                <span className="steps-note">{notReached ? '(pas encore disponible)' : '(l’envoi n’est pas encore disponible)'}</span>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
