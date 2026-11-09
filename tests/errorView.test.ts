// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_ERROR_VIEW, buildErrorView, distinctLevels } from '../src/core/errorView';
import type { ErrorViewOptions } from '../src/core/errorView';
import { summariseIdentical } from '../src/core/identicalErrors';
import type { ErrorRecord } from '../src/core/scanLog';

const record = (offset: number, overrides: Partial<ErrorRecord> = {}): ErrorRecord => ({
  offset,
  length: 10,
  timestamp: null,
  level: 'ERR',
  message: `failure ${offset}`,
  messageCut: false,
  lineCount: 1,
  fingerprintId: offset,
  ...overrides,
});

const view = (records: readonly ErrorRecord[], options: Partial<ErrorViewOptions> = {}): readonly number[] =>
  buildErrorView(records, summariseIdentical(records), { ...DEFAULT_ERROR_VIEW, ...options });

describe('buildErrorView', () => {
  it('should keep every error in reading order when no option is set', () => {
    // Arrange
    const records = [record(0), record(1), record(2)];

    // Act
    const indices = view(records);

    // Assert
    expect(indices).toEqual([0, 1, 2]);
  });

  it('should reverse the reading order when the direction is descending', () => {
    // Arrange
    const records = [record(0), record(1), record(2)];

    // Act
    const indices = view(records, { sortKey: 'reading', direction: 'desc' });

    // Assert
    expect(indices).toEqual([2, 1, 0]);
  });

  describe('search', () => {
    it('should keep the errors whose message contains the text, whatever the case', () => {
      // Arrange
      const records = [record(0, { message: 'Timeout calling Payments' }), record(1, { message: 'Disk full' }), record(2, { message: 'payments refused' })];

      // Act
      const indices = view(records, { search: 'PAYMENTS' });

      // Assert
      expect(indices).toEqual([0, 2]);
    });

    it('should keep the errors whose timestamp contains the text', () => {
      // Arrange
      const records = [record(0, { timestamp: '2026-11-04 08:01:10' }), record(1, { timestamp: '2026-11-04 09:30:00' })];

      // Act
      const indices = view(records, { search: '09:30' });

      // Assert
      expect(indices).toEqual([1]);
    });

    it('should keep the errors whose level contains the text', () => {
      // Arrange
      const records = [record(0, { level: 'ERR' }), record(1, { level: 'FTL' })];

      // Act
      const indices = view(records, { search: 'ftl' });

      // Assert
      expect(indices).toEqual([1]);
    });

    it('should ignore the spaces around the text', () => {
      // Arrange
      const records = [record(0, { message: 'Disk full' }), record(1, { message: 'Timeout' })];

      // Act
      const indices = view(records, { search: '  disk  ' });

      // Assert
      expect(indices).toEqual([0]);
    });

    it('should keep every error when the text is only spaces', () => {
      // Arrange
      const records = [record(0), record(1)];

      // Act
      const indices = view(records, { search: '   ' });

      // Assert
      expect(indices).toEqual([0, 1]);
    });

    it('should keep nothing when no error contains the text', () => {
      // Arrange
      const records = [record(0, { message: 'Disk full' })];

      // Act
      const indices = view(records, { search: 'timeout' });

      // Assert
      expect(indices).toEqual([]);
    });

    it('should not find a text that only the full stack contains', () => {
      // Arrange: only the head message is held in memory (SPEC §3), the stack is read on demand.
      const records = [record(0, { message: 'Unhandled exception', messageCut: true })];

      // Act
      const indices = view(records, { search: 'NullReferenceException' });

      // Assert
      expect(indices).toEqual([]);
    });
  });

  describe('level filter', () => {
    it('should keep only the errors of the chosen level, as written', () => {
      // Arrange
      const records = [record(0, { level: 'ERR' }), record(1, { level: 'FTL' }), record(2, { level: 'ERR' })];

      // Act
      const indices = view(records, { level: 'FTL' });

      // Assert
      expect(indices).toEqual([1]);
    });

    it('should combine with the search', () => {
      // Arrange
      const records = [record(0, { level: 'ERR', message: 'disk' }), record(1, { level: 'FTL', message: 'disk' }), record(2, { level: 'FTL', message: 'network' })];

      // Act
      const indices = view(records, { level: 'FTL', search: 'disk' });

      // Assert
      expect(indices).toEqual([1]);
    });
  });

  describe('sort by time', () => {
    it('should put the oldest first when ascending, from a time of day', () => {
      // Arrange
      const records = [record(0, { timestamp: '10:00:00' }), record(1, { timestamp: '08:00:00' }), record(2, { timestamp: '09:00:00' })];

      // Act
      const indices = view(records, { sortKey: 'time', direction: 'asc' });

      // Assert
      expect(indices).toEqual([1, 2, 0]);
    });

    it('should compare the date, then the time, then the fraction of second, as written', () => {
      // Arrange
      const records = [
        record(0, { timestamp: '2026-11-05 08:00:00.100 +01:00' }),
        record(1, { timestamp: '2026-11-04 23:59:59.900 +01:00' }),
        record(2, { timestamp: '2026-11-05 08:00:00.050 +01:00' }),
      ];

      // Act
      const indices = view(records, { sortKey: 'time', direction: 'asc' });

      // Assert
      expect(indices).toEqual([1, 2, 0]);
    });

    it('should put the newest first when descending', () => {
      // Arrange
      const records = [record(0, { timestamp: '08:00:00' }), record(1, { timestamp: '10:00:00' })];

      // Act
      const indices = view(records, { sortKey: 'time', direction: 'desc' });

      // Assert
      expect(indices).toEqual([1, 0]);
    });

    it('should keep the errors without a usable time at the end, in both directions', () => {
      // Arrange
      const records = [record(0, { timestamp: null }), record(1, { timestamp: '10:00:00' }), record(2, { timestamp: 'not a time' }), record(3, { timestamp: '08:00:00' })];

      // Act
      const ascending = view(records, { sortKey: 'time', direction: 'asc' });
      const descending = view(records, { sortKey: 'time', direction: 'desc' });

      // Assert
      expect({ ascending, descending }).toEqual({ ascending: [3, 1, 0, 2], descending: [1, 3, 0, 2] });
    });

    it('should keep the reading order between errors of the same time', () => {
      // Arrange
      const records = [record(0, { timestamp: '08:00:00' }), record(1, { timestamp: '08:00:00' }), record(2, { timestamp: '07:00:00' })];

      // Act
      const indices = view(records, { sortKey: 'time', direction: 'asc' });

      // Assert
      expect(indices).toEqual([2, 0, 1]);
    });
  });

  describe('sort by severity', () => {
    it('should put the fatal errors first when descending, whatever the case or the spelling', () => {
      // Arrange
      const records = [record(0, { level: 'ERR' }), record(1, { level: 'ftl' }), record(2, { level: 'ERROR' }), record(3, { level: 'CRITICAL' }), record(4, { level: 'FATAL' })];

      // Act
      const indices = view(records, { sortKey: 'severity', direction: 'desc' });

      // Assert
      expect(indices).toEqual([1, 3, 4, 0, 2]);
    });

    it('should put the fatal errors last when ascending', () => {
      // Arrange
      const records = [record(0, { level: 'FTL' }), record(1, { level: 'ERR' })];

      // Act
      const indices = view(records, { sortKey: 'severity', direction: 'asc' });

      // Assert
      expect(indices).toEqual([1, 0]);
    });
  });

  describe('sort by count', () => {
    it('should put the errors repeated most often first when descending', () => {
      // Arrange: fingerprint 5 has three errors, fingerprint 6 one, fingerprint 7 two.
      const records = [record(0, { fingerprintId: 6 }), record(1, { fingerprintId: 5 }), record(2, { fingerprintId: 7 }), record(3, { fingerprintId: 5 }), record(4, { fingerprintId: 7 }), record(5, { fingerprintId: 5 })];

      // Act
      const indices = view(records, { sortKey: 'count', direction: 'desc' });

      // Assert
      expect(indices).toEqual([1, 3, 5, 2, 4, 0]);
    });

    it('should put the errors that are alone first when ascending', () => {
      // Arrange
      const records = [record(0, { fingerprintId: 1 }), record(1, { fingerprintId: 2 }), record(2, { fingerprintId: 1 })];

      // Act
      const indices = view(records, { sortKey: 'count', direction: 'asc' });

      // Assert
      expect(indices).toEqual([1, 0, 2]);
    });
  });

  it('should filter before it sorts, and give positions in the whole list of records', () => {
    // Arrange
    const records = [record(0, { level: 'ERR', timestamp: '10:00:00' }), record(1, { level: 'FTL', timestamp: '09:00:00' }), record(2, { level: 'ERR', timestamp: '08:00:00' })];

    // Act
    const indices = view(records, { level: 'ERR', sortKey: 'time', direction: 'asc' });

    // Assert
    expect(indices).toEqual([2, 0]);
  });

  it('should not change the records it is given', () => {
    // Arrange
    const records = [record(0, { timestamp: '10:00:00' }), record(1, { timestamp: '08:00:00' })];
    const before = records.map((entry) => entry.offset);

    // Act
    view(records, { sortKey: 'time', direction: 'asc' });

    // Assert
    expect(records.map((entry) => entry.offset)).toEqual(before);
  });
});

describe('distinctLevels', () => {
  it('should give each level once, as written, in the order they first appear', () => {
    // Arrange
    const records = [record(0, { level: 'ERR' }), record(1, { level: 'FTL' }), record(2, { level: 'ERR' }), record(3, { level: 'err' })];

    // Act
    const levels = distinctLevels(records);

    // Assert
    expect(levels).toEqual(['ERR', 'FTL', 'err']);
  });

  it('should give nothing for no error', () => {
    // Act
    const levels = distinctLevels([]);

    // Assert
    expect(levels).toEqual([]);
  });
});
