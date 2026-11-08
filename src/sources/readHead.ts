import { detectProfile } from '../core/detectProfile';
import type { Detection } from '../core/detectProfile';
import { createLineSplitter } from '../core/lineSplitter';
import type { TextEncoding } from '../core/lineSplitter';
import type { LogProfile } from '../core/profiles';

/**
 * Bytes read from the start of a source to recognise its format. Enough for the 50 lines the detection
 * looks at in any normal log; a single longer line still gives its header.
 */
export const DETECTION_HEAD_BYTES = 1024 * 1024;

/** Outcome of the recognition; a detected format also tells how to decode the source. */
export type FormatDetection = Exclude<Detection, { status: 'detected' }> | { status: 'detected'; profile: LogProfile; encoding: TextEncoding };

export interface DetectFormatOptions {
  readonly headBytes?: number;
}

/**
 * Recognises the format of a source from its beginning only, so that choosing a big file reads one block of it
 * and keeps nothing (nothing is analysed before the user asks, SPEC §3).
 *
 * A cut in the middle of the last line is harmless: a header pattern ends with `.*`, so a prefix that matches it
 * means the whole line matches as well.
 *
 * @throws The browser error when the source cannot be read; see {@link readFailureMessage}.
 */
export async function detectFormat(source: Blob, options: DetectFormatOptions = {}): Promise<FormatDetection> {
  const head = new Uint8Array(await source.slice(0, options.headBytes ?? DETECTION_HEAD_BYTES).arrayBuffer());
  const splitter = createLineSplitter();
  const lines = [...splitter.push(head), ...splitter.finish()];

  const detection = detectProfile(lines.map((line) => line.text));
  if (detection.status !== 'detected') {
    return detection;
  }
  // A detected profile means at least one line, hence a known encoding; UTF-8 is the splitter's default anyway.
  return { status: 'detected', profile: detection.profile, encoding: splitter.encoding ?? 'utf-8' };
}
