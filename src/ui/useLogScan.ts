import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ErrorRecord, ScanResult } from '../core/scanLog';
import { detectFormat } from '../sources/detectFormat';
import type { FormatDetection } from '../sources/detectFormat';
import { readEntryText } from '../sources/readEntryText';
import type { EntryPosition } from '../sources/readEntryText';
import { readFailureMessage } from '../sources/readFailure';
import type { ScanMessage, StartScan } from '../workers/scanProtocol';
import { startScanWorker } from '../workers/startScanWorker';

/** The source the user chose and what the format detection said about it. */
interface Chosen {
  readonly source: Blob;
  readonly name: string;
  readonly detection: FormatDetection;
}

/**
 * Where the user is. Nothing moves from `ready` to `analysing` without the user's click, and `ready` is where
 * the preparation space of step 4b will live.
 */
export type ScanState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'detecting' }
  | ({ readonly phase: 'ready' } & Chosen)
  | ({ readonly phase: 'analysing'; readonly bytesRead: number; readonly records: readonly ErrorRecord[] } & Chosen)
  | ({ readonly phase: 'analysed'; readonly result: ScanResult; readonly records: readonly ErrorRecord[] } & Chosen)
  | { readonly phase: 'failed'; readonly message: string };

type Action =
  | { readonly type: 'detecting' }
  | { readonly type: 'chosen'; readonly chosen: Chosen }
  | { readonly type: 'analysisStarted' }
  | { readonly type: 'message'; readonly message: ScanMessage }
  | { readonly type: 'cancelled' }
  | { readonly type: 'failed'; readonly message: string }
  | { readonly type: 'reset' };

function reducer(state: ScanState, action: Action): ScanState {
  switch (action.type) {
    case 'detecting':
      return { phase: 'detecting' };
    case 'chosen':
      return { phase: 'ready', ...action.chosen };
    case 'analysisStarted':
      return state.phase === 'ready' ? { ...state, phase: 'analysing', bytesRead: 0, records: [] } : state;
    case 'message':
      return state.phase === 'analysing' ? applyMessage(state, action.message) : state;
    case 'cancelled': {
      if (state.phase !== 'analysing') {
        return state;
      }
      const { source, name, detection } = state;
      return { phase: 'ready', source, name, detection };
    }
    case 'failed':
      return { phase: 'failed', message: action.message };
    case 'reset':
      return { phase: 'idle' };
  }
}

function applyMessage(state: Extract<ScanState, { phase: 'analysing' }>, message: ScanMessage): ScanState {
  switch (message.type) {
    case 'progress':
      return { ...state, bytesRead: message.bytesRead };
    case 'errors':
      return { ...state, records: [...state.records, ...message.records] };
    case 'done': {
      const { source, name, detection, records } = state;
      return { phase: 'analysed', source, name, detection, records, result: message.result };
    }
    case 'failed':
      return { phase: 'failed', message: message.message };
  }
}

/** What the hook needs from the outside; replaced by fakes in the tests. */
export interface ScanDependencies {
  readonly startScan: StartScan;
  readonly detect: (source: Blob) => Promise<FormatDetection>;
}

/** Name shown for text that was pasted instead of read from a file. */
export const PASTED_TEXT_NAME = 'Texte collé';

/**
 * Drives the path from a chosen file or pasted text to the list of errors: recognise the format, wait for the
 * user, scan in a worker, follow the progress, allow cancelling. The worker is stopped whenever the scan
 * ends, is cancelled or the component goes away.
 */
export function useLogScan({ startScan = startScanWorker, detect = detectFormat }: Partial<ScanDependencies> = {}) {
  const [state, dispatch] = useReducer(reducer, { phase: 'idle' });
  const stopRef = useRef<(() => void) | null>(null);
  // Bumped by every action that makes pending results obsolete, so that a late answer cannot overwrite a newer state.
  const generationRef = useRef(0);

  const stopScan = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  useEffect(() => stopScan, [stopScan]);

  const choose = useCallback(
    async (source: Blob, name: string) => {
      stopScan();
      generationRef.current += 1;
      const generation = generationRef.current;
      dispatch({ type: 'detecting' });
      try {
        const detection = await detect(source);
        if (generation === generationRef.current) {
          dispatch({ type: 'chosen', chosen: { source, name, detection } });
        }
      } catch (error) {
        if (generation === generationRef.current) {
          dispatch({ type: 'failed', message: readFailureMessage(error) });
        }
      }
    },
    [detect, stopScan],
  );

  const chooseFile = useCallback((file: File) => choose(file, file.name), [choose]);
  const chooseText = useCallback((text: string) => choose(new Blob([text]), PASTED_TEXT_NAME), [choose]);

  const analyse = useCallback(() => {
    if (state.phase !== 'ready' || state.detection.status !== 'detected') {
      return;
    }
    generationRef.current += 1;
    const generation = generationRef.current;
    dispatch({ type: 'analysisStarted' });
    stopRef.current = startScan({ source: state.source, profileId: state.detection.profile.id }, (message) => {
      if (generation !== generationRef.current) {
        return;
      }
      if (message.type === 'done' || message.type === 'failed') {
        stopScan();
      }
      dispatch({ type: 'message', message });
    });
  }, [state, startScan, stopScan]);

  const cancel = useCallback(() => {
    stopScan();
    generationRef.current += 1;
    dispatch({ type: 'cancelled' });
  }, [stopScan]);

  const reset = useCallback(() => {
    stopScan();
    generationRef.current += 1;
    dispatch({ type: 'reset' });
  }, [stopScan]);

  const readText = useCallback(
    (position: EntryPosition): Promise<string> => {
      if (state.phase !== 'analysed' || state.result.encoding === null) {
        return Promise.reject(new Error('aucun journal analysé'));
      }
      return readEntryText(state.source, position, state.result.encoding);
    },
    [state],
  );

  return { state, chooseFile, chooseText, analyse, cancel, reset, readText };
}
