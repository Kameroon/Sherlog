import { useId } from 'react';
import { NO_PERIOD } from '../core/preparation';
import type { Period, Preparation } from '../core/preparation';
import type { TimeRange } from '../core/previewHead';
import { FoldablePanel } from './FoldablePanel';
import { countOf } from './format';

interface PeriodToolProps {
  preparation: Preparation;
  onChange: (preparation: Preparation) => void;
  /** `true` for a format whose timestamps carry a date; otherwise they are times of day only. */
  withDate: boolean;
  /** Where the text starts and ends, to tell what can be chosen. */
  range: TimeRange | null;
  /** `true` when `range` and `ignoredByPeriod` only cover the beginning of the source. */
  forTheBeginning: boolean;
  ignoredByPeriod: number;
  /** Why the period cannot be used, or `null`. */
  problem: string | null;
}

/** Keeps the entries between two moments. The end minute is included, and the times are the ones written in the log. */
export function PeriodTool({ preparation, onChange, withDate, range, forTheBeginning, ignoredByPeriod, problem }: PeriodToolProps) {
  const id = useId();
  const { period } = preparation;
  const change = (next: Period): void => {
    onChange({ ...preparation, period: next });
  };

  return (
    <FoldablePanel id={id} title="Période">
      {withDate ? (
        <p className="period-help">
          Vous gardez les entrées comprises entre deux dates. Les heures sont comparées telles qu’elles sont écrites dans le journal : le décalage horaire (par exemple +01:00) n’est pas lu. La minute de fin est incluse.
        </p>
      ) : (
        <p className="period-help">
          Vous gardez les entrées comprises entre deux heures de la journée (la minute de fin est incluse). Laissez un champ vide pour ne pas limiter de ce côté.
        </p>
      )}
      {range !== null && (
        <p className="small-note">
          {forTheBeginning ? 'Le début du fichier va' : 'Le journal va'} de {range.first} à {range.last}.
        </p>
      )}
      {withDate ? (
        <div className="field-row">
          <label htmlFor={`${id}-from`}>Début (date et heure)</label>
          <input
            id={`${id}-from`}
            className="text-input"
            type="datetime-local"
            value={period.from}
            onChange={(event) => {
              change({ ...period, from: event.target.value });
            }}
          />
          <label htmlFor={`${id}-to`}>Fin (date et heure)</label>
          <input
            id={`${id}-to`}
            className="text-input"
            type="datetime-local"
            value={period.to}
            onChange={(event) => {
              change({ ...period, to: event.target.value });
            }}
          />
        </div>
      ) : (
        <div className="period-fields">
          <div className="field">
            <label htmlFor={`${id}-time-from`}>Heure de début</label>
            <input
              id={`${id}-time-from`}
              className="text-input time-input"
              type="time"
              value={period.from}
              onChange={(event) => {
                change({ ...period, from: event.target.value });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-time-to`}>Heure de fin</label>
            <input
              id={`${id}-time-to`}
              className="text-input time-input"
              type="time"
              value={period.to}
              onChange={(event) => {
                change({ ...period, to: event.target.value });
              }}
            />
          </div>
        </div>
      )}
      {(period.from !== '' || period.to !== '') && (
        <button
          type="button"
          className="button-link"
          onClick={() => {
            change(NO_PERIOD);
          }}
        >
          Effacer la période
        </button>
      )}
      {problem !== null && (
        <p className="notice notice-warning" role="status">
          <span>{problem}</span> La période n’est pas appliquée tant que ce n’est pas corrigé.
        </p>
      )}
      {problem === null && (period.from !== '' || period.to !== '') && (
        <p className="rule-count">
          {countOf(ignoredByPeriod, 'entrée écartée', 'entrées écartées')} par la période{forTheBeginning ? ' dans le début' : ''}
        </p>
      )}
    </FoldablePanel>
  );
}
