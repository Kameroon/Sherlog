import type { TextEncoding } from '../core/lineSplitter';

/** Where an entry is in its source, in bytes. */
export interface EntryPosition {
  readonly offset: number;
  readonly length: number;
}

/** Text read from an entry, and whether it is only the beginning of it. */
export interface EntryText {
  readonly text: string;
  /** `true` when the entry is longer than the limit: `text` stops there. */
  readonly cut: boolean;
}

/**
 * Most bytes read for one entry. An entry can be as big as the file (a dump after an error line): reading it whole
 * and putting it in the page would freeze the tab. Same size as the text the parser keeps (ADR-010).
 */
export const MAX_ENTRY_TEXT_BYTES = 1024 * 1024;

/**
 * Reads the text of one entry again from its source, with `Blob.slice`: only these bytes are loaded, however
 * big the source or the entry is. The result is shaped like the text kept by the parser: lines joined with `\n`,
 * no trailing line break, no byte order mark.
 *
 * When the entry is longer than `maxBytes`, only its beginning is read and `cut` is `true`. The cut never
 * leaves a broken character: the decoder holds back an incomplete UTF-8 sequence, a half UTF-16 code unit or
 * the first half of a surrogate pair.
 *
 * @param source - The same file (or pasted text) that was scanned.
 * @param position - Byte offset and length of the entry, from the scan.
 * @param encoding - Encoding of the source, from the scan or the format detection.
 * @param maxBytes - Most bytes to read; defaults to {@link MAX_ENTRY_TEXT_BYTES}.
 * @throws The browser error when the source was modified or can no longer be read; see {@link readFailureMessage}.
 */
export async function readEntryText(
  source: Blob,
  position: EntryPosition,
  encoding: TextEncoding,
  maxBytes: number = MAX_ENTRY_TEXT_BYTES,
): Promise<EntryText> {
  const cut = position.length > maxBytes;
  const bytes = await source.slice(position.offset, position.offset + Math.min(position.length, maxBytes)).arrayBuffer();
  const decoded = new TextDecoder(encoding).decode(bytes, { stream: cut });
  return { text: cut ? decoded.replace(/\r\n/g, '\n') : decoded.replace(/\r\n/g, '\n').replace(/\n$/, ''), cut };
}
