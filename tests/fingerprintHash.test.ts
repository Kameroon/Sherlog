// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashFingerprint } from '../src/store/fingerprintHash';
import { parseHistoryRecord } from '../src/store/history';

describe('hashFingerprint', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ])('should give the SHA-256 of %j in lowercase hexadecimal', async (text, expected) => {
    // Act & Assert
    expect(await hashFingerprint(text)).toBe(expected);
  });

  it('should hash the UTF-8 bytes of the text, not its UTF-16 units', async () => {
    // Act & Assert: « é » is the two bytes 0xC3 0xA9 in UTF-8.
    expect(await hashFingerprint('é')).toBe(await sha256OfBytes([0xc3, 0xa9]));
  });

  it('should give a key that a history record accepts', async () => {
    // Arrange
    const key = await hashFingerprint('ERR|Payment <n> failed|at Shop.Pay()');

    // Act
    const parsed = parseHistoryRecord({ key, status: 'resolved', updatedAt: '2026-11-13T09:00:00.000Z', analysis: null }, new Date('2026-11-15T12:00:00.000Z'));

    // Assert
    expect(parsed.ok).toBe(true);
  });

  it('should give another key for a text that differs by one character', async () => {
    // Act
    const [first, second] = await Promise.all([hashFingerprint('ERR|timeout after <n> s'), hashFingerprint('ERR|timeout after <n> m')]);

    // Assert
    expect(first).not.toBe(second);
  });

  it('should give the same key for the same text', async () => {
    // Act
    const [first, second] = await Promise.all([hashFingerprint('ERR|same'), hashFingerprint('ERR|same')]);

    // Assert
    expect(first).toBe(second);
  });

  it('should hash a fingerprint as long as the longest one kept', async () => {
    // Act
    const key = await hashFingerprint('x'.repeat(1_100));

    // Assert
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should fail with a message that says why when the browser has no way to compute hashes', async () => {
    // Act & Assert
    await expect(hashFingerprint('ERR|x', null)).rejects.toThrow(/contexte non sécurisé/);
  });
});

/** The reference the test compares with: the digest of given bytes, without going through the text encoder under test. */
async function sha256OfBytes(bytes: readonly number[]): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
