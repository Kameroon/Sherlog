import { createCsvEntryAssembler } from './csvExport';
import { appendEntryLine, completeEntry, NO_FIELDS, startEntryLines } from './entryLines';
import type { EntryFields, EntryLines } from './entryLines';
import { MAX_RETAINED_BYTES } from './lineSplitter';
import type { SourceLine } from './lineSplitter';
import { matchHeader } from './profiles';
import type { LogProfile, TextProfile } from './profiles';

/** One log entry: a header line and the lines that continue it (exception, multi-line message). */
export interface LogEntry {
  /**
   * Byte offset of the first line. Entries are contiguous: each one ends where the next begins. The line of column
   * names of a CSV export comes before the first entry.
   */
  readonly offset: number;
  /** Byte length up to the start of the next entry (or the end of the input), terminators included. */
  readonly length: number;
  /**
   * Timestamp as written in the log, or as ISO 8601 for a CSV export (see `csvExport.ts`); `null` when the profile has
   * none or the entry has no header.
   */
  readonly timestamp: string | null;
  /** Level as written in the log, or named by the level table of the profile; `null` for lines that come before the first header. */
  readonly level: string | null;
  /** The message on its first line, without the timestamp and the level; `null` when the format does not tell it apart. */
  readonly message: string | null;
  readonly firstLine: string;
  /** Retained lines joined with `\n`; only a beginning of the entry when `truncated`. */
  readonly text: string;
  /** Number of lines of the entry, including those not retained. */
  readonly lineCount: number;
  /** `true` when some of the entry was not retained: `text` is a beginning, `length` stays exact. */
  readonly truncated: boolean;
}

export interface EntryAssemblerOptions {
  readonly maxRetainedBytes?: number;
}

/** Groups lines into entries, one line at a time, keeping only the entry being built. */
export interface EntryAssembler {
  /** Feeds one line; returns the entry completed by it, if any. */
  push(line: SourceLine): LogEntry | null;
  /** Ends the input; returns the entry still being built, if any. */
  finish(): LogEntry | null;
}

/**
 * Builds entries from lines: a line that matches the profile header starts an entry, any other line
 * continues the current one. Lines before the first header form an entry without a level, so nothing
 * is dropped, and such an entry is never an error.
 *
 * The retained text is bounded by `maxRetainedBytes` counted in source bytes. The header line is always
 * kept; later lines are kept while they fit.
 */
function createTextEntryAssembler(profile: TextProfile, maxRetainedBytes: number): EntryAssembler {
  let current: { readonly lines: EntryLines; readonly fields: EntryFields } | null = null;

  return {
    push(line) {
      const header = matchHeader(profile, line.text);
      let completed: LogEntry | null = null;
      if (header !== null && current !== null) {
        completed = completeEntry(current.lines, current.fields);
        current = null;
      }
      if (current === null) {
        current = { lines: startEntryLines(line), fields: header ?? NO_FIELDS };
      } else {
        appendEntryLine(current.lines, line, maxRetainedBytes);
      }
      return completed;
    },

    finish() {
      const last = current === null ? null : completeEntry(current.lines, current.fields);
      current = null;
      return last;
    },
  };
}

/** Builds the entries of a source the way its profile reads them: header lines for a text log, records for a CSV export. */
export function createEntryAssembler(profile: LogProfile, options: EntryAssemblerOptions = {}): EntryAssembler {
  const maxRetainedBytes = options.maxRetainedBytes ?? MAX_RETAINED_BYTES;
  return profile.kind === 'csv' ? createCsvEntryAssembler(profile, maxRetainedBytes) : createTextEntryAssembler(profile, maxRetainedBytes);
}
