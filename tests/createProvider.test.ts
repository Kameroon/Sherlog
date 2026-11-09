// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ANALYSIS_MAX_TOKENS, createProvider } from '../src/ai/createProvider';
import { anthropicEvent, eventStream, fakeFetch, textDelta } from './helpers/fakeFetch';
import { collect, streamOf } from './helpers/streams';

const messages = [{ role: 'user' as const, content: 'hello' }];

describe('createProvider', () => {
  it('should give an Anthropic provider that uses the key and the model chosen, with room for a whole analysis', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(() => eventStream([textDelta('OK'), anthropicEvent('message_stop', {})]));
    const provider = createProvider({ provider: 'anthropic', apiKey: 'sk-ant-key-123', model: 'claude-sonnet-5-5' }, fetchImpl);

    // Act
    await collect(provider.stream(messages));

    // Assert
    expect(requests[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(requests[0]?.init.headers).toMatchObject({ 'x-api-key': 'sk-ant-key-123' });
    expect(requests[0]?.body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: ANALYSIS_MAX_TOKENS });
    expect(ANALYSIS_MAX_TOKENS).toBeGreaterThanOrEqual(2000);
  });

  it('should give an Ollama provider that uses the model chosen and no key', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(() => new Response(streamOf(['{"message":{"content":"OK"},"done":true}\n']), { status: 200 }));
    const provider = createProvider({ provider: 'ollama', apiKey: 'must-not-be-sent', model: 'llama3:8b' }, fetchImpl);

    // Act
    await collect(provider.stream(messages));

    // Assert
    expect(requests[0]?.url).toBe('http://localhost:11434/api/chat');
    expect(requests[0]?.body).toMatchObject({ model: 'llama3:8b' });
    expect(JSON.stringify(requests[0]?.init.headers)).not.toContain('must-not-be-sent');
  });
});
