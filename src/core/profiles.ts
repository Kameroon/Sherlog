/** What every log format declares, whatever the way its entries are read. */
interface ProfileBase {
  readonly id: string;
  readonly label: string;
  /** `true` when the format gives no reliable date, so "first/last seen" cannot be trusted. */
  readonly limited: boolean;
  /**
   * Name prefixes of library code (`System.`, `Microsoft.` for .NET). The fingerprint looks for the first stack
   * frame that does not start with one of them, because that frame is the application code that failed.
   */
  readonly libraryPrefixes: readonly string[];
}

/**
 * A text log format: the regular expression that recognises the first line of an entry.
 * Lines that do not match belong to the previous entry (stack trace, multi-line message).
 */
export interface TextProfile extends ProfileBase {
  readonly kind: 'text';
  /**
   * Must define a named group `level` and may define `ts`. Never carries the `g` or `y` flag:
   * those make `exec` stateful, so the same line could match differently the second time.
   */
  readonly header: RegExp;
}

/**
 * A CSV export: its first line names the columns, each following record is one entry. The fields are found by the
 * name of their column, never by their position, so an export with the columns in another order reads the same.
 */
export interface CsvProfile extends ProfileBase {
  readonly kind: 'csv';
  /** Names of the columns that hold the timestamp, the level and the message, exactly as the first line writes them. */
  readonly columns: { readonly timestamp: string; readonly level: string; readonly message: string };
  /** Level name of each value of the level column. A value that is not in the table is kept as written. */
  readonly levels: ReadonlyMap<string, string>;
}

export type LogProfile = TextProfile | CsvProfile;

/** Result of reading an entry header. */
export interface HeaderMatch {
  /** Timestamp exactly as written in the log; `null` when the profile has no `ts` group. */
  readonly timestamp: string | null;
  /** Level exactly as written in the log (case preserved). */
  readonly level: string;
  /** Text of the `msg` group, which stops at the end of the header line; `null` when the profile has no `msg` group. */
  readonly message: string | null;
}

/**
 * Serilog file template (`{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] …`) and the generic
 * "ISO timestamp then level". The level is restricted to known names so that a message line such as
 * `2026-11-04 08:01:10 Something went wrong` does not start a false entry (SPEC §5).
 */
export const DEFAULT_PROFILE: TextProfile = {
  kind: 'text',
  id: 'serilog-file',
  label: 'Serilog fichier / horodatage ISO + niveau',
  header:
    /^(?<ts>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)\s+\[?(?<level>VERBOSE|VRB|TRACE|TRC|DEBUG|DBG|INFORMATION|INFO|INF|WARNING|WARN|WRN|ERROR|ERR|CRITICAL|FATAL|FTL)\]?\s+(?<msg>.*)$/i,
  limited: false,
  libraryPrefixes: ['System.', 'Microsoft.'],
};

/** Serilog console template, which has no date: `[08:16:10 ERR] message`. */
export const CONSOLE_PROFILE: TextProfile = {
  kind: 'text',
  id: 'serilog-console',
  label: 'Serilog console (sans date)',
  header: /^\[(?<ts>\d{2}:\d{2}:\d{2}) (?<level>[A-Z]{3})\]\s+(?<msg>.*)$/,
  limited: true,
  libraryPrefixes: ['System.', 'Microsoft.'],
};

/**
 * CSV export of the Log Analytics portal (« Exporter » → « CSV (toutes les colonnes) ») for the Application Insights
 * tables. The column names are those of a real `AppTraces` export; the level table is the `SeverityLevel` scale that
 * Microsoft documents for Application Insights (0 Verbose to 4 Critical). The language of the stack is unknown,
 * hence no library prefix.
 */
export const LOG_ANALYTICS_CSV_PROFILE: CsvProfile = {
  kind: 'csv',
  id: 'log-analytics-csv',
  label: 'Export CSV Log Analytics / Application Insights',
  columns: { timestamp: 'TimeGenerated [UTC]', level: 'SeverityLevel', message: 'Message' },
  levels: new Map([
    ['0', 'Verbose'],
    ['1', 'Information'],
    ['2', 'Warning'],
    ['3', 'Error'],
    ['4', 'Critical'],
  ]),
  limited: false,
  libraryPrefixes: [],
};

/** Built-in profiles, in the order they are offered to the detection. */
export const BUILT_IN_PROFILES: readonly LogProfile[] = [DEFAULT_PROFILE, CONSOLE_PROFILE, LOG_ANALYTICS_CSV_PROFILE];

/** Outcome of building a profile from a user-typed pattern; `invalid` always carries a user-facing reason. */
export type CustomProfileResult =
  | { status: 'ok'; profile: TextProfile }
  | { status: 'invalid'; reason: string };

/**
 * Builds a profile from a regular expression typed by the user.
 *
 * The pattern is compiled case-insensitively, like the built-in ones, and must define a named group
 * `level` (needed by the error filter); `ts` is optional. Without `ts` the profile is flagged limited.
 * `msg` is optional too: without it the fingerprint uses the whole first line. No library prefix is
 * declared, since the stack syntax of a user format is unknown: the fingerprint then uses the first frame.
 * The pattern is user input: a pathological one can run for a long time, which is why parsing runs in a
 * terminable worker (step 4) rather than being bounded here.
 */
export function createCustomProfile(pattern: string): CustomProfileResult {
  let header: RegExp;
  try {
    header = new RegExp(pattern, 'i');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: 'invalid', reason: `expression régulière invalide (${detail})` };
  }

  // An empty alternative always matches, so `groups` lists every named group of the pattern.
  const groups = new RegExp(`${pattern}|`, 'i').exec('')?.groups;
  if (groups === undefined || !('level' in groups)) {
    return { status: 'invalid', reason: 'l’expression doit définir un groupe nommé « level » : (?<level>…)' };
  }

  return {
    status: 'ok',
    profile: { kind: 'text', id: 'custom', label: 'Profil personnalisé', header, limited: !('ts' in groups), libraryPrefixes: [] },
  };
}

/**
 * Reads the header of an entry.
 *
 * @returns The timestamp and level, or `null` when the line is not an entry header for this profile.
 */
export function matchHeader(profile: TextProfile, line: string): HeaderMatch | null {
  const groups = profile.header.exec(line)?.groups;
  const level = groups?.['level'];
  if (level === undefined) {
    return null;
  }
  return { timestamp: groups?.['ts'] ?? null, level, message: groups?.['msg'] ?? null };
}
