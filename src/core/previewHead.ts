import { createEntryAssembler } from './entryAssembler';
import type { LogEntry } from './entryAssembler';
import { isErrorLevel } from './levels';
import { createLineSplitter } from './lineSplitter';
import type { SourceLine } from './lineSplitter';
import { createEntryFilter } from './preparation';
import type { Preparation } from './preparation';
import { BUILT_IN_PROFILES, matchHeader } from './profiles';
import type { LogProfile } from './profiles';
import { countOccurrences, redact } from './redact';
import type { RedactionRuleId } from './redact';
import { truncateText } from './text';

/** Lines shown in the preview of the prepared log. */
export const MAX_PREVIEW_LINES = 60;

/** Longest line shown, in UTF-16 units. A log line can be megabytes long; the preview is for reading. */
export const MAX_PREVIEW_LINE_CHARS = 300;

/** One line of the preview, as the preparation sees it. */
export interface PreviewLine {
  /** Position in the text, from 1. */
  readonly number: number;
  /** The line as the screen shows it, masked by the rules that are on, then cut at {@link MAX_PREVIEW_LINE_CHARS}. */
  readonly text: string;
  /** `true` when `text` is shorter than the line it shows. */
  readonly cut: boolean;
  /** The line as it is in the log, cut at {@link MAX_PREVIEW_LINE_CHARS}: shown only when the user asks for it. */
  readonly originalText: string;
  /** `true` when `originalText` is shorter than the real line. */
  readonly originalCut: boolean;
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
  /** Entries outside the period, whether or not a rule also matches them. */
  readonly ignoredByPeriod: number;
  /** `read - ignored`: what the analysis would look at. */
  readonly ready: number;
  /** Error entries among the ready ones. */
  readonly errors: number;
}

/** What the masking rules find in the entries that are kept. */
export interface MaskingFigures {
  /** For each rule, what it finds, whether or not the rule is on: what a box would hide. */
  readonly occurrences: Readonly<Record<RedactionRuleId, number>>;
  /** What the rules that are on replace. */
  readonly masked: number;
}

export interface HeadPreview {
  readonly counts: PreviewCounts;
  readonly masking: MaskingFigures;
  /** The first {@link MAX_PREVIEW_LINES} lines. */
  readonly lines: readonly PreviewLine[];
  /** Every line of the text. */
  readonly totalLines: number;
  /** Entries that start with a header of the format: 0 means the format reads nothing of this text. */
  readonly headerCount: number;
  /** Lines that look like a header of another known format. */
  readonly otherFormat: OtherFormatLines;
  /** Where the text starts and ends in time, as written; `null` when no entry has a timestamp. */
  readonly timeRange: TimeRange | null;
  /** Lines before the first header: kept, but never an error, since nothing says what level they have. */
  readonly orphanLines: number;
}

/** The text read as entries of a profile: what a preparation is then applied to, as often as the user changes it. */
export interface ParsedHead {
  readonly profile: LogProfile;
  /** Only the lines the preview shows: a text of half a million lines must not keep half a million objects. */
  readonly firstLines: readonly SourceLine[];
  /** Every line of the text. */
  readonly totalLines: number;
  readonly entries: readonly LogEntry[];
  /**
   * What each masking rule finds in each entry, in the order of `entries`. Counted once, when the text is read: it does
   * not depend on the preparation, which only decides which entries count.
   */
  readonly occurrencesByEntry: readonly Readonly<Record<RedactionRuleId, number>>[];
  /** Lines that are not a header of the format but look like a header of another known format. */
  readonly otherFormat: OtherFormatLines;
  /** Entries that start with a header of the format: 0 means the format reads nothing of this text. */
  readonly headerCount: number;
  /** First and last timestamp of the text as written, to tell the user what a period can be chosen in. */
  readonly timeRange: TimeRange | null;
}

/**
 * Lines that the format in use reads as the continuation of the entry before them, though they are headers of another
 * known format: a log that mixes layouts. They are only pointed out; the reading does not change.
 */
export interface OtherFormatLines {
  readonly lines: number;
  /** The other formats they look like, once each. */
  readonly labels: readonly string[];
}

/** The timestamps of the first and of the last entry that has one, exactly as written in the log. */
export interface TimeRange {
  readonly first: string;
  readonly last: string;
}

function findOtherFormatLines(lines: readonly SourceLine[], profile: LogProfile): OtherFormatLines {
  const others = BUILT_IN_PROFILES.filter((candidate) => candidate.id !== profile.id);
  const labels = new Set<string>();
  let count = 0;
  for (const line of lines) {
    if (matchHeader(profile, line.text) !== null) {
      continue;
    }
    const like = others.filter((other) => matchHeader(other, line.text) !== null);
    if (like.length > 0) {
      count += 1;
      like.forEach((other) => labels.add(other.label));
    }
  }
  return { lines: count, labels: [...labels] };
}

/**
 * Reads the whole text as entries of `profile`, the way a scan does, but keeps every line for the preview. This is
 * the costly part (it is proportional to the number of lines): do it once per text and profile, then give the result
 * to {@link previewHead} at each change of the preparation.
 */
export function parseHead(bytes: Uint8Array, profile: LogProfile): ParsedHead {
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
  const stamps = entries.flatMap((entry) => (entry.timestamp === null ? [] : [entry.timestamp]));
  const firstStamp = stamps[0];
  const lastStamp = stamps.at(-1);
  const timeRange = firstStamp === undefined || lastStamp === undefined ? null : { first: firstStamp, last: lastStamp };
  const headerCount = entries.filter((entry) => entry.level !== null).length;
  const occurrencesByEntry = entries.map((entry) => countOccurrences(entry.text));
  return { profile, firstLines: lines.slice(0, MAX_PREVIEW_LINES), totalLines: lines.length, entries, occurrencesByEntry, headerCount, timeRange, otherFormat: findOtherFormatLines(lines, profile) };
}

/**
 * What the preparation does to the beginning of a log, for the screen where the user sets it. Same rules as the
 * scan (it uses the same filter), applied to the text it is given: the whole text when it is short, only its
 * start when the source is big. Nothing here reads the source or the bytes again, so it can be redone at every setting.
 *
 * @param parsed - The text, read by {@link parseHead} with the format to preview.
 * @param preparation - What to leave out.
 * @param masking - The masking rules that are on: they change what the lines show, not what is counted as read or ready.
 */
export function previewHead(
  { profile, firstLines, totalLines, entries, occurrencesByEntry, headerCount, timeRange, otherFormat }: ParsedHead,
  preparation: Preparation,
  masking: ReadonlySet<RedactionRuleId> = new Set(),
): HeadPreview {
  const filter = createEntryFilter(preparation);
  const ignoredEntries = entries.map((entry) => filter.ignores(entry));

  const { ignored, ignoredPerRule, ignoredByPeriod } = filter.counts();
  const errors = entries.filter((entry, index) => ignoredEntries[index] === false && isErrorLevel(entry.level)).length;

  // Entries are contiguous: one walk forward gives the entry of every line.
  let current = 0;
  const shown = firstLines.map((line, index): PreviewLine => {
    while (current + 1 < entries.length && line.offset >= (entries[current + 1]?.offset ?? Number.POSITIVE_INFINITY)) {
      current += 1;
    }
    const header = matchHeader(profile, line.text);
    // Masked before it is cut: a secret that straddles the cut must not be shown in part.
    const masked = masking.size === 0 ? line.text : redact(line.text, masking).text;
    return {
      number: index + 1,
      text: truncateText(masked, MAX_PREVIEW_LINE_CHARS),
      cut: masked.length > MAX_PREVIEW_LINE_CHARS,
      originalText: truncateText(line.text, MAX_PREVIEW_LINE_CHARS),
      originalCut: line.text.length > MAX_PREVIEW_LINE_CHARS,
      kind: header === null ? 'continuation' : 'header',
      level: header?.level ?? null,
      isError: header !== null && isErrorLevel(header.level) && ignoredEntries[current] === false,
      ignored: ignoredEntries[current] === true,
    };
  });

  const occurrences = { email: 0, secret: 0, ip: 0, card: 0, guid: 0, urlHost: 0 };
  let masked = 0;
  entries.forEach((entry, index) => {
    if (ignoredEntries[index] === true) {
      return;
    }
    const found = occurrencesByEntry[index];
    if (found === undefined) {
      return;
    }
    for (const id of Object.keys(occurrences) as RedactionRuleId[]) {
      occurrences[id] += found[id];
    }
    // Only an entry in which an active rule found something is worth masking to count the replacements.
    if ([...masking].some((id) => found[id] > 0)) {
      masked += redact(entry.text, masking).count;
    }
  });

  const [first] = entries;
  return {
    masking: { occurrences, masked },
    counts: { read: entries.length, ignored, ignoredPerRule, ignoredByPeriod, ready: entries.length - ignored, errors },
    lines: shown,
    totalLines,
    headerCount,
    otherFormat,
    timeRange,
    orphanLines: first !== undefined && first.level === null ? first.lineCount : 0,
  };
}
