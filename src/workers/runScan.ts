import { createEntryFilter, validatePeriod } from '../core/preparation';
import { BUILT_IN_PROFILES } from '../core/profiles';
import { scanLog } from '../core/scanLog';
import { blobChunks } from '../sources/blobChunks';
import { readFailureMessage } from '../sources/readFailure';
import type { ScanMessage, ScanRequest } from './scanProtocol';

/** Shortest delay between two progress messages: enough for a smooth bar, far from flooding the page. */
export const PROGRESS_INTERVAL_MS = 100;

/**
 * Runs one scan and reports it as messages. It never rejects: every failure becomes a `failed` message, so the
 * page is never left waiting. Kept apart from the worker file so that it can be tested without a worker.
 *
 * @param post - Receives the messages; in the worker it is `postMessage`.
 * @param now - Clock in milliseconds, replaceable in tests.
 */
export async function runScan(request: ScanRequest, post: (message: ScanMessage) => void, now: () => number = () => performance.now()): Promise<void> {
  const profile = BUILT_IN_PROFILES.find((candidate) => candidate.id === request.profileId);
  if (profile === undefined) {
    post({ type: 'failed', message: `Format inconnu : ${request.profileId}.` });
    return;
  }

  // A period the screen should have refused is not scanned without it: that would give figures nobody asked for.
  const periodProblem = validatePeriod(request.preparation.period);
  if (periodProblem !== null) {
    post({ type: 'failed', message: periodProblem });
    return;
  }

  let lastProgressAt = Number.NEGATIVE_INFINITY;
  try {
    const result = await scanLog(blobChunks(request.source), { profile, filter: createEntryFilter(request.preparation) }, {
      onErrors: (records) => post({ type: 'errors', records }),
      onProgress: (bytesRead) => {
        const time = now();
        if (time - lastProgressAt >= PROGRESS_INTERVAL_MS) {
          lastProgressAt = time;
          post({ type: 'progress', bytesRead });
        }
      },
    });
    post({ type: 'done', result });
  } catch (error) {
    post({ type: 'failed', message: readFailureMessage(error) });
  }
}
