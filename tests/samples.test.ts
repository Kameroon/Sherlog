// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/core/fingerprint';
import { MAX_RETAINED_BYTES } from '../src/core/lineSplitter';
import { DEFAULT_PROFILE, matchHeader } from '../src/core/profiles';
import { errorEntries, parseBytes } from './helpers/parseLog';
import type { ParsedLog } from './helpers/parseLog';

/** Reads a sample with LF line endings, whatever the checkout converted them to. */
function readSample(name: string): string {
  const path = fileURLToPath(new URL(`../samples/${name}`, import.meta.url));
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function utf16(text: string, order: 'le' | 'be'): Uint8Array {
  const bytes: number[] = order === 'le' ? [0xff, 0xfe] : [0xfe, 0xff];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    bytes.push(...(order === 'le' ? [unit & 0xff, unit >> 8] : [unit >> 8, unit & 0xff]));
  }
  return Uint8Array.from(bytes);
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function summaryOf({ detection, entries }: ParsedLog) {
  return {
    profile: detection.status === 'detected' ? detection.profile.id : detection.status,
    entries: entries.length,
    errors: errorEntries(entries).length,
  };
}

const summarize = (bytes: Uint8Array, chunkSize?: number) => summaryOf(parseBytes(bytes, chunkSize));

// Reference results of samples/README.md (profile, entries and errors; fingerprints are checked further down).
const references = [
  { file: 'sample.log', profile: 'serilog-file', entries: 14, errors: 5 },
  { file: 'serilog-realistic.log', profile: 'serilog-file', entries: 17, errors: 9 },
  { file: 'serilog-console.log', profile: 'serilog-console', entries: 5, errors: 3 },
  { file: 'serilog-pieges.log', profile: 'serilog-file', entries: 7, errors: 5 },
  // The only real sample: a Docker console output, counted by hand before the parser was run on it.
  { file: 'real-serilog.log', profile: 'serilog-console', entries: 21, errors: 3 },
];

describe('reference samples', () => {
  it.each(references)('should find the documented profile, entries and errors when parsing $file', (reference) => {
    // Act
    const result = summarize(utf8(readSample(reference.file)));

    // Assert
    expect(result).toEqual({ profile: reference.profile, entries: reference.entries, errors: reference.errors });
  });

  it('should not recognise any line of the console sample with the default profile', () => {
    // Arrange
    const lines = readSample('serilog-console.log').split('\n').filter((line) => line !== '');

    // Act
    const matching = lines.filter((line) => matchHeader(DEFAULT_PROFILE, line) !== null);

    // Assert
    expect({ total: lines.length, matching: matching.length }).toEqual({ total: 11, matching: 0 });
  });

  it('should keep the date-like lines inside the import entry when parsing the traps sample', () => {
    // Act
    const { entries } = parseBytes(utf8(readSample('serilog-pieges.log')));

    // Assert
    expect(entries[1]).toMatchObject({ level: 'ERR', lineCount: 6 });
    expect(entries[1]?.text).toContain('2026-11-04 08:01:10 Another value on row 13');
  });

  it.each(references)('should keep only ERR and FTL entries when filtering the errors of $file', (reference) => {
    // Act
    const { entries } = parseBytes(utf8(readSample(reference.file)));

    // Assert
    expect(errorEntries(entries).every((entry) => ['ERR', 'FTL'].includes(entry.level ?? ''))).toBe(true);
  });
});

describe('fingerprints of the reference samples', () => {
  /** Index of the first error that has the same fingerprint, for every error in reading order. */
  function groupsOf(file: string): number[] {
    const { detection, entries } = parseBytes(utf8(readSample(file)));
    if (detection.status !== 'detected') {
      throw new Error(`${file}: no profile detected`);
    }
    const keys = errorEntries(entries).map((entry) => fingerprint(entry, detection.profile));
    return keys.map((key) => [...new Set(keys)].indexOf(key));
  }

  // Reference results of samples/README.md ("Empreintes distinctes"); the groups give the detail by error.
  const fingerprintReferences = [
    { file: 'sample.log', distinct: 4, groups: [0, 0, 1, 2, 3] },
    { file: 'serilog-realistic.log', distinct: 7, groups: [0, 1, 1, 2, 3, 4, 0, 5, 6] },
    { file: 'serilog-console.log', distinct: 2, groups: [0, 0, 1] },
    { file: 'serilog-pieges.log', distinct: 3, groups: [0, 1, 1, 2, 2] },
    // The three health-check errors only differ by the correlation GUID written in brackets in the message.
    { file: 'real-serilog.log', distinct: 1, groups: [0, 0, 0] },
  ];

  it.each(fingerprintReferences)('should find $distinct distinct fingerprints when parsing $file', (reference) => {
    // Act
    const groups = groupsOf(reference.file);

    // Assert
    expect(new Set(groups).size).toBe(reference.distinct);
  });

  it.each(fingerprintReferences)('should group the identical errors of $file as documented', (reference) => {
    // Act
    const groups = groupsOf(reference.file);

    // Assert
    expect(groups).toEqual(reference.groups);
  });
});

describe('encoding and line ending variants of the traps sample', () => {
  const original = readSample('serilog-pieges.log');
  const expected = summarize(utf8(original));

  const variants: [string, () => Uint8Array, number?][] = [
    ['CRLF line endings', () => utf8(original.replace(/\n/g, '\r\n'))],
    ['a UTF-8 byte order mark', () => Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(original)])],
    ['UTF-16 LE with a byte order mark', () => utf16(original, 'le')],
    ['UTF-16 BE with a byte order mark', () => utf16(original, 'be')],
    ['blocks of one byte', () => utf8(original), 1],
    ['UTF-16 LE in blocks of one byte', () => utf16(original, 'le'), 1],
    ['blocks of seven bytes with CRLF', () => utf8(original.replace(/\n/g, '\r\n')), 7],
  ];

  it.each(variants)('should give the same profile, entries and errors with %s', (_label, build, chunkSize) => {
    // Act
    const result = summarize(build(), chunkSize);

    // Assert
    expect(result).toEqual(expected);
  });

  it('should give the same result when a continuation line is several megabytes long', () => {
    // Arrange
    const longLine = 'x'.repeat(3 * 1024 * 1024);
    const text = original.replace('Rejected rows:\n', `Rejected rows:\n${longLine}\n`);

    // Act
    const parsed = parseBytes(utf8(text), 64 * 1024);

    // Assert
    expect(summaryOf(parsed)).toEqual(expected);
    expect(parsed.entries[1]).toMatchObject({ truncated: true, lineCount: 7 });
  });

  it('should still read the level when a header line carries several megabytes of message', () => {
    // Arrange
    const longMessage = 'y'.repeat(3 * 1024 * 1024);
    const text = original.replace('Failed to send email to alice@example.com', `Failed ${longMessage}`);

    // Act
    const parsed = parseBytes(utf8(text), 64 * 1024);

    // Assert
    expect(summaryOf(parsed)).toEqual(expected);
    expect(parsed.entries[2]).toMatchObject({ level: 'ERR', truncated: true });
    expect(parsed.entries[2]?.firstLine.length).toBeLessThanOrEqual(MAX_RETAINED_BYTES);
  });
});

describe('positions on the samples', () => {
  const original = readSample('serilog-realistic.log');

  const encodings: [string, Uint8Array, string][] = [
    ['UTF-8', utf8(original), 'utf-8'],
    ['UTF-8 with CRLF', utf8(original.replace(/\n/g, '\r\n')), 'utf-8'],
    ['UTF-16 LE', utf16(original, 'le'), 'utf-16le'],
    ['UTF-16 BE', utf16(original, 'be'), 'utf-16be'],
  ];

  it.each(encodings)('should cover the whole input with the entry lengths when the input is %s', (_label, bytes) => {
    // Act
    const { entries } = parseBytes(bytes, 5);

    // Assert
    expect(entries.reduce((total, entry) => total + entry.length, 0)).toBe(bytes.length);
  });

  it.each(encodings)('should give back the entry text when its bytes are read again, for %s', (_label, bytes, encoding) => {
    // Arrange
    const { entries } = parseBytes(bytes, 5);
    const decoder = new TextDecoder(encoding);

    // Act
    const reread = entries.map((entry) =>
      decoder
        .decode(bytes.subarray(entry.offset, entry.offset + entry.length))
        .replace(/\r\n/g, '\n')
        .replace(/\n$/, ''),
    );

    // Assert
    expect(reread).toEqual(entries.map((entry) => entry.text));
  });
});
