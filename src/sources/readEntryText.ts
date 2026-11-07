import type { TextEncoding } from '../core/lineSplitter';

/** Where an entry is in its source, in bytes. */
export interface EntryPosition {
  readonly offset: number;
  readonly length: number;
}

/**
 * Reads the text of one entry again from its source, with `Blob.slice`: only these bytes are loaded, however
 * big the source is. The result is shaped like the text kept by the parser: lines joined with `\n`, no trailing
 * line break, no byte order mark.
 *
 * @param source - The same file (or pasted text) that was scanned.
 * @param position - Byte offset and length of the entry, from the scan.
 * @param encoding - Encoding of the source, from the scan or the format detection.
 * @throws The browser error when the source was modified or can no longer be read; see {@link readFailureMessage}.
 */
export async function readEntryText(source: Blob, position: EntryPosition, encoding: TextEncoding): Promise<string> {
  const bytes = await source.slice(position.offset, position.offset + position.length).arrayBuffer();
  return new TextDecoder(encoding).decode(bytes).replace(/\r\n/g, '\n').replace(/\n$/, '');
}
