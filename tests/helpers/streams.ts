/** A response body that delivers the given chunks one after the other, then ends (or fails with `error`). */
export function streamOf(chunks: readonly (string | Uint8Array)[], error?: Error): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      if (error === undefined) {
        controller.close();
      } else {
        controller.error(error);
      }
    },
  });
}

/** Reads everything an async iterable yields. */
export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) {
    items.push(item);
  }
  return items;
}
