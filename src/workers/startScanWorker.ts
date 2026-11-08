import { readFailureMessage } from '../sources/readFailure';
import type { ScanMessage, StartScan } from './scanProtocol';

const WORKER_NOT_STARTED = 'Le traitement n’a pas pu démarrer (script introuvable ou refusé).';

/**
 * Starts the real worker. The worker file is loaded as a separate script from the same origin (`worker-src 'self'`
 * in the CSP): never inline it as a blob. Only checked in a real browser, since jsdom has no `Worker`.
 */
export const startScanWorker: StartScan = (request, onMessage) => {
  const worker = new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<ScanMessage>) => {
    onMessage(event.data);
  };
  worker.onerror = (event) => {
    // A script that is missing or refused raises this event with an empty message.
    const message = event.message === '' ? WORKER_NOT_STARTED : readFailureMessage(new Error(event.message));
    onMessage({ type: 'failed', message });
  };
  worker.onmessageerror = () => {
    onMessage({ type: 'failed', message: 'Lecture impossible : réponse illisible du traitement.' });
  };
  try {
    worker.postMessage(request);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  return () => {
    worker.terminate();
  };
};
