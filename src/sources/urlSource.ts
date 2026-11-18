import { AiRequestError } from '../ai/errors';
import type { AiFailureKind } from '../ai/errors';
import { send } from '../ai/request';

/**
 * The storage accounts the page may download a log from, one by one: the exact host, never a wildcard (ADR-020, T1).
 * The Content-Security-Policy of `staticwebapp.config.json` lists the same hosts, and a test keeps the two equal:
 * adding an account means changing both, then deploying.
 */
export const ALLOWED_STORAGE_HOSTS: readonly string[] = ['sherlogjournaux.blob.core.windows.net'];

/**
 * The largest file downloaded, in bytes. The file is kept whole in a Blob, like a file chosen on the computer, so this
 * is what bounds the memory and the time of the source (ADR-020, U4 and U7); the figures that set it are in ADR-022.
 */
export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;

/** The longest name kept for a source: it comes from the address, so it is text from outside. */
const MAX_NAME_CHARS = 200;

/** Why an address is not taken. The sentence for each is written where the screen is, never from the address itself. */
export type UrlRefusal = 'empty' | 'malformed' | 'not-https' | 'credentials' | 'port' | 'host' | 'no-file';

export type SourceUrlCheck =
  | { readonly ok: true; /** What is requested: the address as given, without its fragment. */ readonly url: string; readonly host: string; readonly name: string }
  | { readonly ok: false; readonly reason: UrlRefusal };

/** The name of the file the address ends with: decoded when it can be, without control characters, and short. */
function nameOf(pathname: string): string {
  const last = pathname.split('/').filter((segment) => segment !== '').at(-1) ?? '';
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // Not valid once decoded (a lone `%`): the name as written is still the best one there is.
  }
  const name = decoded.replace(/\p{Cc}/gu, '').slice(0, MAX_NAME_CHARS);
  return name === '' ? 'journal' : name;
}

/**
 * Checks, before anything is sent, that an address is one this page may download from: https, no credentials, no
 * port, a host that is exactly an allowed one (which keeps out every IP address, every other account and every look-alike),
 * and a file, not a container. The Content-Security-Policy is what really enforces the list, redirections included;
 * this gives the user a clear sentence instead of the browser's silent refusal.
 * The address is never part of a refusal: it may hold an access token.
 */
export function checkSourceUrl(input: string, allowedHosts: readonly string[] = ALLOWED_STORAGE_HOSTS): SourceUrlCheck {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'empty' };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'not-https' };
  }
  // Before the host: in `https://allowed.host@evil.example/` the allowed name is only the user name.
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials' };
  }
  // The default port of https is dropped by the parser, so any port left is another one.
  if (url.port !== '') {
    return { ok: false, reason: 'port' };
  }
  if (!allowedHosts.includes(url.hostname)) {
    return { ok: false, reason: 'host' };
  }
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments.length < 2 || url.pathname.endsWith('/')) {
    return { ok: false, reason: 'no-file' };
  }
  url.hash = '';
  return { ok: true, url: url.href, host: url.hostname, name: nameOf(url.pathname) };
}

export type DownloadFailureKind = AiFailureKind | 'too-large';

/** Why a download did not give a file. It holds no part of the address, which may carry an access token. */
export class DownloadError extends Error {
  readonly kind: DownloadFailureKind;
  /** HTTP status of the answer, when there was one. */
  readonly status: number | undefined;
  /** The size the storage announced, when the file was refused for it before being downloaded. */
  readonly announcedBytes: number | undefined;
  readonly limitBytes: number | undefined;

  constructor(kind: DownloadFailureKind, options: { status?: number; announcedBytes?: number; limitBytes?: number } = {}) {
    super(`Download failed: ${kind}`);
    this.name = 'DownloadError';
    this.kind = kind;
    this.status = options.status;
    this.announcedBytes = options.announcedBytes;
    this.limitBytes = options.limitBytes;
  }
}

export interface DownloadOptions {
  /** An address that `checkSourceUrl` accepted. */
  readonly url: string;
  readonly fetchImpl: typeof fetch;
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
  readonly headersTimeoutMs?: number;
  /** Called with what has arrived and the size the storage announced (`null` when it did not, or not as a number). */
  readonly onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}

/** The size in a `Content-Length` header, or `null` when it is absent or is not a whole number of bytes. */
function announcedSize(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header)) {
    return null;
  }
  const size = Number(header);
  return Number.isSafeInteger(size) ? size : null;
}

/**
 * Downloads one file into a Blob, within a limit of size. A file announced larger is refused before any of it is read;
 * a file that turns out larger is cut off as soon as the limit is passed, and nothing of it is kept.
 * The request goes through the one module that sends none of the page's cookies and no referrer, and that gives up
 * on a redirection: an address with an access token has no reason to lead anywhere else.
 */
export async function downloadLog(options: DownloadOptions): Promise<Blob> {
  const { url, fetchImpl, signal, maxBytes = MAX_DOWNLOAD_BYTES, headersTimeoutMs, onProgress } = options;
  let response: Response;
  try {
    response = await send({ url, method: 'GET', headers: {}, signal, fetchImpl, headersTimeoutMs, redirect: 'error', explain: () => undefined });
  } catch (error) {
    if (error instanceof AiRequestError) {
      throw new DownloadError(error.kind, { status: error.status });
    }
    throw error;
  }

  const announced = announcedSize(response.headers.get('content-length'));
  const body = response.body;
  if (body === null) {
    return new Blob([]);
  }
  const reader = body.getReader();
  // The browser's own failure to stop a stream that is already stopping says nothing the user could act on.
  const stop = (): Promise<void> => reader.cancel().catch(() => undefined);
  if (announced !== null && announced > maxBytes) {
    await stop();
    throw new DownloadError('too-large', { announcedBytes: announced, limitBytes: maxBytes });
  }

  // Cancelling ends a read that waits for data: without this a download that stalled could not be given up.
  const onAbort = (): void => {
    void stop();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>;
      try {
        step = await reader.read();
      } catch {
        throw new DownloadError(signal?.aborted === true ? 'cancelled' : 'interrupted');
      }
      if (signal?.aborted === true) {
        throw new DownloadError('cancelled');
      }
      if (step.done) {
        break;
      }
      received += step.value.byteLength;
      if (received > maxBytes) {
        throw new DownloadError('too-large', { limitBytes: maxBytes });
      }
      chunks.push(step.value);
      onProgress?.(received, announced);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await stop();
  }
  return new Blob(chunks);
}
