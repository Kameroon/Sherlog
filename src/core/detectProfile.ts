import { BUILT_IN_PROFILES, matchHeader } from './profiles';
import type { LogProfile } from './profiles';

/** Number of lines looked at to choose a profile (SPEC §5). */
export const DETECTION_LINES = 50;

/** Outcome of the detection; `unrecognized` always carries a user-facing reason. */
export type Detection =
  | { status: 'detected'; profile: LogProfile }
  /** The content looks like JSON lines: handled by the structured profile (step 3b). */
  | { status: 'structured' }
  | { status: 'unrecognized'; reason: string };

function countHeaders(profile: LogProfile, lines: readonly string[]): number {
  return lines.filter((line) => matchHeader(profile, line) !== null).length;
}

/**
 * Chooses the profile of a text from its first lines, without guessing.
 *
 * A profile is a candidate when the first non-empty line is one of its headers. Among candidates the one
 * with the most headers in the first {@link DETECTION_LINES} lines wins. The share of matching lines is
 * deliberately not used: long stack traces make it low for a perfectly valid file. No candidate, or a tie,
 * gives `unrecognized` so that the user can type a custom profile.
 *
 * @param lines - The beginning of the text, decoded and split into lines.
 * @param profiles - Candidate profiles; defaults to the built-in ones.
 */
export function detectProfile(lines: readonly string[], profiles: readonly LogProfile[] = BUILT_IN_PROFILES): Detection {
  const window = lines.slice(0, DETECTION_LINES);
  const firstLine = window.find((line) => line.trim() !== '');
  if (firstLine === undefined) {
    return { status: 'unrecognized', reason: 'le texte ne contient aucune ligne non vide' };
  }
  if (firstLine.trimStart().startsWith('{')) {
    return { status: 'structured' };
  }

  const candidates = profiles
    .filter((profile) => matchHeader(profile, firstLine) !== null)
    .map((profile) => ({ profile, headers: countHeaders(profile, window) }));
  if (candidates.length === 0) {
    return { status: 'unrecognized', reason: 'aucun profil ne reconnaît la première ligne du texte' };
  }

  const best = Math.max(...candidates.map((candidate) => candidate.headers));
  const leaders = candidates.filter((candidate) => candidate.headers === best);
  const [leader] = leaders;
  if (leaders.length > 1 || leader === undefined) {
    const names = leaders.map((candidate) => candidate.profile.id).join(', ');
    return { status: 'unrecognized', reason: `plusieurs profils reconnaissent autant de lignes (${names}) : choisissez-en un` };
  }
  return { status: 'detected', profile: leader.profile };
}
