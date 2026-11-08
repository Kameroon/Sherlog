import type { LogEntry } from './entryAssembler';
import { matchHeader } from './profiles';
import type { LogProfile } from './profiles';
import { truncateText } from './text';

/**
 * Longest normalised message kept in a key. A key is held in memory for every distinct error, and a log line can be
 * about 1 MiB: without a limit, many different huge lines would keep as much memory as the file. Two messages that
 * are the same on their first characters are therefore the same error (SPEC §5).
 */
export const MAX_MESSAGE_KEY_CHARS = 1000;

/**
 * Rules applied in this order. The order matters: a URL, an e-mail or a temporary path is replaced whole before
 * its digits are looked at, and dates before the numbers they contain.
 *
 * The messages come from untrusted logs and can be about 1 MiB, so every rule must stay linear: no nested
 * quantifier, and a lookbehind on the e-mail rule so that a long run of word characters is scanned once, not
 * once per starting position. `tests/fingerprint.test.ts` guards this with hostile inputs.
 */
const REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/https?:\/\/\S+/gi, '<url>'],
  [/(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>'],
  // Temporary paths hold generated names (upload-4412.bin); the user name inside a Windows path varies too.
  [/\/(?:var\/)?tmp\/\S*/gi, '<tmp>'],
  [/[A-Z]:\\Users\\[^\\\s]+\\AppData\\Local\\Temp\\\S*/gi, '<tmp>'],
  [/[A-Z]:\\(?:Windows\\)?Temp\\\S*/gi, '<tmp>'],
  [/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)?/g, '<time>'],
  [/\b\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/g, '<time>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<guid>'],
  [/\b0x[0-9a-f]+\b/gi, '<addr>'],
  // IPv6 is not handled: its groups are left as written, which can only split identical errors, never merge different ones.
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>'],
];

/** Words joined by `-` or `_`, such as `ORD-2026-7710`. Matching never fails after the first character, hence it is linear. */
const HYPHENATED_WORD = /[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*/g;

/**
 * Numbers, with their decimals. `\b` keeps the digits that are part of a name (`Int32`, `Utf8`) so that two
 * different types are not merged, while `30012ms` still loses its number.
 */
const NUMBER = /\b\d+(?:[.,]\d+)*/g;

/**
 * An identifier mixes letters and digits across hyphens or underscores (`ORD-2026-7710`, `ord_ab12`).
 * Words without a digit (`Content-Type`) and names without a separator (`Int32`) are left alone: replacing them
 * would merge errors that have different causes.
 */
function replaceIdentifier(word: string): string {
  return /[-_]/.test(word) && /\d/.test(word) && /[A-Za-z]/.test(word) ? '<id>' : word;
}

/**
 * Replaces the values that change from one occurrence of an error to the next (numbers, dates, GUIDs, e-mails,
 * IP addresses, URLs, identifiers, temporary paths, memory addresses) with placeholders such as `<n>` or `<guid>`.
 * Two messages that differ only by those values give the same text.
 *
 * Used to group identical errors; it is not a masking step and does not hide sensitive data from the AI (`redact`, step 6).
 */
export function normalizeMessage(message: string): string {
  let normalized = message;
  for (const [pattern, placeholder] of REPLACEMENTS) {
    normalized = normalized.replace(pattern, placeholder);
  }
  return normalized.replace(HYPHENATED_WORD, replaceIdentifier).replace(NUMBER, '<n>');
}

/**
 * A stack frame line: leading blanks, `at`, then a name directly followed by an argument list. The parenthesis
 * is what tells `   at Shop.Orders.Get(Guid id)` from a message line such as `   at least 3 rows`.
 * Only this syntax (.NET and Java) is recognised: other stack formats give no frame, never a guessed one.
 */
const STACK_FRAME = /^\s+at\s+(\S*\(.*)$/;

/** Suffix that .NET adds to a frame: ` in /src/File.cs:line 87`. The line number changes with every build. */
const SOURCE_LOCATION = /:line\s+\d+\s*$/;

function frameName(line: string): string | null {
  const frame = STACK_FRAME.exec(line)?.[1]?.trimEnd();
  if (frame === undefined) {
    return null;
  }
  const locationStart = frame.lastIndexOf(' in ');
  return locationStart >= 0 && SOURCE_LOCATION.test(frame.slice(locationStart)) ? frame.slice(0, locationStart) : frame;
}

/**
 * Finds the frame of the application code that raised the error: the first frame whose name does not start
 * with a library prefix, so that the framework frames above it do not hide which application code failed.
 *
 * @param text - Entry text; its first line is the header and is never read as a frame.
 * @param libraryPrefixes - Name prefixes of library code, from the profile.
 * @returns The frame without its source location; the first frame when all of them are library code;
 *   `null` when the entry has no recognised stack frame.
 */
export function firstApplicationFrame(text: string, libraryPrefixes: readonly string[]): string | null {
  let firstFrame: string | null = null;
  for (const line of text.split('\n').slice(1)) {
    const frame = frameName(line);
    if (frame === null) {
      continue;
    }
    if (!libraryPrefixes.some((prefix) => frame.startsWith(prefix))) {
      return frame;
    }
    firstFrame ??= frame;
  }
  return firstFrame;
}

/**
 * Grouping key of an entry: its level, its normalised message (cut at {@link MAX_MESSAGE_KEY_CHARS}) and its first application frame, joined with
 * line breaks (none of the three parts can contain one). It is the string itself, not a hash, so that `core`
 * stays synchronous and free of Web APIs (SPEC §5). Two entries with the same key are the same error.
 *
 * It is computed from the retained text: when `entry.truncated` the stack may have been cut, and the frame
 * part can then be missing.
 *
 * @param entry - An entry assembled with `profile`.
 * @param profile - The profile that read the entry; gives the message group and the library prefixes.
 */
export function fingerprint(entry: LogEntry, profile: LogProfile): string {
  const message = matchHeader(profile, entry.firstLine)?.message ?? entry.firstLine;
  const frame = firstApplicationFrame(entry.text, profile.libraryPrefixes) ?? '';
  return [(entry.level ?? '').toUpperCase(), truncateText(normalizeMessage(message), MAX_MESSAGE_KEY_CHARS), frame].join('\n');
}
