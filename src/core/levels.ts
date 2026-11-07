/**
 * Levels kept by default as "errors". `ERR` and `FTL` are the Serilog three-letter abbreviations;
 * warnings are deliberately not part of the set (SPEC §3). Names are upper case: see {@link isErrorLevel}.
 */
export const DEFAULT_ERROR_LEVELS: ReadonlySet<string> = new Set(['ERROR', 'ERR', 'FATAL', 'FTL', 'CRITICAL']);

/**
 * Tells whether an entry level counts as an error.
 *
 * @param level - Level as written in the log, or `null` for an entry without a recognised header.
 * @param errorLevels - Upper-case names to keep; defaults to {@link DEFAULT_ERROR_LEVELS}.
 * @returns `false` for `null`: an entry whose level is unknown is never reported as an error.
 */
export function isErrorLevel(level: string | null, errorLevels: ReadonlySet<string> = DEFAULT_ERROR_LEVELS): boolean {
  return level !== null && errorLevels.has(level.toUpperCase());
}
