import { useMemo, useState } from 'react';
import { summariseIdentical } from '../core/identicalErrors';
import type { ErrorRecord } from '../core/scanLog';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import { ErrorBoundary } from './ErrorBoundary';
import { ErrorDetail } from './ErrorDetail';
import { ErrorList } from './ErrorList';

interface ErrorBrowserProps {
  records: readonly ErrorRecord[];
  readText: (position: EntryPosition) => Promise<EntryText>;
  readNeighbours: (position: EntryPosition) => Promise<NeighbourLines>;
  /** `true` when errors past the record limit were counted but not recorded. */
  limitReached: boolean;
}

/** The errors of an analysis: the list on one side, the detail of the selected one on the other. */
export function ErrorBrowser({ records, readText, readNeighbours, limitReached }: ErrorBrowserProps) {
  const groups = useMemo(() => summariseIdentical(records), [records]);
  const [selected, setSelected] = useState<number | null>(null);
  const record = selected === null ? null : (records[selected] ?? null);

  return (
    <div className="results-layout">
      <ErrorList records={records} groups={groups} selected={selected} onSelect={setSelected} />
      {/* Its own boundary: a detail that fails leaves the list in place, and another selection starts afresh. */}
      <ErrorBoundary key={record?.offset ?? 'none'} scope="panel">
        <ErrorDetail
          record={record}
          position={(selected ?? 0) + 1}
          readText={readText}
          readNeighbours={readNeighbours}
          identical={record === null ? undefined : groups.get(record.fingerprintId)}
          countIsMinimum={limitReached}
        />
      </ErrorBoundary>
    </div>
  );
}
