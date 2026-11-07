/** Text encodings recognised from a byte order mark. */
export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

/**
 * Most bytes kept for one line. Beyond it bytes are still counted, but not kept, and the line is flagged.
 * Provisional value: SPEC §3 wants thresholds set from a measurement on a large generated file (step 4).
 */
export const MAX_RETAINED_BYTES = 1024 * 1024;

/** A line of the source, located by bytes so that it can be read again with `File.slice`. */
export interface SourceLine {
  /** Decoded text without its terminator; only the beginning of the line when `truncated`. */
  readonly text: string;
  /** Byte offset of the line start. A byte order mark counts in the first line. */
  readonly offset: number;
  /** Byte length of the whole line, terminator included (and the byte order mark for the first line). */
  readonly byteLength: number;
  /** `true` when the line exceeded the retained limit: `text` is then only a prefix. */
  readonly truncated: boolean;
}

export interface LineSplitterOptions {
  readonly maxRetainedBytes?: number;
}

/** Turns blocks of bytes into lines, in one pass and in constant memory. */
export interface LineSplitter {
  /** `null` until enough bytes have been seen to tell (or the input is empty). */
  readonly encoding: TextEncoding | null;
  /** Feeds one block; returns the lines completed by it. Blocks may be cut anywhere. */
  push(chunk: Uint8Array): SourceLine[];
  /** Ends the input; returns the last line when the input does not end with a terminator. */
  finish(): SourceLine[];
}

const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

interface Detection {
  readonly encoding: TextEncoding;
  readonly bomLength: number;
}

const UTF8_WITHOUT_BOM: Detection = { encoding: 'utf-8', bomLength: 0 };

/**
 * Reads the encoding from the byte order mark only. UTF-16 without a mark cannot be told apart from
 * UTF-8 without guessing, so it is not supported: the text then fails to match any profile, visibly.
 *
 * @returns `null` when more bytes are needed and `isEnd` is false.
 */
function detectEncoding(head: Uint8Array, isEnd: boolean): Detection | null {
  const first = head[0];
  const needed = first === 0xef ? 3 : first === 0xff || first === 0xfe ? 2 : 1;
  if (head.length < needed) {
    return isEnd ? UTF8_WITHOUT_BOM : null;
  }
  if (first === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    return { encoding: 'utf-8', bomLength: 3 };
  }
  if (first === 0xff && head[1] === 0xfe) {
    return { encoding: 'utf-16le', bomLength: 2 };
  }
  if (first === 0xfe && head[1] === 0xff) {
    return { encoding: 'utf-16be', bomLength: 2 };
  }
  return UTF8_WITHOUT_BOM;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const [only] = parts;
  if (parts.length === 1 && only !== undefined) {
    return only;
  }
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let position = 0;
  for (const part of parts) {
    joined.set(part, position);
    position += part.length;
  }
  return joined;
}

/**
 * Finds the next line feed. In UTF-8 the byte 0x0A never occurs inside a multi-byte character, so a
 * byte search is exact. In UTF-16 it must be a whole code unit 0x000A, at an even position, otherwise
 * a character such as U+010A would be cut in two. `data` always starts on a code unit boundary.
 *
 * @returns The index where the terminator starts, or -1.
 */
function findTerminator(encoding: TextEncoding, data: Uint8Array, from: number): number {
  let index = data.indexOf(LINE_FEED, from);
  while (index !== -1) {
    if (encoding === 'utf-8') {
      return index;
    }
    if (encoding === 'utf-16le' && index % 2 === 0 && data[index + 1] === 0) {
      return index;
    }
    if (encoding === 'utf-16be' && index % 2 === 1 && data[index - 1] === 0) {
      return index - 1;
    }
    index = data.indexOf(LINE_FEED, index + 1);
  }
  return -1;
}

/** Drops one trailing carriage return so that a CRLF line reads like an LF line. */
function withoutCarriageReturn(encoding: TextEncoding, bytes: Uint8Array): Uint8Array {
  const last = bytes.length - 1;
  if (encoding === 'utf-8') {
    return bytes[last] === CARRIAGE_RETURN ? bytes.subarray(0, last) : bytes;
  }
  const isCarriageReturn =
    encoding === 'utf-16le'
      ? bytes[last - 1] === CARRIAGE_RETURN && bytes[last] === 0
      : bytes[last - 1] === 0 && bytes[last] === CARRIAGE_RETURN;
  return isCarriageReturn ? bytes.subarray(0, last - 1) : bytes;
}

/**
 * Splits bytes into lines **before** decoding them. A character cut between two blocks therefore never
 * reaches the decoder, and every line gets an exact byte position (SPEC §3, ADR-010).
 *
 * Only LF and CRLF end a line. Invalid UTF-8 is decoded as U+FFFD rather than rejected.
 */
export function createLineSplitter(options: LineSplitterOptions = {}): LineSplitter {
  const maxRetainedBytes = options.maxRetainedBytes ?? MAX_RETAINED_BYTES;

  let encoding: TextEncoding | null = null;
  let decoder: TextDecoder | null = null;
  let undecided: Uint8Array | null = null;
  let oddByte: Uint8Array | null = null;

  let lineOffset = 0;
  let lineByteLength = 0;
  let contentBytes = 0;
  let retained: Uint8Array[] = [];
  let retainedBytes = 0;

  function adopt(detection: Detection): void {
    encoding = detection.encoding;
    decoder = new TextDecoder(detection.encoding, { ignoreBOM: true });
    lineByteLength = detection.bomLength;
  }

  function appendToLine(data: Uint8Array, from: number, to: number): void {
    const length = to - from;
    if (length === 0) {
      return;
    }
    contentBytes += length;
    lineByteLength += length;
    let kept = Math.min(length, maxRetainedBytes - retainedBytes);
    if (encoding !== 'utf-8') {
      kept -= kept % 2;
    }
    if (kept > 0) {
      // Copy: the caller may reuse its block after the call.
      retained.push(data.slice(from, from + kept));
      retainedBytes += kept;
    }
  }

  function endLine(terminatorLength: number, out: SourceLine[]): void {
    if (encoding === null || decoder === null) {
      return;
    }
    lineByteLength += terminatorLength;
    const truncated = contentBytes > retainedBytes;
    const bytes = concatenate(retained);
    out.push({
      text: decoder.decode(truncated ? bytes : withoutCarriageReturn(encoding, bytes)),
      offset: lineOffset,
      byteLength: lineByteLength,
      truncated,
    });
    lineOffset += lineByteLength;
    lineByteLength = 0;
    contentBytes = 0;
    retained = [];
    retainedBytes = 0;
  }

  function consume(input: Uint8Array, out: SourceLine[]): void {
    if (encoding === null) {
      return;
    }
    let data = input;
    if (encoding !== 'utf-8') {
      // Keep a half code unit for the next block: the terminator search needs whole units.
      if (oddByte !== null) {
        data = concatenate([oddByte, data]);
        oddByte = null;
      }
      if (data.length % 2 === 1) {
        oddByte = data.slice(data.length - 1);
        data = data.subarray(0, data.length - 1);
      }
    }
    const terminatorLength = encoding === 'utf-8' ? 1 : 2;
    let lineStart = 0;
    for (let found = findTerminator(encoding, data, 0); found !== -1; found = findTerminator(encoding, data, lineStart)) {
      appendToLine(data, lineStart, found);
      endLine(terminatorLength, out);
      lineStart = found + terminatorLength;
    }
    appendToLine(data, lineStart, data.length);
  }

  return {
    get encoding() {
      return encoding;
    },

    push(chunk) {
      const out: SourceLine[] = [];
      if (encoding !== null) {
        consume(chunk, out);
        return out;
      }
      undecided = concatenate([undecided ?? new Uint8Array(0), chunk.slice()]);
      const detection = detectEncoding(undecided, false);
      if (detection !== null) {
        adopt(detection);
        const head = undecided.subarray(detection.bomLength);
        undecided = null;
        consume(head, out);
      }
      return out;
    },

    finish() {
      const out: SourceLine[] = [];
      if (encoding === null && undecided !== null) {
        const head = undecided;
        undecided = null;
        const detection = detectEncoding(head, true);
        if (detection !== null) {
          adopt(detection);
          consume(head.subarray(detection.bomLength), out);
        }
      }
      if (oddByte !== null) {
        appendToLine(oddByte, 0, 1);
        oddByte = null;
      }
      if (lineByteLength > 0) {
        endLine(0, out);
      }
      return out;
    },
  };
}
