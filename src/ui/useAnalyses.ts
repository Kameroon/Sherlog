import { useCallback, useEffect, useRef, useState } from 'react';
import { analyseError } from '../ai/analyseError';
import { createProvider } from '../ai/createProvider';
import type { ProviderChoice } from '../ai/createProvider';
import { AiRequestError } from '../ai/errors';
import { failureMessage } from '../ai/failureMessage';
import { PROVIDER_NAMES } from '../ai/provider';
import type { IdenticalErrors } from '../core/identicalErrors';
import type { RedactionRuleId } from '../core/redact';
import type { ErrorRecord } from '../core/scanLog';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import type { AnalysisByFingerprint, AnalysisEntry } from './analysisState';
import { readPayload } from './readPayload';

/** What the analyses read of the analysis session; given afresh at each render, read when it is needed. */
export interface AnalysesInputs {
  readonly records: readonly ErrorRecord[];
  readonly groups: ReadonlyMap<number, IdenticalErrors>;
  readonly fileName: string;
  readonly hasDate: boolean;
  readonly countIsMinimum: boolean;
  readonly readText: (position: EntryPosition) => Promise<EntryText>;
  readonly readNeighbours: (position: EntryPosition) => Promise<NeighbourLines>;
  readonly fetchImpl?: typeof fetch;
  /** The address of this site, which a failure of Ollama tells the user to allow. */
  readonly siteOrigin: string;
  /** Called when the model has answered for a fingerprint. */
  readonly onAnalysed: (fingerprintId: number) => void;
}

/** What the user asked for with one click: the errors, and the provider and masking as they were at that moment. */
interface Job {
  readonly fingerprints: readonly number[];
  readonly choice: ProviderChoice;
  readonly masking: ReadonlySet<RedactionRuleId>;
}

export interface SendProgress {
  readonly done: number;
  readonly total: number;
}

export interface Analyses {
  readonly analyses: AnalysisByFingerprint;
  /** `null` when nothing is being sent. */
  readonly progress: SendProgress | null;
  readonly send: (fingerprints: readonly number[], choice: ProviderChoice, masking: ReadonlySet<RedactionRuleId>) => void;
  readonly cancel: () => void;
}

/**
 * Asks the model to analyse the errors the user chose, one after the other, when the user clicks. For each fingerprint
 * the entry and the lines around its most recent occurrence are read from the log, masked and cut by the same function
 * that shows the preview (so what was seen is what leaves), then analysed. The first failure ends the run: an
 * error of the key or of the provider would only repeat for the others. A run is cancelled by the user, or when the screen goes away.
 */
export function useAnalyses(inputs: AnalysesInputs): Analyses {
  const [analyses, setAnalyses] = useState<AnalysisByFingerprint>(new Map());
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState<SendProgress | null>(null);

  // The run reads the latest inputs when it needs them: restarting it at each render would cancel the request under way.
  const latest = useRef(inputs);
  useEffect(() => {
    latest.current = inputs;
  });

  const setEntry = useCallback((fingerprintId: number, entry: AnalysisEntry | null): void => {
    setAnalyses((previous) => {
      const next = new Map(previous);
      if (entry === null) {
        next.delete(fingerprintId);
      } else {
        next.set(fingerprintId, entry);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (job === null) {
      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;

    const run = async (): Promise<void> => {
      for (const [index, fingerprintId] of job.fingerprints.entries()) {
        setProgress({ done: index, total: job.fingerprints.length });
        setEntry(fingerprintId, { status: 'running' });
        const { records, groups, fileName, hasDate, countIsMinimum, readText, readNeighbours, fetchImpl, siteOrigin } = latest.current;
        const read = await readPayload({ records, groups, fingerprintId, hasDate, fileName, countIsMinimum, readText, readNeighbours }, job.masking, signal);
        if (!read.ok) {
          setEntry(fingerprintId, read.aborted ? null : { status: 'failed', message: read.message });
          return;
        }

        try {
          // A run given up while the log was read sends nothing: the request refuses to start once cancelled.
          const outcome = await analyseError(createProvider(job.choice, fetchImpl), read.payload, { signal });
          if (signal.aborted) {
            // An answer that comes after the user cancelled is not kept: the screen says the run was given up.
            setEntry(fingerprintId, null);
            return;
          }
          setEntry(fingerprintId, { status: 'done', outcome, by: `${job.choice.model} (${PROVIDER_NAMES[job.choice.provider]})` });
          latest.current.onAnalysed(fingerprintId);
        } catch (error) {
          if (signal.aborted || (error instanceof AiRequestError && error.kind === 'cancelled')) {
            setEntry(fingerprintId, null);
          } else {
            const message = error instanceof AiRequestError ? failureMessage(error, { provider: job.choice.provider, siteOrigin }) : 'Erreur inattendue pendant l’analyse.';
            setEntry(fingerprintId, { status: 'failed', message });
          }
          return;
        }
      }
    };

    void run().then(() => {
      if (!signal.aborted) {
        setJob(null);
        setProgress(null);
      }
    });
    return () => {
      controller.abort();
      // Whatever was under way when the run is given up is not under way any more, even if the request is slow to notice.
      setAnalyses((previous) => new Map([...previous].filter(([, entry]) => entry.status !== 'running')));
    };
  }, [job, setEntry]);

  const send = useCallback((fingerprints: readonly number[], choice: ProviderChoice, masking: ReadonlySet<RedactionRuleId>): void => {
    setJob({ fingerprints, choice, masking });
  }, []);

  const cancel = useCallback((): void => {
    setJob(null);
    setProgress(null);
  }, []);

  return { analyses, progress, send, cancel };
}
