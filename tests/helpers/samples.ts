import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads a sample with LF line endings, whatever the checkout converted them to. Relative to the project root, where
 * Vitest runs: `import.meta.url` is not a file path under the jsdom environment.
 */
export function readSample(name: string): string {
  return readFileSync(join(process.cwd(), 'samples', name), 'utf8').replace(/\r\n/g, '\n');
}

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Encodes text as UTF-16 with a byte order mark. */
export function utf16(text: string, order: 'le' | 'be'): Uint8Array {
  const bytes: number[] = order === 'le' ? [0xff, 0xfe] : [0xfe, 0xff];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    bytes.push(...(order === 'le' ? [unit & 0xff, unit >> 8] : [unit >> 8, unit & 0xff]));
  }
  return Uint8Array.from(bytes);
}

/** Yields `bytes` in blocks of `blockSize` bytes, like a stream would, so that blocks cut characters in the middle. */
export function* inBlocks(bytes: Uint8Array, blockSize = bytes.length): Generator<Uint8Array> {
  for (let start = 0; start < bytes.length; start += Math.max(blockSize, 1)) {
    yield bytes.subarray(start, start + blockSize);
  }
}
