// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiRequestError } from '../src/ai/errors';
import { OLLAMA_URL, createOllamaProvider, listOllamaModels } from '../src/ai/ollama';
import { fakeFetch, hangingFetch, jsonAnswer } from './helpers/fakeFetch';
import { collect, streamOf } from './helpers/streams';

const messages = [{ role: 'user' as const, content: 'hello' }];
const line = (value: Record<string, unknown>): string => `${JSON.stringify(value)}\n`;
const piece = (content: string, done = false): string => line({ model: 'llama3', message: { role: 'assistant', content }, done });
const goodStream = () => new Response(streamOf([piece('Hel'), piece('lo'), line({ model: 'llama3', message: { role: 'assistant', content: '' }, done: true })]), { status: 200 });

const provider = (fetchImpl: typeof fetch) => createOllamaProvider({ model: 'llama3:8b', fetchImpl });

const failureOf = async (run: () => Promise<unknown>): Promise<AiRequestError> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof AiRequestError) {
      return error;
    }
    throw error;
  }
  throw new Error('the request was expected to fail');
};

afterEach(() => {
  vi.useRealTimers();
});

describe('Ollama models', () => {
  it('should read the installed models from the local server, with no body and no cookie', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(() => jsonAnswer({ models: [{ name: 'llama3:8b' }] }));

    // Act
    await listOllamaModels({ fetchImpl });

    // Assert
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${OLLAMA_URL}/api/tags`);
    expect(requests[0]?.init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(requests[0]?.body).toBeUndefined();
  });

  it('should give the names of the models, in alphabetical order', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonAnswer({ models: [{ name: 'qwen2:7b', size: 1 }, { name: 'llama3:8b' }, { name: 'mistral:latest' }] }));

    // Act
    const result = await listOllamaModels({ fetchImpl });

    // Assert
    expect(result).toEqual({ ok: true, models: ['llama3:8b', 'mistral:latest', 'qwen2:7b'] });
  });

  it('should succeed with no model when none is installed', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonAnswer({ models: [] }));

    // Act
    const result = await listOllamaModels({ fetchImpl });

    // Assert
    expect(result).toEqual({ ok: true, models: [] });
  });

  it.each([
    ['an answer that is not JSON', () => new Response('<html></html>', { status: 200 })],
    ['an answer without a list of models', () => jsonAnswer({ other: [] })],
    ['a model without a name', () => jsonAnswer({ models: [{ size: 1 }] })],
  ])('should report a protocol error for %s', async (_name, answer) => {
    // Arrange
    const { fetchImpl } = fakeFetch(answer);

    // Act
    const result = await listOllamaModels({ fetchImpl });

    // Assert
    expect(result).toMatchObject({ ok: false, failure: { kind: 'protocol' } });
  });

  it('should say the address of the site is refused when Ollama answers 403', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => new Response('', { status: 403 }));

    // Act
    const result = await listOllamaModels({ fetchImpl });

    // Assert
    expect(result).toMatchObject({ ok: false, failure: { kind: 'forbidden', status: 403 } });
  });

  it('should report a network error when Ollama is not reachable', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => new TypeError('Failed to fetch'));

    // Act
    const result = await listOllamaModels({ fetchImpl });

    // Assert
    expect(result).toMatchObject({ ok: false, failure: { kind: 'network' } });
  });

  it('should report a timeout when Ollama does not answer in time', async () => {
    // Arrange
    vi.useFakeTimers();
    const { fetchImpl } = hangingFetch();
    const result = listOllamaModels({ fetchImpl, headersTimeoutMs: 3000 });

    // Act
    await vi.advanceTimersByTimeAsync(3000);

    // Assert
    await expect(result).resolves.toMatchObject({ ok: false, failure: { kind: 'timeout' } });
  });
});

describe('Ollama chat request', () => {
  it('should post the model and the messages to the local chat endpoint and ask for a stream', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);

    // Act
    await collect(provider(fetchImpl).stream(messages));

    // Assert
    expect(requests[0]?.url).toBe(`${OLLAMA_URL}/api/chat`);
    expect(requests[0]?.init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(requests[0]?.body).toEqual({ model: 'llama3:8b', messages, stream: true });
  });

  it('should send no key of any kind', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);

    // Act
    await collect(provider(fetchImpl).stream(messages));

    // Assert
    expect(requests[0]?.init.headers).toEqual({ 'content-type': 'application/json' });
  });
});

describe('Ollama chat answer', () => {
  it('should give the text pieces in order and stop at the end marker', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(goodStream);

    // Act
    const pieces = await collect(provider(fetchImpl).stream(messages));

    // Assert
    expect(pieces).toEqual(['Hel', 'lo']);
  });

  it('should read a line that is cut between two chunks, and skip empty lines', async () => {
    // Arrange
    const whole = piece('Hello');
    const { fetchImpl } = fakeFetch(() => new Response(streamOf([whole.slice(0, 20), `${whole.slice(20)}\n`, line({ done: true })]), { status: 200 }));

    // Act
    const pieces = await collect(provider(fetchImpl).stream(messages));

    // Assert
    expect(pieces).toEqual(['Hello']);
  });

  it('should fail as interrupted when the stream ends before the end marker', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => new Response(streamOf([piece('Hel')]), { status: 200 }));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure.kind).toBe('interrupted');
  });

  it('should fail as interrupted when the connection drops in the middle of the stream', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => new Response(streamOf([piece('Hel')], new TypeError('network error')), { status: 200 }));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure.kind).toBe('interrupted');
  });

  it('should fail with what Ollama says when an error line comes in the middle of the stream', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => new Response(streamOf([piece('Hel'), line({ error: 'model runner has unexpectedly stopped' })]), { status: 200 }));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure).toMatchObject({ kind: 'unavailable', detail: 'model runner has unexpectedly stopped' });
  });

  it('should fail as a protocol error when a line is not JSON', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => new Response(streamOf(['not json\n']), { status: 200 }));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure.kind).toBe('protocol');
  });

  it('should say the model is not installed when Ollama answers 404 with its explanation', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonAnswer({ error: "model 'llama3:8b' not found" }, 404));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure).toMatchObject({ kind: 'not-found', status: 404, detail: "model 'llama3:8b' not found" });
  });

  it('should stop with nothing to say when the caller cancels the request', async () => {
    // Arrange
    const { fetchImpl } = hangingFetch();
    const controller = new AbortController();
    const failure = failureOf(() => collect(provider(fetchImpl).stream(messages, { signal: controller.signal })));

    // Act
    controller.abort();

    // Assert
    await expect(failure).resolves.toMatchObject({ kind: 'cancelled' });
  });
});
