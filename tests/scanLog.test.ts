// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_KEY_CHARS } from '../src/core/fingerprint';
import { EMPTY_PREPARATION, createEntryFilter } from '../src/core/preparation';
import { scanLog } from '../src/core/scanLog';
import type { ErrorRecord, ScanOptions, ScanResult } from '../src/core/scanLog';
import { MAX_RETAINED_BYTES } from '../src/core/lineSplitter';
import { BUILT_IN_PROFILES, CONSOLE_PROFILE, DEFAULT_PROFILE } from '../src/core/profiles';
import type { LogProfile } from '../src/core/profiles';
import { errorEntries, parseBytes } from './helpers/parseLog';
import { inBlocks, readSample, utf16, utf8 } from './helpers/samples';

interface Scanned {
  readonly result: ScanResult;
  readonly records: readonly ErrorRecord[];
  readonly batches: readonly (readonly ErrorRecord[])[];
  readonly progress: readonly number[];
}

async function scan(
  bytes: Uint8Array,
  profile: LogProfile,
  blockSize = bytes.length,
  options: Partial<ScanOptions> = {},
): Promise<Scanned> {
  const batches: (readonly ErrorRecord[])[] = [];
  const progress: number[] = [];
  const result = await scanLog(inBlocks(bytes, blockSize), { profile, ...options }, {
    onErrors: (records) => batches.push(records),
    onProgress: (bytesRead) => progress.push(bytesRead),
  });
  return { result, records: batches.flat(), batches, progress };
}

const profileOf = (id: string): LogProfile => {
  const profile = BUILT_IN_PROFILES.find((candidate) => candidate.id === id);
  if (profile === undefined) {
    throw new Error(`unknown profile ${id}`);
  }
  return profile;
};

// Same reference results as samples/README.md; `groups` gives the fingerprint id of each error in reading order.
const references = [
  { file: 'sample.log', profile: 'serilog-file', entries: 14, errors: 5, groups: [0, 0, 1, 2, 3] },
  { file: 'serilog-realistic.log', profile: 'serilog-file', entries: 17, errors: 9, groups: [0, 1, 1, 2, 3, 4, 0, 5, 6] },
  { file: 'serilog-console.log', profile: 'serilog-console', entries: 5, errors: 3, groups: [0, 0, 1] },
  { file: 'serilog-pieges.log', profile: 'serilog-file', entries: 7, errors: 5, groups: [0, 1, 1, 2, 2] },
  { file: 'real-serilog.log', profile: 'serilog-console', entries: 21, errors: 3, groups: [0, 0, 0] },
];

describe('scanLog on the reference samples', () => {
  it.each(references)('should count the documented entries and errors when scanning $file', async (reference) => {
    // Act
    const { result } = await scan(utf8(readSample(reference.file)), profileOf(reference.profile));

    // Assert
    expect({ entries: result.entries, errors: result.errors }).toEqual({ entries: reference.entries, errors: reference.errors });
  });

  it.each(references)('should give identical errors the same fingerprint id when scanning $file', async (reference) => {
    // Act
    const { records, result } = await scan(utf8(readSample(reference.file)), profileOf(reference.profile));

    // Assert
    expect(records.map((record) => record.fingerprintId)).toEqual(reference.groups);
    expect(result.fingerprints).toHaveLength(new Set(reference.groups).size);
  });

  it.each(references)('should describe each error like the parser does when scanning $file', async (reference) => {
    // Arrange
    const bytes = utf8(readSample(reference.file));
    const expected = errorEntries(parseBytes(bytes).entries);

    // Act
    const { records } = await scan(bytes, profileOf(reference.profile));

    // Assert
    expect(records.map(({ offset, length, timestamp, level, lineCount }) => ({ offset, length, timestamp, level, lineCount }))).toEqual(
      expected.map(({ offset, length, timestamp, level, lineCount }) => ({ offset, length, timestamp, level, lineCount })),
    );
  });
});

describe('scanLog input variants', () => {
  const original = readSample('serilog-pieges.log');

  it.each([1, 7])('should give the same result when the input comes in blocks of %i bytes', async (blockSize) => {
    // Act
    const whole = await scan(utf8(original), DEFAULT_PROFILE);
    const blocks = await scan(utf8(original), DEFAULT_PROFILE, blockSize);

    // Assert
    expect(blocks.result).toEqual(whole.result);
    expect(blocks.records).toEqual(whole.records);
  });

  const variants: [string, Uint8Array, string][] = [
    ['CRLF line endings', utf8(original.replace(/\n/g, '\r\n')), 'utf-8'],
    ['a UTF-8 byte order mark', Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(original)]), 'utf-8'],
    ['UTF-16 LE', utf16(original, 'le'), 'utf-16le'],
    ['UTF-16 BE', utf16(original, 'be'), 'utf-16be'],
  ];

  it.each(variants)('should find the same entries, errors and fingerprints when the input has %s', async (_label, bytes, encoding) => {
    // Act
    const { result, records } = await scan(bytes, DEFAULT_PROFILE, 5);

    // Assert
    expect({ entries: result.entries, errors: result.errors, groups: records.map((record) => record.fingerprintId), encoding: result.encoding }).toEqual({
      entries: 7,
      errors: 5,
      groups: [0, 1, 1, 2, 2],
      encoding,
    });
  });

  it('should report the number of bytes read when the input ends', async () => {
    // Arrange
    const bytes = utf16(original, 'le');

    // Act
    const { result } = await scan(bytes, DEFAULT_PROFILE, 11);

    // Assert
    expect(result.bytes).toBe(bytes.length);
  });

  it('should count an empty input without any entry and without calling the error callback', async () => {
    // Act
    const { result, batches } = await scan(new Uint8Array(0), DEFAULT_PROFILE);

    // Assert
    expect({ entries: result.entries, errors: result.errors, encoding: result.encoding, batches: batches.length }).toEqual({
      entries: 0,
      errors: 0,
      encoding: null,
      batches: 0,
    });
  });

  it('should count lines before the first header as an entry that is not an error', async () => {
    // Act
    const { result } = await scan(utf8('Preamble line\n[08:16:10 ERR] Failed\n'), CONSOLE_PROFILE);

    // Assert
    expect({ entries: result.entries, errors: result.errors }).toEqual({ entries: 2, errors: 1 });
  });
});

describe('scanLog progress and batches', () => {
  it('should report a growing number of bytes ending at the size of the input when blocks are read', async () => {
    // Arrange
    const bytes = utf8(readSample('serilog-realistic.log'));

    // Act
    const { progress } = await scan(bytes, DEFAULT_PROFILE, 100);

    // Assert
    expect(progress.length).toBeGreaterThan(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(bytes.length);
  });

  it('should send the errors in batches of at most the batch size, in reading order', async () => {
    // Arrange
    const bytes = utf8(readSample('serilog-realistic.log'));

    // Act
    const { batches, records } = await scan(bytes, DEFAULT_PROFILE, bytes.length, { batchSize: 4 });

    // Assert
    expect(batches.map((batch) => batch.length)).toEqual([4, 4, 1]);
    expect(records.map((record) => record.offset)).toEqual([...records.map((record) => record.offset)].sort((a, b) => a - b));
  });
});

describe('scanLog limits', () => {
  it('should keep counting the errors but record only the first ones when the record limit is reached', async () => {
    // Arrange
    const bytes = utf8(readSample('serilog-realistic.log'));

    // Act
    const { result, records } = await scan(bytes, DEFAULT_PROFILE, bytes.length, { maxErrorRecords: 3 });

    // Assert
    expect({ errors: result.errors, recorded: records.length, limitReached: result.limitReached }).toEqual({
      errors: 9,
      recorded: 3,
      limitReached: true,
    });
  });

  it('should not report a limit when every error fits', async () => {
    // Act
    const { result } = await scan(utf8(readSample('serilog-realistic.log')), DEFAULT_PROFILE, undefined, { maxErrorRecords: 9 });

    // Assert
    expect(result.limitReached).toBe(false);
  });

  it('should cut a long first line for display and say so when the line exceeds the display limit', async () => {
    // Act
    const { records } = await scan(utf8(`[08:16:10 ERR] ${'x'.repeat(40)}\n[08:16:11 ERR] short\n`), CONSOLE_PROFILE, undefined, {
      maxFirstLineChars: 20,
    });

    // Assert
    expect(records.map(({ firstLine, firstLineCut }) => ({ length: firstLine.length, firstLineCut }))).toEqual([
      { length: 20, firstLineCut: true },
      { length: '[08:16:11 ERR] short'.length, firstLineCut: false },
    ]);
  });

  it('should not split a surrogate pair when the cut falls in the middle of a character', async () => {
    // Arrange: the emoji (two UTF-16 units) starts at index 15, the last index before the limit of 16.
    const bytes = utf8('[08:16:10 ERR] 😀 broken\n');

    // Act
    const { records } = await scan(bytes, CONSOLE_PROFILE, undefined, { maxFirstLineChars: 16 });

    // Assert
    expect(records[0]).toMatchObject({ firstLine: '[08:16:10 ERR] ', firstLineCut: true });
  });

  it('should keep each fingerprint key short when the error lines are very long', async () => {
    // Arrange
    const lines = ['a', 'b', 'c'].map((letter) => `[08:16:10 ERR] ${letter}${'x'.repeat(100_000)}\n`).join('');

    // Act
    const { result } = await scan(utf8(lines), CONSOLE_PROFILE);

    // Assert
    expect(result.fingerprints).toHaveLength(3);
    expect(result.fingerprints.every((key) => key.length <= MAX_MESSAGE_KEY_CHARS + 'ERR\n\n'.length)).toBe(true);
  });

  it('should count the entries whose text was too long to keep as truncated', async () => {
    // Arrange
    const longLine = 'y'.repeat(MAX_RETAINED_BYTES + 1024);

    // Act
    const { result } = await scan(utf8(`[08:16:10 ERR] Failed\n${longLine}\n[08:16:11 INF] Next\n`), CONSOLE_PROFILE, 64 * 1024);

    // Assert
    expect({ entries: result.entries, truncatedEntries: result.truncatedEntries }).toEqual({ entries: 2, truncatedEntries: 1 });
  });
});

describe('scanLog with entries left out by the user', () => {
  const scanWithout = (bytes: Uint8Array, profile: LogProfile, ignoreTexts: string[], blockSize = bytes.length, options: Partial<ScanOptions> = {}) =>
    scan(bytes, profile, blockSize, { ...options, filter: createEntryFilter({ ...EMPTY_PREPARATION, ignoreTexts }) });

  it('should leave out the 15 of 21 entries of the real sample that mention /health so that no error remains', async () => {
    // Act
    const { result, records } = await scanWithout(utf8(readSample('real-serilog.log')), CONSOLE_PROFILE, ['/health']);

    // Assert
    expect({ entries: result.entries, ignored: result.ignored, ignoredPerRule: result.ignoredPerRule, errors: result.errors }).toEqual({
      entries: 21,
      ignored: 15,
      ignoredPerRule: [15],
      errors: 0,
    });
    expect({ records: records.length, fingerprints: result.fingerprints }).toEqual({ records: 0, fingerprints: [] });
  });

  it('should not count an ignored error and keep the other errors', async () => {
    // Act
    const { result, records } = await scanWithout(utf8(readSample('sample.log')), DEFAULT_PROFILE, ['timeout']);

    // Assert
    expect({ entries: result.entries, ignored: result.ignored, errors: result.errors, recorded: records.length }).toEqual({
      entries: 14,
      ignored: 2,
      errors: 3,
      recorded: 3,
    });
  });

  it('should leave the errors alone when the ignored entries are not errors', async () => {
    // Act
    const { result } = await scanWithout(utf8(readSample('sample.log')), DEFAULT_PROFILE, ['health check']);

    // Assert
    expect({ ignored: result.ignored, errors: result.errors }).toEqual({ ignored: 1, errors: 5 });
  });

  it('should give the same result whatever the size of the blocks it reads', async () => {
    // Arrange
    const bytes = utf8(readSample('sample.log'));

    // Act
    const whole = await scanWithout(bytes, DEFAULT_PROFILE, ['timeout', 'sql']);
    const byte = await scanWithout(bytes, DEFAULT_PROFILE, ['timeout', 'sql'], 1);
    const seven = await scanWithout(bytes, DEFAULT_PROFILE, ['timeout', 'sql'], 7);

    // Assert
    expect(byte.result).toEqual(whole.result);
    expect(seven.result).toEqual(whole.result);
    expect(seven.records).toEqual(whole.records);
  });

  it('should not spend the record limit on entries that are left out', async () => {
    // Act
    const { result } = await scanWithout(utf8(readSample('sample.log')), DEFAULT_PROFILE, ['timeout'], undefined, { maxErrorRecords: 3 });

    // Assert
    expect({ errors: result.errors, limitReached: result.limitReached }).toEqual({ errors: 3, limitReached: false });
  });

  it('should report nothing left out when there is no filter', async () => {
    // Act
    const { result } = await scan(utf8(readSample('sample.log')), DEFAULT_PROFILE);

    // Assert
    expect({ ignored: result.ignored, ignoredPerRule: result.ignoredPerRule }).toEqual({ ignored: 0, ignoredPerRule: [] });
  });
});

describe('scanLog with a period', () => {
  const realLog = () => utf8(readSample('real-serilog.log'));
  const scanDuring = (from: string, to: string, blockSize?: number) =>
    scan(realLog(), CONSOLE_PROFILE, blockSize, { filter: createEntryFilter({ ...EMPTY_PREPARATION, period: { from, to } }) });

  it('should leave out the entries outside the period and count the errors of the others only', async () => {
    // Act: the sample has 4 entries at 12:05, 14 at 12:06 and 3 at 12:07; 2 of the 3 errors are at 12:06.
    const { result } = await scanDuring('12:06', '12:06');

    // Assert
    expect({ entries: result.entries, ignored: result.ignored, ignoredByPeriod: result.ignoredByPeriod, errors: result.errors }).toEqual({
      entries: 21,
      ignored: 7,
      ignoredByPeriod: 7,
      errors: 2,
    });
  });

  it('should give the same result whatever the size of the blocks it reads', async () => {
    // Act
    const whole = await scanDuring('12:06', '12:06');
    const byte = await scanDuring('12:06', '12:06', 1);

    // Assert
    expect(byte.result).toEqual(whole.result);
  });

  it('should report nothing left out by a period when there is no filter', async () => {
    // Act
    const { result } = await scan(realLog(), CONSOLE_PROFILE);

    // Assert
    expect(result.ignoredByPeriod).toBe(0);
  });
});
