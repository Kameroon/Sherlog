/**
 * What the user has decided about an error. « Analysé » (SPEC §3) is not here: it is set by the analysis of step 8,
 * not by the user, and has nothing to show before it.
 */
export type ErrorStatus = 'new' | 'ignored' | 'resolved';

/** The status of each fingerprint that has one; a fingerprint that is not in it is new. */
export type StatusByFingerprint = ReadonlyMap<number, ErrorStatus>;

export const NO_STATUSES: StatusByFingerprint = new Map();

export const statusOf = (statuses: StatusByFingerprint, fingerprintId: number): ErrorStatus => statuses.get(fingerprintId) ?? 'new';

/**
 * Sets the status of a fingerprint, hence of every error that shares it (SPEC §3). Giving back `new` forgets the
 * fingerprint instead of storing the default.
 *
 * @returns A new map: the one given is not changed, so that a React state holding it sees the change.
 */
export function withStatus(statuses: StatusByFingerprint, fingerprintId: number, status: ErrorStatus): StatusByFingerprint {
  const next = new Map(statuses);
  if (status === 'new') {
    next.delete(fingerprintId);
  } else {
    next.set(fingerprintId, status);
  }
  return next;
}
