import type { LogEntry } from './entryAssembler';
import type { SourceLine } from './lineSplitter';

/** What an entry says about itself: read from its header line in a text log, from its fields in an export. */
export interface EntryFields {
  readonly timestamp: string | null;
  readonly level: string | null;
  readonly message: string | null;
}

/** The fields of lines that say nothing about themselves: such an entry is never an error. */
export const NO_FIELDS: EntryFields = { timestamp: null, level: null, message: null };

/** The lines of an entry being built, its text retained up to a number of source bytes. Shared by every way of reading. */
export interface EntryLines {
  readonly offset: number;
  length: number;
  readonly firstLine: string;
  readonly lines: string[];
  lineCount: number;
  retainedBytes: number;
  /** Set when a line did not fit: the following lines are skipped too, so `text` stays a beginning. */
  full: boolean;
  truncated: boolean;
}

/** Starts an entry with its first line, which is always retained. */
export function startEntryLines(line: SourceLine): EntryLines {
  return {
    offset: line.offset,
    length: line.byteLength,
    firstLine: line.text,
    lines: [line.text],
    lineCount: 1,
    retainedBytes: line.byteLength,
    full: false,
    truncated: line.truncated,
  };
}

/** Adds a line to an entry: counted always, retained while the entry fits in `maxRetainedBytes`. */
export function appendEntryLine(entry: EntryLines, line: SourceLine, maxRetainedBytes: number): void {
  entry.length += line.byteLength;
  entry.lineCount += 1;
  if (entry.full || entry.retainedBytes + line.byteLength > maxRetainedBytes) {
    entry.full = true;
    entry.truncated = true;
    return;
  }
  entry.lines.push(line.text);
  entry.retainedBytes += line.byteLength;
  entry.truncated ||= line.truncated;
}

export function completeEntry(entry: EntryLines, fields: EntryFields): LogEntry {
  return {
    offset: entry.offset,
    length: entry.length,
    timestamp: fields.timestamp,
    level: fields.level,
    message: fields.message,
    firstLine: entry.firstLine,
    text: entry.lines.join('\n'),
    lineCount: entry.lineCount,
    truncated: entry.truncated,
  };
}
