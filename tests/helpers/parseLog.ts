import { detectProfile } from '../../src/core/detectProfile';
import type { Detection } from '../../src/core/detectProfile';
import { createEntryAssembler } from '../../src/core/entryAssembler';
import type { LogEntry } from '../../src/core/entryAssembler';
import { isErrorLevel } from '../../src/core/levels';
import { createLineSplitter } from '../../src/core/lineSplitter';
import type { SourceLine, TextEncoding } from '../../src/core/lineSplitter';
import type { LogProfile } from '../../src/core/profiles';

export interface ParsedLog {
  readonly encoding: TextEncoding | null;
  readonly detection: Detection;
  readonly lines: readonly SourceLine[];
  /** Empty unless a profile was detected or given. */
  readonly entries: readonly LogEntry[];
}

/**
 * Runs the whole core pipeline on bytes, the way the worker of step 4 will: split, detect, assemble.
 * The input is fed in blocks of `chunkSize` bytes so that blocks cut in the middle of characters are exercised.
 */
export function parseBytes(bytes: Uint8Array, chunkSize = bytes.length, profile?: LogProfile): ParsedLog {
  const splitter = createLineSplitter();
  const lines: SourceLine[] = [];
  for (let start = 0; start < bytes.length; start += Math.max(chunkSize, 1)) {
    lines.push(...splitter.push(bytes.subarray(start, start + chunkSize)));
  }
  lines.push(...splitter.finish());

  const detection: Detection = profile
    ? { status: 'detected', profile }
    : detectProfile(lines.map((line) => line.text));
  if (detection.status !== 'detected') {
    return { encoding: splitter.encoding, detection, lines, entries: [] };
  }

  const assembler = createEntryAssembler(detection.profile);
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
  return { encoding: splitter.encoding, detection, lines, entries };
}

export function errorEntries(entries: readonly LogEntry[]): LogEntry[] {
  return entries.filter((entry) => isErrorLevel(entry.level));
}
