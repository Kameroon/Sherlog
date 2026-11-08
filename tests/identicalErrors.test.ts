// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summariseIdentical } from '../src/core/identicalErrors';
import type { ErrorRecord } from '../src/core/scanLog';

const record = (offset: number, fingerprintId: number, timestamp: string | null = null): ErrorRecord => ({
  offset,
  length: 10,
  timestamp,
  level: 'ERR',
  message: `error at ${offset}`,
  messageCut: false,
  lineCount: 1,
  fingerprintId,
});

describe('summariseIdentical', () => {
  it('should give nothing for no error', () => {
    // Act
    const groups = summariseIdentical([]);

    // Assert
    expect(groups.size).toBe(0);
  });

  it('should count the errors that share a fingerprint', () => {
    // Arrange
    const records = [record(0, 0), record(10, 1), record(20, 0), record(30, 0)];

    // Act
    const groups = summariseIdentical(records);

    // Assert
    expect([groups.get(0)?.count, groups.get(1)?.count]).toEqual([3, 1]);
  });

  it('should give the first and the last error of a group in reading order', () => {
    // Arrange
    const records = [record(0, 0, '08:00:00'), record(10, 1), record(20, 0, '09:00:00'), record(30, 0, '10:00:00')];

    // Act
    const group = summariseIdentical(records).get(0);

    // Assert
    expect({ first: group?.first.offset, last: group?.last.offset }).toEqual({ first: 0, last: 30 });
  });

  it('should have a group of one whose first and last error are the same one', () => {
    // Act
    const group = summariseIdentical([record(5, 7)]).get(7);

    // Assert
    expect({ count: group?.count, first: group?.first.offset, last: group?.last.offset }).toEqual({ count: 1, first: 5, last: 5 });
  });

  it('should not keep the order of the timestamps, only the order of reading', () => {
    // Arrange: the log is not in time order; "last" is still the last one read.
    const records = [record(0, 0, '10:00:00'), record(10, 0, '08:00:00')];

    // Act
    const group = summariseIdentical(records).get(0);

    // Assert
    expect({ first: group?.first.timestamp, last: group?.last.timestamp }).toEqual({ first: '10:00:00', last: '08:00:00' });
  });

  it('should handle a hundred thousand errors in one pass', () => {
    // Arrange
    const records = Array.from({ length: 100_000 }, (_, index) => record(index * 10, index % 7));

    // Act
    const groups = summariseIdentical(records);

    // Assert
    expect([...groups.values()].reduce((total, group) => total + group.count, 0)).toBe(100_000);
  });
});
