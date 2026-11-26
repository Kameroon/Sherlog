import { checkAnalysis } from '../ai/analysis';
import type { Analysis } from '../ai/analysis';

/**
 * What the history keeps of an error that was analysed or decided on (ADR-022): never the text of the log, the
 * fingerprint in clear, a chat or the key of the model. « New » is not kept: an error nobody did anything about has nothing to remember.
 */
export type HistoryStatus = 'analysed' | 'ignored' | 'resolved';

export const HISTORY_STATUSES: readonly HistoryStatus[] = ['analysed', 'ignored', 'resolved'];

/** The analysis of the model as it was shown, with when it was made and by which model (for example « claude-haiku-5-5 (Anthropic) »). */
export interface HistoryAnalysis {
  readonly analysis: Analysis;
  readonly at: string;
  readonly by: string;
}

export interface HistoryRecord {
  /** SHA-256 of the fingerprint, in lowercase hexadecimal: the fingerprint itself is a message of the log and is not kept. */
  readonly key: string;
  readonly status: HistoryStatus;
  /** UTC date as `Date.prototype.toISOString` writes it. */
  readonly updatedAt: string;
  readonly analysis: HistoryAnalysis | null;
}

/**
 * Most records kept for one identity. Provisional (ADR-022, « Seuils »): an analysis of a few kilobytes makes a few
 * megabytes of this; the size of an imported file is bounded apart, by its own measurement. A full history refuses a
 * new record and says so, it never drops one.
 */
export const MAX_HISTORY_ENTRIES = 2_000;

/** Longest name of a model kept with an analysis. */
const MAX_MODEL_NAME_CHARS = 200;

/** A date may be this far ahead of now: more is a clock or a file that would win every merge. */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

const KEY_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type ParsedHistoryRecord = { readonly ok: true; readonly record: HistoryRecord } | { readonly ok: false; readonly reason: string };

/** The result of a change of the list: the new list, or why it was not made (the list given is left as it was). */
export type HistoryUpdate = { readonly ok: true; readonly records: readonly HistoryRecord[] } | { readonly ok: false; readonly reason: string };

/** Why a value is not a record; carries the sentence that says it. */
class NotARecord extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A date as `toISOString` writes it: a string that another way of writing the same moment, or a day that does not exist, does not pass. */
function dateField(value: unknown, field: string, now: Date): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new NotARecord(`la date ${field} n’est pas une date UTC au format ISO avec millisecondes`);
  }
  if (Date.parse(value) > now.getTime() + MAX_FUTURE_MS) {
    throw new NotARecord(`la date ${field} est dans le futur`);
  }
  return value;
}

function analysisOf(value: unknown, now: Date): HistoryAnalysis | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new NotARecord('l’analyse n’est ni un objet ni vide');
  }
  const checked = checkAnalysis(value['analysis']);
  if (!checked.ok) {
    throw new NotARecord(`l’analyse est refusée : ${checked.reason}`);
  }
  const { by } = value;
  if (typeof by !== 'string' || by.trim() === '' || by.length > MAX_MODEL_NAME_CHARS) {
    throw new NotARecord(`le nom du modèle n’est pas un texte de 1 à ${MAX_MODEL_NAME_CHARS} caractères`);
  }
  return { analysis: checked.analysis, at: dateField(value['at'], 'de l’analyse', now), by };
}

/**
 * Checks that a value read from the store or from an imported file is a record (ADR-022, H1 and H4), and builds it
 * field by field: what the schema does not name is dropped, so that nothing else can be stored or shown. Nothing is
 * guessed, a value that does not fit is refused with its reason.
 *
 * @param now - The moment the check is made at, given so that the check stays pure.
 */
export function parseHistoryRecord(value: unknown, now: Date): ParsedHistoryRecord {
  try {
    if (!isRecord(value)) {
      throw new NotARecord('l’enregistrement n’est pas un objet');
    }
    const { key, status } = value;
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new NotARecord('la clé n’est pas une empreinte SHA-256 en hexadécimal minuscule (64 caractères)');
    }
    const knownStatus = HISTORY_STATUSES.find((candidate) => candidate === status);
    if (knownStatus === undefined) {
      throw new NotARecord(`le statut est absent ou hors des valeurs admises (${HISTORY_STATUSES.join(', ')})`);
    }
    const updatedAt = dateField(value['updatedAt'], 'de mise à jour', now);
    const analysis = analysisOf(value['analysis'], now);
    if (knownStatus === 'analysed' && analysis === null) {
      throw new NotARecord('un enregistrement analysé n’a pas d’analyse');
    }
    return { ok: true, record: { key, status: knownStatus, updatedAt, analysis } };
  } catch (error) {
    if (error instanceof NotARecord) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

const full = (max: number): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason: `L’historique est plein (${max} enregistrements au plus) : supprimez des enregistrements ou effacez l’historique.`,
});

/**
 * Writes one record: it replaces the record under its key, whatever their dates (it is what the user just did), or is
 * added. A new key is refused when the history is full.
 */
export function upsertRecord(records: readonly HistoryRecord[], incoming: HistoryRecord, max: number = MAX_HISTORY_ENTRIES): HistoryUpdate {
  const index = records.findIndex((existing) => existing.key === incoming.key);
  if (index === -1) {
    return records.length >= max ? full(max) : { ok: true, records: [...records, incoming] };
  }
  return { ok: true, records: records.map((existing, position) => (position === index ? incoming : existing)) };
}

/**
 * Merges the records of an import into the history: under a key that both have, the later date wins and the existing
 * record stays when the dates are equal. Dates compare as text, which is right because a record's date has a fixed form
 * (`parseHistoryRecord`). The whole merge is refused when it would go over the limit, so that no record is dropped.
 */
export function mergeHistory(records: readonly HistoryRecord[], incoming: readonly HistoryRecord[], max: number = MAX_HISTORY_ENTRIES): HistoryUpdate {
  const merged = new Map(records.map((existing) => [existing.key, existing]));
  for (const candidate of incoming) {
    const existing = merged.get(candidate.key);
    if (existing === undefined || candidate.updatedAt > existing.updatedAt) {
      merged.set(candidate.key, candidate);
    }
  }
  return merged.size > max ? full(max) : { ok: true, records: [...merged.values()] };
}
