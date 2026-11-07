/**
 * Names the browser raises when a `File` it handed out is no longer what it was: renamed, moved, deleted,
 * or modified since the user chose it.
 */
const SOURCE_CHANGED_ERRORS: ReadonlySet<string> = new Set(['NotFoundError', 'NotReadableError']);

/**
 * Reads a field of what was thrown without relying on `instanceof Error`, which is false for an error that comes
 * from another realm (an iframe, a worker) even though it has the same shape.
 */
function stringField(error: unknown, field: 'name' | 'message'): string | undefined {
  if (typeof error !== 'object' || error === null || !(field in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Turns the error of a failed read into a message for the user. Never includes log content: the text of a browser
 * error describes the failure, not the file.
 */
export function readFailureMessage(error: unknown): string {
  const name = stringField(error, 'name');
  if (name !== undefined && SOURCE_CHANGED_ERRORS.has(name)) {
    return 'Le fichier a été modifié, déplacé ou n’est plus lisible depuis son choix. Choisissez-le à nouveau.';
  }
  return `Lecture impossible : ${stringField(error, 'message') ?? 'cause inconnue'}.`;
}
