import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AnalysisOutcome } from '../ai/analyseError';
import type { ProviderChoice } from '../ai/createProvider';
import { NO_STATUSES, statusOf, withAnalysis, withStatus } from '../core/errorStatus';
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
import { ChatContextPreview, ChatPanel } from './ChatPanel';
import { useAnalyses } from './useAnalyses';
import { NEW_CHAT, useChats } from './useChats';

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
  /** What the user chose in those settings, once it is usable; `null` until then. */
  provider?: ProviderChoice | null;
  /** Replaces the network of the page; used by the tests. */
  aiFetch?: typeof fetch;
  /** The address of this site, which a failure of Ollama tells the user to allow. */
  siteOrigin?: string;
}

/**
 * The errors of an analysis: the search, the filter and the sort above, the list on one side and the detail of the
 * selected one on the other. The selection is an error of the whole list (`selected` is its position in `records`,
 * which is also its number in the log), so it holds when the order changes or a search hides it. The statuses are
 * kept here, for this analysis only: a new analysis mounts the browser again, with every error new. So is the choice
 * of the errors to have explained, made by fingerprint: none is chosen by default, and nothing is sent from here.
 */
export function ErrorBrowser({ records, readText, readNeighbours, limitReached, fileName = 'journal', masking = DEFAULT_ENABLED_RULES, hasDate = true, sendSettings, provider = null, aiFetch, siteOrigin = window.location.origin }: ErrorBrowserProps) {
  const groups = useMemo(() => summariseIdentical(records), [records]);
  const levels = useMemo(() => distinctLevels(records), [records]);
  const [options, setOptions] = useState<ErrorViewOptions>(DEFAULT_ERROR_VIEW);
  // The text box answers at once; the list of a hundred thousand errors follows when the browser is free.
  const applied = useDeferredValue(options);
  const [statuses, setStatuses] = useState<StatusByFingerprint>(NO_STATUSES);
  const [chosenForSending, setChosenForSending] = useState<ReadonlySet<number>>(new Set());
  const { analyses, progress, send, cancel } = useAnalyses({
    records,
    groups,
    fileName,
    hasDate,
    countIsMinimum: limitReached,
    readText,
    readNeighbours,
    fetchImpl: aiFetch,
    siteOrigin,
    onAnalysed: (fingerprintId) => {
      setStatuses((previous) => withAnalysis(previous, fingerprintId));
    },
  });
  /** What the model said of a fingerprint, once it has answered (an analysis, or its text when it did not follow the schema). */
  const analysisOf = (fingerprintId: number): AnalysisOutcome | null => {
    const entry = analyses.get(fingerprintId);
    return entry?.status === 'done' ? entry.outcome : null;
  };
  const chats = useChats({
    records,
    groups,
    fileName,
    hasDate,
    countIsMinimum: limitReached,
    readText,
    readNeighbours,
    fetchImpl: aiFetch,
    siteOrigin,
    analysisOf,
  });
  const indices = useMemo(() => buildErrorView(records, groups, applied, statuses), [records, groups, applied, statuses]);
  const visible = useMemo(() => indices.flatMap((index) => records[index] ?? []), [indices, records]);
  const [selected, setSelected] = useState<number | null>(null);
  const browserRef = useRef<HTMLDivElement>(null);
  // Counts the « Voir l'analyse » clicks of the sending panel: the analysis is in the detail, away from the button that asked for it.
  const [analysisRequests, setAnalysisRequests] = useState(0);
  useEffect(() => {
    if (analysisRequests > 0) {
      // Focusing scrolls to it, and tells a screen reader where the user is.
      browserRef.current?.querySelector<HTMLElement>('.analysis')?.focus();
    }
  }, [analysisRequests]);
  const record = selected === null ? null : (records[selected] ?? null);
  const latest = useMemo(() => (record === null ? null : latestOccurrence(records, record.fingerprintId, hasDate)), [records, record, hasDate]);
  const selectedRow = useMemo(() => {
    const row = selected === null ? -1 : indices.indexOf(selected);
    return row === -1 ? null : row;
  }, [indices, selected]);

  const latestRecord = latest === null ? undefined : records[latest.index];
  const selectedGroup = record === null ? undefined : groups.get(record.fingerprintId);
  // The chat deepens what the model said: it is not offered before the model has answered for this error (ADR-019).
  const selectedAnalysis = record === null ? null : analysisOf(record.fingerprintId);
  const chatPanel =
    record === null || latest === null || latestRecord === undefined || selectedGroup === undefined || selectedAnalysis === null ? undefined : (
      <ChatPanel
        chat={chats.chats.get(record.fingerprintId) ?? NEW_CHAT}
        provider={provider}
        masking={masking}
        busy={chats.busy !== null}
        answering={chats.busy === record.fingerprintId}
        twins={selectedGroup.count}
        onAsk={(question) => {
          if (provider !== null) {
            chats.ask(record.fingerprintId, question, provider, masking);
          }
        }}
        onStop={chats.stop}
        onClear={() => {
          chats.clear(record.fingerprintId);
        }}
        context={
          <ChatContextPreview
            record={latestRecord}
            number={latest.index + 1}
            group={selectedGroup}
            fileName={fileName}
            masking={masking}
            countIsMinimum={limitReached}
            readText={readText}
            readNeighbours={readNeighbours}
            analysis={selectedAnalysis}
          />
        }
      />
    );

  return (
    <div className="error-browser" ref={browserRef}>
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
            analysis={record === null ? undefined : analyses.get(record.fingerprintId)}
            chat={chatPanel}
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
        provider={provider}
        analyses={analyses}
        progress={progress}
        onSend={() => {
          if (provider !== null) {
            send([...chosenForSending], provider, masking);
          }
        }}
        onCancelSend={cancel}
        onShowAnalysis={(fingerprintId) => {
          const latestIndex = latestOccurrence(records, fingerprintId, hasDate)?.index ?? null;
          if (latestIndex !== null) {
            setSelected(latestIndex);
            setAnalysisRequests((count) => count + 1);
          }
        }}
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
