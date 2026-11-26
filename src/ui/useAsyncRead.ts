import { useEffect, useState } from 'react';
import { readFailureMessage } from '../sources/readFailure';

/** What a panel shows of a read of the log: the read in progress, what it gave, or why it could not be done. */
export type AsyncRead<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'done'; readonly value: T }
  | { readonly status: 'failed'; readonly message: string };

/**
 * Runs `read` when the panel appears, and again when `read` changes (give it a stable identity, with `useCallback`).
 * An answer that comes after the panel went away, or after `read` changed, is dropped: the user may select another
 * error before a read ends.
 */
export function useAsyncRead<T>(read: () => Promise<T>): AsyncRead<T> {
  const [state, setState] = useState<AsyncRead<T>>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    read().then(
      (value) => {
        if (current) {
          setState({ status: 'done', value });
        }
      },
      (error: unknown) => {
        if (current) {
          setState({ status: 'failed', message: readFailureMessage(error) });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [read]);

  return state;
}
