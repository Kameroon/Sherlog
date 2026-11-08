/**
 * Reads a blob as blocks of bytes, in order and in constant memory.
 *
 * Uses a reader instead of `for await` over the stream: async iteration of a `ReadableStream` is not
 * available in every supported browser, while `getReader()` is.
 */
export async function* blobChunks(source: Blob): AsyncGenerator<Uint8Array> {
  const reader = source.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
