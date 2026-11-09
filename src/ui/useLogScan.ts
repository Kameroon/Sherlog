import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ErrorRecord, ScanResult } from '../core/scanLog';
import { EMPTY_PREPARATION, NO_PERIOD } from '../core/preparation';
import type { Preparation } from '../core/preparation';
import type { LogProfile } from '../core/profiles';
import { DEFAULT_ENABLED_RULES } from '../core/redact';
import type { RedactionRuleId } from '../core/redact';
import { readHead } from '../sources/readHead';
import type { FormatDetection, HeadRead } from '../sources/readHead';
import { readEntryText } from '../sources/readEntryText';
import type { EntryPosition, EntryText } from '../sources/readEntryText';
import { readNeighbourLines } from '../sources/readNeighbourLines';
import type { NeighbourLines } from '../sources/readNeighbourLines';
import { readFailureMessage, startFailureMessage } from '../sources/readFailure';
import type { ScanMessage, StartScan } from '../workers/scanProtocol';
import { startScanWorker } from '../workers/startScanWorker';

/** The source the user chose, what the format detection said about it, and what the user set for the analysis. */
interface Chosen {
  readonly source: Blob;
  readonly name: string;
  readonly detection: FormatDetection;
  /** The beginning of the source: the preparation screen shows its figures from it, without reading the file again. */
  readonly head: Uint8Array;
  /** `true` when `head` is the whole source, so that the figures computed on it are exact. */
  readonly complete: boolean;
  readonly preparation: Preparation;
  /**
   * The masking rules that are on. Apart from the preparation: masking changes what is shown and sent, not which
   * errors there are, so changing it does not make a result obsolete.
   */
  readonly masking: ReadonlySet<RedactionRuleId>;
  /** The format the log is read with: the recognised one at first, then the user's choice; `null` until there is one. */
  readonly profile: LogProfile | null;
}

function chosenOf({ source, name, detection, head, complete, preparation, masking, profile }: Chosen): Chosen {
  return { source, name, detection, head, complete, preparation, masking, profile };
}

/**
 * Where the user is. Nothing moves from `ready` to `analysing` without the user's click, and `ready` is where
 * the preparation space of step 4b will live.
 */
export type ScanState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'detecting' }
  | ({ readonly phase: 'ready'; readonly settingsChanged: boolean } & Chosen)
  | ({ readonly phase: 'analysing'; readonly bytesRead: number; readonly records: readonly ErrorRecord[] } & Chosen)
  | ({ readonly phase: 'analysed'; readonly result: ScanResult; readonly records: readonly ErrorRecord[] } & Chosen)
  | { readonly phase: 'failed'; readonly message: string };

type Action =
  | { readonly type: 'detecting' }
  | { readonly type: 'chosen'; readonly chosen: Chosen }
  | { readonly type: 'preparationChanged'; readonly preparation: Preparation }
  | { readonly type: 'maskingChanged'; readonly masking: ReadonlySet<RedactionRuleId> }
  | { readonly type: 'profileChanged'; readonly profile: LogProfile }
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
      return { phase: 'ready', settingsChanged: false, ...action.chosen };
    case 'preparationChanged':
      // A result was computed with the old settings: it is dropped, and the screen says to analyse again.
      if (state.phase === 'analysed') {
        return { phase: 'ready', settingsChanged: true, ...chosenOf(state), preparation: action.preparation };
      }
      return state.phase === 'ready' ? { ...state, preparation: action.preparation } : state;
    case 'maskingChanged':
      return state.phase === 'ready' || state.phase === 'analysed' ? { ...state, masking: action.masking } : state;
    case 'profileChanged': {
      // JSON is not read yet: there is no format to offer for it. The period fits the format it was set for, so it goes.
      if ((state.phase !== 'ready' && state.phase !== 'analysed') || state.detection.status === 'structured') {
        return state;
      }
      const changed = { ...chosenOf(state), profile: action.profile, preparation: { ...state.preparation, period: NO_PERIOD } };
      return { phase: 'ready', settingsChanged: state.phase === 'analysed' || state.settingsChanged, ...changed };
    }
    case 'analysisStarted':
      return state.phase === 'ready' ? { phase: 'analysing', bytesRead: 0, records: [], ...chosenOf(state) } : state;
    case 'message':
      return state.phase === 'analysing' ? applyMessage(state, action.message) : state;
    case 'cancelled': {
      if (state.phase !== 'analysing') {
        return state;
      }
      return { phase: 'ready', settingsChanged: false, ...chosenOf(state) };
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
    case 'done':
      return { phase: 'analysed', records: state.records, result: message.result, ...chosenOf(state) };
    case 'failed':
      return { phase: 'failed', message: message.message };
  }
}

/** What the hook needs from the outside; replaced by fakes in the tests. */
export interface ScanDependencies {
  readonly startScan: StartScan;
  readonly readHead: (source: Blob) => Promise<HeadRead>;
}

/** Name shown for text that was pasted instead of read from a file. */
export const PASTED_TEXT_NAME = 'Texte collé';

/**
 * Drives the path from a chosen file or pasted text to the list of errors: recognise the format, wait for the
 * user, scan in a worker, follow the progress, allow cancelling. The worker is stopped whenever the scan
 * ends, is cancelled or the component goes away.
 */
export function useLogScan({ startScan = startScanWorker, readHead: read = readHead }: Partial<ScanDependencies> = {}) {
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
        const { detection, head, complete } = await read(source);
        if (generation === generationRef.current) {
          const profile = detection.status === 'detected' ? detection.profile : null;
          dispatch({ type: 'chosen', chosen: { source, name, detection, head, complete, preparation: EMPTY_PREPARATION, masking: DEFAULT_ENABLED_RULES, profile } });
        }
      } catch (error) {
        if (generation === generationRef.current) {
          dispatch({ type: 'failed', message: readFailureMessage(error) });
        }
      }
    },
    [read, stopScan],
  );

  const chooseFile = useCallback((file: File) => choose(file, file.name), [choose]);
  const chooseText = useCallback((text: string) => choose(new Blob([text]), PASTED_TEXT_NAME), [choose]);

  const analyse = useCallback(() => {
    if (state.phase !== 'ready' || state.profile === null) {
      return;
    }
    generationRef.current += 1;
    const generation = generationRef.current;
    dispatch({ type: 'analysisStarted' });
    try {
      const request = { source: state.source, profileId: state.profile.id, preparation: state.preparation };
      stopRef.current = startScan(request, (message) => {
        if (generation !== generationRef.current) {
          return;
        }
        if (message.type === 'done' || message.type === 'failed') {
          stopScan();
        }
        dispatch({ type: 'message', message });
      });
    } catch (error) {
      // The browser refuses synchronously when it cannot create the worker: without this the screen would stay on "in progress".
      dispatch({ type: 'failed', message: startFailureMessage(error) });
    }
  }, [state, startScan, stopScan]);

  const changePreparation = useCallback((preparation: Preparation) => {
    dispatch({ type: 'preparationChanged', preparation });
  }, []);

  const changeMasking = useCallback((masking: ReadonlySet<RedactionRuleId>) => {
    dispatch({ type: 'maskingChanged', masking });
  }, []);

  const changeProfile = useCallback((profile: LogProfile) => {
    dispatch({ type: 'profileChanged', profile });
  }, []);

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
    (position: EntryPosition): Promise<EntryText> => {
      if (state.phase !== 'analysed' || state.result.encoding === null) {
        return Promise.reject(new Error('aucun journal analysé'));
      }
      return readEntryText(state.source, position, state.result.encoding);
    },
    [state],
  );

  const readNeighbours = useCallback(
    (position: EntryPosition): Promise<NeighbourLines> => {
      if (state.phase !== 'analysed' || state.result.encoding === null) {
        return Promise.reject(new Error('aucun journal analysé'));
      }
      return readNeighbourLines(state.source, position, state.result.encoding);
    },
    [state],
  );

  return { state, chooseFile, chooseText, changePreparation, changeMasking, changeProfile, analyse, cancel, reset, readText, readNeighbours };
}
