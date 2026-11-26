// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_LIST_ITEMS, MAX_TEXT_CHARS } from '../src/ai/analysis';
import { MAX_HISTORY_ENTRIES, mergeHistory, parseHistoryRecord, upsertRecord } from '../src/store/history';
import type { HistoryRecord } from '../src/store/history';

const KEY = 'a'.repeat(64);
const NOW = new Date('2026-11-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const analysis = {
  summary: 'Le paiement échoue.',
  probableCause: 'Le délai de la passerelle est dépassé.',
  severity: 'high',
  confidence: 'medium',
  evidence: ['TimeoutException après 30 s'],
  suggestedFixes: [{ title: 'Augmenter le délai', details: 'Passer à 60 s.', codeHint: 'timeout: 60' }],
  missingInfo: ['La configuration réseau'],
};

const analysed = {
  key: KEY,
  status: 'analysed',
  updatedAt: '2026-11-14T08:30:00.000Z',
  analysis: { analysis, at: '2026-11-14T08:30:00.000Z', by: 'claude-haiku-5-5 (Anthropic)' },
};

const resolved = { key: 'b'.repeat(64), status: 'resolved', updatedAt: '2026-11-13T09:00:00.000Z', analysis: null };

const parse = (value: unknown) => parseHistoryRecord(value, NOW);
const reasonOf = (value: unknown): string => {
  const result = parse(value);
  return result.ok ? '' : result.reason;
};

/** A valid record under `key`, updated at `updatedAt`, for the tests of the list. */
const record = (key: string, updatedAt: string, status: HistoryRecord['status'] = 'resolved'): HistoryRecord => ({ key, status, updatedAt, analysis: null });
const keyOf = (index: number): string => index.toString(16).padStart(64, '0');

describe('parseHistoryRecord of a valid record', () => {
  it('should give back an analysed record with its analysis', () => {
    // Act
    const result = parse(analysed);

    // Assert
    expect(result).toEqual({ ok: true, record: analysed });
  });

  it('should give back a decision of the user that has no analysis', () => {
    // Act
    const result = parse(resolved);

    // Assert
    expect(result).toEqual({ ok: true, record: resolved });
  });

  it.each(['ignored', 'resolved'])('should accept an analysis for a record that is %s', (status) => {
    // Act
    const result = parse({ ...analysed, status });

    // Assert
    expect(result.ok).toBe(true);
  });

  it('should keep only the fields of the schema when the data carries others', () => {
    // Arrange
    const withExtras = { ...analysed, text: 'un morceau du journal', apiKey: 'sk-secret', analysis: { ...analysed.analysis, chat: ['question'] } };

    // Act
    const result = parse(withExtras);

    // Assert
    expect(result).toEqual({ ok: true, record: analysed });
    expect(JSON.stringify(result)).not.toContain('sk-secret');
    expect(JSON.stringify(result)).not.toContain('un morceau du journal');
  });

  it('should not let a __proto__ key of parsed JSON reach the record', () => {
    // Arrange
    const hostile: unknown = JSON.parse(`{"key":"${KEY}","status":"resolved","updatedAt":"2026-11-13T09:00:00.000Z","analysis":null,"__proto__":{"status":"analysed"}}`);

    // Act
    const result = parse(hostile);

    // Assert
    expect(result).toEqual({ ok: true, record: { ...resolved, key: KEY } });
  });

  it('should accept a date exactly one day after now', () => {
    // Arrange
    const limit = new Date(NOW.getTime() + DAY_MS).toISOString();

    // Act
    const result = parse({ ...resolved, updatedAt: limit });

    // Assert
    expect(result.ok).toBe(true);
  });
});

describe('parseHistoryRecord of a record that is not one', () => {
  it.each([
    ['null', null],
    ['a list', [resolved]],
    ['a text', 'resolved'],
    ['a number', 4],
  ])('should refuse %s', (_name, value) => {
    // Act & Assert
    expect(reasonOf(value)).toContain('objet');
  });

  it.each([
    ['capitals', 'A'.repeat(64)],
    ['63 characters', 'a'.repeat(63)],
    ['65 characters', 'a'.repeat(65)],
    ['a character that is not hexadecimal', `${'a'.repeat(63)}g`],
    ['a path', '../../etc/passwd'],
    ['a number', 12],
  ])('should refuse a key that is %s', (_name, key) => {
    // Act & Assert
    expect(reasonOf({ ...resolved, key })).toContain('clé');
  });

  it.each(['new', 'done', '', 3])('should refuse the status %j', (status) => {
    // Act & Assert
    expect(reasonOf({ ...resolved, status })).toContain('statut');
  });

  it('should refuse an analysed record that has no analysis', () => {
    // Act & Assert
    expect(reasonOf({ ...resolved, status: 'analysed' })).toContain('analyse');
  });

  it('should refuse an analysis that does not follow the schema, and say which field', () => {
    // Arrange
    const broken = { ...analysed, analysis: { ...analysed.analysis, analysis: { ...analysis, severity: 'enormous' } } };

    // Act & Assert
    expect(reasonOf(broken)).toContain('severity');
  });

  it('should refuse an analysis text over the limit of the schema', () => {
    // Arrange
    const long = { ...analysed, analysis: { ...analysed.analysis, analysis: { ...analysis, summary: 'x'.repeat(MAX_TEXT_CHARS + 1) } } };

    // Act & Assert
    expect(reasonOf(long)).toContain('summary');
  });

  it('should refuse an analysis list over the limit of the schema', () => {
    // Arrange
    const many = { ...analysed, analysis: { ...analysed.analysis, analysis: { ...analysis, evidence: Array.from({ length: MAX_LIST_ITEMS + 1 }, () => 'x') } } };

    // Act & Assert
    expect(reasonOf(many)).toContain('evidence');
  });

  it.each([
    ['a date without time', '2026-11-14'],
    ['a date with an offset', '2026-11-14T08:30:00.000+01:00'],
    ['a date without milliseconds', '2026-11-14T08:30:00Z'],
    ['a day that does not exist', '2026-02-30T08:30:00.000Z'],
    ['a month that does not exist', '2026-13-14T08:30:00.000Z'],
    // Valid for `toISOString`, but it would not sort as text, which the merge relies on.
    ['a negative year', '-000001-01-01T00:00:00.000Z'],
    ['a text', 'yesterday'],
    ['a number', 1_763_000_000_000],
  ])('should refuse the update date when it is %s', (_name, updatedAt) => {
    // Act & Assert
    expect(reasonOf({ ...resolved, updatedAt })).toContain('date');
  });

  it('should refuse the date of the analysis when it is not a date', () => {
    // Arrange
    const broken = { ...analysed, analysis: { ...analysed.analysis, at: 'hier' } };

    // Act & Assert
    expect(reasonOf(broken)).toContain('date');
  });

  it('should refuse an update date more than one day after now', () => {
    // Arrange
    const tooLate = new Date(NOW.getTime() + DAY_MS + 1).toISOString();

    // Act & Assert
    expect(reasonOf({ ...resolved, updatedAt: tooLate })).toContain('futur');
  });

  it('should refuse the date of the analysis when it is more than one day after now', () => {
    // Arrange
    const tooLate = new Date(NOW.getTime() + DAY_MS + 1).toISOString();
    const broken = { ...analysed, analysis: { ...analysed.analysis, at: tooLate } };

    // Act & Assert
    expect(reasonOf(broken)).toContain('futur');
  });

  it.each([
    ['a text that is too long', 'm'.repeat(201)],
    ['an empty text', ''],
    ['a number', 7],
  ])('should refuse the name of the model when it is %s', (_name, by) => {
    // Arrange
    const broken = { ...analysed, analysis: { ...analysed.analysis, by } };

    // Act & Assert
    expect(reasonOf(broken)).toContain('modèle');
  });

  it('should refuse an analysis that is neither an object nor null', () => {
    // Act & Assert
    expect(reasonOf({ ...resolved, analysis: 'texte' })).toContain('analyse');
  });
});

describe('upsertRecord', () => {
  it('should add a record under a key the history does not have', () => {
    // Arrange
    const existing = [record(keyOf(1), '2026-11-10T00:00:00.000Z')];

    // Act
    const result = upsertRecord(existing, record(keyOf(2), '2026-11-11T00:00:00.000Z'), 10);

    // Assert
    expect(result).toEqual({ ok: true, records: [existing[0], record(keyOf(2), '2026-11-11T00:00:00.000Z')] });
  });

  it('should replace the record under the same key, even when its date is older or equal', () => {
    // Arrange
    const existing = [record(keyOf(1), '2026-11-10T00:00:00.000Z', 'ignored'), record(keyOf(2), '2026-11-10T00:00:00.000Z')];

    // Act
    const result = upsertRecord(existing, record(keyOf(1), '2026-11-10T00:00:00.000Z', 'resolved'), 10);

    // Assert
    expect(result).toEqual({ ok: true, records: [record(keyOf(1), '2026-11-10T00:00:00.000Z', 'resolved'), existing[1]] });
  });

  it('should refuse a new key when the history is full, and say so', () => {
    // Arrange
    const full = [record(keyOf(1), '2026-11-10T00:00:00.000Z'), record(keyOf(2), '2026-11-10T00:00:00.000Z')];

    // Act
    const result = upsertRecord(full, record(keyOf(3), '2026-11-11T00:00:00.000Z'), 2);

    // Assert
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('plein') as unknown });
  });

  it('should still replace a record when the history is full', () => {
    // Arrange
    const full = [record(keyOf(1), '2026-11-10T00:00:00.000Z'), record(keyOf(2), '2026-11-10T00:00:00.000Z')];

    // Act
    const result = upsertRecord(full, record(keyOf(2), '2026-11-11T00:00:00.000Z', 'ignored'), 2);

    // Assert
    expect(result).toEqual({ ok: true, records: [full[0], record(keyOf(2), '2026-11-11T00:00:00.000Z', 'ignored')] });
  });

  it('should not change the list it is given', () => {
    // Arrange
    const existing = [record(keyOf(1), '2026-11-10T00:00:00.000Z')];
    const copy = structuredClone(existing);

    // Act
    upsertRecord(existing, record(keyOf(2), '2026-11-11T00:00:00.000Z'), 10);
    upsertRecord(existing, record(keyOf(1), '2026-11-12T00:00:00.000Z', 'ignored'), 10);

    // Assert
    expect(existing).toEqual(copy);
  });
});

describe('mergeHistory', () => {
  it('should keep the record with the later date when a key is in both', () => {
    // Arrange
    const mine = [record(keyOf(1), '2026-11-10T00:00:00.000Z', 'ignored'), record(keyOf(2), '2026-11-12T00:00:00.000Z', 'ignored')];
    const theirs = [record(keyOf(1), '2026-11-11T00:00:00.000Z', 'resolved'), record(keyOf(2), '2026-11-11T00:00:00.000Z', 'resolved')];

    // Act
    const result = mergeHistory(mine, theirs, 10);

    // Assert
    expect(result).toEqual({ ok: true, records: [record(keyOf(1), '2026-11-11T00:00:00.000Z', 'resolved'), record(keyOf(2), '2026-11-12T00:00:00.000Z', 'ignored')] });
  });

  it('should keep the existing record when both have the same date', () => {
    // Arrange
    const mine = [record(keyOf(1), '2026-11-10T00:00:00.000Z', 'ignored')];
    const theirs = [record(keyOf(1), '2026-11-10T00:00:00.000Z', 'resolved')];

    // Act
    const result = mergeHistory(mine, theirs, 10);

    // Assert
    expect(result).toEqual({ ok: true, records: mine });
  });

  it('should add the records whose key the history does not have', () => {
    // Arrange
    const mine = [record(keyOf(1), '2026-11-10T00:00:00.000Z')];
    const theirs = [record(keyOf(2), '2026-11-10T00:00:00.000Z'), record(keyOf(3), '2026-11-10T00:00:00.000Z')];

    // Act
    const result = mergeHistory(mine, theirs, 10);

    // Assert
    expect(result).toEqual({ ok: true, records: [mine[0], theirs[0], theirs[1]] });
  });

  it('should accept a merge that reaches the limit exactly', () => {
    // Arrange
    const mine = [record(keyOf(1), '2026-11-10T00:00:00.000Z')];
    const theirs = [record(keyOf(2), '2026-11-10T00:00:00.000Z')];

    // Act
    const result = mergeHistory(mine, theirs, 2);

    // Assert
    expect(result.ok).toBe(true);
  });

  it('should refuse the whole merge when it goes over the limit, and say so', () => {
    // Arrange
    const mine = [record(keyOf(1), '2026-11-10T00:00:00.000Z')];
    const theirs = [record(keyOf(2), '2026-11-10T00:00:00.000Z'), record(keyOf(3), '2026-11-10T00:00:00.000Z')];

    // Act
    const result = mergeHistory(mine, theirs, 2);

    // Assert
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('plein') as unknown });
  });

  it('should count a key that is in both once when it checks the limit', () => {
    // Arrange
    const mine = [record(keyOf(1), '2026-11-10T00:00:00.000Z'), record(keyOf(2), '2026-11-10T00:00:00.000Z')];
    const theirs = [record(keyOf(2), '2026-11-11T00:00:00.000Z')];

    // Act
    const result = mergeHistory(mine, theirs, 2);

    // Assert
    expect(result.ok).toBe(true);
  });

  it('should not change the lists it is given', () => {
    // Arrange
    const mine = [record(keyOf(1), '2026-11-10T00:00:00.000Z')];
    const theirs = [record(keyOf(1), '2026-11-11T00:00:00.000Z', 'ignored')];
    const copies = [structuredClone(mine), structuredClone(theirs)];

    // Act
    mergeHistory(mine, theirs, 10);

    // Assert
    expect([mine, theirs]).toEqual(copies);
  });
});

describe('MAX_HISTORY_ENTRIES', () => {
  it('should be a positive whole number', () => {
    // Assert
    expect(Number.isInteger(MAX_HISTORY_ENTRIES) && MAX_HISTORY_ENTRIES > 0).toBe(true);
  });
});
