/**
 * Why a request to a provider did not give an answer. The kind is what the interface acts on; the detail is the
 * provider's own explanation, kept apart because it is text from a third party.
 */
export type AiFailureKind =
  /** 401: the key is wrong, expired or revoked. */
  | 'unauthorized'
  /** 403: the key is not allowed to do this, or Ollama does not accept the address of this site. */
  | 'forbidden'
  /** 404: the model does not exist (or is not installed). */
  | 'not-found'
  /** 400 or 413: the provider refused the request itself. */
  | 'rejected'
  /** 429: too many requests or no more credit. */
  | 'rate-limited'
  /** 5xx or an overloaded provider. */
  | 'unavailable'
  /** The browser could not reach the provider at all (offline, blocked, or refused by CORS). */
  | 'network'
  /** No answer within the time allowed. */
  | 'timeout'
  /** The answer began and then stopped before its end. */
  | 'interrupted'
  /** The answer is not in the form the provider documents. */
  | 'protocol'
  /** The caller gave up: nothing to tell the user. */
  | 'cancelled';

export class AiRequestError extends Error {
  readonly kind: AiFailureKind;
  /** HTTP status of the answer, when there was one. */
  readonly status: number | undefined;
  /** What the provider said about it, when it said something. */
  readonly detail: string | undefined;

  constructor(kind: AiFailureKind, options: { status?: number; detail?: string } = {}) {
    super(`AI request failed: ${kind}`);
    this.name = 'AiRequestError';
    this.kind = kind;
    this.status = options.status;
    this.detail = options.detail;
  }
}

/** `true` when a failure comes from the caller giving up (the signal, or a request that said so): nothing to tell the user. */
export function wasCancelled(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof AiRequestError && error.kind === 'cancelled');
}
