import { readLines } from './streamLines';

export interface ServerSentEvent {
  /** `message` when the event has no name. */
  readonly event: string;
  readonly data: string;
}

/**
 * Reads a `text/event-stream` body as events. Only `event` and `data` are used: comments, `id` and `retry` are
 * skipped, an event without data is not given, and an event the stream cut off before its blank line is dropped
 * (the caller tells a complete answer from a cut one by the event that ends it).
 */
export async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerSentEvent> {
  let event = 'message';
  let data: string[] = [];
  for await (const line of readLines(body)) {
    if (line === '') {
      if (data.length > 0) {
        yield { event, data: data.join('\n') };
      }
      event = 'message';
      data = [];
      continue;
    }
    if (line.startsWith(':')) {
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const rest = colon === -1 ? '' : line.slice(colon + 1);
    const value = rest.startsWith(' ') ? rest.slice(1) : rest;
    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      data.push(value);
    }
  }
}
