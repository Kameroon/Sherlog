import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAsyncRead } from '../src/ui/useAsyncRead';

/** A read the test ends by hand, so that the order in which reads end can be chosen. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('useAsyncRead', () => {
  it('should be loading until the read ends, then give what it read', async () => {
    // Arrange
    const read = deferred<string>();
    const load = () => read.promise;

    // Act
    const { result } = renderHook(() => useAsyncRead(load));

    // Assert
    expect(result.current).toEqual({ status: 'loading' });
    await act(async () => {
      read.resolve('text');
      await read.promise;
    });
    expect(result.current).toEqual({ status: 'done', value: 'text' });
  });

  it('should say why the read failed, without keeping the error itself', async () => {
    // Arrange
    const load = () => Promise.reject(new DOMException('gone', 'NotFoundError'));

    // Act
    const { result } = renderHook(() => useAsyncRead(load));

    // Assert
    await waitFor(() => {
      expect(result.current.status).toBe('failed');
    });
    expect(result.current).toEqual({ status: 'failed', message: expect.stringContaining('Le fichier a été modifié, déplacé') as string });
  });

  it('should drop the answer of an earlier read once the read has changed', async () => {
    // Arrange
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(({ load }) => useAsyncRead(load), { initialProps: { load: () => first.promise } });
    rerender({ load: () => second.promise });

    // Act: the second read ends first, then the first one, late.
    await act(async () => {
      second.resolve('second');
      await second.promise;
    });
    await act(async () => {
      first.resolve('first');
      await first.promise;
    });

    // Assert
    expect(result.current).toEqual({ status: 'done', value: 'second' });
  });

  it('should drop the failure of an earlier read once the read has changed', async () => {
    // Arrange
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(({ load }) => useAsyncRead(load), { initialProps: { load: () => first.promise } });
    rerender({ load: () => second.promise });

    // Act
    await act(async () => {
      second.resolve('second');
      await second.promise;
    });
    await act(async () => {
      first.reject(new Error('late'));
      await first.promise.catch(() => undefined);
    });

    // Assert
    expect(result.current).toEqual({ status: 'done', value: 'second' });
  });
});
