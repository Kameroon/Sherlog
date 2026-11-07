// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { scanLog } from '../src/core/scanLog';
import { DEFAULT_PROFILE } from '../src/core/profiles';
import { readFailureMessage } from '../src/sources/readFailure';
import { readEntryText } from '../src/sources/readEntryText';
import { errorEntries, parseBytes } from './helpers/parseLog';
import { inBlocks, readSample, utf16, utf8 } from './helpers/samples';

describe('readEntryText', () => {
  const original = readSample('serilog-realistic.log');

  const sources: [string, Uint8Array, 'utf-8' | 'utf-16le' | 'utf-16be'][] = [
    ['UTF-8', utf8(original), 'utf-8'],
    ['UTF-8 with CRLF', utf8(original.replace(/\n/g, '\r\n')), 'utf-8'],
    ['UTF-8 with a byte order mark', Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(original)]), 'utf-8'],
    ['UTF-16 LE', utf16(original, 'le'), 'utf-16le'],
    ['UTF-16 BE', utf16(original, 'be'), 'utf-16be'],
  ];

  it.each(sources)('should give back the text of every error when the source is %s', async (_label, bytes, encoding) => {
    // Arrange
    const records: { offset: number; length: number }[] = [];
    await scanLog(inBlocks(bytes, 64), { profile: DEFAULT_PROFILE }, { onErrors: (batch) => records.push(...batch), onProgress: () => undefined });
    const expected = errorEntries(parseBytes(bytes).entries).map((entry) => entry.text);
    const blob = new Blob([bytes as BlobPart]);

    // Act
    const texts = await Promise.all(records.map((record) => readEntryText(blob, record, encoding)));

    // Assert
    expect(texts).toEqual(expected);
  });

  it('should reject when the source cannot be read any more', async () => {
    // Arrange
    const unreadable = { slice: () => ({ arrayBuffer: () => Promise.reject(new DOMException('changed', 'NotReadableError')) }) } as unknown as Blob;

    // Act
    const text = readEntryText(unreadable, { offset: 0, length: 10 }, 'utf-8');

    // Assert
    await expect(text).rejects.toMatchObject({ name: 'NotReadableError' });
  });
});

describe('readFailureMessage', () => {
  it.each(['NotFoundError', 'NotReadableError'])('should say the file changed or moved when the browser reports %s', (name) => {
    // Act
    const message = readFailureMessage(new DOMException('details', name));

    // Assert
    expect(message).toContain('modifié, déplacé ou n’est plus lisible');
  });

  it('should keep the reason of another failure so that it can be told apart', () => {
    // Act
    const message = readFailureMessage(new Error('out of memory'));

    // Assert
    expect(message).toBe('Lecture impossible : out of memory.');
  });

  it('should not break when what was thrown is not an error', () => {
    // Act
    const message = readFailureMessage('boom');

    // Assert
    expect(message).toBe('Lecture impossible : cause inconnue.');
  });
});
