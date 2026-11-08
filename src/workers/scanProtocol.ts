import type { Preparation } from '../core/preparation';
import type { ErrorRecord, ScanResult } from '../core/scanLog';

/** What the page asks the worker to do. */
export interface ScanRequest {
  /** The file, or the pasted text as a blob; a `File` is cloned to the worker without being copied. */
  readonly source: Blob;
  /** Id of a built-in profile, as recognised by the format detection. */
  readonly profileId: string;
  /** What to leave out; plain data, so that it is cloned to the worker as it is. */
  readonly preparation: Preparation;
}

/** What the worker answers, in order: any number of `progress` and `errors`, then exactly one `done` or `failed`. */
export type ScanMessage =
  | { readonly type: 'progress'; readonly bytesRead: number }
  | { readonly type: 'errors'; readonly records: readonly ErrorRecord[] }
  | { readonly type: 'done'; readonly result: ScanResult }
  | { readonly type: 'failed'; readonly message: string };

/**
 * Starts a scan and returns the function that stops it. Behind this type is a real worker in the app and a
 * fake in the tests: the page never touches `Worker` directly.
 */
export type StartScan = (request: ScanRequest, onMessage: (message: ScanMessage) => void) => () => void;
