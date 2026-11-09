// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AiRequestError } from '../src/ai/errors';
import { readLines } from '../src/ai/streamLines';
import { collect, streamOf } from './helpers/streams';

describe('readLines', () => {
  it('should give each line of a chunk without its line break', async () => {
    // Act
    const lines = await collect(readLines(streamOf(['one\ntwo\n'])));

    // Assert
    expect(lines).toEqual(['one', 'two']);
  });

  it('should join a line that is cut between two chunks', async () => {
    // Act
    const lines = await collect(readLines(streamOf(['hel', 'lo\nwor', 'ld\n'])));

    // Assert
    expect(lines).toEqual(['hello', 'world']);
  });

  it('should drop the carriage return of a CRLF line break, even when it ends a chunk', async () => {
    // Act
    const lines = await collect(readLines(streamOf(['one\r', '\ntwo\r\n'])));

    // Assert
    expect(lines).toEqual(['one', 'two']);
  });

  it('should keep empty lines, which separate the events of a stream', async () => {
    // Act
    const lines = await collect(readLines(streamOf(['a\n\nb\n'])));

    // Assert
    expect(lines).toEqual(['a', '', 'b']);
  });

  it('should give the last line when the stream ends without a line break', async () => {
    // Act
    const lines = await collect(readLines(streamOf(['one\ntwo'])));

    // Assert
    expect(lines).toEqual(['one', 'two']);
  });

  it('should decode a character whose bytes are split between two chunks', async () => {
    // Arrange
    const bytes = new TextEncoder().encode('é\n');

    // Act
    const lines = await collect(readLines(streamOf([bytes.slice(0, 1), bytes.slice(1)])));

    // Assert
    expect(lines).toEqual(['é']);
  });

  it('should give nothing for an empty stream', async () => {
    // Act
    const lines = await collect(readLines(streamOf([])));

    // Assert
    expect(lines).toEqual([]);
  });

  it('should refuse a line longer than the limit rather than keep growing in memory', async () => {
    // Arrange
    const stream = streamOf(['abcdef', 'ghij']);

    // Act
    const failure = collect(readLines(stream, 8));

    // Assert
    await expect(failure).rejects.toMatchObject({ kind: 'protocol' });
    await expect(failure).rejects.toBeInstanceOf(AiRequestError);
  });

  it('should refuse a complete line longer than the limit', async () => {
    // Act
    const failure = collect(readLines(streamOf(['abcdefghij\n']), 8));

    // Assert
    await expect(failure).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('should pass on the error that interrupts the stream', async () => {
    // Arrange
    const interruption = new TypeError('network error');

    // Act
    const failure = collect(readLines(streamOf(['one\n'], interruption)));

    // Assert
    await expect(failure).rejects.toBe(interruption);
  });

  it('should release the stream when the reader stops before the end', async () => {
    // Arrange
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('one\ntwo\n'));
      },
      cancel() {
        cancelled = true;
      },
    });

    // Act
    for await (const line of readLines(stream)) {
      expect(line).toBe('one');
      break;
    }

    // Assert
    expect(cancelled).toBe(true);
  });
});
