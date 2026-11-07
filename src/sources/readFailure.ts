/**
 * Names the browser raises when a `File` it handed out is no longer what it was: renamed, moved, deleted,
 * or modified since the user chose it.
 */
const SOURCE_CHANGED_ERRORS: ReadonlySet<string> = new Set(['NotFoundError', 'NotReadableError']);

/**
 * Turns the error of a failed read into a message for the user. Never includes log content: the text of a browser
 * error describes the failure, not the file.
 */
export function readFailureMessage(error: unknown): string {
  if (error instanceof Error && SOURCE_CHANGED_ERRORS.has(error.name)) {
    return 'Le fichier a été modifié, déplacé ou n’est plus lisible depuis son choix. Choisissez-le à nouveau.';
  }
  const reason = error instanceof Error ? error.message : 'cause inconnue';
  return `Lecture impossible : ${reason}.`;
}
