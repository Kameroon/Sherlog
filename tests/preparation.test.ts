// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREPARATION,
  MAX_IGNORE_TEXTS,
  MAX_IGNORE_TEXT_CHARS,
  addIgnoreText,
  createEntryFilter,
  removeIgnoreText,
  validatePeriod,
} from '../src/core/preparation';
import type { Preparation } from '../src/core/preparation';
import { CONSOLE_PROFILE, DEFAULT_PROFILE } from '../src/core/profiles';
import { parseBytes } from './helpers/parseLog';
import { readSample, utf8 } from './helpers/samples';

const preparationOf = (...ignoreTexts: string[]): Preparation => ({ ...EMPTY_PREPARATION, ignoreTexts });
const sampleEntries = (name: string) => parseBytes(utf8(readSample(name))).entries;

describe('addIgnoreText', () => {
  it('should add the text without the spaces around it when the rule is valid', () => {
    // Act
    const edit = addIgnoreText(EMPTY_PREPARATION, '  /health ');

    // Assert
    expect(edit).toEqual({ ok: true, preparation: preparationOf('/health') });
  });

  it('should keep the rules in the order they were added', () => {
    // Arrange
    const first = addIgnoreText(EMPTY_PREPARATION, '/health');

    // Act
    const edit = first.ok ? addIgnoreText(first.preparation, 'ping') : first;

    // Assert
    expect(edit).toEqual({ ok: true, preparation: preparationOf('/health', 'ping') });
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
    expect(before).toEqual(preparationOf('/health'));
  });
});

describe('removeIgnoreText', () => {
  it('should remove only the rule at the given position', () => {
    // Act
    const after = removeIgnoreText(preparationOf('a', 'b', 'c'), 1);

    // Assert
    expect(after).toEqual(preparationOf('a', 'c'));
  });
});

describe('createEntryFilter', () => {
  it('should ignore nothing and count nothing when there is no rule', () => {
    // Arrange
    const filter = createEntryFilter(EMPTY_PREPARATION);

    // Act
    const ignored = sampleEntries('sample.log').filter((entry) => filter.ignores(entry));

    // Assert
    expect({ ignored: ignored.length, counts: filter.counts() }).toEqual({ ignored: 0, counts: { ignored: 0, ignoredPerRule: [], ignoredByPeriod: 0 } });
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
    expect(filter.counts()).toEqual({ ignored: 2, ignoredPerRule: [2, 2, 0], ignoredByPeriod: 0 });
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

const period = (from: string, to: string, ...ignoreTexts: string[]): Preparation => ({ ignoreTexts, period: { from, to } });

describe('validatePeriod', () => {
  it.each([
    ['no bound', '', ''],
    ['a start only', '09:00', ''],
    ['an end only', '', '10:30'],
    ['two times of day', '09:00', '10:30'],
    ['the same minute twice', '09:15', '09:15'],
    ['two dates with a time', '2026-11-04T08:00', '2026-11-05T17:30'],
    ['the same date and minute twice', '2026-11-04T08:00', '2026-11-04T08:00'],
  ])('should accept %s', (_, from, to) => {
    // Act
    const problem = validatePeriod({ from, to });

    // Assert
    expect(problem).toBeNull();
  });

  it.each(['25:00', '09:60', '9:00', '09-00', 'noon', '2026-13-04T08:00', '2026-11-04 08:00', '2026-11-04T24:00'])(
    'should refuse the bound %j as an invalid time or date',
    (bad) => {
      // Act
      const problem = validatePeriod({ from: bad, to: '' });

      // Assert
      expect(problem).toBe('Heure ou date invalide.');
    },
  );

  it('should refuse a start that is a time of day with an end that is a date', () => {
    // Act
    const problem = validatePeriod({ from: '09:00', to: '2026-11-04T10:00' });

    // Assert
    expect(problem).toBe('Le début et la fin doivent être du même type : des heures, ou des dates avec heure.');
  });

  it('should refuse an end before the start and say that midnight is not handled', () => {
    // Act
    const problem = validatePeriod({ from: '22:00', to: '02:00' });

    // Assert
    expect(problem).toBe('La fin doit suivre le début : un passage de minuit n’est pas géré.');
  });

  it('should refuse an end on an earlier date than the start', () => {
    // Act
    const problem = validatePeriod({ from: '2026-11-05T08:00', to: '2026-11-04T23:00' });

    // Assert
    expect(problem).toBe('La fin doit suivre le début : un passage de minuit n’est pas géré.');
  });
});

describe('createEntryFilter with a period of times of day', () => {
  const log = utf8(
    ['[08:16:10 INF] before', '[09:00:00 INF] first minute', '[09:30:12 INF] middle', '[10:00:59 INF] last second of the end minute', '[10:01:00 INF] after'].join('\n') + '\n',
  );
  const keptBy = (preparation: Preparation): string[] => {
    const filter = createEntryFilter(preparation);
    return parseBytes(log, log.length, CONSOLE_PROFILE)
      .entries.filter((entry) => !filter.ignores(entry))
      .map((entry) => entry.timestamp ?? '');
  };

  it('should keep the entries between the two times, the end minute included to its last second', () => {
    // Act
    const kept = keptBy(period('09:00', '10:00'));

    // Assert
    expect(kept).toEqual(['09:00:00', '09:30:12', '10:00:59']);
  });

  it('should keep everything up to the end when there is only an end', () => {
    // Act
    const kept = keptBy(period('', '09:00'));

    // Assert
    expect(kept).toEqual(['08:16:10', '09:00:00']);
  });

  it('should keep everything from the start when there is only a start', () => {
    // Act
    const kept = keptBy(period('10:00', ''));

    // Assert
    expect(kept).toEqual(['10:00:59', '10:01:00']);
  });

  it('should keep every entry when there is no bound', () => {
    // Act
    const kept = keptBy(period('', ''));

    // Assert
    expect(kept).toHaveLength(5);
  });

  it('should keep an entry that has no time, since nothing says it is outside', () => {
    // Arrange
    const bytes = utf8('no header here\n[09:30:12 INF] inside\n');
    const filter = createEntryFilter(period('09:00', '10:00'));

    // Act
    const ignored = parseBytes(bytes, bytes.length, CONSOLE_PROFILE).entries.map((entry) => filter.ignores(entry));

    // Assert
    expect(ignored).toEqual([false, false]);
  });

  it('should count the entries left out by the period on their own, and once in the total when a rule also matches', () => {
    // Arrange
    const filter = createEntryFilter(period('09:00', '10:00', 'before', 'middle'));

    // Act
    parseBytes(log, log.length, CONSOLE_PROFILE).entries.forEach((entry) => filter.ignores(entry));

    // Assert
    expect(filter.counts()).toEqual({ ignored: 3, ignoredPerRule: [1, 1], ignoredByPeriod: 2 });
  });

  it('should not apply a period that is invalid, since the caller is expected to refuse it first', () => {
    // Arrange
    const filter = createEntryFilter(period('22:00', '02:00'));

    // Act
    parseBytes(log, log.length, CONSOLE_PROFILE).entries.forEach((entry) => filter.ignores(entry));

    // Assert
    expect(filter.counts().ignored).toBe(0);
  });
});

describe('createEntryFilter with a period of dates', () => {
  const log = utf8(
    [
      '2026-11-04 22:59:59.100 +01:00 [INF] before',
      '2026-11-04 23:00:00.000 +01:00 [INF] first minute',
      '2026-11-05 00:00:59.999 +00:00 [INF] last second of the end minute, another offset',
      '2026-11-05 00:01:00.000 +01:00 [INF] after',
    ].join('\n') + '\n',
  );
  const keptBy = (preparation: Preparation): string[] => {
    const filter = createEntryFilter(preparation);
    return parseBytes(log, log.length, DEFAULT_PROFILE)
      .entries.filter((entry) => !filter.ignores(entry))
      .map((entry) => entry.firstLine.split('[INF] ')[1] ?? '');
  };

  it('should keep the entries between the two dates across midnight, with the time as written whatever its offset', () => {
    // Act
    const kept = keptBy(period('2026-11-04T23:00', '2026-11-05T00:00'));

    // Assert
    expect(kept).toEqual(['first minute', 'last second of the end minute, another offset']);
  });

  it('should keep an entry whose timestamp has no date, since it cannot be placed', () => {
    // Arrange
    const bytes = utf8('[09:30:12 INF] inside\n');
    const filter = createEntryFilter(period('2026-11-04T08:00', '2026-11-04T09:00'));

    // Act
    const ignored = parseBytes(bytes, bytes.length, CONSOLE_PROFILE).entries.map((entry) => filter.ignores(entry));

    // Assert
    expect(ignored).toEqual([false]);
  });
});
