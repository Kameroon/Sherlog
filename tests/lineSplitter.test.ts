// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLineSplitter, MAX_RETAINED_BYTES } from '../src/core/lineSplitter';
import type { LineSplitterOptions, SourceLine } from '../src/core/lineSplitter';

type Utf16Order = 'le' | 'be';

function utf8(text: string, bom = false): Uint8Array {
  const body = new TextEncoder().encode(text);
  return bom ? Uint8Array.from([0xef, 0xbb, 0xbf, ...body]) : body;
}

function utf16(text: string, order: Utf16Order, bom = true): Uint8Array {
  const bytes: number[] = bom ? (order === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const low = unit & 0xff;
    const high = unit >> 8;
    bytes.push(...(order === 'le' ? [low, high] : [high, low]));
  }
  return Uint8Array.from(bytes);
}

function split(bytes: Uint8Array, chunkSize = bytes.length, options?: LineSplitterOptions) {
  const splitter = createLineSplitter(options);
  const lines: SourceLine[] = [];
  for (let start = 0; start < bytes.length; start += Math.max(chunkSize, 1)) {
    lines.push(...splitter.push(bytes.subarray(start, start + chunkSize)));
  }
  lines.push(...splitter.finish());
  return { lines, encoding: splitter.encoding };
}

const texts = (lines: readonly SourceLine[]) => lines.map((line) => line.text);

describe('createLineSplitter line terminators', () => {
  it('should split on line feeds and report the byte offset and length of each line', () => {
    // Act
    const { lines } = split(utf8('ab\ncd\n'));

    // Assert
    expect(lines).toEqual([
      { text: 'ab', offset: 0, byteLength: 3, truncated: false },
      { text: 'cd', offset: 3, byteLength: 3, truncated: false },
    ]);
  });

  it('should drop the carriage return from the text but count it in the length when the terminator is CRLF', () => {
    // Act
    const { lines } = split(utf8('ab\r\ncd\r\n'));

    // Assert
    expect(lines).toEqual([
      { text: 'ab', offset: 0, byteLength: 4, truncated: false },
      { text: 'cd', offset: 4, byteLength: 4, truncated: false },
    ]);
  });

  it('should keep a lone carriage return in the text because only LF and CRLF end a line', () => {
    // Act
    const { lines } = split(utf8('a\rb\n'));

    // Assert
    expect(texts(lines)).toEqual(['a\rb']);
  });

  it('should return the last line when the input does not end with a line terminator', () => {
    // Act
    const { lines } = split(utf8('ab\ncd'));

    // Assert
    expect(lines[1]).toEqual({ text: 'cd', offset: 3, byteLength: 2, truncated: false });
  });

  it('should not return an extra empty line when the input ends with a line terminator', () => {
    // Act
    const { lines } = split(utf8('ab\n'));

    // Assert
    expect(lines).toHaveLength(1);
  });

  it('should keep empty lines when two terminators follow each other', () => {
    // Act
    const { lines } = split(utf8('a\n\nb\n'));

    // Assert
    expect(texts(lines)).toEqual(['a', '', 'b']);
  });

  it('should return no line when the input is empty', () => {
    // Act
    const { lines, encoding } = split(new Uint8Array(0));

    // Assert
    expect({ lines, encoding }).toEqual({ lines: [], encoding: null });
  });
});

describe('createLineSplitter encodings', () => {
  it('should detect UTF-8 without a byte order mark when the input has none', () => {
    // Act
    const { encoding } = split(utf8('abc\n'));

    // Assert
    expect(encoding).toBe('utf-8');
  });

  it('should skip the UTF-8 byte order mark in the text but count it in the first line when the input has one', () => {
    // Act
    const { lines } = split(utf8('ab\n', true));

    // Assert
    expect(lines).toEqual([{ text: 'ab', offset: 0, byteLength: 6, truncated: false }]);
  });

  it('should decode accented characters when the input is UTF-8', () => {
    // Act
    const { lines } = split(utf8('Échec réseau\n'));

    // Assert
    expect(texts(lines)).toEqual(['Échec réseau']);
  });

  it('should replace invalid UTF-8 bytes with the replacement character instead of failing', () => {
    // Act
    const { lines } = split(Uint8Array.from([0x61, 0xff, 0x62, 0x0a]));

    // Assert
    expect(texts(lines)).toEqual(['a�b']);
  });

  it.each<[string, Utf16Order, string]>([
    ['UTF-16 LE', 'le', 'utf-16le'],
    ['UTF-16 BE', 'be', 'utf-16be'],
  ])('should decode %s and count the byte order mark in the first line', (_label, order, expectedEncoding) => {
    // Act
    const { lines, encoding } = split(utf16('ab\ncd\n', order));

    // Assert
    expect({ encoding, lines }).toEqual({
      encoding: expectedEncoding,
      lines: [
        { text: 'ab', offset: 0, byteLength: 8, truncated: false },
        { text: 'cd', offset: 8, byteLength: 6, truncated: false },
      ],
    });
  });

  it.each<Utf16Order>(['le', 'be'])('should drop the carriage return of a CRLF terminator when the input is UTF-16 %s', (order) => {
    // Act
    const { lines } = split(utf16('ab\r\ncd\r\n', order));

    // Assert
    expect(texts(lines)).toEqual(['ab', 'cd']);
  });

  // Each text holds a 0x0A byte that is not a line feed. The third and fourth cases put a 0x00 byte
  // right next to it, which is what makes a search without the alignment check cut the line.
  it.each<[string, Utf16Order, string]>([
    ['0x0A is the low byte of U+010A, followed by 0x01', 'le', 'aĊb'],
    ['0x0A is the high byte of U+0A41, followed by the 0x00 low byte of U+0100', 'le', 'aੁĀb'],
    ['0x0A is the low byte of U+010A, preceded by 0x01', 'be', 'aĊb'],
    ['0x0A is the high byte of U+0A41, preceded by the 0x00 low byte of U+0100', 'be', 'aĀੁb'],
  ])('should not split a line when %s (UTF-16 %s)', (_label, order, text) => {
    // Act
    const { lines } = split(utf16(`${text}\n`, order));

    // Assert
    expect(texts(lines)).toEqual([text]);
  });
});

describe('createLineSplitter blocks cut anywhere', () => {
  const samples: [string, Uint8Array][] = [
    ['UTF-8', utf8('Échec réseau\r\nsuite 日本語\nfin')],
    ['UTF-8 with a byte order mark', utf8('Échec réseau\r\nsuite 日本語\nfin', true)],
    ['UTF-16 LE', utf16('Échec réseau\r\nsuite 日本語\nfin', 'le')],
    ['UTF-16 BE', utf16('Échec réseau\r\nsuite 日本語\nfin', 'be')],
  ];

  it.each(samples)('should give the same lines for every block size when the input is %s', (_label, bytes) => {
    // Arrange
    const reference = split(bytes);

    // Act
    const results = Array.from({ length: bytes.length }, (_, index) => split(bytes, index + 1));

    // Assert
    expect(results.every((result) => JSON.stringify(result) === JSON.stringify(reference))).toBe(true);
  });

  it.each(samples)('should cover the whole input with the line lengths when the input is %s', (_label, bytes) => {
    // Act
    const { lines } = split(bytes, 3);

    // Assert
    expect(lines.reduce((total, line) => total + line.byteLength, 0)).toBe(bytes.length);
  });

  it('should reconstruct a multi-byte character cut between two blocks', () => {
    // Arrange: "é" is the two bytes C3 A9
    const bytes = utf8('é\n');

    // Act
    const { lines } = split(bytes, 1);

    // Assert
    expect(texts(lines)).toEqual(['é']);
  });

  it('should not report an encoding before it has enough bytes to tell', () => {
    // Arrange
    const splitter = createLineSplitter();

    // Act
    splitter.push(Uint8Array.from([0xef]));

    // Assert
    expect(splitter.encoding).toBeNull();
  });
});

describe('createLineSplitter long lines', () => {
  it('should keep the beginning of the line, flag it and keep its exact length when it exceeds the limit', () => {
    // Act
    const { lines } = split(utf8('abcdefghijklmnop\nnext\n'), 5, { maxRetainedBytes: 8 });

    // Assert
    expect(lines).toEqual([
      { text: 'abcdefgh', offset: 0, byteLength: 17, truncated: true },
      { text: 'next', offset: 17, byteLength: 5, truncated: false },
    ]);
  });

  it('should keep a whole number of characters when a UTF-16 line exceeds the limit', () => {
    // Act
    const { lines } = split(utf16('abcdefgh\n', 'le'), 3, { maxRetainedBytes: 9 });

    // Assert
    expect(lines[0]).toMatchObject({ text: 'abcd', truncated: true });
  });

  it('should not flag the line when it is exactly at the limit', () => {
    // Act
    const { lines } = split(utf8('abcdefgh\n'), 4, { maxRetainedBytes: 8 });

    // Assert
    expect(lines[0]).toMatchObject({ text: 'abcdefgh', truncated: false });
  });

  it('should flag a line of several megabytes with the default limit and still return the next line', () => {
    // Arrange
    const megabytes = 3 * 1024 * 1024;
    const bytes = utf8(`${'x'.repeat(megabytes)}\nnext\n`);

    // Act
    const { lines } = split(bytes, 64 * 1024);

    // Assert
    expect(lines.map((line) => [line.text.length, line.byteLength, line.truncated])).toEqual([
      [MAX_RETAINED_BYTES, megabytes + 1, true],
      [4, 5, false],
    ]);
  });
});
