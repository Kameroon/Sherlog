/**
 * The status of an error. The user sets « new », « ignored » and « resolved »; « analysed » is set by the analysis of
 * step 8 (`withAnalysis`), never offered as a choice, and never over a decision of the user.
 */
export type ErrorStatus = 'new' | 'analysed' | 'ignored' | 'resolved';

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

/**
 * Marks a fingerprint as analysed once the model has answered for it. An error the user has ignored or resolved stays
 * so: the analysis does not undo a decision.
 */
export function withAnalysis(statuses: StatusByFingerprint, fingerprintId: number): StatusByFingerprint {
  return statusOf(statuses, fingerprintId) === 'new' ? withStatus(statuses, fingerprintId, 'analysed') : new Map(statuses);
}
