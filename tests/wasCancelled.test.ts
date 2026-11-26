import { describe, expect, it } from 'vitest';
import { AiRequestError, wasCancelled } from '../src/ai/errors';

describe('wasCancelled', () => {
  it('should be true when the signal was aborted, whatever the error is', () => {
    // Arrange
    const controller = new AbortController();
    controller.abort();

    // Act / Assert
    expect(wasCancelled(new Error('network down'), controller.signal)).toBe(true);
  });

  it('should be true for a request that said it was cancelled, even if the signal was not aborted', () => {
    // Act / Assert
    expect(wasCancelled(new AiRequestError('cancelled'), new AbortController().signal)).toBe(true);
  });

  it('should be false for a real failure while the signal is still live', () => {
    // Act / Assert
    expect(wasCancelled(new AiRequestError('network'), new AbortController().signal)).toBe(false);
    expect(wasCancelled(new Error('boom'), new AbortController().signal)).toBe(false);
  });
});
