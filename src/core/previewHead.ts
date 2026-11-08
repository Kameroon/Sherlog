import { createEntryAssembler } from './entryAssembler';
import type { LogEntry } from './entryAssembler';
import { isErrorLevel } from './levels';
import { createLineSplitter } from './lineSplitter';
import type { SourceLine } from './lineSplitter';
import { createEntryFilter } from './preparation';
import type { Preparation } from './preparation';
import { matchHeader } from './profiles';
import type { LogProfile } from './profiles';
import { truncateText } from './text';

/** Lines shown in the preview of the prepared log. */
export const MAX_PREVIEW_LINES = 60;

/** Longest line shown, in UTF-16 units. A log line can be megabytes long; the preview is for reading. */
export const MAX_PREVIEW_LINE_CHARS = 300;

/** One line of the preview, as the preparation sees it. */
export interface PreviewLine {
  /** Position in the text, from 1. */
  readonly number: number;
  /** The line, cut at {@link MAX_PREVIEW_LINE_CHARS}. */
  readonly text: string;
  /** `true` when `text` is shorter than the real line. */
  readonly cut: boolean;
  /** `header` starts an entry; `continuation` belongs to the entry before it (stack, long message). */
  readonly kind: 'header' | 'continuation';
  /** Level written in a header; `null` for a continuation. */
  readonly level: string | null;
  /** `true` for the header of an error entry that is kept: a line of an entry left out is never highlighted as an error. */
  readonly isError: boolean;
  /** `true` when the entry this line belongs to is left out by the preparation. */
  readonly ignored: boolean;
}

/** The same figures as a scan gives, over the text that was looked at. */
export interface PreviewCounts {
  /** Every entry of the text, errors or not. */
  readonly read: number;
  /** Entries left out, each counted once. */
  readonly ignored: number;
  /** For each « ignore » rule, in order, the entries it matches. */
  readonly ignoredPerRule: readonly number[];
  /** `read - ignored`: what the analysis would look at. */
  readonly ready: number;
  /** Error entries among the ready ones. */
  readonly errors: number;
}

export interface HeadPreview {
  readonly counts: PreviewCounts;
  /** The first {@link MAX_PREVIEW_LINES} lines. */
  readonly lines: readonly PreviewLine[];
  /** Every line of the text. */
  readonly totalLines: number;
  /** Lines before the first header: kept, but never an error, since nothing says what level they have. */
  readonly orphanLines: number;
}

/** Reads the whole text as entries of `profile`, the way a scan does, but keeps every line for the preview. */
function readEntries(bytes: Uint8Array, profile: LogProfile): { lines: readonly SourceLine[]; entries: readonly LogEntry[] } {
  const splitter = createLineSplitter();
  const lines = [...splitter.push(bytes), ...splitter.finish()];
  const assembler = createEntryAssembler(profile);
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const completed = assembler.push(line);
    if (completed !== null) {
      entries.push(completed);
    }
  }
  const last = assembler.finish();
  if (last !== null) {
    entries.push(last);
  }
  return { lines, entries };
}

/**
 * What the preparation does to the beginning of a log, for the screen where the user sets it. Same rules as the
 * scan (it uses the same filter), applied to the bytes it is given: the whole text when it is short, only its
 * start when the source is big. Nothing here reads the source again, so it can be redone at every setting.
 *
 * @param bytes - The text, as read from the source.
 * @param profile - The format to read it with.
 * @param preparation - What to leave out.
 */
export function previewHead(bytes: Uint8Array, profile: LogProfile, preparation: Preparation): HeadPreview {
  const { lines, entries } = readEntries(bytes, profile);
  const filter = createEntryFilter(preparation);
  const ignoredEntries = entries.map((entry) => filter.ignores(entry));

  const { ignored, ignoredPerRule } = filter.counts();
  const errors = entries.filter((entry, index) => ignoredEntries[index] === false && isErrorLevel(entry.level)).length;

  // Entries are contiguous: one walk forward gives the entry of every line.
  let current = 0;
  const shown = lines.slice(0, MAX_PREVIEW_LINES).map((line, index): PreviewLine => {
    while (current + 1 < entries.length && line.offset >= (entries[current + 1]?.offset ?? Number.POSITIVE_INFINITY)) {
      current += 1;
    }
    const header = matchHeader(profile, line.text);
    return {
      number: index + 1,
      text: truncateText(line.text, MAX_PREVIEW_LINE_CHARS),
      cut: line.text.length > MAX_PREVIEW_LINE_CHARS,
      kind: header === null ? 'continuation' : 'header',
      level: header?.level ?? null,
      isError: header !== null && isErrorLevel(header.level) && ignoredEntries[current] === false,
      ignored: ignoredEntries[current] === true,
    };
  });

  const [first] = entries;
  return {
    counts: { read: entries.length, ignored, ignoredPerRule, ready: entries.length - ignored, errors },
    lines: shown,
    totalLines: lines.length,
    orphanLines: first !== undefined && first.level === null ? first.lineCount : 0,
  };
}
