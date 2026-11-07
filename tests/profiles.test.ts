// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CONSOLE_PROFILE, DEFAULT_PROFILE, matchHeader } from '../src/core/profiles';

describe('default profile', () => {
  it('should read the timestamp and level when the line is a Serilog file header', () => {
    // Act
    const match = matchHeader(DEFAULT_PROFILE, '2026-11-04 08:16:10.332 +01:00 [ERR] Timeout after 30012 ms');

    // Assert
    expect(match).toEqual({ timestamp: '2026-11-04 08:16:10.332 +01:00', level: 'ERR' });
  });

  it('should match when the header is a generic ISO timestamp followed by an unbracketed level', () => {
    // Act
    const match = matchHeader(DEFAULT_PROFILE, '2026-11-04T08:16:10Z ERROR Connection refused');

    // Assert
    expect(match).toEqual({ timestamp: '2026-11-04T08:16:10Z', level: 'ERROR' });
  });

  it('should keep the level as written when it is not upper case', () => {
    // Act
    const match = matchHeader(DEFAULT_PROFILE, '2026-11-04 08:16:10.332 +01:00 [err] lower-case level');

    // Assert
    expect(match?.level).toBe('err');
  });

  it('should match when the message is empty', () => {
    // Act
    const match = matchHeader(DEFAULT_PROFILE, '2026-11-04 08:16:10.332 +01:00 [INF] ');

    // Assert
    expect(match?.level).toBe('INF');
  });

  it('should not match when a message line starts with a date followed by a word that is not a level', () => {
    // Act
    const match = matchHeader(DEFAULT_PROFILE, '2026-11-04 08:01:10 Something went wrong on row 12');

    // Assert
    expect(match).toBeNull();
  });

  it('should not match when the word after the date only starts like a level', () => {
    // Act
    const match = matchHeader(DEFAULT_PROFILE, '2026-11-04 08:01:10 Infrastructure check failed');

    // Assert
    expect(match).toBeNull();
  });

  it('should not match a Serilog console line because it has no date', () => {
    // Act
    const match = matchHeader(DEFAULT_PROFILE, '[08:16:10 ERR] Timeout after 30012 ms');

    // Assert
    expect(match).toBeNull();
  });

  it('should return the same result when it is applied twice to the same line', () => {
    // Arrange
    const line = '2026-11-04 08:16:10.332 +01:00 [ERR] Timeout';

    // Act
    const first = matchHeader(DEFAULT_PROFILE, line);
    const second = matchHeader(DEFAULT_PROFILE, line);

    // Assert
    expect(second).toEqual(first);
  });

  it('should not be flagged as limited because it knows the full date', () => {
    // Assert
    expect(DEFAULT_PROFILE.limited).toBe(false);
  });
});

describe('console profile', () => {
  it('should read the time and level when the line is a Serilog console header', () => {
    // Act
    const match = matchHeader(CONSOLE_PROFILE, '[08:16:10 ERR] Timeout after 30012 ms');

    // Assert
    expect(match).toEqual({ timestamp: '08:16:10', level: 'ERR' });
  });

  it('should not match a Serilog file line because the header starts with a date', () => {
    // Act
    const match = matchHeader(CONSOLE_PROFILE, '2026-11-04 08:16:10.332 +01:00 [ERR] Timeout');

    // Assert
    expect(match).toBeNull();
  });

  it('should not match when the level has more than three letters', () => {
    // Act
    const match = matchHeader(CONSOLE_PROFILE, '[10:32:39 BOOT INF] Starting');

    // Assert
    expect(match).toBeNull();
  });

  it('should be flagged as limited because only the time is known', () => {
    // Assert
    expect(CONSOLE_PROFILE.limited).toBe(true);
  });
});
