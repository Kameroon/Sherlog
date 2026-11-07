import { readFailureMessage } from '../sources/readFailure';
import type { ScanMessage, StartScan } from './scanProtocol';

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
    onMessage({ type: 'failed', message: readFailureMessage(new Error(event.message)) });
  };
  worker.onmessageerror = () => {
    onMessage({ type: 'failed', message: 'Lecture impossible : réponse illisible du traitement.' });
  };
  worker.postMessage(request);
  return () => {
    worker.terminate();
  };
};
