// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENABLED_RULES } from '../src/core/redact';
import type { RedactionRuleId } from '../src/core/redact';
import { MAX_INPUT_CHARS, buildSendPayload } from '../src/core/sendPayload';
import type { SendSource } from '../src/core/sendPayload';

const NO_CHOICE: ReadonlySet<RedactionRuleId> = new Set();
const source = (overrides: Partial<SendSource> = {}): SendSource => ({
  fileName: 'app.log',
  count: 3,
  firstSeen: '08:00:00',
  lastSeen: '09:00:00',
  entry: '2026-11-04 08:16:10 [ERR] Timeout while calling PaymentGateway\n   at Shop.Payments.Charge()',
  entryReadLimitReached: false,
  before: ['line before 1', 'line before 2'],
  after: ['line after 1'],
  ...overrides,
});

describe('buildSendPayload layout', () => {
  it('should give the occurrences, the file, the error and the lines around it, as the prompt template asks', () => {
    // Act
    const { text } = buildSendPayload(source(), DEFAULT_ENABLED_RULES);

    // Assert
    expect(text).toBe(
      [
        'Occurrences : 3 (première : 08:00:00, dernière : 09:00:00)',
        'Fichier : app.log',
        '',
        '--- Erreur ---',
        '2026-11-04 08:16:10 [ERR] Timeout while calling PaymentGateway',
        '   at Shop.Payments.Charge()',
        '',
        '--- Contexte avant ---',
        'line before 1',
        'line before 2',
        '',
        '--- Contexte après ---',
        'line after 1',
      ].join('\n'),
    );
  });

  it('should say « sans heure » when an occurrence has no time', () => {
    // Act
    const { text } = buildSendPayload(source({ firstSeen: null, lastSeen: null }), DEFAULT_ENABLED_RULES);

    // Assert
    expect(text).toContain('(première : sans heure, dernière : sans heure)');
  });

  it('should say the count is a minimum when errors past the record limit were not recorded', () => {
    // Act
    const { text } = buildSendPayload(source({ countIsMinimum: true }), DEFAULT_ENABLED_RULES);

    // Assert
    expect(text).toContain('Occurrences : au moins 3');
  });

  it('should say there is no line when a side of the context is empty', () => {
    // Act
    const { text } = buildSendPayload(source({ before: [], after: [] }), DEFAULT_ENABLED_RULES);

    // Assert
    expect(text).toContain('--- Contexte avant ---\n(aucune ligne)');
    expect(text).toContain('--- Contexte après ---\n(aucune ligne)');
  });

  it('should add no note when everything fits', () => {
    // Act
    const payload = buildSendPayload(source(), DEFAULT_ENABLED_RULES);

    // Assert
    expect(payload.note).toBeNull();
    expect(payload.cut).toEqual({ entry: false, before: false, after: false });
  });
});

describe('buildSendPayload masking', () => {
  it('should mask the entry, the lines around it and the file name', () => {
    // Arrange
    const sensitive = source({
      fileName: 'orders-a@b.example.org.log',
      entry: 'failed for john.doe@example.com with Password=S3cr3t!',
      before: ['call from 10.0.4.17'],
      after: ['Authorization: Bearer abc123.def456 sent'],
    });

    // Act
    const { text } = buildSendPayload(sensitive, DEFAULT_ENABLED_RULES);

    // Assert
    expect(text).not.toMatch(/john\.doe|S3cr3t|10\.0\.4\.17|abc123|a@b\.example/);
    expect(text).toContain('[EMAIL]');
    expect(text).toContain('Password=[SECRET]');
    expect(text).toContain('call from [IP]');
    expect(text).toContain('Authorization: Bearer [SECRET]');
  });

  it('should still mask what is on by default when the user chose no rule', () => {
    // Act
    const { text } = buildSendPayload(source({ entry: 'failed for john.doe@example.com' }), NO_CHOICE);

    // Assert
    expect(text).toContain('[EMAIL]');
  });

  it('should mask an option only when the user chose it', () => {
    // Arrange
    const guid = '7ecb1df3-8db1-4137-8038-9584ac6f3083';
    const withGuid = source({ entry: `request ${guid} failed` });

    // Act
    const without = buildSendPayload(withGuid, DEFAULT_ENABLED_RULES);
    const chosen = buildSendPayload(withGuid, new Set<RedactionRuleId>(['guid']));

    // Assert
    expect(without.text).toContain(guid);
    expect(chosen.text).toContain('[GUID]');
  });

  it('should count what it masked', () => {
    // Act
    const { maskedCount } = buildSendPayload(source({ entry: 'a@b.example.org and c@d.example.org', before: ['10.0.4.17'] }), DEFAULT_ENABLED_RULES);

    // Assert
    expect(maskedCount).toBe(3);
  });

  it('should find an address that is cut across two lines of the entry as one text', () => {
    // Arrange: a header split over two lines still has to be masked, since the entry is masked as a whole.
    const split = source({ entry: 'Authorization:\n Bearer abc123.def456' });

    // Act
    const { text } = buildSendPayload(split, DEFAULT_ENABLED_RULES);

    // Assert
    expect(text).not.toContain('abc123');
  });
});

describe('buildSendPayload header', () => {
  it('should mask the times too, since everything that comes from the log is masked', () => {
    // Act
    const { text } = buildSendPayload(source({ firstSeen: 'at a@b.example.org', lastSeen: 'from 10.0.4.17' }), DEFAULT_ENABLED_RULES);

    // Assert
    expect(text).toContain('(première : at [EMAIL], dernière : from [IP])');
  });
});

describe('buildSendPayload truncation', () => {
  const LIMIT = 500;

  it('should never give more than the limit, and say what was cut', () => {
    // Arrange
    const big = source({ entry: 'e'.repeat(5000), before: Array.from({ length: 50 }, (_, i) => `before line ${i}`), after: Array.from({ length: 50 }, (_, i) => `after line ${i}`) });

    // Act
    const payload = buildSendPayload(big, DEFAULT_ENABLED_RULES, LIMIT);

    // Assert
    expect(payload.text.length).toBeLessThanOrEqual(LIMIT);
    expect(payload.cut.entry).toBe(true);
    expect(payload.note).toBe(`Note : le contenu a été tronqué à ${LIMIT} caractères.`);
  });

  it('should keep the start of an entry that is too long', () => {
    // Arrange
    const long = source({ entry: `Unhandled ${'x'.repeat(5000)} END` });

    // Act
    const { text } = buildSendPayload(long, DEFAULT_ENABLED_RULES, LIMIT);

    // Assert
    expect(text).toContain('Unhandled xxx');
    expect(text).not.toContain('END');
  });

  it('should keep the lines nearest to the error, whole, and drop the far ones', () => {
    // Arrange
    const lines = (prefix: string) => Array.from({ length: 40 }, (_, i) => `${prefix} ${String(i).padStart(2, '0')}`);
    const crowded = source({ entry: 'short entry', before: lines('before'), after: lines('after') });

    // Act
    const { text, cut } = buildSendPayload(crowded, DEFAULT_ENABLED_RULES, LIMIT);

    // Assert
    expect(text).toContain('before 39');
    expect(text).not.toContain('before 00');
    expect(text).toContain('after 00');
    expect(text).not.toContain('after 39');
    expect(cut).toEqual({ entry: false, before: true, after: true });
    for (const line of text.split('\n').filter((candidate) => /^(before|after) /.test(candidate))) {
      expect(line).toMatch(/^(before|after) \d\d$/);
    }
  });

  it('should give the room left by a short side to the other one', () => {
    // Arrange
    const lopsided = source({ entry: 'short entry', before: [], after: Array.from({ length: 80 }, (_, i) => `after line number ${String(i).padStart(2, '0')}`) });

    // Act
    const { text } = buildSendPayload(lopsided, DEFAULT_ENABLED_RULES, LIMIT);

    // Assert
    const kept = text.split('\n').filter((line) => line.startsWith('after line'));
    expect(kept.length).toBeGreaterThan(8);
    expect(text.length).toBeLessThanOrEqual(LIMIT);
  });

  it('should keep the entry whole before it keeps any line around it', () => {
    // Arrange
    const entry = 'E'.repeat(200);
    const crowded = source({ entry, before: ['b'.repeat(300)], after: ['a'.repeat(300)] });

    // Act
    const { text, cut } = buildSendPayload(crowded, DEFAULT_ENABLED_RULES, LIMIT);

    // Assert
    expect(text).toContain(entry);
    expect(cut.entry).toBe(false);
  });

  it('should mask before it cuts, so that no part of a secret is sent', () => {
    // Arrange: the limit is set so that an unmasked cut would fall five characters into the password.
    const bare = source({ entry: '', before: [], after: [] });
    const overhead = buildSendPayload(bare, DEFAULT_ENABLED_RULES, 100_000).text.length;
    const prefix = `${'x'.repeat(100)} password=`;
    const risky = { ...bare, entry: `${prefix}hunter2hunter2hunter2hunter2` };

    // Act
    const { text } = buildSendPayload(risky, DEFAULT_ENABLED_RULES, overhead + prefix.length + 5);

    // Assert
    expect(text).not.toContain('hunt');
    expect(text).toContain('password=');
  });

  it('should say the entry is cut when it was already cut by the limit on what is read', () => {
    // Act
    const { cut, note } = buildSendPayload(source({ entryReadLimitReached: true }), DEFAULT_ENABLED_RULES);

    // Assert
    expect(cut.entry).toBe(true);
    expect(note).not.toBeNull();
  });

  it('should have a limit that is stated and not tiny', () => {
    // Assert
    expect(MAX_INPUT_CHARS).toBeGreaterThanOrEqual(4000);
  });

  it('should not start a line of the context with half a pair of UTF-16 units when it cuts it', () => {
    // Arrange: a single line of the context is longer than the room left, and the room takes every size in turn so that
    // the cut falls inside an emoji for half of them.
    const crowded = source({ entry: 'short', before: ['😀'.repeat(300)], after: [] });
    const limits = Array.from({ length: 40 }, (_, step) => 300 + step);

    // Act
    const broken = limits.filter((limit) => /(?<![\ud800-\udbff])[\udc00-\udfff]/.test(buildSendPayload(crowded, DEFAULT_ENABLED_RULES, limit).text));

    // Assert
    expect(broken).toEqual([]);
  });

  it('should not break a pair of UTF-16 units when it cuts an entry', () => {
    // Arrange
    const emoji = source({ entry: '😀'.repeat(400) });

    // Act
    const { text } = buildSendPayload(emoji, DEFAULT_ENABLED_RULES, 300);

    // Assert
    expect(text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});
