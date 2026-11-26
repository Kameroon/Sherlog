/** Where the browser keeps the hash functions; absent in a page that is not served securely. */
function browserSubtle(): SubtleCrypto | null {
  // The DOM types promise `crypto`, which is not true of an insecure page: the type is widened to say what can happen.
  const browserCrypto = globalThis.crypto as Crypto | undefined;
  return browserCrypto?.subtle ?? null;
}

/**
 * The key of an error in the history: the SHA-256 of its fingerprint, in lowercase hexadecimal (ADR-022). The
 * fingerprint is a message of the log, normalised but not masked, so only its hash is ever stored. It is hashed here and
 * not in `core`, which stays plain TypeScript without a Web API (ADR-003).
 *
 * @param subtle - The hash functions to use, given for the tests.
 * @throws When the browser has none: the history is then unavailable, and the message says why.
 */
export async function hashFingerprint(fingerprint: string, subtle: SubtleCrypto | null = browserSubtle()): Promise<string> {
  if (subtle === null) {
    throw new Error('Le navigateur ne sait pas calculer d’empreintes (page servie dans un contexte non sécurisé) : l’historique est indisponible.');
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
