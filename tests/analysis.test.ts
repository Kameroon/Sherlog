// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_LIST_ITEMS, MAX_TEXT_CHARS, parseAnalysis } from '../src/ai/analysis';

const valid = {
  summary: 'Le paiement échoue.',
  probableCause: 'Le délai de la passerelle est dépassé.',
  severity: 'high',
  confidence: 'medium',
  evidence: ['TimeoutException après 30 s'],
  suggestedFixes: [{ title: 'Augmenter le délai', details: 'Passer à 60 s.', codeHint: 'timeout: 60' }],
  missingInfo: ['La configuration réseau'],
};

const parse = (value: unknown) => parseAnalysis(JSON.stringify(value));
const reasonOf = (text: string): string => {
  const result = parseAnalysis(text);
  return result.ok ? '' : result.reason;
};

describe('parseAnalysis of a valid answer', () => {
  it('should give back every field', () => {
    // Act
    const result = parse(valid);

    // Assert
    expect(result).toEqual({ ok: true, analysis: valid });
  });

  it.each([
    ['a json fence', '```json\n{JSON}\n```'],
    ['a plain fence', '```\n{JSON}\n```'],
    ['whitespace around', '\n  {JSON}  \n'],
    ['a fence in capitals', '```JSON\n{JSON}\n```'],
  ])('should read the JSON under %s', (_name, template) => {
    // Arrange
    const text = template.replace('{JSON}', JSON.stringify(valid));

    // Act & Assert
    expect(parseAnalysis(text)).toEqual({ ok: true, analysis: valid });
  });

  it('should take an absent or null code hint as no code hint', () => {
    // Arrange
    const fixes = [{ title: 'a', details: 'b' }, { title: 'c', details: 'd', codeHint: null }];

    // Act
    const result = parse({ ...valid, suggestedFixes: fixes });

    // Assert
    expect(result).toMatchObject({ ok: true, analysis: { suggestedFixes: [{ codeHint: null }, { codeHint: null }] } });
  });

  it('should accept empty lists, an analysis may have nothing to suggest or ask', () => {
    // Act & Assert
    expect(parse({ ...valid, evidence: [], suggestedFixes: [], missingInfo: [] })).toMatchObject({ ok: true });
  });

  it('should keep the text as it is, markup included: it is shown as text, never interpreted', () => {
    // Arrange
    const summary = '<img src=x onerror=alert(1)> & "quotes"';

    // Act
    const result = parse({ ...valid, summary });

    // Assert
    expect(result).toMatchObject({ ok: true, analysis: { summary } });
  });

  it('should drop the fields the schema does not have, so that nothing else reaches the screen', () => {
    // Arrange
    const text = JSON.stringify({ ...valid, html: '<b>x</b>', suggestedFixes: [{ title: 'a', details: 'b', codeHint: null, run: 'rm -rf' }] }).replace('{', '{"__proto__":{"polluted":true},');

    // Act
    const result = parseAnalysis(text);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.analysis).sort()).toEqual(['confidence', 'evidence', 'missingInfo', 'probableCause', 'severity', 'suggestedFixes', 'summary']);
      expect(Object.keys(result.analysis.suggestedFixes[0] ?? {}).sort()).toEqual(['codeHint', 'details', 'title']);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    }
  });
});

describe('parseAnalysis of an answer that is not an analysis', () => {
  it.each([
    ['not JSON', 'Voici mon analyse : tout va bien.'],
    ['prose before the JSON', `Voici : ${JSON.stringify(valid)}`],
    ['prose after the JSON', `${JSON.stringify(valid)} J'espère que cela aide.`],
    ['an empty answer', ''],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"hello"'],
    ['two objects', `${JSON.stringify(valid)}${JSON.stringify(valid)}`],
  ])('should refuse %s', (_name, text) => {
    // Act & Assert
    expect(parseAnalysis(text).ok).toBe(false);
  });

  it.each([
    ['a missing summary', { ...valid, summary: undefined }],
    ['an empty summary', { ...valid, summary: '  ' }],
    ['an empty cause', { ...valid, probableCause: '' }],
    ['a summary that is not text', { ...valid, summary: 3 }],
    ['an unknown severity', { ...valid, severity: 'catastrophic' }],
    ['a severity in capitals', { ...valid, severity: 'HIGH' }],
    ['an unknown confidence', { ...valid, confidence: 'sure' }],
    ['evidence that is not a list', { ...valid, evidence: 'because' }],
    ['evidence with something that is not text', { ...valid, evidence: ['ok', 3] }],
    ['a missing list of fixes', { ...valid, suggestedFixes: undefined }],
    ['a fix without title', { ...valid, suggestedFixes: [{ details: 'x', codeHint: null }] }],
    ['a fix with a title that is not text', { ...valid, suggestedFixes: [{ title: 1, details: 'x' }] }],
    ['a fix that is not an object', { ...valid, suggestedFixes: ['do it'] }],
    ['a code hint that is not text', { ...valid, suggestedFixes: [{ title: 'a', details: 'b', codeHint: 5 }] }],
    ['a missing list of missing information', { ...valid, missingInfo: undefined }],
  ])('should refuse %s', (_name, value) => {
    // Act & Assert
    expect(parse(value).ok).toBe(false);
  });

  it('should say what was wrong', () => {
    // Act & Assert
    expect(reasonOf('not json')).toMatch(/JSON/);
    expect(reasonOf(JSON.stringify({ ...valid, severity: 'x' }))).toMatch(/severity/);
  });
});

describe('parseAnalysis limits', () => {
  it('should accept a text of exactly the limit', () => {
    // Act & Assert
    expect(parse({ ...valid, summary: 'x'.repeat(MAX_TEXT_CHARS) }).ok).toBe(true);
  });

  it('should refuse a text over the limit rather than cut it', () => {
    // Act & Assert
    expect(parse({ ...valid, summary: 'x'.repeat(MAX_TEXT_CHARS + 1) }).ok).toBe(false);
  });

  it.each(['evidence', 'missingInfo'] as const)('should accept %s of exactly the limit of items and refuse one more', (key) => {
    // Act & Assert
    expect(parse({ ...valid, [key]: Array<string>(MAX_LIST_ITEMS).fill('x') }).ok).toBe(true);
    expect(parse({ ...valid, [key]: Array<string>(MAX_LIST_ITEMS + 1).fill('x') }).ok).toBe(false);
  });

  it('should refuse more fixes than the limit', () => {
    // Arrange
    const fix = { title: 'a', details: 'b', codeHint: null };

    // Act & Assert
    expect(parse({ ...valid, suggestedFixes: Array(MAX_LIST_ITEMS).fill(fix) }).ok).toBe(true);
    expect(parse({ ...valid, suggestedFixes: Array(MAX_LIST_ITEMS + 1).fill(fix) }).ok).toBe(false);
  });

  it('should refuse a text too long in a fix or in a code hint', () => {
    // Act & Assert
    expect(parse({ ...valid, suggestedFixes: [{ title: 'a', details: 'x'.repeat(MAX_TEXT_CHARS + 1), codeHint: null }] }).ok).toBe(false);
    expect(parse({ ...valid, suggestedFixes: [{ title: 'a', details: 'b', codeHint: 'x'.repeat(MAX_TEXT_CHARS + 1) }] }).ok).toBe(false);
  });
});
