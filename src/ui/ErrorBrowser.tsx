import { useDeferredValue, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { NO_STATUSES, statusOf, withStatus } from '../core/errorStatus';
import type { ErrorStatus, StatusByFingerprint } from '../core/errorStatus';
import { DEFAULT_ERROR_VIEW, buildErrorView, distinctLevels } from '../core/errorView';
import type { ErrorViewOptions } from '../core/errorView';
import { latestOccurrence, summariseIdentical } from '../core/identicalErrors';
import { DEFAULT_ENABLED_RULES } from '../core/redact';
import type { RedactionRuleId } from '../core/redact';
import type { ErrorRecord } from '../core/scanLog';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import { ErrorBoundary } from './ErrorBoundary';
import { ErrorDetail } from './ErrorDetail';
import { ErrorList } from './ErrorList';
import { ErrorToolbar } from './ErrorToolbar';
import { SendPanel } from './SendPanel';

interface ErrorBrowserProps {
  records: readonly ErrorRecord[];
  readText: (position: EntryPosition) => Promise<EntryText>;
  readNeighbours: (position: EntryPosition) => Promise<NeighbourLines>;
  /** `true` when errors past the record limit were counted but not recorded. */
  limitReached: boolean;
  /** Name of the log, which is part of what would be sent. */
  fileName?: string;
  /** The masking rules the user chose in the preparation. */
  masking?: ReadonlySet<RedactionRuleId>;
  /** `true` when the format has dates, so that the most recent occurrence of an error can be told from the times. */
  hasDate?: boolean;
  /** The provider's settings, shown in the sending panel. */
  sendSettings?: ReactNode;
}

/**
 * The errors of an analysis: the search, the filter and the sort above, the list on one side and the detail of the
 * selected one on the other. The selection is an error of the whole list (`selected` is its position in `records`,
 * which is also its number in the log), so it holds when the order changes or a search hides it. The statuses are
 * kept here, for this analysis only: a new analysis mounts the browser again, with every error new. So is the choice
 * of the errors to have explained, made by fingerprint: none is chosen by default, and nothing is sent from here.
 */
export function ErrorBrowser({ records, readText, readNeighbours, limitReached, fileName = 'journal', masking = DEFAULT_ENABLED_RULES, hasDate = true, sendSettings }: ErrorBrowserProps) {
  const groups = useMemo(() => summariseIdentical(records), [records]);
  const levels = useMemo(() => distinctLevels(records), [records]);
  const [options, setOptions] = useState<ErrorViewOptions>(DEFAULT_ERROR_VIEW);
  // The text box answers at once; the list of a hundred thousand errors follows when the browser is free.
  const applied = useDeferredValue(options);
  const [statuses, setStatuses] = useState<StatusByFingerprint>(NO_STATUSES);
  const [chosenForSending, setChosenForSending] = useState<ReadonlySet<number>>(new Set());
  const indices = useMemo(() => buildErrorView(records, groups, applied, statuses), [records, groups, applied, statuses]);
  const visible = useMemo(() => indices.flatMap((index) => records[index] ?? []), [indices, records]);
  const [selected, setSelected] = useState<number | null>(null);
  const record = selected === null ? null : (records[selected] ?? null);
  const latest = useMemo(() => (record === null ? null : latestOccurrence(records, record.fingerprintId, hasDate)), [records, record, hasDate]);
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
            chosenForSending={chosenForSending}
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
            sendChoice={
              record === null
                ? undefined
                : {
                    chosen: chosenForSending.has(record.fingerprintId),
                    hasDate,
                    latest: latest === null ? null : { number: latest.index + 1, time: records[latest.index]?.timestamp ?? null, byTime: latest.byTime },
                    onChange: (chosen: boolean) => {
                      setChosenForSending((previous) => {
                        const next = new Set(previous);
                        if (chosen) {
                          next.add(record.fingerprintId);
                        } else {
                          next.delete(record.fingerprintId);
                        }
                        return next;
                      });
                    },
                  }
            }
          />
        </ErrorBoundary>
      </div>
      <SendPanel
        records={records}
        groups={groups}
        chosen={chosenForSending}
        fileName={fileName}
        masking={masking}
        hasDate={hasDate}
        countIsMinimum={limitReached}
        readText={readText}
        readNeighbours={readNeighbours}
        onRemove={(fingerprintId) => {
          setChosenForSending((previous) => {
            const next = new Set(previous);
            next.delete(fingerprintId);
            return next;
          });
        }}
        onClear={() => {
          setChosenForSending(new Set());
        }}
      >
        {sendSettings}
      </SendPanel>
    </div>
  );
}
