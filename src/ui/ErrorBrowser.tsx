import { useMemo, useState } from 'react';
import { summariseIdentical } from '../core/identicalErrors';
import type { ErrorRecord } from '../core/scanLog';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import { ErrorDetail } from './ErrorDetail';
import { ErrorList } from './ErrorList';

interface ErrorBrowserProps {
  records: readonly ErrorRecord[];
  readText: (position: EntryPosition) => Promise<EntryText>;
}

/** The errors of an analysis: the list on one side, the detail of the selected one on the other. */
export function ErrorBrowser({ records, readText }: ErrorBrowserProps) {
  const groups = useMemo(() => summariseIdentical(records), [records]);
  const [selected, setSelected] = useState<number | null>(null);
  const record = selected === null ? null : (records[selected] ?? null);

  return (
    <div className="results-layout">
      <ErrorList records={records} groups={groups} selected={selected} onSelect={setSelected} />
      <ErrorDetail key={record?.offset ?? 'none'} record={record} position={(selected ?? 0) + 1} readText={readText} />
    </div>
  );
}
