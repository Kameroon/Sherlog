// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AiRequestError } from '../src/ai/errors';
import { readAnswer } from '../src/ai/provider';

async function* pieces(...texts: string[]): AsyncGenerator<string> {
  for (const text of texts) {
    yield text;
  }
}

describe('readAnswer', () => {
  it('should join the pieces of an answer', async () => {
    // Act & Assert
    await expect(readAnswer(pieces('Hel', 'lo'))).resolves.toBe('Hello');
  });

  it('should accept an answer of exactly the limit', async () => {
    // Act & Assert
    await expect(readAnswer(pieces('abcd', 'ef'), 6)).resolves.toBe('abcdef');
  });

  it('should refuse an answer longer than the limit rather than keep it growing in memory', async () => {
    // Act
    const failure = readAnswer(pieces('abcd', 'efg'), 6);

    // Assert
    await expect(failure).rejects.toBeInstanceOf(AiRequestError);
    await expect(failure).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('should stop reading the source once the limit is passed', async () => {
    // Arrange
    let read = 0;
    async function* endless(): AsyncGenerator<string> {
      for (;;) {
        read += 1;
        yield 'xxxx';
      }
    }

    // Act
    await readAnswer(endless(), 10).catch(() => undefined);

    // Assert
    expect(read).toBe(3);
  });
});
