import { AiRequestError } from './errors';
import type { AiFailureKind } from './errors';

/** How long a provider has to start answering: past this, the request is given up (the answer itself may take longer). */
export const DEFAULT_HEADERS_TIMEOUT_MS = 30_000;

/** The longest explanation of a provider kept, so that an answer cannot fill the screen. */
const MAX_DETAIL_CHARS = 300;

export interface RequestOptions {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  /** Sent as JSON. */
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly fetchImpl: typeof fetch;
  readonly headersTimeoutMs?: number;
  /** What to do when the address answers with a redirection; the browser's own rule (follow) when not given. */
  readonly redirect?: RequestRedirect;
  /** Taken out of what the provider says before it is kept: a key must never come back to the screen. */
  readonly secret?: string;
  /** Finds the explanation in the JSON body of an error answer. */
  readonly explain: (body: unknown) => string | undefined;
}

/** The failure a status stands for. */
function kindOfStatus(status: number): AiFailureKind {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 429:
      return 'rate-limited';
    default:
      return status >= 500 ? 'unavailable' : 'rejected';
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON (a proxy's page, for instance): the status alone tells the kind, the explanation is a bonus.
    return undefined;
  }
}

async function explanationOf(response: Response, options: Pick<RequestOptions, 'explain' | 'secret'>): Promise<string | undefined> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    // The answer broke off while it was read: the status is enough to say what happened.
    return undefined;
  }
  const explanation = options.explain(parseJson(text))?.trim();
  if (explanation === undefined || explanation === '') {
    return undefined;
  }
  const withoutSecret = options.secret === undefined || options.secret === '' ? explanation : explanation.split(options.secret).join('…');
  return withoutSecret.slice(0, MAX_DETAIL_CHARS);
}

/**
 * Sends one request and gives the answer once its headers are there and its status is a success; the body is left to
 * be read. Every other outcome is an `AiRequestError`, so that a caller deals with one kind of failure.
 * No cookie and no referrer go with the request (the page's own are not for a provider).
 */
export async function send(options: RequestOptions): Promise<Response> {
  // `fetch` is called as a plain function: as the method of `options` the browser refuses it ("Illegal invocation").
  const { signal, fetchImpl } = options;
  // Read again each time it is needed: the caller may cancel while a request is in flight.
  const isCancelled = (): boolean => signal?.aborted === true;
  if (isCancelled()) {
    throw new AiRequestError('cancelled');
  }
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = (): void => {
    controller.abort();
  };
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(options.url, {
      method: options.method,
      headers: { ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: options.redirect,
    });
  } catch {
    signal?.removeEventListener('abort', forwardAbort);
    // The browser says nothing more than "Failed to fetch" for an offline machine, a blocked address and a refusal by CORS alike.
    throw new AiRequestError(timedOut ? 'timeout' : isCancelled() ? 'cancelled' : 'network');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    signal?.removeEventListener('abort', forwardAbort);
    throw new AiRequestError(kindOfStatus(response.status), { status: response.status, detail: await explanationOf(response, options) });
  }
  return response;
}

/** The failure to report when reading an answer that had begun breaks off. */
export function interruptionOf(error: unknown, signal?: AbortSignal): AiRequestError {
  if (error instanceof AiRequestError) {
    return error;
  }
  return new AiRequestError(signal?.aborted === true ? 'cancelled' : 'interrupted');
}
