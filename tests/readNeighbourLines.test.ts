// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '../src/core/profiles';
import { scanLog } from '../src/core/scanLog';
import { readNeighbourLines } from '../src/sources/readNeighbourLines';
import { inBlocks, readSample, utf16, utf8 } from './helpers/samples';

const blobOf = (bytes: Uint8Array): Blob => new Blob([bytes as BlobPart]);

/** `line 1` … `line count`, one per line, each ended by `terminator`. */
const numberedLines = (count: number, terminator = '\n'): string[] => Array.from({ length: count }, (_, index) => `line ${index + 1}${terminator}`);

/** Byte position of the lines `first` to `last` (from 1) of a UTF-8 text made of `lines`. */
function positionOfLines(lines: readonly string[], first: number, last: number) {
  const bytesOf = (selection: readonly string[]) => utf8(selection.join('')).length;
  return { offset: bytesOf(lines.slice(0, first - 1)), length: bytesOf(lines.slice(first - 1, last)) };
}

describe('readNeighbourLines', () => {
  it('should give the lines before and after the entry, in file order, when the entry is in the middle', async () => {
    // Arrange
    const lines = numberedLines(30);
    const position = positionOfLines(lines, 15, 16);

    // Act
    const neighbours = await readNeighbourLines(blobOf(utf8(lines.join(''))), position, 'utf-8', { count: 3 });

    // Assert
    expect(neighbours.before).toEqual(['line 12', 'line 13', 'line 14']);
    expect(neighbours.after).toEqual(['line 17', 'line 18', 'line 19']);
  });

  it('should give ten lines on each side by default', async () => {
    // Arrange
    const lines = numberedLines(40);

    // Act
    const neighbours = await readNeighbourLines(blobOf(utf8(lines.join(''))), positionOfLines(lines, 20, 20), 'utf-8');

    // Assert
    expect(neighbours.before).toHaveLength(10);
    expect(neighbours.before[0]).toBe('line 10');
    expect(neighbours.after).toHaveLength(10);
    expect(neighbours.after[9]).toBe('line 30');
  });

  it('should give fewer lines, without saying it is a limit, when the file starts or ends close to the entry', async () => {
    // Arrange
    const lines = numberedLines(5);

    // Act
    const neighbours = await readNeighbourLines(blobOf(utf8(lines.join(''))), positionOfLines(lines, 2, 4), 'utf-8', { count: 10 });

    // Assert
    expect(neighbours).toEqual({ before: ['line 1'], after: ['line 5'], beforeLimited: false, afterLimited: false });
  });

  it('should give nothing when the entry is the whole source', async () => {
    // Arrange
    const lines = numberedLines(3);

    // Act
    const neighbours = await readNeighbourLines(blobOf(utf8(lines.join(''))), positionOfLines(lines, 1, 3), 'utf-8');

    // Assert
    expect(neighbours).toEqual({ before: [], after: [], beforeLimited: false, afterLimited: false });
  });

  it('should keep a last line that has no line break, and invent no empty line after a final line break', async () => {
    // Arrange
    const withoutBreak = numberedLines(3).join('').slice(0, -1);
    const withBreak = numberedLines(3).join('');
    const position = { offset: 0, length: 7 };

    // Act
    const unfinished = await readNeighbourLines(blobOf(utf8(withoutBreak)), position, 'utf-8');
    const finished = await readNeighbourLines(blobOf(utf8(withBreak)), position, 'utf-8');

    // Assert
    expect(unfinished.after).toEqual(['line 2', 'line 3']);
    expect(finished.after).toEqual(['line 2', 'line 3']);
  });

  it('should keep empty lines, which are lines of the file', async () => {
    // Arrange
    const text = 'a\n\nERR\n\nb\n';

    // Act
    const neighbours = await readNeighbourLines(blobOf(utf8(text)), { offset: 3, length: 4 }, 'utf-8');

    // Assert
    expect(neighbours.before).toEqual(['a', '']);
    expect(neighbours.after).toEqual(['', 'b']);
  });

  it('should read lines ended by CRLF like lines ended by LF', async () => {
    // Arrange
    const lines = numberedLines(7, '\r\n');

    // Act
    const neighbours = await readNeighbourLines(blobOf(utf8(lines.join(''))), positionOfLines(lines, 4, 4), 'utf-8', { count: 2 });

    // Assert
    expect(neighbours.before).toEqual(['line 2', 'line 3']);
    expect(neighbours.after).toEqual(['line 5', 'line 6']);
  });

  describe('when the limit of bytes is reached before the lines are found', () => {
    // Four lines of 10 bytes (9 characters and a line break) around an entry of 10 bytes.
    const lines = ['aaaaaaaaa\n', 'bbbbbbbbb\n', 'ccccccccc\n', 'ENTRYENTR\n', 'ddddddddd\n', 'eeeeeeeee\n', 'fffffffff\n'];
    const source = blobOf(utf8(lines.join('')));
    const position = { offset: 30, length: 10 };

    it('should drop the line the limit cuts through, and say that more lines were wanted', async () => {
      // Act: 25 bytes before the entry hold the end of "aaaaaaaaa", then "bbbbbbbbb" and "ccccccccc" whole.
      const neighbours = await readNeighbourLines(source, position, 'utf-8', { count: 5, maxBytes: 25 });

      // Assert
      expect(neighbours.before).toEqual(['bbbbbbbbb', 'ccccccccc']);
      expect(neighbours.beforeLimited).toBe(true);
      expect(neighbours.after).toEqual(['ddddddddd', 'eeeeeeeee']);
      expect(neighbours.afterLimited).toBe(true);
    });

    it('should not say it is a limit when the lines asked for were found within it', async () => {
      // Act
      const neighbours = await readNeighbourLines(source, position, 'utf-8', { count: 2, maxBytes: 25 });

      // Assert
      expect(neighbours.beforeLimited).toBe(false);
      expect(neighbours.afterLimited).toBe(false);
    });

    it('should read no more than the limit on each side of the entry', async () => {
      // Arrange
      const requested: [number, number][] = [];
      const spy = {
        size: source.size,
        slice: (start: number, end: number) => {
          requested.push([start, end]);
          return source.slice(start, end);
        },
      } as unknown as Blob;

      // Act
      await readNeighbourLines(spy, position, 'utf-8', { count: 5, maxBytes: 25 });

      // Assert
      expect(requested).toEqual([
        [5, 30],
        [40, 65],
      ]);
    });
  });

  it('should give nothing, and say it is a limit, when a single line is longer than what is read', async () => {
    // Arrange
    const text = `${'x'.repeat(100)}\nERR\n${'y'.repeat(100)}\n`;

    // Act
    const neighbours = await readNeighbourLines(blobOf(utf8(text)), { offset: 101, length: 4 }, 'utf-8', { maxBytes: 50 });

    // Assert
    expect(neighbours).toEqual({ before: [], after: [], beforeLimited: true, afterLimited: true });
  });

  it('should not leave a broken character when the limit falls in the middle of a UTF-8 character', async () => {
    // Arrange: each "é" takes two bytes; the window starts in the middle of the first line's characters.
    const text = 'éééé\nok\nERR\nok\nééééé\n';
    const position = { offset: utf8('éééé\nok\n').length, length: 4 };

    // Act
    const neighbours = await readNeighbourLines(blobOf(utf8(text)), position, 'utf-8', { count: 5, maxBytes: 9 });

    // Assert
    expect(neighbours.before).toEqual(['ok']);
    expect(neighbours.after).toEqual(['ok']);
    expect(neighbours.before.join('') + neighbours.after.join('')).not.toContain('�');
  });

  it.each([
    ['UTF-16 LE', 'le', 'utf-16le'],
    ['UTF-16 BE', 'be', 'utf-16be'],
  ] as const)('should read the lines around an entry when the source is %s, window cuts included', async (_label, order, encoding) => {
    // Arrange: the byte order mark takes 2 bytes; each character takes 2.
    const lines = ['alpha\n', 'bravo\n', 'ERR\n', 'delta\n', 'echo\n'];
    const position = { offset: 2 + 2 * (6 + 6), length: 2 * 4 };

    // Act
    const whole = await readNeighbourLines(blobOf(utf16(lines.join(''), order)), position, encoding, { count: 2 });
    const cut = await readNeighbourLines(blobOf(utf16(lines.join(''), order)), position, encoding, { count: 2, maxBytes: 15 });

    // Assert
    expect(whole.before).toEqual(['alpha', 'bravo']);
    expect(whole.after).toEqual(['delta', 'echo']);
    expect(cut.before).toEqual(['bravo']);
    expect(cut.after).toEqual(['delta']);
  });

  it('should reject when the source cannot be read any more', async () => {
    // Arrange
    const unreadable = { size: 100, slice: () => ({ arrayBuffer: () => Promise.reject(new DOMException('changed', 'NotReadableError')) }) } as unknown as Blob;

    // Act
    const neighbours = readNeighbourLines(unreadable, { offset: 10, length: 10 }, 'utf-8');

    // Assert
    await expect(neighbours).rejects.toMatchObject({ name: 'NotReadableError' });
  });

  describe('on the lines of a real sample', () => {
    const original = readSample('serilog-realistic.log');
    const sources = [
      ['UTF-8', utf8(original), 'utf-8'],
      ['UTF-8 with CRLF', utf8(original.replace(/\n/g, '\r\n')), 'utf-8'],
      ['UTF-16 LE', utf16(original, 'le'), 'utf-16le'],
      ['UTF-16 BE', utf16(original, 'be'), 'utf-16be'],
    ] as const;

    it.each(sources)('should give, for every error, the lines that surround it in the file when the source is %s', async (_label, bytes, encoding) => {
      // Arrange
      const records: { offset: number; length: number }[] = [];
      await scanLog(inBlocks(bytes, 64), { profile: DEFAULT_PROFILE }, { onErrors: (batch) => records.push(...batch), onProgress: () => undefined });
      const fileLines = original.replace(/\n$/, '').split('\n');
      const blob = blobOf(bytes);
      const decode = async (start: number, end: number) => new TextDecoder(encoding).decode(await blob.slice(start, end).arrayBuffer()).replace(/\r\n/g, '\n');

      for (const record of records) {
        // The first line of the entry is the number of line breaks before it; its last is the one before the next entry.
        const firstLine = (await decode(0, record.offset)).split('\n').length - 1;
        const entryLines = (await decode(record.offset, record.offset + record.length)).replace(/\n$/, '').split('\n').length;

        // Act
        const neighbours = await readNeighbourLines(blob, record, encoding, { count: 4 });

        // Assert
        expect(neighbours.before).toEqual(fileLines.slice(Math.max(firstLine - 4, 0), firstLine));
        expect(neighbours.after).toEqual(fileLines.slice(firstLine + entryLines, firstLine + entryLines + 4));
      }
      expect(records.length).toBeGreaterThan(0);
    });
  });
});
