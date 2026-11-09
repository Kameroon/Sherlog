import { useDeferredValue, useMemo, useState } from 'react';
import { NO_STATUSES, statusOf, withStatus } from '../core/errorStatus';
import type { ErrorStatus, StatusByFingerprint } from '../core/errorStatus';
import { DEFAULT_ERROR_VIEW, buildErrorView, distinctLevels } from '../core/errorView';
import type { ErrorViewOptions } from '../core/errorView';
import { summariseIdentical } from '../core/identicalErrors';
import type { ErrorRecord } from '../core/scanLog';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import { ErrorBoundary } from './ErrorBoundary';
import { ErrorDetail } from './ErrorDetail';
import { ErrorList } from './ErrorList';
import { ErrorToolbar } from './ErrorToolbar';

interface ErrorBrowserProps {
  records: readonly ErrorRecord[];
  readText: (position: EntryPosition) => Promise<EntryText>;
  readNeighbours: (position: EntryPosition) => Promise<NeighbourLines>;
  /** `true` when errors past the record limit were counted but not recorded. */
  limitReached: boolean;
}

/**
 * The errors of an analysis: the search, the filter and the sort above, the list on one side and the detail of the
 * selected one on the other. The selection is an error of the whole list (`selected` is its position in `records`,
 * which is also its number in the log), so it holds when the order changes or a search hides it. The statuses are
 * kept here, for this analysis only: a new analysis mounts the browser again, with every error new.
 */
export function ErrorBrowser({ records, readText, readNeighbours, limitReached }: ErrorBrowserProps) {
  const groups = useMemo(() => summariseIdentical(records), [records]);
  const levels = useMemo(() => distinctLevels(records), [records]);
  const [options, setOptions] = useState<ErrorViewOptions>(DEFAULT_ERROR_VIEW);
  // The text box answers at once; the list of a hundred thousand errors follows when the browser is free.
  const applied = useDeferredValue(options);
  const [statuses, setStatuses] = useState<StatusByFingerprint>(NO_STATUSES);
  const indices = useMemo(() => buildErrorView(records, groups, applied, statuses), [records, groups, applied, statuses]);
  const visible = useMemo(() => indices.flatMap((index) => records[index] ?? []), [indices, records]);
  const [selected, setSelected] = useState<number | null>(null);
  const record = selected === null ? null : (records[selected] ?? null);
  const selectedRow = useMemo(() => {
    const row = selected === null ? -1 : indices.indexOf(selected);
    return row === -1 ? null : row;
  }, [indices, selected]);

  return (
    <div className="error-browser">
      <ErrorToolbar options={options} onChange={setOptions} levels={levels} shown={visible.length} total={records.length} />
      <div className="results-layout">
        {visible.length === 0 ? (
          <p className="notice error-list-empty">Aucune erreur ne correspond à la recherche et aux filtres.</p>
        ) : (
          <ErrorList
            // A new search, filter or sort starts the list again at the top.
            key={`${applied.search.trim()}|${applied.level ?? ''}|${applied.status ?? ''}|${applied.sortKey}:${applied.direction}`}
            records={visible}
            groups={groups}
            statuses={statuses}
            selected={selectedRow}
            onSelect={(row) => {
              setSelected(indices[row] ?? null);
            }}
          />
        )}
        {/* Its own boundary: a detail that fails leaves the list in place, and another selection starts afresh. */}
        <ErrorBoundary key={record?.offset ?? 'none'} scope="panel">
          <ErrorDetail
            record={record}
            position={(selected ?? 0) + 1}
            readText={readText}
            readNeighbours={readNeighbours}
            identical={record === null ? undefined : groups.get(record.fingerprintId)}
            countIsMinimum={limitReached}
            status={record === null ? undefined : statusOf(statuses, record.fingerprintId)}
            onStatusChange={
              record === null
                ? undefined
                : (status: ErrorStatus) => {
                    setStatuses((previous) => withStatus(previous, record.fingerprintId, status));
                  }
            }
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
