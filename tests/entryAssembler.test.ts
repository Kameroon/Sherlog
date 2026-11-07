// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createEntryAssembler } from '../src/core/entryAssembler';
import type { EntryAssemblerOptions, LogEntry } from '../src/core/entryAssembler';
import { createLineSplitter } from '../src/core/lineSplitter';
import { CONSOLE_PROFILE, DEFAULT_PROFILE } from '../src/core/profiles';
import type { LogProfile } from '../src/core/profiles';

function assemble(text: string, profile: LogProfile = DEFAULT_PROFILE, options?: EntryAssemblerOptions): LogEntry[] {
  const splitter = createLineSplitter();
  const assembler = createEntryAssembler(profile, options);
  const entries: LogEntry[] = [];
  const bytes = new TextEncoder().encode(text);
  const lines = [...splitter.push(bytes), ...splitter.finish()];
  for (const line of lines) {
    const completed = assembler.push(line);
    if (completed !== null) {
      entries.push(completed);
    }
  }
  const last = assembler.finish();
  if (last !== null) {
    entries.push(last);
  }
  return entries;
}

const withError = [
  '2026-11-04 08:00:00.000 +01:00 [INF] Started',
  '2026-11-04 08:16:10.332 +01:00 [ERR] Timeout after 30012 ms',
  'System.TimeoutException: The operation has timed out.',
  '   at Shop.Payments.GatewayClient.ChargeAsync(Order order) in /src/GatewayClient.cs:line 87',
  '2026-11-04 08:21:03.778 +01:00 [WRN] Slow query',
].join('\n');

describe('createEntryAssembler', () => {
  it('should start one entry per header line when every line is a header', () => {
    // Act
    const entries = assemble('2026-11-04 08:00:00.000 +01:00 [INF] a\n2026-11-04 08:00:01.000 +01:00 [WRN] b\n');

    // Assert
    expect(entries.map((entry) => [entry.timestamp, entry.level, entry.firstLine, entry.lineCount])).toEqual([
      ['2026-11-04 08:00:00.000 +01:00', 'INF', '2026-11-04 08:00:00.000 +01:00 [INF] a', 1],
      ['2026-11-04 08:00:01.000 +01:00', 'WRN', '2026-11-04 08:00:01.000 +01:00 [WRN] b', 1],
    ]);
  });

  it('should attach the lines that follow a header to that entry when they are not headers', () => {
    // Act
    const entries = assemble(withError);

    // Assert
    expect(entries[1]).toMatchObject({
      level: 'ERR',
      lineCount: 3,
      text: [
        '2026-11-04 08:16:10.332 +01:00 [ERR] Timeout after 30012 ms',
        'System.TimeoutException: The operation has timed out.',
        '   at Shop.Payments.GatewayClient.ChargeAsync(Order order) in /src/GatewayClient.cs:line 87',
      ].join('\n'),
    });
  });

  it('should keep a date-like line inside the entry when its level is not a known one', () => {
    // Arrange
    const text = [
      '2026-11-04 08:01:10.100 +01:00 [ERR] Import failed',
      '2026-11-04 08:01:10 Something went wrong on row 12',
      '2026-11-04 08:02:00.200 +01:00 [WRN] Next',
    ].join('\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries.map((entry) => entry.lineCount)).toEqual([2, 1]);
  });

  it('should return an entry only when the next header arrives, and the last one when the input ends', () => {
    // Arrange
    const splitter = createLineSplitter();
    const assembler = createEntryAssembler(DEFAULT_PROFILE);
    const lines = [
      ...splitter.push(new TextEncoder().encode('2026-11-04 08:00:00.000 +01:00 [INF] a\n2026-11-04 08:00:01.000 +01:00 [INF] b\n')),
      ...splitter.finish(),
    ];

    // Act
    const results = [...lines.map((line) => assembler.push(line)), assembler.finish()];

    // Assert
    expect(results.map((entry) => entry?.firstLine.slice(-1) ?? null)).toEqual([null, 'a', 'b']);
  });

  it('should return no entry when the input is empty', () => {
    // Act
    const entries = assemble('');

    // Assert
    expect(entries).toEqual([]);
  });

  it('should build an entry without a level when lines come before the first header', () => {
    // Arrange
    const text = ['preamble line', '2026-11-04 08:00:00.000 +01:00 [ERR] Failed'].join('\n');

    // Act
    const entries = assemble(text);

    // Assert
    expect(entries.map((entry) => [entry.level, entry.timestamp, entry.firstLine])).toEqual([
      [null, null, 'preamble line'],
      ['ERR', '2026-11-04 08:00:00.000 +01:00', '2026-11-04 08:00:00.000 +01:00 [ERR] Failed'],
    ]);
  });

  it('should cover the whole input without gaps or overlaps when entries are contiguous', () => {
    // Arrange
    const text = `preamble\n${withError}\n`;
    const totalBytes = new TextEncoder().encode(text).length;

    // Act
    const entries = assemble(text);

    // Assert
    const gaps = entries.map((entry, index) => entry.offset + entry.length - (entries[index + 1]?.offset ?? totalBytes));
    expect(gaps.every((gap) => gap === 0) && entries[0]?.offset === 0).toBe(true);
  });

  it('should read the time and level when the profile is the console one', () => {
    // Act
    const entries = assemble('[08:16:10 ERR] Timeout\nSystem.TimeoutException: timed out\n[08:21:03 WRN] Slow\n', CONSOLE_PROFILE);

    // Assert
    expect(entries.map((entry) => [entry.timestamp, entry.level, entry.lineCount])).toEqual([
      ['08:16:10', 'ERR', 2],
      ['08:21:03', 'WRN', 1],
    ]);
  });

  it('should keep the beginning of the entry, flag it and keep its exact size when it exceeds the limit', () => {
    // Arrange
    const header = '2026-11-04 08:00:00.000 +01:00 [ERR] Failed';
    const stack = Array.from({ length: 10 }, (_, index) => `   at Frame${index}.Run()`);
    const text = [header, ...stack, '2026-11-04 08:00:01.000 +01:00 [INF] Next'].join('\n');
    const failedBytes = new TextEncoder().encode([header, ...stack].join('\n') + '\n').length;

    // Act
    const entries = assemble(text, DEFAULT_PROFILE, { maxRetainedBytes: 100 });

    // Assert
    expect(entries[0]).toMatchObject({ truncated: true, lineCount: 11, length: failedBytes });
    expect(entries[0]?.text.startsWith(header)).toBe(true);
    expect(entries[0]?.text.split('\n').length).toBeLessThan(11);
  });

  it('should keep the header line even when it alone exceeds the limit', () => {
    // Act
    const entries = assemble('2026-11-04 08:00:00.000 +01:00 [ERR] Failed\n   at Frame.Run()\n', DEFAULT_PROFILE, { maxRetainedBytes: 10 });

    // Assert
    expect(entries[0]).toMatchObject({ level: 'ERR', firstLine: '2026-11-04 08:00:00.000 +01:00 [ERR] Failed', truncated: true });
  });

  it('should not flag an entry that fits in the limit', () => {
    // Act
    const entries = assemble(withError);

    // Assert
    expect(entries.every((entry) => !entry.truncated)).toBe(true);
  });

  it('should flag the entry when one of its lines was already cut by the line splitter', () => {
    // Arrange
    const splitter = createLineSplitter({ maxRetainedBytes: 50 });
    const assembler = createEntryAssembler(DEFAULT_PROFILE);
    const bytes = new TextEncoder().encode('2026-11-04 08:00:00.000 +01:00 [ERR] A very long message that gets cut\n');
    const lines = [...splitter.push(bytes), ...splitter.finish()];

    // Act
    lines.forEach((line) => assembler.push(line));
    const entry = assembler.finish();

    // Assert
    expect(entry).toMatchObject({ level: 'ERR', truncated: true });
  });
});
