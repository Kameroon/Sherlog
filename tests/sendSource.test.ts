// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IdenticalErrors } from '../src/core/identicalErrors';
import type { ErrorRecord } from '../src/core/scanLog';
import { sendSourceOf } from '../src/ui/sendSource';

const record = (timestamp: string | null): ErrorRecord => ({ offset: 0, length: 10, timestamp, level: 'ERR', message: 'boom', messageCut: false, lineCount: 1, fingerprintId: 3 });
const group = (count: number): IdenticalErrors => ({ count, first: record('08:00:00'), last: record('08:09:00'), firstIndex: 0, lastIndex: 9 });
const lines = { before: ['a', 'b'], after: ['c'], beforeLimited: false, afterLimited: false };

describe('sendSourceOf', () => {
  it('should describe the error that is sent from what was read of the log', () => {
    // Act
    const source = sendSourceOf({ fileName: 'app.log', group: group(4), countIsMinimum: false, entry: { text: 'boom\n  at X', cut: false }, lines });

    // Assert
    expect(source).toEqual({
      fileName: 'app.log',
      count: 4,
      countIsMinimum: false,
      firstSeen: '08:00:00',
      lastSeen: '08:09:00',
      entry: 'boom\n  at X',
      entryReadLimitReached: false,
      before: ['a', 'b'],
      after: ['c'],
    });
  });

  it('should say when the entry was cut by the limit on what is read, and when the count is a minimum', () => {
    // Act
    const source = sendSourceOf({ fileName: 'app.log', group: group(2), countIsMinimum: true, entry: { text: 'x', cut: true }, lines });

    // Assert
    expect(source).toMatchObject({ entryReadLimitReached: true, countIsMinimum: true });
  });

  it('should have no time for an entry without one', () => {
    // Act
    const source = sendSourceOf({ fileName: 'app.log', group: { ...group(1), first: record(null), last: record(null) }, countIsMinimum: false, entry: { text: 'x', cut: false }, lines });

    // Assert
    expect(source).toMatchObject({ firstSeen: null, lastSeen: null });
  });
});
