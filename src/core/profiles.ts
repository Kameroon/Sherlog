/**
 * A log format: the regular expression that recognises the first line of an entry.
 * Lines that do not match belong to the previous entry (stack trace, multi-line message).
 */
export interface LogProfile {
  readonly id: string;
  readonly label: string;
  /**
   * Must define a named group `level` and may define `ts`. Never carries the `g` or `y` flag:
   * those make `exec` stateful, so the same line could match differently the second time.
   */
  readonly header: RegExp;
  /** `true` when the format gives no reliable date, so "first/last seen" cannot be trusted. */
  readonly limited: boolean;
}

/** Result of reading an entry header. */
export interface HeaderMatch {
  /** Timestamp exactly as written in the log; `null` when the profile has no `ts` group. */
  readonly timestamp: string | null;
  /** Level exactly as written in the log (case preserved). */
  readonly level: string;
}

/**
 * Serilog file template (`{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] …`) and the generic
 * "ISO timestamp then level". The level is restricted to known names so that a message line such as
 * `2026-11-04 08:01:10 Something went wrong` does not start a false entry (SPEC §5).
 */
export const DEFAULT_PROFILE: LogProfile = {
  id: 'serilog-file',
  label: 'Serilog fichier / horodatage ISO + niveau',
  header:
    /^(?<ts>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)\s+\[?(?<level>VERBOSE|VRB|TRACE|TRC|DEBUG|DBG|INFORMATION|INFO|INF|WARNING|WARN|WRN|ERROR|ERR|CRITICAL|FATAL|FTL)\]?\s+(?<msg>.*)$/i,
  limited: false,
};

/** Serilog console template, which has no date: `[08:16:10 ERR] message`. */
export const CONSOLE_PROFILE: LogProfile = {
  id: 'serilog-console',
  label: 'Serilog console (sans date)',
  header: /^\[(?<ts>\d{2}:\d{2}:\d{2}) (?<level>[A-Z]{3})\]\s+(?<msg>.*)$/,
  limited: true,
};

/** Built-in profiles, in the order they are offered to the detection. */
export const BUILT_IN_PROFILES: readonly LogProfile[] = [DEFAULT_PROFILE, CONSOLE_PROFILE];

/**
 * Reads the header of an entry.
 *
 * @returns The timestamp and level, or `null` when the line is not an entry header for this profile.
 */
export function matchHeader(profile: LogProfile, line: string): HeaderMatch | null {
  const groups = profile.header.exec(line)?.groups;
  const level = groups?.['level'];
  if (level === undefined) {
    return null;
  }
  return { timestamp: groups?.['ts'] ?? null, level };
}
