import { redact, rulesForSending } from './redact';
import type { RedactionRuleId } from './redact';
import { truncateText } from './text';

/**
 * Most characters of what comes from the log in one request. Provisional, like the other limits: about three thousand
 * words, which a small local model still follows. Past it the text is cut, and the cut is said (SPEC §6).
 */
export const MAX_INPUT_CHARS = 12_000;

const NO_LINE = '(aucune ligne)';

/** What is known of the error that is sent: the most recent occurrence of its fingerprint, and the log around it. */
export interface SendSource {
  readonly fileName: string;
  /** How many errors share the fingerprint. */
  readonly count: number;
  /** `true` when `count` is a minimum, because errors past the record limit were not recorded. */
  readonly countIsMinimum?: boolean;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  /** The whole text of the entry, stack included, as read from the log. */
  readonly entry: string;
  /** `true` when `entry` stops where the limit on what is read stopped it. */
  readonly entryReadLimitReached: boolean;
  /** The lines of the log before the entry, nearest last. */
  readonly before: readonly string[];
  /** The lines of the log after the entry, nearest first. */
  readonly after: readonly string[];
}

export interface SendPayload {
  /** What comes from the log, as it would be sent: masked, and at most the limit. */
  readonly text: string;
  /** Said to the model after the data when something was cut; `null` otherwise. */
  readonly note: string | null;
  /** What the masking replaced. */
  readonly maskedCount: number;
  /** What was cut. */
  readonly cut: { readonly entry: boolean; readonly before: boolean; readonly after: boolean };
}

const layout = (header: string, entry: string, before: string, after: string): string =>
  `${header}\n\n--- Erreur ---\n${entry}\n\n--- Contexte avant ---\n${before}\n\n--- Contexte après ---\n${after}`;

/** Keeps whole lines from the side nearest to the error until the budget is used; a single line too long for it is cut. */
function fitLines(lines: readonly string[], budget: number, nearest: 'end' | 'start'): { text: string; cut: boolean } {
  const ordered = nearest === 'end' ? [...lines].reverse() : [...lines];
  const kept: string[] = [];
  let used = 0;
  for (const line of ordered) {
    const cost = line.length + (kept.length > 0 ? 1 : 0);
    if (used + cost > budget) {
      break;
    }
    kept.push(line);
    used += cost;
  }
  if (kept.length === 0 && ordered[0] !== undefined && budget > 0) {
    const first = ordered[0];
    const partial = nearest === 'end' ? first.slice(first.length - budget) : truncateText(first, budget);
    return { text: partial, cut: true };
  }
  const inReadingOrder = nearest === 'end' ? kept.reverse() : kept;
  return { text: inReadingOrder.join('\n'), cut: kept.length < lines.length };
}

/**
 * Builds what a request would carry of the log: the occurrences, the file, the error and the lines around it
 * (`docs/PROMPTS.md` §2). Everything is masked first, with the rules the user chose and always those that are on by
 * default (the last safety net, SPEC §6), and only then cut to `maxChars`, so that no part of a secret is sent because
 * a cut fell inside it. The entry is kept before any line around it; the rest is shared between the two sides, a short
 * side giving its room to the other, and each side keeps the lines nearest to the error.
 *
 * The instructions to the model and the random delimiter around this text come from step 8: this is all that comes
 * from the log.
 */
export function buildSendPayload(source: SendSource, masking: ReadonlySet<RedactionRuleId>, maxChars: number = MAX_INPUT_CHARS): SendPayload {
  const rules = rulesForSending(masking);
  let maskedCount = 0;
  const masked = (text: string): string => {
    const result = redact(text, rules);
    maskedCount += result.count;
    return result.text;
  };

  // The extension is set aside: an address that ends a file name (« export-jane@acme.com.log ») would otherwise end in
  // « .log », which the e-mail rule takes for a file name and leaves alone.
  const extension = /\.[A-Za-z0-9]{1,8}$/.exec(source.fileName)?.[0] ?? '';
  const fileName = `${masked(source.fileName.slice(0, source.fileName.length - extension.length))}${extension}`;
  const entry = masked(source.entry);
  // A side is masked as one text: a header can be split over two lines.
  const before = masked(source.before.join('\n')).split('\n');
  const after = masked(source.after.join('\n')).split('\n');
  const beforeLines = source.before.length === 0 ? [] : before;
  const afterLines = source.after.length === 0 ? [] : after;

  const count = `${source.countIsMinimum === true ? 'au moins ' : ''}${source.count}`;
  const header = `Occurrences : ${count} (première : ${source.firstSeen ?? 'sans heure'}, dernière : ${source.lastSeen ?? 'sans heure'})\nFichier : ${fileName}`;

  const reserved = (beforeLines.length === 0 ? NO_LINE.length : 0) + (afterLines.length === 0 ? NO_LINE.length : 0);
  const budget = Math.max(0, maxChars - layout(header, '', '', '').length - reserved);

  const entryText = truncateText(entry, budget);
  const entryCut = entryText.length < entry.length || source.entryReadLimitReached;
  const rest = budget - entryText.length;

  const beforeLength = beforeLines.join('\n').length;
  const afterLength = afterLines.join('\n').length;
  const beforeShare = Math.min(beforeLength, Math.floor(rest / 2));
  const afterShare = Math.min(afterLength, rest - beforeShare);
  const beforeRoom = Math.min(beforeLength, rest - afterShare);

  const beforeFit = beforeLines.length === 0 ? { text: NO_LINE, cut: false } : fitLines(beforeLines, beforeRoom, 'end');
  const afterFit = afterLines.length === 0 ? { text: NO_LINE, cut: false } : fitLines(afterLines, afterShare, 'start');

  const cut = { entry: entryCut, before: beforeFit.cut, after: afterFit.cut };
  const anyCut = cut.entry || cut.before || cut.after;
  return {
    text: layout(header, entryText, beforeFit.text, afterFit.text),
    note: anyCut ? `Note : le contenu a été tronqué à ${maxChars} caractères.` : null,
    maskedCount,
    cut,
  };
}
