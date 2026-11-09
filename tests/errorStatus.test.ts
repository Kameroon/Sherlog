// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NO_STATUSES, statusOf, withAnalysis, withStatus } from '../src/core/errorStatus';

describe('statusOf', () => {
  it('should be new for an error that nobody has set a status for', () => {
    // Act
    const status = statusOf(NO_STATUSES, 4);

    // Assert
    expect(status).toBe('new');
  });

  it('should give the status that was set for the fingerprint', () => {
    // Arrange
    const statuses = withStatus(NO_STATUSES, 4, 'resolved');

    // Act
    const status = statusOf(statuses, 4);

    // Assert
    expect(status).toBe('resolved');
  });
});

describe('withStatus', () => {
  it('should leave the other fingerprints as they were', () => {
    // Arrange
    const statuses = withStatus(withStatus(NO_STATUSES, 1, 'ignored'), 2, 'resolved');

    // Act
    const next = withStatus(statuses, 2, 'ignored');

    // Assert
    expect([statusOf(next, 1), statusOf(next, 2), statusOf(next, 3)]).toEqual(['ignored', 'ignored', 'new']);
  });

  it('should not change the statuses it is given', () => {
    // Arrange
    const statuses = withStatus(NO_STATUSES, 1, 'ignored');

    // Act
    withStatus(statuses, 1, 'resolved');

    // Assert
    expect(statusOf(statuses, 1)).toBe('ignored');
  });

  it('should forget the fingerprint when the status goes back to new, so that nothing is kept for nothing', () => {
    // Arrange
    const statuses = withStatus(NO_STATUSES, 1, 'resolved');

    // Act
    const next = withStatus(statuses, 1, 'new');

    // Assert
    expect(next.size).toBe(0);
  });
});

describe('withAnalysis', () => {
  it('should mark a new error as analysed', () => {
    // Act
    const statuses = withAnalysis(NO_STATUSES, 7);

    // Assert
    expect(statusOf(statuses, 7)).toBe('analysed');
  });

  it.each(['ignored', 'resolved'] as const)('should keep the decision of the user when the error is %s', (status) => {
    // Arrange
    const decided = withStatus(NO_STATUSES, 7, status);

    // Act
    const statuses = withAnalysis(decided, 7);

    // Assert
    expect(statusOf(statuses, 7)).toBe(status);
  });

  it('should not change the other errors, nor the map it was given', () => {
    // Arrange
    const before = withStatus(NO_STATUSES, 1, 'resolved');

    // Act
    const after = withAnalysis(before, 2);

    // Assert
    expect(statusOf(after, 1)).toBe('resolved');
    expect(statusOf(before, 2)).toBe('new');
    expect(after).not.toBe(before);
  });
});
