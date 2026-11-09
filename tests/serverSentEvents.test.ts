// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readServerSentEvents } from '../src/ai/serverSentEvents';
import { collect, streamOf } from './helpers/streams';

describe('readServerSentEvents', () => {
  it('should give the name and the data of an event', async () => {
    // Act
    const events = await collect(readServerSentEvents(streamOf(['event: content_block_delta\ndata: {"a":1}\n\n'])));

    // Assert
    expect(events).toEqual([{ event: 'content_block_delta', data: '{"a":1}' }]);
  });

  it('should call an event "message" when it has no name', async () => {
    // Act
    const events = await collect(readServerSentEvents(streamOf(['data: hello\n\n'])));

    // Assert
    expect(events).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('should join the data lines of one event with a line break', async () => {
    // Act
    const events = await collect(readServerSentEvents(streamOf(['data: one\ndata: two\n\n'])));

    // Assert
    expect(events).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });

  it('should keep every space but the first one after the colon', async () => {
    // Act
    const events = await collect(readServerSentEvents(streamOf(['data:  two spaces\n\ndata:none\n\n'])));

    // Assert
    expect(events.map((event) => event.data)).toEqual([' two spaces', 'none']);
  });

  it('should ignore comments and the fields it does not use', async () => {
    // Act
    const events = await collect(readServerSentEvents(streamOf([': keep-alive\nid: 7\nretry: 100\ndata: x\n\n'])));

    // Assert
    expect(events).toEqual([{ event: 'message', data: 'x' }]);
  });

  it('should not give an event that has no data', async () => {
    // Act
    const events = await collect(readServerSentEvents(streamOf(['event: ping\n\ndata: x\n\n'])));

    // Assert
    expect(events).toEqual([{ event: 'message', data: 'x' }]);
  });

  it('should not carry the name of an event over to the next one', async () => {
    // Act
    const events = await collect(readServerSentEvents(streamOf(['event: first\ndata: 1\n\ndata: 2\n\n'])));

    // Assert
    expect(events).toEqual([
      { event: 'first', data: '1' },
      { event: 'message', data: '2' },
    ]);
  });

  it('should read events whose lines arrive in separate chunks and with CRLF line breaks', async () => {
    // Act
    const events = await collect(readServerSentEvents(streamOf(['event: a\r\nda', 'ta: 1\r\n\r', '\n'])));

    // Assert
    expect(events).toEqual([{ event: 'a', data: '1' }]);
  });

  it('should drop an event the stream cut off before its blank line', async () => {
    // Act
    const events = await collect(readServerSentEvents(streamOf(['data: done\n\ndata: cut'])));

    // Assert
    expect(events).toEqual([{ event: 'message', data: 'done' }]);
  });
});
