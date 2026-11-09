// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANTHROPIC_VERSION,
  CONNECTION_TEST_MESSAGE,
  createAnthropicProvider,
  isPlausibleApiKey,
  testAnthropicConnection,
} from '../src/ai/anthropic';
import { AiRequestError } from '../src/ai/errors';
import { anthropicEvent, eventStream, fakeFetch, hangingFetch, jsonAnswer, textDelta } from './helpers/fakeFetch';
import { collect, streamOf } from './helpers/streams';

const KEY = 'sk-ant-test-0123456789';
const messages = [{ role: 'user' as const, content: 'hello' }];
const goodStream = () => eventStream([anthropicEvent('message_start', { message: {} }), textDelta('Hel'), textDelta('lo'), anthropicEvent('message_stop', {})]);

const provider = (fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof createAnthropicProvider>[0]> = {}) =>
  createAnthropicProvider({ apiKey: KEY, model: 'claude-haiku-5-5', maxTokens: 100, fetchImpl, ...overrides });

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

describe('Anthropic request', () => {
  it('should post to the messages endpoint with the headers the browser access needs', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);

    // Act
    await collect(provider(fetchImpl).stream(messages));

    // Assert
    const [request] = requests;
    expect(request?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request?.init.method).toBe('POST');
    expect(request?.init.headers).toEqual({
      'x-api-key': KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });

  it('should send the model, the limit, the messages and ask for a stream', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);

    // Act
    await collect(provider(fetchImpl, { model: 'claude-sonnet-5-5', maxTokens: 321 }).stream(messages));

    // Assert
    expect(requests[0]?.body).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 321, stream: true, messages });
  });

  it.each(['temperature', 'top_p', 'top_k'])('should not send %s, which this version of the API refuses', async (parameter) => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);

    // Act
    await collect(provider(fetchImpl).stream(messages));

    // Assert
    expect(requests[0]?.body).not.toHaveProperty(parameter);
  });

  it('should send no cookie and no referrer to the provider', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);

    // Act
    await collect(provider(fetchImpl).stream(messages));

    // Assert
    expect(requests[0]?.init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('should not send anything when the key could not be written in a header', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl, { apiKey: 'clé-é' }).stream(messages)));

    // Assert
    expect(failure.kind).toBe('rejected');
    expect(requests).toHaveLength(0);
  });
});

describe('Anthropic answer', () => {
  it('should give the text pieces in order and ignore the events that carry none', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      eventStream([
        anthropicEvent('message_start', { message: {} }),
        anthropicEvent('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
        anthropicEvent('ping', {}),
        textDelta('Hel'),
        anthropicEvent('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        textDelta('lo'),
        anthropicEvent('content_block_stop', { index: 0 }),
        anthropicEvent('message_delta', { delta: { stop_reason: 'end_turn' } }),
        anthropicEvent('message_stop', {}),
      ]),
    );

    // Act
    const pieces = await collect(provider(fetchImpl).stream(messages));

    // Assert
    expect(pieces).toEqual(['Hel', 'lo']);
  });

  it('should fail as interrupted when the stream ends before its last event', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => eventStream([textDelta('Hel')]));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure.kind).toBe('interrupted');
  });

  it('should fail as interrupted when the connection drops in the middle of the stream', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => new Response(streamOf([textDelta('Hel')], new TypeError('network error')), { status: 200 }));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure.kind).toBe('interrupted');
  });

  it('should fail with what the provider says when an error event comes in the middle of the stream', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      eventStream([textDelta('Hel'), anthropicEvent('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })]),
    );

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure).toMatchObject({ kind: 'unavailable', detail: 'Overloaded' });
  });

  it('should fail as a protocol error when an event is not JSON', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => eventStream(['event: content_block_delta\ndata: not json\n\n']));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure.kind).toBe('protocol');
  });

  it('should fail as a protocol error when the answer has no body', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => new Response(null, { status: 200 }));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure.kind).toBe('protocol');
  });
});

describe('Anthropic failure to answer', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [400, 'rejected'],
    [413, 'rejected'],
    [429, 'rate-limited'],
    [500, 'unavailable'],
    [529, 'unavailable'],
  ])('should classify the status %i as %s', async (status, kind) => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonAnswer({ type: 'error', error: { type: 'x', message: 'Because' } }, status));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure).toMatchObject({ kind, status, detail: 'Because' });
  });

  it('should still classify the status when the body of the error is not JSON', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure).toMatchObject({ kind: 'unavailable', status: 502, detail: undefined });
  });

  it('should never keep the key in what the provider says', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonAnswer({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }, 401));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure.detail).toBeDefined();
    expect(failure.detail).not.toContain(KEY);
  });

  it('should keep the explanation short', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonAnswer({ error: { message: 'x'.repeat(5000) } }, 400));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure.detail?.length).toBeLessThanOrEqual(300);
  });

  it('should fail as a network error when the browser cannot reach the provider', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => new TypeError('Failed to fetch'));

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages)));

    // Assert
    expect(failure.kind).toBe('network');
  });

  it('should fail as a timeout when the provider does not answer in time', async () => {
    // Arrange
    vi.useFakeTimers();
    const { fetchImpl } = hangingFetch();
    const failure = failureOf(() => collect(provider(fetchImpl, { headersTimeoutMs: 5000 }).stream(messages)));

    // Act
    await vi.advanceTimersByTimeAsync(5000);

    // Assert
    await expect(failure).resolves.toMatchObject({ kind: 'timeout' });
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

  it('should not send anything when the caller has already cancelled', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);
    const controller = new AbortController();
    controller.abort();

    // Act
    const failure = await failureOf(() => collect(provider(fetchImpl).stream(messages, { signal: controller.signal })));

    // Assert
    expect(failure.kind).toBe('cancelled');
    expect(requests).toHaveLength(0);
  });
});

describe('Anthropic connection test', () => {
  it('should succeed when the provider answers', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(goodStream);

    // Act
    const result = await testAnthropicConnection({ apiKey: KEY, model: 'claude-haiku-5-5', fetchImpl });

    // Assert
    expect(result).toEqual({ ok: true });
  });

  it('should send one fixed short message and nothing from a log', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);

    // Act
    await testAnthropicConnection({ apiKey: KEY, model: 'claude-haiku-5-5', fetchImpl });

    // Assert
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 16,
      stream: true,
      messages: [{ role: 'user', content: CONNECTION_TEST_MESSAGE }],
    });
  });

  it('should say why it failed instead of throwing', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonAnswer({ error: { message: 'invalid x-api-key' } }, 401));

    // Act
    const result = await testAnthropicConnection({ apiKey: KEY, model: 'claude-haiku-5-5', fetchImpl });

    // Assert
    expect(result).toMatchObject({ ok: false, failure: { kind: 'unauthorized', status: 401 } });
  });
});

describe('isPlausibleApiKey', () => {
  it.each(['sk-ant-api03-AbC_123-xyz', 'a'])('should accept %s', (key) => {
    // Act & Assert
    expect(isPlausibleApiKey(key)).toBe(true);
  });

  it.each([['an empty key', ''], ['a key with a space', 'sk ant'], ['a key with a line break', 'sk\nant'], ['a key with an accent', 'clé'], ['a key that is too long', 'k'.repeat(513)]])(
    'should refuse %s',
    (_name, key) => {
      // Act & Assert
      expect(isPlausibleApiKey(key)).toBe(false);
    },
  );
});

describe('Anthropic system prompt', () => {
  it('should send the instructions as the system field, outside the messages', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);

    // Act
    await collect(provider(fetchImpl).stream(messages, { system: 'Be brief.' }));

    // Assert
    expect(requests[0]?.body).toEqual({ model: 'claude-haiku-5-5', max_tokens: 100, stream: true, system: 'Be brief.', messages });
  });

  it('should send no system field when there are no instructions', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(goodStream);

    // Act
    await collect(provider(fetchImpl).stream(messages));

    // Assert
    expect(requests[0]?.body).not.toHaveProperty('system');
  });
});
