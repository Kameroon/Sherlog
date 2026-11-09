import { useId } from 'react';
import { DEFAULT_ERROR_VIEW } from '../core/errorView';
import type { ErrorViewOptions, SortDirection, SortKey } from '../core/errorView';
import { countOf, formatCount } from './format';
import { STATUS_CHOICES } from './statusLabels';

/** The sorts offered, one entry per key and direction: a single list says everything, with no default direction to guess. */
const SORTS: readonly { key: SortKey; direction: SortDirection; label: string }[] = [
  { key: 'reading', direction: 'asc', label: 'Ordre de lecture du journal' },
  { key: 'reading', direction: 'desc', label: 'Ordre de lecture inversé (fin du journal d’abord)' },
  { key: 'time', direction: 'asc', label: 'Heure : la plus ancienne d’abord' },
  { key: 'time', direction: 'desc', label: 'Heure : la plus récente d’abord' },
  { key: 'severity', direction: 'desc', label: 'Gravité : la plus grave d’abord' },
  { key: 'severity', direction: 'asc', label: 'Gravité : la moins grave d’abord' },
  { key: 'count', direction: 'desc', label: 'Identiques : les plus nombreuses d’abord' },
  { key: 'count', direction: 'asc', label: 'Identiques : les moins nombreuses d’abord' },
];

const sortValue = (key: SortKey, direction: SortDirection): string => `${key}:${direction}`;

interface ErrorToolbarProps {
  /** What the controls show. */
  options: ErrorViewOptions;
  onChange: (options: ErrorViewOptions) => void;
  /** The levels to choose from; the filter is left out when there is only one. */
  levels: readonly string[];
  /** Errors in the list after the search and the filters. */
  shown: number;
  /** Errors recorded. */
  total: number;
}

/** Search, level filter and sort of the list of errors, and how many errors that leaves. */
export function ErrorToolbar({ options, onChange, levels, shown, total }: ErrorToolbarProps) {
  const id = useId();
  const isDefault = options.search === DEFAULT_ERROR_VIEW.search && options.level === DEFAULT_ERROR_VIEW.level && options.status === DEFAULT_ERROR_VIEW.status && options.sortKey === DEFAULT_ERROR_VIEW.sortKey && options.direction === DEFAULT_ERROR_VIEW.direction;

  return (
    <div className="error-toolbar">
      <div className="error-toolbar-controls">
        <div className="field">
          <label htmlFor={`${id}-search`}>Rechercher</label>
          <input
            id={`${id}-search`}
            className="text-input"
            type="search"
            aria-describedby={`${id}-search-note`}
            value={options.search}
            onChange={(event) => {
              onChange({ ...options, search: event.target.value });
            }}
          />
        </div>
        {levels.length > 1 && (
          <div className="field">
            <label htmlFor={`${id}-level`}>Niveau</label>
            <select
              id={`${id}-level`}
              className="select"
              value={options.level ?? ''}
              onChange={(event) => {
                onChange({ ...options, level: event.target.value === '' ? null : event.target.value });
              }}
            >
              <option value="">Tous</option>
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-status`}>Statut</label>
          <select
            id={`${id}-status`}
            className="select"
            value={options.status ?? ''}
            onChange={(event) => {
              onChange({ ...options, status: STATUS_CHOICES.find((choice) => choice.status === event.target.value)?.status ?? null });
            }}
          >
            <option value="">Tous</option>
            {STATUS_CHOICES.map((choice) => (
              <option key={choice.status} value={choice.status}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-sort`}>Trier par</label>
          <select
            id={`${id}-sort`}
            className="select"
            value={sortValue(options.sortKey, options.direction)}
            onChange={(event) => {
              const chosen = SORTS.find((sort) => sortValue(sort.key, sort.direction) === event.target.value);
              if (chosen !== undefined) {
                onChange({ ...options, sortKey: chosen.key, direction: chosen.direction });
              }
            }}
          >
            {SORTS.map((sort) => (
              <option key={sortValue(sort.key, sort.direction)} value={sortValue(sort.key, sort.direction)}>
                {sort.label}
              </option>
            ))}
          </select>
        </div>
        {/* Always in the page, so that a change of its text is announced; the summary above the list already gives the total. */}
        <p className="small-note error-toolbar-count" role="status">
          {shown === total ? '' : `${countOf(shown, 'erreur affichée', 'erreurs affichées')} sur ${formatCount(total)}`}
        </p>
        {!isDefault && (
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              onChange(DEFAULT_ERROR_VIEW);
            }}
          >
            Réinitialiser
          </button>
        )}
      </div>
      <p id={`${id}-search-note`} className="small-note">
        La recherche porte sur l’heure, le niveau et le début du message, tels qu’ils sont dans la liste, pas dans la pile.
        {options.sortKey === 'time' && ' Les heures sont comparées telles qu’elles sont écrites dans le journal ; les erreurs sans heure exploitable restent à la fin.'}
      </p>
    </div>
  );
}
