// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_ERROR_LEVELS, isErrorLevel } from '../src/core/levels';

describe('isErrorLevel', () => {
  it.each(['ERROR', 'ERR', 'FATAL', 'FTL', 'CRITICAL'])('should return true when the level is %s', (level) => {
    // Act
    const result = isErrorLevel(level);

    // Assert
    expect(result).toBe(true);
  });

  it.each(['VERBOSE', 'VRB', 'TRACE', 'DEBUG', 'DBG', 'INFO', 'INF', 'WARNING', 'WARN', 'WRN'])(
    'should return false when the level is %s',
    (level) => {
      // Act
      const result = isErrorLevel(level);

      // Assert
      expect(result).toBe(false);
    },
  );

  it('should ignore the case when comparing the level', () => {
    // Act
    const result = isErrorLevel('Err');

    // Assert
    expect(result).toBe(true);
  });

  it('should return false when the entry has no level', () => {
    // Act
    const result = isErrorLevel(null);

    // Assert
    expect(result).toBe(false);
  });

  it('should use the configured levels when they are provided', () => {
    // Arrange
    const configured = new Set(['WRN']);

    // Act
    const warning = isErrorLevel('WRN', configured);
    const error = isErrorLevel('ERR', configured);

    // Assert
    expect({ warning, error }).toEqual({ warning: true, error: false });
  });

  it('should expose the defaults as upper-case names so that they match the comparison', () => {
    // Assert
    expect([...DEFAULT_ERROR_LEVELS].every((level) => level === level.toUpperCase())).toBe(true);
  });
});
