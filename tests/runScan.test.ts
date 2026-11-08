// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EMPTY_PREPARATION } from '../src/core/preparation';
import type { Preparation } from '../src/core/preparation';
import { blobChunks } from '../src/sources/blobChunks';
import { runScan } from '../src/workers/runScan';
import type { ScanMessage } from '../src/workers/scanProtocol';
import { readSample, utf8 } from './helpers/samples';

const blobOf = (text: string): Blob => new Blob([utf8(text) as BlobPart]);

async function run(source: Blob, profileId: string, now?: () => number, preparation: Preparation = EMPTY_PREPARATION): Promise<ScanMessage[]> {
  const messages: ScanMessage[] = [];
  await runScan({ source, profileId, preparation }, (message) => messages.push(message), now);
  return messages;
}

/** A source that streams the given blocks, to get several blocks from a small input. */
function streamOf(...blocks: string[]): Blob {
  return {
    size: blocks.join('').length,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          blocks.forEach((block) => controller.enqueue(utf8(block)));
          controller.close();
        },
      }),
  } as unknown as Blob;
}

describe('blobChunks', () => {
  it('should give the whole content of the blob in order when it is read block by block', async () => {
    // Arrange
    const text = readSample('serilog-realistic.log');

    // Act
    const parts: Uint8Array[] = [];
    for await (const chunk of blobChunks(blobOf(text))) {
      parts.push(chunk);
    }

    // Assert
    expect(new TextDecoder().decode(await new Blob(parts as BlobPart[]).arrayBuffer())).toBe(text);
  });
});

describe('runScan', () => {
  it('should send the errors then a done message with the totals when the profile is known', async () => {
    // Act
    const messages = await run(blobOf(readSample('serilog-realistic.log')), 'serilog-file');

    // Assert
    const errors = messages.flatMap((message) => (message.type === 'errors' ? message.records : []));
    const last = messages.at(-1);
    expect(errors).toHaveLength(9);
    expect(last).toMatchObject({ type: 'done', result: { entries: 17, errors: 9, limitReached: false } });
  });

  it('should leave out the entries of the preparation and report how many when a rule is given', async () => {
    // Act
    const messages = await run(blobOf(readSample('real-serilog.log')), 'serilog-console', undefined, { ...EMPTY_PREPARATION, ignoreTexts: ['/health'] });

    // Assert
    const errors = messages.flatMap((message) => (message.type === 'errors' ? message.records : []));
    expect(errors).toHaveLength(0);
    expect(messages.at(-1)).toMatchObject({ type: 'done', result: { entries: 21, ignored: 15, ignoredPerRule: [15], ignoredByPeriod: 0, errors: 0 } });
  });

  it('should leave out the entries outside the period when one is given', async () => {
    // Act
    const messages = await run(blobOf(readSample('real-serilog.log')), 'serilog-console', undefined, { ...EMPTY_PREPARATION, period: { from: '12:06', to: '12:06' } });

    // Assert
    expect(messages.at(-1)).toMatchObject({ type: 'done', result: { entries: 21, ignored: 7, ignoredByPeriod: 7, errors: 2 } });
  });

  it('should refuse a period that is not valid with the reason, instead of scanning without it', async () => {
    // Act
    const messages = await run(blobOf(readSample('real-serilog.log')), 'serilog-console', undefined, { ...EMPTY_PREPARATION, period: { from: '22:00', to: '02:00' } });

    // Assert
    expect(messages).toEqual([{ type: 'failed', message: 'La fin doit suivre le début : un passage de minuit n’est pas géré.' }]);
  });

  it('should send a failed message naming the profile when the profile id is unknown', async () => {
    // Act
    const messages = await run(blobOf('anything'), 'no-such-profile');

    // Assert
    expect(messages).toEqual([{ type: 'failed', message: expect.stringContaining('no-such-profile') as unknown }]);
  });

  it('should send a failed message with the reason when the source cannot be read', async () => {
    // Arrange
    const unreadable = {
      stream: () => {
        throw new DOMException('gone', 'NotFoundError');
      },
    } as unknown as Blob;

    // Act
    const messages = await run(unreadable, 'serilog-file');

    // Assert
    expect(messages).toEqual([{ type: 'failed', message: expect.stringContaining('modifié, déplacé') as unknown }]);
  });

  it('should send a progress message for each block when enough time has passed between blocks', async () => {
    // Arrange
    let clock = 0;
    const source = streamOf('[08:16:10 ERR] A\n', '[08:16:11 ERR] B\n', '[08:16:12 ERR] C\n');

    // Act
    const messages = await run(source, 'serilog-console', () => (clock += 1000));

    // Assert
    expect(messages.filter((message) => message.type === 'progress')).toHaveLength(3);
  });

  it('should send at most one progress message when the blocks follow each other too fast', async () => {
    // Arrange
    const source = streamOf('[08:16:10 ERR] A\n', '[08:16:11 ERR] B\n', '[08:16:12 ERR] C\n');

    // Act
    const messages = await run(source, 'serilog-console', () => 0);

    // Assert
    expect(messages.filter((message) => message.type === 'progress')).toHaveLength(1);
  });
});
