// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { detectProfile } from '../src/core/detectProfile';
import { CONSOLE_PROFILE, DEFAULT_PROFILE } from '../src/core/profiles';
import type { LogProfile } from '../src/core/profiles';

const fileLines = [
  '2026-11-04 08:00:00.000 +01:00 [INF] Started',
  '2026-11-04 08:16:10.332 +01:00 [ERR] Timeout',
  'System.TimeoutException: The operation has timed out.',
];

const consoleLines = ['[08:12:01 INF] Started', '[08:16:10 ERR] Timeout', 'System.TimeoutException: timed out'];

function profileWith(id: string, header: RegExp): LogProfile {
  return { id, label: id, header, limited: false, libraryPrefixes: [] };
}

describe('detectProfile', () => {
  it('should detect the Serilog file profile when the lines are Serilog file entries', () => {
    // Act
    const result = detectProfile(fileLines);

    // Assert
    expect(result).toEqual({ status: 'detected', profile: DEFAULT_PROFILE });
  });

  it('should detect the console profile when the lines have no date', () => {
    // Act
    const result = detectProfile(consoleLines);

    // Assert
    expect(result).toEqual({ status: 'detected', profile: CONSOLE_PROFILE });
  });

  it('should ignore leading empty lines when looking for the first line', () => {
    // Act
    const result = detectProfile(['', '   ', ...fileLines]);

    // Assert
    expect(result.status).toBe('detected');
  });

  it('should detect the profile even when stack traces make most lines non-headers', () => {
    // Arrange: a single header among the first 50 lines, as in a log with a long stack
    const stack = Array.from({ length: 49 }, (_, index) => `   at Frame${index}.Run()`);
    const lines = [fileLines[1] ?? '', ...stack, fileLines[0] ?? ''];

    // Act
    const result = detectProfile(lines);

    // Assert
    expect(result).toEqual({ status: 'detected', profile: DEFAULT_PROFILE });
  });

  it('should return unrecognized with a reason when the first line matches no profile', () => {
    // Act
    const result = detectProfile(['[10:32:39 BOOT INF] Starting', '[10:32:41 INF] Started']);

    // Assert
    expect(result).toEqual({ status: 'unrecognized', reason: expect.stringContaining('aucun profil') as unknown });
  });

  it('should not look at later lines when the first line matches no profile', () => {
    // Act
    const result = detectProfile(['Some banner', ...fileLines]);

    // Assert
    expect(result.status).toBe('unrecognized');
  });

  it('should return unrecognized when the input has no non-empty line', () => {
    // Act
    const result = detectProfile(['', '  ']);

    // Assert
    expect(result.status).toBe('unrecognized');
  });

  it('should return unrecognized and name both profiles when two profiles have the same number of headers', () => {
    // Arrange
    const first = profileWith('first', /^(?<level>[A-Z]{3}): /);
    const second = profileWith('second', /^(?<level>[A-Z]{3}):/);

    // Act
    const result = detectProfile(['ERR: a', 'INF: b'], [first, second]);

    // Assert
    expect(result).toEqual({
      status: 'unrecognized',
      reason: expect.stringMatching(/first.*second|second.*first/) as unknown,
    });
  });

  it('should keep the profile with the most headers when several profiles match the first line', () => {
    // Arrange
    const narrow = profileWith('narrow', /^(?<level>ERR): /);
    const wide = profileWith('wide', /^(?<level>[A-Z]{3}): /);

    // Act
    const result = detectProfile(['ERR: a', 'INF: b', 'WRN: c'], [narrow, wide]);

    // Assert
    expect(result).toEqual({ status: 'detected', profile: wide });
  });

  it('should count headers on the first 50 lines only', () => {
    // Arrange: the wide profile only wins after line 50
    const narrow = profileWith('narrow', /^(?<level>ERR): /);
    const wide = profileWith('wide', /^(?<level>[A-Z]{3}): /);
    const lines = ['ERR: a', ...Array.from({ length: 49 }, () => 'continuation'), 'INF: b', 'INF: c'];

    // Act
    const result = detectProfile(lines, [narrow, wide]);

    // Assert
    expect(result.status).toBe('unrecognized');
  });

  it('should route the input to the structured profile when the first line starts with an opening brace', () => {
    // Act
    const result = detectProfile(['{"@t":"2026-11-04T08:16:10.332Z","@l":"Error"}']);

    // Assert
    expect(result).toEqual({ status: 'structured' });
  });
});
