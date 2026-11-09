import { DEFAULT_ANTHROPIC_MODEL } from '../ai/anthropic';
import { isValidModelName } from '../ai/provider';
import type { ProviderId } from '../ai/provider';

/** What the user chose about the provider: not secret, kept on this computer for the next visit. */
export interface AiSettings {
  readonly provider: ProviderId;
  readonly anthropicModel: string;
  /** Empty until the user picks one of the models Ollama says are installed. */
  readonly ollamaModel: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = { provider: 'anthropic', anthropicModel: DEFAULT_ANTHROPIC_MODEL, ollamaModel: '' };

/** The two places the browser keeps data: until the tab is closed, and until the user clears it. */
export interface BrowserStorages {
  readonly session: Storage;
  readonly local: Storage;
}

export interface LoadedSettings {
  readonly settings: AiSettings;
  /** Why what was saved could not be used, when it could not. */
  readonly warning: string | null;
}

export interface LoadedKey {
  readonly key: string | null;
  /** `true` when the key is kept on the computer after the browser is closed. */
  readonly remembered: boolean;
  readonly warning: string | null;
}

// The scope is the identity of the signed-in user: on a computer that several invited people use, nothing of one
// (above all not a key) is read by another (SPEC §2). It is part of every name written to a storage.
const keyName = (scope: string): string => `sherlog:${scope}:api-key`;
const settingsName = (scope: string): string => `sherlog:${scope}:ai-settings`;

const KEY_UNREADABLE = 'La clé enregistrée n’a pas pu être lue : le navigateur refuse l’accès à son stockage.';
const KEY_NOT_SAVED = 'La clé n’a pas été enregistrée : le navigateur refuse d’écrire dans son stockage (navigation privée ou stockage bloqué).';
const KEY_COPY_REMAINS = 'Une copie de la clé peut rester dans le stockage du navigateur : elle n’a pas pu être effacée.';
const SETTINGS_UNREADABLE = 'Les réglages enregistrés n’ont pas pu être lus : les réglages par défaut sont utilisés.';
const SETTINGS_NOT_SAVED = 'Les réglages n’ont pas été enregistrés : le navigateur refuse d’écrire dans son stockage.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reads the key: the copy kept for the tab first, then the one remembered on the computer. */
export function loadApiKey(scope: string, storages: BrowserStorages): LoadedKey {
  try {
    const forTheTab = storages.session.getItem(keyName(scope));
    if (forTheTab !== null) {
      return { key: forTheTab, remembered: false, warning: null };
    }
    const remembered = storages.local.getItem(keyName(scope));
    return { key: remembered, remembered: remembered !== null, warning: null };
  } catch {
    return { key: null, remembered: false, warning: KEY_UNREADABLE };
  }
}

/**
 * Keeps the key where the user chose: for the tab (the default, it goes when the tab is closed) or on the computer.
 * One copy only: the other place is emptied, so that going back to "this tab only" does not leave the key behind.
 *
 * @returns why it did not work, or `null`.
 */
export function saveApiKey(scope: string, key: string, remember: boolean, storages: BrowserStorages): string | null {
  const [target, other] = remember ? [storages.local, storages.session] : [storages.session, storages.local];
  try {
    target.setItem(keyName(scope), key);
  } catch {
    return KEY_NOT_SAVED;
  }
  try {
    other.removeItem(keyName(scope));
  } catch {
    return KEY_COPY_REMAINS;
  }
  return null;
}

/**
 * Removes the key from both places.
 *
 * @returns why a copy may remain, or `null`.
 */
export function forgetApiKey(scope: string, storages: BrowserStorages): string | null {
  let remains = false;
  for (const storage of [storages.session, storages.local]) {
    try {
      storage.removeItem(keyName(scope));
    } catch {
      remains = true;
    }
  }
  return remains ? KEY_COPY_REMAINS : null;
}

/** Each field is taken as it was saved if it is valid, otherwise it goes back to its default: a bad one does not spoil the others. */
function settingsFrom(saved: unknown): AiSettings {
  if (!isRecord(saved)) {
    return DEFAULT_AI_SETTINGS;
  }
  const { provider, anthropicModel, ollamaModel } = saved;
  return {
    provider: provider === 'anthropic' || provider === 'ollama' ? provider : DEFAULT_AI_SETTINGS.provider,
    anthropicModel: typeof anthropicModel === 'string' && isValidModelName(anthropicModel) ? anthropicModel : DEFAULT_AI_SETTINGS.anthropicModel,
    ollamaModel: typeof ollamaModel === 'string' && (ollamaModel === '' || isValidModelName(ollamaModel)) ? ollamaModel : DEFAULT_AI_SETTINGS.ollamaModel,
  };
}

export function loadSettings(scope: string, storages: BrowserStorages): LoadedSettings {
  let saved: string | null;
  try {
    saved = storages.local.getItem(settingsName(scope));
  } catch {
    return { settings: DEFAULT_AI_SETTINGS, warning: SETTINGS_UNREADABLE };
  }
  if (saved === null) {
    return { settings: DEFAULT_AI_SETTINGS, warning: null };
  }
  try {
    return { settings: settingsFrom(JSON.parse(saved)), warning: null };
  } catch {
    return { settings: DEFAULT_AI_SETTINGS, warning: SETTINGS_UNREADABLE };
  }
}

/** @returns why the settings were not saved, or `null`. */
export function saveSettings(scope: string, settings: AiSettings, storages: BrowserStorages): string | null {
  try {
    storages.local.setItem(settingsName(scope), JSON.stringify(settings));
  } catch {
    return SETTINGS_NOT_SAVED;
  }
  return null;
}
