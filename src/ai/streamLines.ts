import { AiRequestError } from './errors';

/** The longest line accepted from a provider: a line that never ends would otherwise fill the memory of the page. */
export const MAX_LINE_CHARS = 1_000_000;

/**
 * Reads a response body as text lines. The bytes are decoded as a stream, so that a character split between two
 * chunks stays whole, and `\r\n` is read as one line break even when the two characters arrive apart.
 *
 * @throws AiRequestError of kind `protocol` when a line is longer than `maxLineChars`; the error that interrupts the
 * body is passed on as it is.
 */
export async function* readLines(body: ReadableStream<Uint8Array>, maxLineChars: number = MAX_LINE_CHARS): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let pending = '';
  // The body is released when the caller stops early, but not after it ended or failed (cancelling an errored body would hide the error).
  let finished = false;
  const tooLong = (): AiRequestError => new AiRequestError('protocol', { detail: 'ligne trop longue' });
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        finished = true;
        throw error;
      }
      if (chunk.done) {
        finished = true;
        break;
      }
      pending += decoder.decode(chunk.value, { stream: true });
      let start = 0;
      for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n', start)) {
        if (end - start > maxLineChars) {
          throw tooLong();
        }
        yield withoutCarriageReturn(pending.slice(start, end));
        start = end + 1;
      }
      pending = pending.slice(start);
      if (pending.length > maxLineChars) {
        throw tooLong();
      }
    }
    pending += decoder.decode();
    if (pending !== '') {
      yield withoutCarriageReturn(pending);
    }
  } finally {
    if (!finished) {
      await reader.cancel();
    }
    reader.releaseLock();
  }
}

function withoutCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}
