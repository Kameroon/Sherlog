// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createEntryFilter, EMPTY_PREPARATION } from '../src/core/preparation';
import type { Preparation } from '../src/core/preparation';
import { BUILT_IN_PROFILES, CONSOLE_PROFILE, DEFAULT_PROFILE } from '../src/core/profiles';
import type { LogProfile } from '../src/core/profiles';
import { MAX_PREVIEW_LINES, MAX_PREVIEW_LINE_CHARS, parseHead, previewHead as previewOf } from '../src/core/previewHead';
import { scanLog } from '../src/core/scanLog';
import { parseBytes } from './helpers/parseLog';
import { inBlocks, readSample, utf8 } from './helpers/samples';

const preparationOf = (...ignoreTexts: string[]): Preparation => ({ ...EMPTY_PREPARATION, ignoreTexts });
const previewHead = (bytes: Uint8Array, profile: LogProfile, preparation: Preparation) => previewOf(parseHead(bytes, profile), preparation);

describe('previewHead counters', () => {
  it('should count every entry as ready when nothing is left out', () => {
    // Act
    const { counts } = previewHead(utf8(readSample('real-serilog.log')), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(counts).toEqual({ read: 21, ignored: 0, ignoredPerRule: [], ignoredByPeriod: 0, ready: 21, errors: 3 });
  });

  it('should count the entries left out by a rule and what remains', () => {
    // Act
    const { counts } = previewHead(utf8(readSample('real-serilog.log')), CONSOLE_PROFILE, preparationOf('/health'));

    // Assert
    expect(counts).toEqual({ read: 21, ignored: 15, ignoredPerRule: [15], ignoredByPeriod: 0, ready: 6, errors: 0 });
  });

  it('should count nothing for an empty text', () => {
    // Act
    const preview = previewHead(new Uint8Array(), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(preview).toMatchObject({ counts: { read: 0, ignored: 0, ready: 0, errors: 0 }, lines: [], totalLines: 0, orphanLines: 0 });
  });

  const references: { file: string; profile: LogProfile }[] = [
    { file: 'sample.log', profile: DEFAULT_PROFILE },
    { file: 'serilog-realistic.log', profile: DEFAULT_PROFILE },
    { file: 'serilog-console.log', profile: CONSOLE_PROFILE },
    { file: 'serilog-pieges.log', profile: DEFAULT_PROFILE },
    { file: 'real-serilog.log', profile: CONSOLE_PROFILE },
  ];

  // The preview and the scan are two ways of counting the same thing: they must never drift apart.
  it.each(references)('should give the same counters as the scan when the head is the whole of $file', async ({ file, profile }) => {
    // Arrange
    const bytes = utf8(readSample(file));
    const preparation = preparationOf('health', 'timeout', 'exception');

    // Act
    const { counts } = previewHead(bytes, profile, preparation);
    const scanned = await scanLog(inBlocks(bytes, 7), { profile, filter: createEntryFilter(preparation) }, { onErrors: () => undefined, onProgress: () => undefined });

    // Assert
    expect(counts).toEqual({
      read: scanned.entries,
      ignored: scanned.ignored,
      ignoredPerRule: scanned.ignoredPerRule,
      ignoredByPeriod: 0,
      ready: scanned.entries - scanned.ignored,
      errors: scanned.errors,
    });
  });

  // The middle entry of each sample gives an end bound that really cuts the log (a time of day, or a date with a time).
  it.each(references)('should give the same counters as the scan when a period cuts $file', async ({ file, profile }) => {
    // Arrange
    const bytes = utf8(readSample(file));
    const timestamps = parseBytes(bytes, bytes.length, profile).entries.flatMap((entry) => (entry.timestamp === null ? [] : [entry.timestamp]));
    const middle = timestamps[Math.floor(timestamps.length / 2)] ?? '';
    const to = profile.limited ? middle.slice(0, 5) : `${middle.slice(0, 10)}T${middle.slice(11, 16)}`;
    const preparation: Preparation = { ...preparationOf('health'), period: { from: '', to } };

    // Act
    const { counts } = previewHead(bytes, profile, preparation);
    const scanned = await scanLog(inBlocks(bytes, 7), { profile, filter: createEntryFilter(preparation) }, { onErrors: () => undefined, onProgress: () => undefined });

    // Assert
    expect(counts).toEqual({
      read: scanned.entries,
      ignored: scanned.ignored,
      ignoredPerRule: scanned.ignoredPerRule,
      ignoredByPeriod: scanned.ignoredByPeriod,
      ready: scanned.entries - scanned.ignored,
      errors: scanned.errors,
    });
    expect(scanned.ignoredByPeriod).toBeGreaterThan(0);
  });

  it('should have a profile for every sample it is compared on', () => {
    // Assert: guards the table above against a renamed profile.
    expect(references.every(({ profile }) => BUILT_IN_PROFILES.includes(profile))).toBe(true);
  });
});

describe('previewHead headers', () => {
  it('should count the entry headers of the text for the format', () => {
    // Act
    const { headerCount } = previewHead(utf8(readSample('real-serilog.log')), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(headerCount).toBe(21);
  });

  it('should count no header when the text is read with a format that matches none of its lines', () => {
    // Act
    const { headerCount, counts } = previewHead(utf8(readSample('real-serilog.log')), DEFAULT_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect({ headerCount, read: counts.read }).toEqual({ headerCount: 0, read: 1 });
  });

  it('should not count the lines before the first header as headers', () => {
    // Act
    const { headerCount } = previewHead(utf8('Starting up\n[08:16:10 ERR] Failed\n'), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(headerCount).toBe(1);
  });
});

describe('previewHead time range', () => {
  it('should give the first and the last timestamp of the text as they are written', () => {
    // Act
    const { timeRange } = previewHead(utf8(readSample('real-serilog.log')), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(timeRange).toEqual({ first: '12:05:38', last: '12:07:09' });
  });

  it('should give the whole timestamp, date and offset included, when the format has them', () => {
    // Act
    const { timeRange } = previewHead(utf8(readSample('sample.log')), DEFAULT_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(timeRange).toEqual({ first: '2026-11-04 08:12:01.123 +01:00', last: '2026-11-04 10:12:34.100 +01:00' });
  });

  it('should give nothing when no entry has a timestamp', () => {
    // Act
    const { timeRange } = previewHead(utf8('only a line without header\n'), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(timeRange).toBeNull();
  });
});

describe('previewHead excerpt', () => {
  it('should number the lines from one and tell headers from the lines that continue them', () => {
    // Act
    const { lines } = previewHead(utf8(readSample('sample.log')), DEFAULT_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(lines.slice(2, 6).map(({ number, kind, level }) => ({ number, kind, level }))).toEqual([
      { number: 3, kind: 'header', level: 'WRN' },
      { number: 4, kind: 'header', level: 'ERR' },
      { number: 5, kind: 'continuation', level: null },
      { number: 6, kind: 'continuation', level: null },
    ]);
  });

  it('should flag the headers of errors', () => {
    // Act
    const { lines } = previewHead(utf8(readSample('sample.log')), DEFAULT_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(lines.filter((line) => line.isError).map((line) => line.level)).toEqual(['ERR', 'ERR', 'ERR', 'FTL', 'ERR']);
  });

  it('should mark every line of an entry that is left out, its stack included, and no other', () => {
    // Act
    const { lines } = previewHead(utf8(readSample('sample.log')), DEFAULT_PROFILE, preparationOf('timeout'));

    // Assert
    const ignoredNumbers = lines.filter((line) => line.ignored).map((line) => line.number);
    expect(ignoredNumbers).toEqual([4, 5, 6, 7, 9, 10, 11, 12]);
  });

  it('should show only the first lines and say how many there are in all', () => {
    // Arrange
    const many = Array.from({ length: MAX_PREVIEW_LINES + 40 }, (_, index) => `[08:16:10 INF] line ${index}\n`).join('');

    // Act
    const { lines, totalLines } = previewHead(utf8(many), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect({ shown: lines.length, totalLines }).toEqual({ shown: MAX_PREVIEW_LINES, totalLines: MAX_PREVIEW_LINES + 40 });
  });

  it('should cut a very long line and say it was cut, keeping its entry whole for the counters', () => {
    // Arrange
    const long = `[08:16:10 ERR] ${'x'.repeat(1024 * 1024)}\n[08:16:11 INF] Next\n`;

    // Act
    const { lines, counts } = previewHead(utf8(long), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect({ length: lines[0]?.text.length, cut: lines[0]?.cut, read: counts.read, errors: counts.errors }).toEqual({
      length: MAX_PREVIEW_LINE_CHARS,
      cut: true,
      read: 2,
      errors: 1,
    });
  });

  it('should not mark a short line as cut', () => {
    // Act
    const { lines } = previewHead(utf8('[08:16:10 ERR] Failed\n'), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(lines[0]).toMatchObject({ text: '[08:16:10 ERR] Failed', cut: false });
  });

  it('should count the lines before the first header, which no entry header introduces', () => {
    // Act
    const { orphanLines, lines } = previewHead(utf8('Starting up\nsecond line\n[08:16:10 ERR] Failed\n'), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect({ orphanLines, kinds: lines.map((line) => line.kind) }).toEqual({ orphanLines: 2, kinds: ['continuation', 'continuation', 'header'] });
  });

  it('should report no line before the first header when the text starts with one', () => {
    // Act
    const { orphanLines } = previewHead(utf8('[08:16:10 ERR] Failed\n'), CONSOLE_PROFILE, EMPTY_PREPARATION);

    // Assert
    expect(orphanLines).toBe(0);
  });
});

describe('previewHead on a head that was read once', () => {
  it('should give the figures of each preparation from the same reading of the text', () => {
    // Arrange
    const parsed = parseHead(utf8(readSample('real-serilog.log')), CONSOLE_PROFILE);

    // Act
    const none = previewOf(parsed, EMPTY_PREPARATION).counts;
    const health = previewOf(parsed, preparationOf('/health')).counts;
    const noneAgain = previewOf(parsed, EMPTY_PREPARATION).counts;

    // Assert
    expect([none.ignored, health.ignored, noneAgain.ignored]).toEqual([0, 15, 0]);
  });
});
