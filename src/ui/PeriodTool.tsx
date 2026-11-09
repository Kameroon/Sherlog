import { useId } from 'react';
import type { Period, Preparation } from '../core/preparation';
import type { TimeRange } from '../core/previewHead';
import { countOf } from './format';

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'));

interface TimeBoundProps {
  /** `HH:MM`, or empty for no bound. */
  value: string;
  onChange: (value: string) => void;
  hourLabel: string;
  minuteLabel: string;
}

/** An hour and minutes, as two lists: the minutes wait for an hour, so that a bound is never half set. */
function TimeBound({ value, onChange, hourLabel, minuteLabel }: TimeBoundProps) {
  const hour = value.slice(0, 2);
  const minute = value === '' ? '00' : value.slice(3, 5);
  return (
    <>
      <select
        className="select select-time"
        aria-label={hourLabel}
        value={hour}
        onChange={(event) => {
          onChange(event.target.value === '' ? '' : `${event.target.value}:${minute}`);
        }}
      >
        <option value="">--</option>
        {HOURS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="period-word" aria-hidden="true">
        h
      </span>
      <select
        className="select select-time"
        aria-label={minuteLabel}
        value={minute}
        disabled={hour === ''}
        onChange={(event) => {
          onChange(`${hour}:${event.target.value}`);
        }}
      >
        {MINUTES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </>
  );
}

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
    <section className="panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Période</h2>
      {withDate ? (
        <p className="period-help">
          Vous gardez les entrées comprises entre deux dates. Les heures sont comparées telles qu’elles sont écrites dans le journal : le décalage horaire (par exemple +01:00) n’est pas lu. La minute de fin est incluse.
        </p>
      ) : (
        <p className="period-help">
          Vous gardez les entrées comprises entre deux heures de la journée (la minute de fin est incluse). Laissez « -- » pour ne pas limiter.
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
        <div className="field-row">
          {/* Each bound stays whole when the card is narrow and the row wraps. */}
          <span className="period-bound">
            <span className="period-word">De</span>
            <TimeBound
              value={period.from}
              hourLabel="Heure de début"
              minuteLabel="Minutes de début"
              onChange={(from) => {
                change({ ...period, from });
              }}
            />
          </span>
          <span className="period-bound">
            <span className="period-word">à</span>
            <TimeBound
              value={period.to}
              hourLabel="Heure de fin"
              minuteLabel="Minutes de fin"
              onChange={(to) => {
                change({ ...period, to });
              }}
            />
          </span>
        </div>
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
    </section>
  );
}
