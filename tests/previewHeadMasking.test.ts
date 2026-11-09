// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EMPTY_PREPARATION } from '../src/core/preparation';
import type { Preparation } from '../src/core/preparation';
import { CONSOLE_PROFILE, DEFAULT_PROFILE } from '../src/core/profiles';
import type { LogProfile } from '../src/core/profiles';
import { MAX_PREVIEW_LINE_CHARS, parseHead, previewHead as previewOf } from '../src/core/previewHead';
import { DEFAULT_ENABLED_RULES } from '../src/core/redact';
import type { RedactionRuleId } from '../src/core/redact';
import { readSample, utf8 } from './helpers/samples';

const NO_MASKING: ReadonlySet<RedactionRuleId> = new Set();
const preview = (text: string, profile: LogProfile, masking: ReadonlySet<RedactionRuleId>, preparation: Preparation = EMPTY_PREPARATION) =>
  previewOf(parseHead(utf8(text), profile), preparation, masking);
const sample = readSample('sample.log');

describe('previewHead masking', () => {
  it('should leave the lines as they are when nothing is masked', () => {
    // Act
    const { lines, masking } = preview(sample, DEFAULT_PROFILE, NO_MASKING);

    // Assert
    expect(lines.some((line) => line.text.includes('S3cr3t!'))).toBe(true);
    expect(masking.masked).toBe(0);
  });

  it('should show the masked line and keep the original one beside it', () => {
    // Act
    const { lines } = preview(sample, DEFAULT_PROFILE, DEFAULT_ENABLED_RULES);

    // Assert
    const line = lines.find((candidate) => candidate.originalText.includes('Password='));
    expect(line?.text).toContain('Password=[SECRET]');
    expect(line?.text).not.toContain('S3cr3t!');
    expect(line?.originalText).toContain('Password=S3cr3t!');
  });

  it('should count what the masking replaced', () => {
    // Act
    const { masking } = preview(sample, DEFAULT_PROFILE, DEFAULT_ENABLED_RULES);

    // Assert
    expect(masking.masked).toBe(2);
  });

  it('should count, for each rule, what it finds, whether or not the rule is on', () => {
    // Act
    const { masking } = preview(sample, DEFAULT_PROFILE, NO_MASKING);

    // Assert
    expect(masking.occurrences).toEqual({ email: 1, secret: 1, ip: 0, card: 0, guid: 1, urlHost: 0 });
  });

  it('should not count what an entry that is left out holds', () => {
    // Arrange
    const preparation: Preparation = { ...EMPTY_PREPARATION, ignoreTexts: ['send email'] };

    // Act
    const { masking } = preview(sample, DEFAULT_PROFILE, DEFAULT_ENABLED_RULES, preparation);

    // Assert
    expect(masking.occurrences.email).toBe(0);
    expect(masking.masked).toBe(1);
  });

  it('should mask a line before it cuts it, so that no part of a secret is shown', () => {
    // Arrange
    const secret = 'hunter2hunter2hunter2hunter2hunter2';
    const line = `[08:16:10 ERR] ${'x'.repeat(MAX_PREVIEW_LINE_CHARS - 40)} password=${secret}`;

    // Act
    const [first] = preview(`${line}\n`, CONSOLE_PROFILE, DEFAULT_ENABLED_RULES).lines;

    // Assert
    expect(first?.text).not.toContain('hunter');
    expect(first?.originalText).toContain('hunter');
  });

  it('should not say a line is cut when masking made it short enough', () => {
    // Arrange: 320 characters, of which a 40-character secret that the masking shortens.
    const line = `[08:16:10 ERR] ${'x'.repeat(250)} password=${'s'.repeat(40)}`;

    // Act
    const [first] = preview(`${line}\n`, CONSOLE_PROFILE, DEFAULT_ENABLED_RULES).lines;

    // Assert
    expect(first?.cut).toBe(false);
    expect(first?.originalCut).toBe(true);
  });

  it('should give the same lines as before when no masking is asked for', () => {
    // Act
    const { lines } = previewOf(parseHead(utf8(sample), DEFAULT_PROFILE), EMPTY_PREPARATION);

    // Assert
    expect(lines.every((line) => line.text === line.originalText)).toBe(true);
  });
});
