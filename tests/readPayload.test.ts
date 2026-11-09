// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summariseIdentical } from '../src/core/identicalErrors';
import { DEFAULT_ENABLED_RULES } from '../src/core/redact';
import type { ErrorRecord } from '../src/core/scanLog';
import type { EntryPosition, EntryText } from '../src/sources/readEntryText';
import type { NeighbourLines } from '../src/sources/readNeighbourLines';
import { readPayload } from '../src/ui/readPayload';

const record = (index: number, fingerprintId: number): ErrorRecord => ({
  offset: index * 100,
  length: 90,
  timestamp: `2026-11-04 08:00:${String(index).padStart(2, '0')}`,
  level: 'ERR',
  message: `failure ${index}`,
  messageCut: false,
  lineCount: 1,
  fingerprintId,
});

const records = [record(0, 0), record(1, 0), record(2, 1)];
const groups = summariseIdentical(records);
const noLines: NeighbourLines = { before: [], after: [], beforeLimited: false, afterLimited: false };
const entryOf = (position: EntryPosition): EntryText => ({ text: `entry at ${position.offset} for jane@example.com`, cut: false });

const inputs = (overrides: Partial<Parameters<typeof readPayload>[0]> = {}): Parameters<typeof readPayload>[0] => ({
  records,
  groups,
  fingerprintId: 0,
  hasDate: true,
  fileName: 'app.log',
  countIsMinimum: false,
  readText: (position) => Promise.resolve(entryOf(position)),
  readNeighbours: () => Promise.resolve(noLines),
  ...overrides,
});

describe('readPayload', () => {
  it('should read the most recent occurrence of the fingerprint and build the text that is sent, masked', async () => {
    // Act
    const result = await readPayload(inputs(), DEFAULT_ENABLED_RULES, new AbortController().signal);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.text).toContain('entry at 100');
      expect(result.payload.text).toContain('[EMAIL]');
      expect(result.payload.text).not.toContain('jane@example.com');
      expect(result.payload.text).toContain('Occurrences : 2');
    }
  });

  it('should say when the error is no longer in the list', async () => {
    // Act
    const result = await readPayload(inputs({ fingerprintId: 99 }), DEFAULT_ENABLED_RULES, new AbortController().signal);

    // Assert
    expect(result).toEqual({ ok: false, aborted: false, message: 'Cette erreur n’est plus dans la liste.' });
  });

  it('should say why the log could not be read', async () => {
    // Act
    const result = await readPayload(inputs({ readText: () => Promise.reject(new DOMException('gone', 'NotFoundError')) }), DEFAULT_ENABLED_RULES, new AbortController().signal);

    // Assert
    expect(result).toMatchObject({ ok: false, aborted: false });
    expect(result.ok ? '' : result.message).toMatch(/modifié, déplacé/);
  });

  it('should have nothing to say when the read fails after it was given up', async () => {
    // Arrange
    const controller = new AbortController();
    const readText = () => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    };

    // Act
    const result = await readPayload(inputs({ readText }), DEFAULT_ENABLED_RULES, controller.signal);

    // Assert
    expect(result).toEqual({ ok: false, aborted: true, message: '' });
  });
});
