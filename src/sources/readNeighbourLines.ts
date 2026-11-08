import type { TextEncoding } from '../core/lineSplitter';
import type { EntryPosition } from './readEntryText';

/** How many lines are shown on each side of an entry (SPEC §3). */
export const NEIGHBOUR_LINES = 10;

/**
 * Most bytes read on each side of an entry. A line can be as long as the file: without a bound, asking for the lines
 * around an error would load it whole. Provisional value, like the other read limits: about 10 usual lines fit.
 */
export const MAX_NEIGHBOUR_BYTES = 64 * 1024;

/** The lines of the file just before and just after an entry, without their line breaks. */
export interface NeighbourLines {
  readonly before: readonly string[];
  readonly after: readonly string[];
  /** `true` when `before` has fewer lines than asked for because the bytes limit was reached, not the start of the file. */
  readonly beforeLimited: boolean;
  /** `true` when `after` has fewer lines than asked for because the bytes limit was reached, not the end of the file. */
  readonly afterLimited: boolean;
}

export interface NeighbourOptions {
  /** Lines wanted on each side; defaults to {@link NEIGHBOUR_LINES}. */
  readonly count?: number;
  /** Most bytes read on each side; defaults to {@link MAX_NEIGHBOUR_BYTES}. */
  readonly maxBytes?: number;
}

/** Line breaks normalised to LF, then cut into lines. A text that ends with a line break ends with an empty piece. */
const pieces = (text: string): string[] => text.replace(/\r\n/g, '\n').split('\n');

/**
 * Reads again, from its source, the lines that surround an entry: the physical lines of the file, whatever entries
 * they belong to (other errors, warnings, the stack of the entry before). Only a window of `maxBytes` on each side is
 * loaded, with `Blob.slice`, however big the source is.
 *
 * A line the window cuts through is dropped rather than shown in part. When that leaves fewer lines than asked for,
 * `beforeLimited` / `afterLimited` say so, so that a missing line is never taken for the edge of the file.
 *
 * @param source - The same file (or pasted text) that was scanned.
 * @param position - Byte offset and length of the entry, from the scan; the entry starts and ends on a line boundary.
 * @param encoding - Encoding of the source, from the scan or the format detection.
 * @throws The browser error when the source was modified or can no longer be read; see {@link readFailureMessage}.
 */
export async function readNeighbourLines(
  source: Blob,
  position: EntryPosition,
  encoding: TextEncoding,
  options: NeighbourOptions = {},
): Promise<NeighbourLines> {
  const count = options.count ?? NEIGHBOUR_LINES;
  const maxBytes = options.maxBytes ?? MAX_NEIGHBOUR_BYTES;

  const [before, after] = await Promise.all([
    readBefore(source, position.offset, encoding, count, maxBytes),
    readAfter(source, position.offset + position.length, encoding, count, maxBytes),
  ]);
  return { before: before.lines, after: after.lines, beforeLimited: before.limited, afterLimited: after.limited };
}

interface Side {
  readonly lines: string[];
  readonly limited: boolean;
}

async function readBefore(source: Blob, end: number, encoding: TextEncoding, count: number, maxBytes: number): Promise<Side> {
  // A UTF-16 window must start on a code unit: `end` is on one, so is a start moved down by one byte if it is odd.
  const rawStart = Math.max(0, end - maxBytes);
  const start = encoding === 'utf-8' ? rawStart : rawStart - (rawStart % 2);
  const text = new TextDecoder(encoding).decode(await source.slice(start, end).arrayBuffer());

  const found = pieces(text);
  // The window ends on a line break, hence the empty piece at the end; when it starts inside the file its first piece may be the end of a longer line.
  found.pop();
  if (start > 0) {
    found.shift();
  }
  return { lines: found.slice(-count), limited: start > 0 && found.length < count };
}

async function readAfter(source: Blob, start: number, encoding: TextEncoding, count: number, maxBytes: number): Promise<Side> {
  const end = Math.min(source.size, start + maxBytes);
  const reachesEnd = end >= source.size;
  // Without `stream`, a character cut by the end of the window would become a replacement character.
  const text = new TextDecoder(encoding).decode(await source.slice(start, end).arrayBuffer(), { stream: !reachesEnd });

  const found = pieces(text);
  // The last piece is either an empty one (the text ends with a line break) or the beginning of a line the window cuts: neither is a line.
  const last = found.pop();
  if (reachesEnd && last !== undefined && last !== '') {
    found.push(last);
  }
  return { lines: found.slice(0, count), limited: !reachesEnd && found.length < count };
}
