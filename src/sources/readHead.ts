import { detectProfile } from '../core/detectProfile';
import type { Detection } from '../core/detectProfile';
import { createLineSplitter } from '../core/lineSplitter';
import type { TextEncoding } from '../core/lineSplitter';
import type { LogProfile } from '../core/profiles';

/**
 * Bytes read from the start of a source. Enough for the 50 lines the format detection looks at in any normal log
 * (a single longer line still gives its header), and the text the preparation screen shows its figures for.
 */
export const HEAD_BYTES = 1024 * 1024;

/** Outcome of the recognition; a detected format also tells how to decode the source. */
export type FormatDetection = Exclude<Detection, { status: 'detected' }> | { status: 'detected'; profile: LogProfile; encoding: TextEncoding };

export interface ReadHeadOptions {
  readonly headBytes?: number;
}

/** The beginning of a source, and what the detection made of it. */
export interface HeadRead {
  readonly detection: FormatDetection;
  /** The first bytes of the source: all of it when it is small. Kept by the page for the preparation screen. */
  readonly head: Uint8Array;
  /** `true` when `head` is the whole source, so that what is computed on it is exact. */
  readonly complete: boolean;
}

/**
 * Reads the beginning of a source and recognises its format from it, so that choosing a big file reads one block
 * of it (nothing is analysed before the user asks, SPEC §3). The beginning is given back for the preparation screen.
 *
 * A cut in the middle of the last line is harmless: a header pattern ends with `.*`, so a prefix that matches it
 * means the whole line matches as well.
 *
 * @throws The browser error when the source cannot be read; see {@link readFailureMessage}.
 */
export async function readHead(source: Blob, options: ReadHeadOptions = {}): Promise<HeadRead> {
  const headBytes = options.headBytes ?? HEAD_BYTES;
  const head = new Uint8Array(await source.slice(0, headBytes).arrayBuffer());
  const complete = source.size <= headBytes;
  const splitter = createLineSplitter();
  const lines = [...splitter.push(head), ...splitter.finish()];

  const detection = detectProfile(lines.map((line) => line.text));
  if (detection.status !== 'detected') {
    return { detection, head, complete };
  }
  // A detected profile means at least one line, hence a known encoding; UTF-8 is the splitter's default anyway.
  return { detection: { status: 'detected', profile: detection.profile, encoding: splitter.encoding ?? 'utf-8' }, head, complete };
}
