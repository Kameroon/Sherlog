// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREPARATION,
  MAX_IGNORE_TEXTS,
  MAX_IGNORE_TEXT_CHARS,
  addIgnoreText,
  createEntryFilter,
  removeIgnoreText,
} from '../src/core/preparation';
import type { Preparation } from '../src/core/preparation';
import { CONSOLE_PROFILE } from '../src/core/profiles';
import { parseBytes } from './helpers/parseLog';
import { readSample, utf8 } from './helpers/samples';

const preparationOf = (...ignoreTexts: string[]): Preparation => ({ ignoreTexts });
const sampleEntries = (name: string) => parseBytes(utf8(readSample(name))).entries;

describe('addIgnoreText', () => {
  it('should add the text without the spaces around it when the rule is valid', () => {
    // Act
    const edit = addIgnoreText(EMPTY_PREPARATION, '  /health ');

    // Assert
    expect(edit).toEqual({ ok: true, preparation: { ignoreTexts: ['/health'] } });
  });

  it('should keep the rules in the order they were added', () => {
    // Arrange
    const first = addIgnoreText(EMPTY_PREPARATION, '/health');

    // Act
    const edit = first.ok ? addIgnoreText(first.preparation, 'ping') : first;

    // Assert
    expect(edit).toEqual({ ok: true, preparation: { ignoreTexts: ['/health', 'ping'] } });
  });

  it.each(['', '   ', '\t'])('should refuse the empty text %j and say what to write', (text) => {
    // Act
    const edit = addIgnoreText(EMPTY_PREPARATION, text);

    // Assert
    expect(edit).toEqual({ ok: false, reason: 'Écrivez d’abord le texte à ignorer, par exemple /health.' });
  });

  it('should refuse a rule that already exists, whatever its case', () => {
    // Act
    const edit = addIgnoreText(preparationOf('/Health'), ' /HEALTH');

    // Assert
    expect(edit).toEqual({ ok: false, reason: 'Cette règle existe déjà.' });
  });

  it('should refuse a text longer than the limit and say the limit', () => {
    // Act
    const edit = addIgnoreText(EMPTY_PREPARATION, 'x'.repeat(MAX_IGNORE_TEXT_CHARS + 1));

    // Assert
    expect(edit).toEqual({ ok: false, reason: `Ce texte dépasse ${MAX_IGNORE_TEXT_CHARS} caractères.` });
  });

  it('should accept a text of exactly the limit', () => {
    // Act
    const edit = addIgnoreText(EMPTY_PREPARATION, 'x'.repeat(MAX_IGNORE_TEXT_CHARS));

    // Assert
    expect(edit.ok).toBe(true);
  });

  it('should refuse a new rule once the maximum number of rules is reached and say the maximum', () => {
    // Arrange
    const full = preparationOf(...Array.from({ length: MAX_IGNORE_TEXTS }, (_, index) => `rule ${index}`));

    // Act
    const edit = addIgnoreText(full, 'one more');

    // Assert
    expect(edit).toEqual({ ok: false, reason: `${MAX_IGNORE_TEXTS} règles au maximum : retirez-en une avant d’en ajouter.` });
  });

  it('should not change the preparation it was given', () => {
    // Arrange
    const before = preparationOf('/health');

    // Act
    addIgnoreText(before, 'ping');

    // Assert
    expect(before).toEqual({ ignoreTexts: ['/health'] });
  });
});

describe('removeIgnoreText', () => {
  it('should remove only the rule at the given position', () => {
    // Act
    const after = removeIgnoreText(preparationOf('a', 'b', 'c'), 1);

    // Assert
    expect(after).toEqual({ ignoreTexts: ['a', 'c'] });
  });
});

describe('createEntryFilter', () => {
  it('should ignore nothing and count nothing when there is no rule', () => {
    // Arrange
    const filter = createEntryFilter(EMPTY_PREPARATION);

    // Act
    const ignored = sampleEntries('sample.log').filter((entry) => filter.ignores(entry));

    // Assert
    expect({ ignored: ignored.length, counts: filter.counts() }).toEqual({ ignored: 0, counts: { ignored: 0, ignoredPerRule: [] } });
  });

  it('should ignore the entries whose text contains the rule, whatever the case', () => {
    // Arrange
    const filter = createEntryFilter(preparationOf('HEALTH CHECK'));

    // Act
    const ignored = sampleEntries('sample.log').filter((entry) => filter.ignores(entry));

    // Assert
    expect(ignored.map((entry) => entry.firstLine)).toEqual(['2026-11-04 10:03:10.001 +01:00 [INF] Health check failed, switching to degraded mode']);
  });

  it('should look at the lines after the header too, since they belong to the entry', () => {
    // Arrange: the class name is only on a stack line of the entry.
    const filter = createEntryFilter(preparationOf('NullReferenceException'));

    // Act
    const ignored = sampleEntries('sample.log').filter((entry) => filter.ignores(entry));

    // Assert
    expect(ignored.map((entry) => entry.level)).toEqual(['ERR']);
  });

  it('should count an entry once in the total and once for each rule that matches it', () => {
    // Arrange: both rules match both timeout entries.
    const filter = createEntryFilter(preparationOf('timeout', 'PaymentGateway', 'no such text'));

    // Act
    sampleEntries('sample.log').forEach((entry) => filter.ignores(entry));

    // Assert
    expect(filter.counts()).toEqual({ ignored: 2, ignoredPerRule: [2, 2, 0] });
  });

  it('should also apply to a line before the first header', () => {
    // Arrange
    const bytes = utf8('Starting up /health probe\n[08:16:10 ERR] Failed\n');
    const [orphan] = parseBytes(bytes, bytes.length, CONSOLE_PROFILE).entries;
    const filter = createEntryFilter(preparationOf('/health'));

    // Act
    const ignored = orphan === undefined ? null : filter.ignores(orphan);

    // Assert
    expect(ignored).toBe(true);
  });
});
