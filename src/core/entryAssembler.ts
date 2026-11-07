import { MAX_RETAINED_BYTES } from './lineSplitter';
import type { SourceLine } from './lineSplitter';
import { matchHeader } from './profiles';
import type { HeaderMatch, LogProfile } from './profiles';

/** One log entry: a header line and the lines that continue it (exception, multi-line message). */
export interface LogEntry {
  /** Byte offset of the first line. Entries are contiguous: each one ends where the next begins. */
  readonly offset: number;
  /** Byte length up to the start of the next entry (or the end of the input), terminators included. */
  readonly length: number;
  /** Timestamp as written in the log; `null` when the profile has none or the entry has no header. */
  readonly timestamp: string | null;
  /** Level as written in the log; `null` for lines that come before the first header. */
  readonly level: string | null;
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

interface Draft {
  readonly offset: number;
  length: number;
  readonly timestamp: string | null;
  readonly level: string | null;
  readonly firstLine: string;
  readonly lines: string[];
  lineCount: number;
  retainedBytes: number;
  /** Set when a line did not fit: the following lines are skipped too, so `text` stays a beginning. */
  full: boolean;
  truncated: boolean;
}

function toEntry(draft: Draft): LogEntry {
  return {
    offset: draft.offset,
    length: draft.length,
    timestamp: draft.timestamp,
    level: draft.level,
    firstLine: draft.firstLine,
    text: draft.lines.join('\n'),
    lineCount: draft.lineCount,
    truncated: draft.truncated,
  };
}

/**
 * Builds entries from lines: a line that matches the profile header starts an entry, any other line
 * continues the current one. Lines before the first header form an entry without a level, so nothing
 * is dropped, and such an entry is never an error.
 *
 * The retained text is bounded by `maxRetainedBytes` counted in source bytes. The header line is always
 * kept; later lines are kept while they fit.
 */
export function createEntryAssembler(profile: LogProfile, options: EntryAssemblerOptions = {}): EntryAssembler {
  const maxRetainedBytes = options.maxRetainedBytes ?? MAX_RETAINED_BYTES;
  let current: Draft | null = null;

  function start(line: SourceLine, header: HeaderMatch | null): Draft {
    return {
      offset: line.offset,
      length: line.byteLength,
      timestamp: header?.timestamp ?? null,
      level: header?.level ?? null,
      firstLine: line.text,
      lines: [line.text],
      lineCount: 1,
      retainedBytes: line.byteLength,
      full: false,
      truncated: line.truncated,
    };
  }

  function append(draft: Draft, line: SourceLine): void {
    draft.length += line.byteLength;
    draft.lineCount += 1;
    if (draft.full || draft.retainedBytes + line.byteLength > maxRetainedBytes) {
      draft.full = true;
      draft.truncated = true;
      return;
    }
    draft.lines.push(line.text);
    draft.retainedBytes += line.byteLength;
    draft.truncated ||= line.truncated;
  }

  return {
    push(line) {
      const header = matchHeader(profile, line.text);
      let completed: LogEntry | null = null;
      if (header !== null && current !== null) {
        completed = toEntry(current);
        current = null;
      }
      if (current === null) {
        current = start(line, header);
      } else {
        append(current, line);
      }
      return completed;
    },

    finish() {
      const last = current === null ? null : toEntry(current);
      current = null;
      return last;
    },
  };
}
