// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCustomProfile, matchHeader } from '../src/core/profiles';

function expectProfile(pattern: string) {
  const result = createCustomProfile(pattern);
  if (result.status !== 'ok') {
    throw new Error(`expected a valid profile, got: ${result.reason}`);
  }
  return result.profile;
}

describe('createCustomProfile', () => {
  it('should read the timestamp and level when the pattern defines both groups', () => {
    // Arrange
    const profile = expectProfile(String.raw`^(?<ts>\d{2}:\d{2}:\d{2}) \|(?<level>[A-Z]+)\| (?<msg>.*)$`);

    // Act
    const match = matchHeader(profile, '08:16:10 |ERROR| Timeout');

    // Assert
    expect(match).toEqual({ timestamp: '08:16:10', level: 'ERROR', message: 'Timeout' });
  });

  it('should read a level that follows an extra tag when the pattern skips that tag', () => {
    // Arrange
    const profile = expectProfile(String.raw`^\[(?<ts>\d{2}:\d{2}:\d{2}) (?:BOOT )?(?<level>[A-Z]{3})\]\s+(?<msg>.*)$`);

    // Act
    const match = matchHeader(profile, '[10:32:39 BOOT INF] Starting');

    // Assert
    expect(match).toEqual({ timestamp: '10:32:39', level: 'INF', message: 'Starting' });
  });

  it('should give a null timestamp and flag the profile as limited when the pattern has no timestamp group', () => {
    // Arrange
    const profile = expectProfile(String.raw`^(?<level>[A-Z]{3}): (?<msg>.*)$`);

    // Act
    const match = matchHeader(profile, 'ERR: Timeout');

    // Assert
    expect({ match, limited: profile.limited }).toEqual({
      match: { timestamp: null, level: 'ERR', message: 'Timeout' },
      limited: true,
    });
  });

  it('should give a null message when the pattern has no message group', () => {
    // Arrange
    const profile = expectProfile(String.raw`^(?<ts>\d{2}:\d{2}:\d{2}) (?<level>[A-Z]{3})`);

    // Act
    const match = matchHeader(profile, '08:16:10 ERR Timeout');

    // Assert
    expect(match).toEqual({ timestamp: '08:16:10', level: 'ERR', message: null });
  });

  it('should declare no library prefix because the stack syntax of the format is unknown', () => {
    // Act
    const profile = expectProfile(String.raw`^(?<level>[A-Z]{3}): (?<msg>.*)$`);

    // Assert
    expect(profile.libraryPrefixes).toEqual([]);
  });

  it('should not flag the profile as limited when the pattern has a timestamp group', () => {
    // Act
    const profile = expectProfile(String.raw`^(?<ts>\S+) (?<level>[A-Z]{3}) (?<msg>.*)$`);

    // Assert
    expect(profile.limited).toBe(false);
  });

  it('should ignore the case when matching, like the built-in profiles', () => {
    // Arrange
    const profile = expectProfile(String.raw`^(?<level>err): (?<msg>.*)$`);

    // Act
    const match = matchHeader(profile, 'ERR: Timeout');

    // Assert
    expect(match?.level).toBe('ERR');
  });

  it('should refuse the pattern with a reason when the regular expression is invalid', () => {
    // Act
    const result = createCustomProfile('^(?<level>[A-Z]{3}');

    // Assert
    expect(result).toEqual({ status: 'invalid', reason: expect.stringContaining('invalide') as unknown });
  });

  it('should refuse the pattern with a reason when it has no level group', () => {
    // Act
    const result = createCustomProfile(String.raw`^\[(?<ts>\d{2}:\d{2}:\d{2})\]\s+(?<msg>.*)$`);

    // Assert
    expect(result).toEqual({ status: 'invalid', reason: expect.stringContaining('level') as unknown });
  });

  it('should refuse the pattern with a reason when it has no named group at all', () => {
    // Act
    const result = createCustomProfile(String.raw`^\[\d{2}:\d{2}:\d{2} [A-Z]{3}\]`);

    // Assert
    expect(result).toEqual({ status: 'invalid', reason: expect.stringContaining('level') as unknown });
  });

  it('should refuse the pattern with a reason when it is empty', () => {
    // Act
    const result = createCustomProfile('');

    // Assert
    expect(result.status).toBe('invalid');
  });
});
