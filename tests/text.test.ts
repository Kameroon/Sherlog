// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { truncateText } from '../src/core/text';

describe('truncateText', () => {
  it('should return the text unchanged when it fits the limit', () => {
    // Act & Assert
    expect(truncateText('abcdef', 6)).toBe('abcdef');
  });

  it('should keep the first characters when the text is longer than the limit', () => {
    // Act & Assert
    expect(truncateText('abcdef', 3)).toBe('abc');
  });

  it('should not leave half of a surrogate pair at the end when the cut falls inside a character', () => {
    // Arrange: the emoji is two UTF-16 units, at indexes 1 and 2.
    const text = 'a😀b';

    // Act & Assert
    expect(truncateText(text, 2)).toBe('a');
  });

  it('should keep a whole surrogate pair when the cut falls right after it', () => {
    // Act & Assert
    expect(truncateText('a😀b', 3)).toBe('a😀');
  });
});
