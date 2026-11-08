import { createEntryAssembler } from './entryAssembler';
import type { LogEntry } from './entryAssembler';
import { fingerprint } from './fingerprint';
import { isErrorLevel } from './levels';
import { createLineSplitter } from './lineSplitter';
import type { SourceLine, TextEncoding } from './lineSplitter';
import type { EntryFilter } from './preparation';
import { matchHeader } from './profiles';
import type { LogProfile } from './profiles';
import { truncateText } from './text';

/**
 * Most error entries kept for one scan. Provisional: SPEC §3 wants the thresholds fixed by a measurement on a
 * large generated file; beyond it errors are still counted but not recorded, and the result says so.
 */
export const MAX_ERROR_RECORDS = 100_000;

/** Longest message kept in a record, in UTF-16 units. The whole entry is read again on demand. */
export const MAX_MESSAGE_CHARS = 300;

/** Errors sent to the callback at once, so that a long scan shows its first results early. */
export const ERROR_BATCH_SIZE = 500;

/**
 * An error entry as kept in memory: where it is in the source, not its text. The text is read again from the
 * source with `offset` and `length` (SPEC §3, « Mémoire »).
 */
export interface ErrorRecord {
  /** Byte offset of the entry in the source. */
  readonly offset: number;
  /** Byte length of the entry, up to the start of the next one. */
  readonly length: number;
  readonly timestamp: string | null;
  readonly level: string;
  /**
   * What follows the timestamp and the level on the first line of the entry (the whole first line when the format has
   * no message part), cut at {@link ScanOptions.maxMessageChars}. The timestamp and the level are kept apart.
   */
  readonly message: string;
  /** `true` when `message` is shorter than the real message. */
  readonly messageCut: boolean;
  readonly lineCount: number;
  /** Index in {@link ScanResult.fingerprints}; errors with the same id are the same error. */
  readonly fingerprintId: number;
}

export interface ScanOptions {
  readonly profile: LogProfile;
  readonly maxErrorRecords?: number;
  readonly maxMessageChars?: number;
  readonly batchSize?: number;
  /** Leaves entries out: an entry it ignores is counted as read, but it is neither an error nor fingerprinted. */
  readonly filter?: EntryFilter;
}

export interface ScanCallbacks {
  /** Called with the next errors, in reading order. */
  onErrors(records: readonly ErrorRecord[]): void;
  /** Called after each block with the total number of bytes read so far. */
  onProgress(bytesRead: number): void;
}

export interface ScanResult {
  /** Total bytes read. */
  readonly bytes: number;
  /** `null` when the input was empty. */
  readonly encoding: TextEncoding | null;
  /** Every entry of the source, errors or not. */
  readonly entries: number;
  /** Entries left out by the filter, each counted once; `entries - ignored` is what the analysis looked at. */
  readonly ignored: number;
  /** For each rule of the filter, the entries it matches (an entry matched by two rules counts for both). */
  readonly ignoredPerRule: readonly number[];
  /** Entries outside the period of the filter, whether or not a rule also matches them. */
  readonly ignoredByPeriod: number;
  /** Every error entry kept by the filter, including those past the record limit. */
  readonly errors: number;
  /** Entries whose text was too long to keep: their beginning is kept, their position stays exact. */
  readonly truncatedEntries: number;
  /** `true` when some errors were counted but not recorded because of `maxErrorRecords`. */
  readonly limitReached: boolean;
  /** Grouping key of each distinct error among the recorded ones, indexed by `fingerprintId`. */
  readonly fingerprints: readonly string[];
}

/**
 * Reads a whole source once: splits it into lines, groups them into entries with `profile`, and records
 * the position, level and fingerprint of every error. Memory stays proportional to the number of recorded
 * errors, not to the size of the source: entry texts are dropped as soon as they are read, the first line
 * kept in a record is short, and a fingerprint key is capped (`MAX_MESSAGE_KEY_CHARS`).
 *
 * @param chunks - The source as blocks of bytes, e.g. `blob.stream()`; blocks may be cut anywhere.
 *   A plain iterable is accepted too, for a source that is already in memory.
 * @param options - The profile to read the entries with, and the limits.
 * @param callbacks - Receives the errors in batches and the progress.
 */
export async function scanLog(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: ScanOptions,
  callbacks: ScanCallbacks,
): Promise<ScanResult> {
  const { profile } = options;
  const maxErrorRecords = options.maxErrorRecords ?? MAX_ERROR_RECORDS;
  const maxMessageChars = options.maxMessageChars ?? MAX_MESSAGE_CHARS;
  const batchSize = options.batchSize ?? ERROR_BATCH_SIZE;
  const { filter } = options;

  const splitter = createLineSplitter();
  const assembler = createEntryAssembler(profile);
  const fingerprintIds = new Map<string, number>();
  let batch: ErrorRecord[] = [];
  let bytes = 0;
  let entries = 0;
  let errors = 0;
  let recorded = 0;
  let truncatedEntries = 0;

  function flush(): void {
    if (batch.length > 0) {
      callbacks.onErrors(batch);
      batch = [];
    }
  }

  function record(entry: LogEntry, level: string): void {
    const key = fingerprint(entry, profile);
    let fingerprintId = fingerprintIds.get(key);
    if (fingerprintId === undefined) {
      fingerprintId = fingerprintIds.size;
      fingerprintIds.set(key, fingerprintId);
    }
    const message = matchHeader(profile, entry.firstLine)?.message ?? entry.firstLine;
    batch.push({
      offset: entry.offset,
      length: entry.length,
      timestamp: entry.timestamp,
      level,
      message: truncateText(message, maxMessageChars),
      messageCut: message.length > maxMessageChars,
      lineCount: entry.lineCount,
      fingerprintId,
    });
    recorded += 1;
    if (batch.length >= batchSize) {
      flush();
    }
  }

  function take(entry: LogEntry | null): void {
    if (entry === null) {
      return;
    }
    entries += 1;
    if (entry.truncated) {
      truncatedEntries += 1;
    }
    if (filter?.ignores(entry) === true) {
      return;
    }
    if (entry.level !== null && isErrorLevel(entry.level)) {
      errors += 1;
      if (recorded < maxErrorRecords) {
        record(entry, entry.level);
      }
    }
  }

  function feed(lines: readonly SourceLine[]): void {
    for (const line of lines) {
      take(assembler.push(line));
    }
  }

  for await (const chunk of chunks) {
    bytes += chunk.length;
    feed(splitter.push(chunk));
    callbacks.onProgress(bytes);
  }
  feed(splitter.finish());
  take(assembler.finish());
  flush();

  const { ignored, ignoredPerRule, ignoredByPeriod } = filter?.counts() ?? { ignored: 0, ignoredPerRule: [], ignoredByPeriod: 0 };
  return {
    bytes,
    encoding: splitter.encoding,
    entries,
    ignored,
    ignoredPerRule,
    ignoredByPeriod,
    errors,
    truncatedEntries,
    limitReached: errors > recorded,
    fingerprints: [...fingerprintIds.keys()],
  };
}
