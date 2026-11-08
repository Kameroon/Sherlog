// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readHead } from '../src/sources/readHead';
import { readSample, utf16, utf8 } from './helpers/samples';

const blobOf = (bytes: Uint8Array): Blob => new Blob([bytes as BlobPart]);

describe('readHead recognition', () => {
  it.each([
    ['sample.log', 'serilog-file'],
    ['serilog-console.log', 'serilog-console'],
    ['real-serilog.log', 'serilog-console'],
  ])('should recognise the profile of %s', async (file, profileId) => {
    // Act
    const { detection } = await readHead(blobOf(utf8(readSample(file))));

    // Assert
    expect(detection).toMatchObject({ status: 'detected', encoding: 'utf-8', profile: { id: profileId } });
  });

  it('should report the encoding when the file is UTF-16 with a byte order mark', async () => {
    // Act
    const { detection } = await readHead(blobOf(utf16(readSample('sample.log'), 'le')));

    // Assert
    expect(detection).toMatchObject({ status: 'detected', encoding: 'utf-16le', profile: { id: 'serilog-file' } });
  });

  it('should say the content is structured when the first line is JSON', async () => {
    // Act
    const { detection } = await readHead(blobOf(utf8('{"@t":"2026-11-04T08:16:10Z","@l":"Error"}\n')));

    // Assert
    expect(detection).toEqual({ status: 'structured' });
  });

  it('should give the reason when no profile reads the first line', async () => {
    // Act
    const { detection } = await readHead(blobOf(utf8('[10:32:39 BOOT INF] Starting\n')));

    // Assert
    expect(detection).toEqual({ status: 'unrecognized', reason: expect.stringContaining('aucun profil') as unknown });
  });

  it('should say the file is empty when it has no byte', async () => {
    // Act
    const { detection } = await readHead(blobOf(new Uint8Array(0)));

    // Assert
    expect(detection).toEqual({ status: 'unrecognized', reason: expect.stringContaining('vide') as unknown });
  });

  it('should recognise the profile when the cut falls inside a line of the beginning', async () => {
    // Arrange
    const text = '[08:16:10 ERR] First\n[08:16:11 INF] Second\n[08:16:12 ERR] Third\n';
    const head = text.indexOf('Third') + 2;

    // Act
    const { detection } = await readHead(blobOf(utf8(text)), { headBytes: head });

    // Assert
    expect(detection).toMatchObject({ status: 'detected', profile: { id: 'serilog-console' } });
  });

  it('should recognise the profile when the first line is longer than the beginning that is read', async () => {
    // Act
    const { detection } = await readHead(blobOf(utf8(`[08:16:10 ERR] ${'x'.repeat(200)}\n`)), { headBytes: 100 });

    // Assert
    expect(detection).toMatchObject({ status: 'detected', profile: { id: 'serilog-console' } });
  });

  it('should read the first line of a file made of one short line without a line break', async () => {
    // Act
    const { detection } = await readHead(blobOf(utf8('[08:16:10 ERR] Failed')));

    // Assert
    expect(detection).toMatchObject({ status: 'detected', profile: { id: 'serilog-console' } });
  });

  it('should let the read failure through when the file cannot be read', async () => {
    // Arrange
    const unreadable = { size: 10, slice: () => ({ arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotFoundError')) }) } as unknown as Blob;

    // Act
    const detection = readHead(unreadable);

    // Assert
    await expect(detection).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('readHead beginning', () => {
  it('should give back the whole text and say it is complete when the source is smaller than the beginning', async () => {
    // Arrange
    const bytes = utf8('[08:16:10 ERR] Failed\n');

    // Act
    const read = await readHead(blobOf(bytes), { headBytes: 1000 });

    // Assert
    expect({ head: Array.from(read.head), complete: read.complete }).toEqual({ head: Array.from(bytes), complete: true });
  });

  it('should say it is complete when the source is exactly the size of the beginning', async () => {
    // Arrange
    const bytes = utf8('[08:16:10 ERR] Failed\n');

    // Act
    const read = await readHead(blobOf(bytes), { headBytes: bytes.length });

    // Assert
    expect(read.complete).toBe(true);
  });

  it('should give back only the beginning and say it is not complete when the source is bigger', async () => {
    // Arrange
    const bytes = utf8('[08:16:10 ERR] Failed\n[08:16:11 INF] Next\n');

    // Act
    const read = await readHead(blobOf(bytes), { headBytes: 10 });

    // Assert
    expect({ head: Array.from(read.head), complete: read.complete }).toEqual({ head: Array.from(bytes.subarray(0, 10)), complete: false });
  });

  it('should say an empty source is complete', async () => {
    // Act
    const read = await readHead(blobOf(new Uint8Array(0)));

    // Assert
    expect({ length: read.head.length, complete: read.complete }).toEqual({ length: 0, complete: true });
  });
});
