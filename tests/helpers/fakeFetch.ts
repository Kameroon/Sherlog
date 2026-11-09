import { streamOf } from './streams';

export interface RecordedRequest {
  url: string;
  init: RequestInit;
  /** The JSON body that was sent, `undefined` for a request without one. */
  body: unknown;
}

type Answer = Response | Error;

/** A `fetch` that records what it is asked and answers as the test says; the request is seen before it is answered. */
export function fakeFetch(answer: (request: RecordedRequest) => Answer | Promise<Answer>) {
  const requests: RecordedRequest[] = [];
  // A function, not an arrow: like the browser's `fetch`, it refuses to be called as the method of another object ("Illegal invocation").
  const fetchImpl = async function (this: unknown, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch': Illegal invocation");
    }
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const request: RecordedRequest = { url, init, body };
    requests.push(request);
    const given = await answer(request);
    if (given instanceof Error) {
      throw given;
    }
    return given;
  };
  return { fetchImpl, requests };
}

/** A `fetch` that never answers by itself: it ends, as the browser's does, when the request is aborted. */
export function hangingFetch() {
  return fakeFetch(
    (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );
}

export const eventStream = (chunks: readonly string[], status = 200): Response =>
  new Response(streamOf(chunks), { status, headers: { 'content-type': 'text/event-stream' } });

export const jsonAnswer = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** One Anthropic server-sent event, as it is written on the wire. */
export const anthropicEvent = (type: string, data: Record<string, unknown>): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

export const textDelta = (text: string): string => anthropicEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
