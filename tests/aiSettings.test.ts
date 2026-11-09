// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS, forgetApiKey, loadApiKey, loadSettings, saveApiKey, saveSettings } from '../src/store/aiSettings';
import type { BrowserStorages } from '../src/store/aiSettings';
import { MemoryStorage } from './helpers/memoryStorage';

const KEY = 'sk-ant-test-0123456789';
const SCOPE = 'github/1234';

let session: MemoryStorage;
let local: MemoryStorage;
let storages: BrowserStorages;

beforeEach(() => {
  session = new MemoryStorage();
  local = new MemoryStorage();
  storages = { session, local };
});

describe('settings', () => {
  it('should start with Anthropic and its lightest model when nothing was saved', () => {
    // Act
    const loaded = loadSettings(SCOPE, storages);

    // Assert
    expect(loaded).toEqual({ settings: DEFAULT_AI_SETTINGS, warning: null });
    expect(DEFAULT_AI_SETTINGS).toEqual({ provider: 'anthropic', anthropicModel: 'claude-haiku-5-5', ollamaModel: '' });
  });

  it('should give back what was saved', () => {
    // Arrange
    const settings = { provider: 'ollama' as const, anthropicModel: 'claude-sonnet-5-5', ollamaModel: 'llama3:8b' };

    // Act
    const warning = saveSettings(SCOPE, settings, storages);

    // Assert
    expect(warning).toBeNull();
    expect(loadSettings(SCOPE, storages)).toEqual({ settings, warning: null });
  });

  it('should keep the settings of each identity apart', () => {
    // Arrange
    saveSettings('github/1', { ...DEFAULT_AI_SETTINGS, provider: 'ollama' }, storages);

    // Act
    const other = loadSettings('github/2', storages);

    // Assert
    expect(other.settings).toEqual(DEFAULT_AI_SETTINGS);
  });

  it('should not put the settings in the storage that ends with the tab', () => {
    // Act
    saveSettings(SCOPE, { ...DEFAULT_AI_SETTINGS, provider: 'ollama' }, storages);

    // Assert
    expect(session.dump()).toEqual({});
  });

  it('should fall back to the default for a field that is not valid, and keep the others', () => {
    // Arrange
    local.setItem(`sherlog:${SCOPE}:ai-settings`, JSON.stringify({ provider: 'openai', anthropicModel: 'claude sonnet', ollamaModel: 'llama3:8b' }));

    // Act
    const { settings } = loadSettings(SCOPE, storages);

    // Assert
    expect(settings).toEqual({ ...DEFAULT_AI_SETTINGS, ollamaModel: 'llama3:8b' });
  });

  it('should warn and use the defaults when what was saved is not JSON', () => {
    // Arrange
    local.setItem(`sherlog:${SCOPE}:ai-settings`, '{not json');

    // Act
    const loaded = loadSettings(SCOPE, storages);

    // Assert
    expect(loaded.settings).toEqual(DEFAULT_AI_SETTINGS);
    expect(loaded.warning).toMatch(/réglages/);
  });

  it('should warn and use the defaults when the storage cannot be read', () => {
    // Arrange
    local.failing.add('getItem');

    // Act
    const loaded = loadSettings(SCOPE, storages);

    // Assert
    expect(loaded.settings).toEqual(DEFAULT_AI_SETTINGS);
    expect(loaded.warning).toMatch(/réglages/);
  });

  it('should say so when the settings cannot be saved', () => {
    // Arrange
    local.failing.add('setItem');

    // Act
    const warning = saveSettings(SCOPE, DEFAULT_AI_SETTINGS, storages);

    // Assert
    expect(warning).toMatch(/réglages/);
  });
});

describe('key kept for the tab', () => {
  it('should have no key at first', () => {
    // Act & Assert
    expect(loadApiKey(SCOPE, storages)).toEqual({ key: null, remembered: false, warning: null });
  });

  it('should keep the key in the storage that ends with the tab, and nowhere else', () => {
    // Act
    const warning = saveApiKey(SCOPE, KEY, false, storages);

    // Assert
    expect(warning).toBeNull();
    expect(Object.values(session.dump())).toEqual([KEY]);
    expect(local.dump()).toEqual({});
    expect(loadApiKey(SCOPE, storages)).toEqual({ key: KEY, remembered: false, warning: null });
  });

  it('should not keep the key of one identity for another', () => {
    // Arrange
    saveApiKey('github/1', KEY, false, storages);
    saveApiKey('github/1', KEY, true, storages);

    // Act
    const other = loadApiKey('github/2', storages);

    // Assert
    expect(other.key).toBeNull();
  });
});

describe('key remembered on the computer', () => {
  it('should keep the key in the lasting storage, and nowhere else', () => {
    // Act
    const warning = saveApiKey(SCOPE, KEY, true, storages);

    // Assert
    expect(warning).toBeNull();
    expect(Object.values(local.dump())).toEqual([KEY]);
    expect(session.dump()).toEqual({});
    expect(loadApiKey(SCOPE, storages)).toEqual({ key: KEY, remembered: true, warning: null });
  });

  it('should drop the lasting copy when the user goes back to keeping it for the tab only', () => {
    // Arrange
    saveApiKey(SCOPE, KEY, true, storages);

    // Act
    saveApiKey(SCOPE, KEY, false, storages);

    // Assert
    expect(local.dump()).toEqual({});
    expect(loadApiKey(SCOPE, storages).remembered).toBe(false);
  });

  it('should drop the copy for the tab when the user chooses to remember the key', () => {
    // Arrange
    saveApiKey(SCOPE, KEY, false, storages);

    // Act
    saveApiKey(SCOPE, KEY, true, storages);

    // Assert
    expect(session.dump()).toEqual({});
  });

  it('should replace the key and keep a single copy', () => {
    // Arrange
    saveApiKey(SCOPE, KEY, true, storages);

    // Act
    saveApiKey(SCOPE, 'sk-ant-other-key', true, storages);

    // Assert
    expect(Object.values(local.dump())).toEqual(['sk-ant-other-key']);
  });
});

describe('forgetting the key', () => {
  it('should remove the key from both storages', () => {
    // Arrange
    saveApiKey(SCOPE, KEY, true, storages);
    session.setItem(`sherlog:${SCOPE}:api-key`, KEY);

    // Act
    const warning = forgetApiKey(SCOPE, storages);

    // Assert
    expect(warning).toBeNull();
    expect(session.dump()).toEqual({});
    expect(local.dump()).toEqual({});
  });

  it('should not touch the key of another identity', () => {
    // Arrange
    saveApiKey('github/1', KEY, true, storages);
    saveApiKey('github/2', 'sk-ant-other-key', true, storages);

    // Act
    forgetApiKey('github/1', storages);

    // Assert
    expect(loadApiKey('github/2', storages).key).toBe('sk-ant-other-key');
  });
});

describe('a storage that refuses', () => {
  it.each([
    ['the tab storage when saving for the tab', false, 'session'],
    ['the lasting storage when remembering', true, 'local'],
  ] as const)('should say the key was not saved when it refuses %s', (_name, remember, which) => {
    // Arrange
    (which === 'session' ? session : local).failing.add('setItem');

    // Act
    const warning = saveApiKey(SCOPE, KEY, remember, storages);

    // Assert
    expect(warning).toMatch(/clé n’a pas été enregistrée/);
  });

  it('should say a copy may remain when the other storage cannot be emptied', () => {
    // Arrange
    saveApiKey(SCOPE, KEY, true, storages);
    local.failing.add('removeItem');

    // Act
    const warning = saveApiKey(SCOPE, KEY, false, storages);

    // Assert
    expect(warning).toMatch(/copie/);
  });

  it('should say a copy may remain when forgetting the key fails', () => {
    // Arrange
    saveApiKey(SCOPE, KEY, true, storages);
    local.failing.add('removeItem');

    // Act
    const warning = forgetApiKey(SCOPE, storages);

    // Assert
    expect(warning).toMatch(/copie/);
  });

  it('should warn and have no key when the storage cannot be read', () => {
    // Arrange
    session.failing.add('getItem');

    // Act
    const loaded = loadApiKey(SCOPE, storages);

    // Assert
    expect(loaded.key).toBeNull();
    expect(loaded.warning).toMatch(/clé/);
  });

  it('should not throw when the browser refuses even the access to its storages', () => {
    // Arrange
    const blocked: BrowserStorages = {
      get session(): Storage {
        throw new DOMException('Access is denied.', 'SecurityError');
      },
      get local(): Storage {
        throw new DOMException('Access is denied.', 'SecurityError');
      },
    };

    // Act & Assert
    expect(loadApiKey(SCOPE, blocked).warning).toMatch(/clé/);
    expect(saveApiKey(SCOPE, KEY, false, blocked)).toMatch(/clé n’a pas été enregistrée/);
    expect(forgetApiKey(SCOPE, blocked)).toMatch(/copie/);
    expect(loadSettings(SCOPE, blocked).warning).toMatch(/réglages/);
    expect(saveSettings(SCOPE, DEFAULT_AI_SETTINGS, blocked)).toMatch(/réglages/);
  });

  it('should never put the key in a message', () => {
    // Arrange
    local.failing.add('setItem');

    // Act
    const warning = saveApiKey(SCOPE, KEY, true, storages);

    // Assert
    expect(warning).not.toContain(KEY);
  });
});
