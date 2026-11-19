import type { EntryAssembler, LogEntry } from './entryAssembler';
import { appendEntryLine, completeEntry, NO_FIELDS, startEntryLines } from './entryLines';
import type { EntryFields, EntryLines } from './entryLines';
import type { CsvProfile } from './profiles';

/**
 * The date as the Log Analytics portal writes it in a real export: `20/10/2026 00:41:49.839`, day first, 24-hour
 * clock, in UTC as the column name says. Any other shape gives no date rather than a guessed one; a month above 12, in
 * particular, shows that the day is not first. Anchored and without nested quantifiers, hence linear.
 */
const EXPORT_TIME = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(\d{4}) ((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?)$/;

/** Rewrites the date of the export as ISO 8601, so that sorting and the period read it like the date of a text log. */
function readExportTime(value: string | undefined): string | null {
  const parts = value === undefined ? null : EXPORT_TIME.exec(value);
  if (parts === null) {
    return null;
  }
  const [, day, month, year, time] = parts;
  return `${year ?? ''}-${month ?? ''}-${day ?? ''}T${time ?? ''}Z`;
}

/** Reads the fields of one record, line by line (RFC 4180: quoted fields may hold commas, doubled quotes and line breaks). */
interface FieldReader {
  /** Reads the next line of the record; `true` when it ends the record, `false` when a quoted field goes on. */
  read(line: string): boolean;
  /** The first line of each kept field read so far, by column index. */
  readonly values: ReadonlyMap<number, string>;
}

/**
 * Only the fields for which `isKept` is true are retained, and only up to their first line break: a field cannot then
 * hold more than a line, whatever the record. The others are read only to count the columns.
 */
function createFieldReader(isKept: (column: number) => boolean): FieldReader {
  const values = new Map<number, string>();
  let column = 0;
  let value = '';
  let quoted = false;
  let atFieldStart = true;
  let onFirstLine = true;

  function keep(text: string): void {
    if (onFirstLine && isKept(column)) {
      value += text;
    }
  }

  function endField(): void {
    if (isKept(column)) {
      values.set(column, value);
    }
    column += 1;
    value = '';
    atFieldStart = true;
    onFirstLine = true;
  }

  return {
    values,
    read(line) {
      for (let index = 0; index < line.length; index += 1) {
        const char = line.charAt(index);
        if (quoted) {
          if (char !== '"') {
            keep(char);
          } else if (line.charAt(index + 1) === '"') {
            keep('"');
            index += 1;
          } else {
            quoted = false;
          }
        } else if (char === ',') {
          endField();
        } else if (char === '"' && atFieldStart) {
          // Only a quote that opens a field starts quoted text: a stray one inside a value would swallow the next rows.
          quoted = true;
          atFieldStart = false;
        } else {
          keep(char);
          atFieldStart = false;
        }
      }
      if (quoted) {
        onFirstLine = false;
        return false;
      }
      endField();
      return true;
    },
  };
}

interface ColumnIndexes {
  readonly timestamp: number;
  readonly level: number;
  readonly message: number;
}

/** Finds the columns of the profile on the line of column names; `null` when one of them is missing. */
function findColumns(profile: CsvProfile, line: string): ColumnIndexes | null {
  const reader = createFieldReader(() => true);
  reader.read(line);
  const names = [...reader.values.values()];
  const timestamp = names.indexOf(profile.columns.timestamp);
  const level = names.indexOf(profile.columns.level);
  const message = names.indexOf(profile.columns.message);
  return timestamp < 0 || level < 0 || message < 0 ? null : { timestamp, level, message };
}

/** `true` when `line` names every column the profile reads: the first line of such an export. */
export function hasProfileColumns(profile: CsvProfile, line: string): boolean {
  return findColumns(profile, line) !== null;
}

/**
 * Builds entries from the records of a CSV export: the first line names the columns, then each record is one entry,
 * even when a quoted message spans several lines. The level is named with the table of the profile, the date is
 * rewritten as ISO 8601 (see {@link EXPORT_TIME}).
 *
 * When a column of the profile is missing, the whole text is one entry without a level: it is shown, never an error.
 *
 * @throws When a line was cut by the line splitter: its quotes can no longer be counted, so the fields of every
 *   following record would be read at the wrong place. Refusing is visible; reading on could invent errors.
 */
export function createCsvEntryAssembler(profile: CsvProfile, maxRetainedBytes: number): EntryAssembler {
  /** `undefined` until the first line is read, `null` when it lacks a column of the profile. */
  let columns: ColumnIndexes | null | undefined;
  let current: { readonly lines: EntryLines; readonly reader: FieldReader } | null = null;

  function isKept(column: number): boolean {
    return columns !== null && columns !== undefined && (column === columns.timestamp || column === columns.level || column === columns.message);
  }

  function fieldsOf(reader: FieldReader): EntryFields {
    if (columns === null || columns === undefined) {
      return NO_FIELDS;
    }
    const level = reader.values.get(columns.level);
    return {
      timestamp: readExportTime(reader.values.get(columns.timestamp)),
      level: level === undefined ? null : (profile.levels.get(level) ?? level),
      message: reader.values.get(columns.message) ?? null,
    };
  }

  function complete(): LogEntry | null {
    if (current === null) {
      return null;
    }
    const entry = completeEntry(current.lines, fieldsOf(current.reader));
    current = null;
    return entry;
  }

  return {
    push(line) {
      if (line.truncated) {
        throw new Error('une ligne de l’export CSV est trop longue pour être lue entière : ses colonnes ne peuvent pas être lues sûrement');
      }
      if (columns === undefined) {
        columns = findColumns(profile, line.text);
        if (columns !== null) {
          // The line of column names is not an entry.
          return null;
        }
      }
      if (current === null) {
        current = { lines: startEntryLines(line), reader: createFieldReader(isKept) };
      } else {
        appendEntryLine(current.lines, line, maxRetainedBytes);
      }
      // Without its columns the export cannot be read: every line joins the same entry, which has no level.
      return columns !== null && current.reader.read(line.text) ? complete() : null;
    },

    // A record left open by the end of the input (the beginning of a big file) gives what was read of it.
    finish: complete,
  };
}
