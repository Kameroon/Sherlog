import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CONNECTION_TEST_MESSAGE } from '../src/ai/anthropic';
import type { ProviderChoice } from '../src/ai/createProvider';
import type { StorageScope } from '../src/auth/storageScope';
import { DEFAULT_AI_SETTINGS, loadApiKey, loadSettings, saveApiKey, saveSettings } from '../src/store/aiSettings';
import type { AiSettings, BrowserStorages } from '../src/store/aiSettings';
import { ProviderSettings } from '../src/ui/ProviderSettings';
import { anthropicEvent, eventStream, fakeFetch, jsonAnswer, textDelta } from './helpers/fakeFetch';
import type { RecordedRequest } from './helpers/fakeFetch';
import { MemoryStorage } from './helpers/memoryStorage';

const KEY = 'sk-ant-test-0123456789';
const SITE = 'https://sherlog.test';
const scope: StorageScope = { name: 'github/1', identified: true };
const goodAnthropic = () => eventStream([textDelta('OK'), anthropicEvent('message_stop', {})]);

interface Options {
  scope?: StorageScope | null;
  answer?: (request: RecordedRequest) => Response | Error | Promise<Response | Error>;
  key?: { value: string; remembered: boolean };
  settings?: AiSettings;
  onChoiceChange?: (choice: ProviderChoice | null) => void;
}

function show(options: Options = {}) {
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  const storages: BrowserStorages = { session, local };
  const chosenScope = options.scope === undefined ? scope : options.scope;
  if (options.key !== undefined && chosenScope !== null) {
    saveApiKey(chosenScope.name, options.key.value, options.key.remembered, storages);
  }
  if (options.settings !== undefined && chosenScope !== null) {
    saveSettings(chosenScope.name, options.settings, storages);
  }
  const { fetchImpl, requests } = fakeFetch(options.answer ?? goodAnthropic);
  const view = render(<ProviderSettings scope={chosenScope} storages={storages} fetchImpl={fetchImpl} siteOrigin={SITE} onChoiceChange={options.onChoiceChange} />);
  return { session, local, storages, requests, ...view };
}

const keyField = () => screen.getByLabelText<HTMLInputElement>('Clé API Anthropic');
const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const typeKey = (value = KEY): void => {
  type('Clé API Anthropic', value);
};
const click = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name }));
};
const chooseProvider = (name: RegExp): void => {
  fireEvent.click(screen.getByRole('radio', { name }));
};

describe('ProviderSettings display', () => {
  it('should wait for the identity before offering anything, since what is kept belongs to it', () => {
    // Act
    show({ scope: null });

    // Assert
    expect(screen.getByText(/identité/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Clé API Anthropic')).not.toBeInTheDocument();
  });

  it('should start with Anthropic and its lightest model, and say where the extracts would go', () => {
    // Act
    show();

    // Assert
    expect(screen.getByRole('radio', { name: /Anthropic/ })).toBeChecked();
    expect(screen.getByLabelText('Modèle Claude')).toHaveValue('claude-haiku-5-5');
    expect(screen.getByText(/partiront vers Anthropic \(api\.anthropic\.com\)/)).toBeInTheDocument();
  });

  it('should ask for the key in a field that does not show it and is not filled in by the browser', () => {
    // Act
    show();

    // Assert
    expect(keyField()).toHaveAttribute('type', 'password');
    expect(keyField()).toHaveAttribute('autocomplete', 'off');
    expect(keyField()).toHaveAttribute('spellcheck', 'false');
  });

  it('should advise a key made for this use, with a spending limit', () => {
    // Act
    show();

    // Assert
    expect(screen.getByText(/clé dédiée à Sherlog/)).toBeInTheDocument();
    expect(screen.getByText(/plafond de dépense/)).toBeInTheDocument();
  });

  it('should not offer to test the connection before there is a key', () => {
    // Act
    show();

    // Assert
    expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeDisabled();
  });
});

describe('ProviderSettings key', () => {
  it('should keep the key for the tab by default and say so', () => {
    // Arrange
    const { session, local } = show();
    typeKey();

    // Act
    click('Enregistrer la clé');

    // Assert
    expect(screen.getByText(/Clé enregistrée pour cet onglet/)).toBeInTheDocument();
    expect(Object.values(session.dump())).toContain(KEY);
    expect(local.dump()).toEqual({});
  });

  it('should warn before remembering the key on the computer, then keep it there', () => {
    // Arrange
    const { session, local } = show();
    typeKey();

    // Act
    fireEvent.click(screen.getByLabelText('Me souvenir de ma clé sur cet ordinateur'));
    click('Enregistrer la clé');

    // Assert
    expect(screen.getByText(/lisible par tout script de cette page/)).toBeInTheDocument();
    expect(screen.getByText(/Clé enregistrée sur cet ordinateur/)).toBeInTheDocument();
    expect(Object.values(local.dump())).toContain(KEY);
    expect(session.dump()).toEqual({});
  });

  it('should not offer to remember the key when the user cannot be told from another', () => {
    // Act
    show({ scope: { name: 'sans-identite', identified: false } });

    // Assert
    expect(screen.getByLabelText('Me souvenir de ma clé sur cet ordinateur')).toBeDisabled();
    expect(screen.getByText(/identité n’a pas pu être lue/)).toBeInTheDocument();
  });

  it('should never show the key again once it is saved', () => {
    // Arrange
    show();
    typeKey();

    // Act
    click('Enregistrer la clé');

    // Assert
    expect(keyField()).toHaveValue('');
    expect(screen.getByText(/Une clé est enregistrée/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(KEY);
  });

  it('should find the key that was saved before, without showing it', () => {
    // Act
    show({ key: { value: KEY, remembered: true } });

    // Assert
    expect(screen.getByText(/Une clé est enregistrée sur cet ordinateur/)).toBeInTheDocument();
    expect(screen.getByLabelText('Me souvenir de ma clé sur cet ordinateur')).toBeChecked();
    expect(keyField()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeEnabled();
  });

  it('should not give the key of one identity to another that signs in on the same page', () => {
    // Arrange
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const storages: BrowserStorages = { session, local };
    saveApiKey('github/1', KEY, true, storages);
    const { fetchImpl } = fakeFetch(goodAnthropic);
    const view = render(<ProviderSettings scope={{ name: 'github/1', identified: true }} storages={storages} fetchImpl={fetchImpl} siteOrigin={SITE} />);
    expect(screen.getByText(/Une clé est enregistrée/)).toBeInTheDocument();

    // Act
    view.rerender(<ProviderSettings scope={{ name: 'github/2', identified: true }} storages={storages} fetchImpl={fetchImpl} siteOrigin={SITE} />);

    // Assert
    expect(screen.queryByText(/Une clé est enregistrée/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeDisabled();
  });

  it('should forget the key everywhere', () => {
    // Arrange
    const { storages } = show({ key: { value: KEY, remembered: true } });

    // Act
    click('Oublier la clé');

    // Assert
    expect(loadApiKey(scope.name, storages).key).toBeNull();
    expect(screen.getByText(/Clé oubliée/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeDisabled();
  });

  it('should move a saved key to the other place when the user changes where to keep it', () => {
    // Arrange
    const { storages } = show({ key: { value: KEY, remembered: false } });

    // Act
    fireEvent.click(screen.getByLabelText('Me souvenir de ma clé sur cet ordinateur'));
    click('Enregistrer la clé');

    // Assert
    expect(loadApiKey(scope.name, storages)).toMatchObject({ key: KEY, remembered: true });
  });

  it.each([
    ['a space', 'sk ant'],
    ['an accent', 'clé'],
  ])('should refuse a key with %s before anything is saved or sent', (_name, value) => {
    // Arrange
    const { session, requests } = show();

    // Act
    typeKey(value);

    // Assert
    expect(screen.getByText(/caractères que le navigateur ne peut pas envoyer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer la clé' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeDisabled();
    expect(session.dump()).toEqual({});
    expect(requests).toHaveLength(0);
  });

  it('should say so when the browser refuses to keep the key', () => {
    // Arrange
    const { local } = show();
    local.failing.add('setItem');
    typeKey();

    // Act
    fireEvent.click(screen.getByLabelText('Me souvenir de ma clé sur cet ordinateur'));
    click('Enregistrer la clé');

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent(/clé n’a pas été enregistrée/);
    expect(document.body.textContent).not.toContain(KEY);
  });
});

describe('ProviderSettings model', () => {
  it('should keep the model the user types for the next visit', () => {
    // Arrange
    const { storages } = show();

    // Act
    type('Modèle Claude', 'claude-sonnet-5-5');

    // Assert
    expect(loadSettings(scope.name, storages).settings).toEqual({ ...DEFAULT_AI_SETTINGS, anthropicModel: 'claude-sonnet-5-5' });
  });

  it('should say so when the browser refuses to keep the settings', () => {
    // Arrange
    const { local } = show();
    local.failing.add('setItem');

    // Act
    type('Modèle Claude', 'claude-sonnet-5-5');

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent(/réglages n’ont pas été enregistrés/);
  });

  it('should say so when the settings saved before cannot be read', () => {
    // Arrange
    const storages: BrowserStorages = { session: new MemoryStorage(), local: new MemoryStorage() };
    (storages.local as MemoryStorage).failing.add('getItem');
    const { fetchImpl } = fakeFetch(goodAnthropic);

    // Act
    render(<ProviderSettings scope={scope} storages={storages} fetchImpl={fetchImpl} siteOrigin={SITE} />);

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent(/réglages enregistrés n’ont pas pu être lus/);
  });

  it('should find the settings saved before', () => {
    // Act
    show({ settings: { provider: 'anthropic', anthropicModel: 'claude-opus-5-5', ollamaModel: '' } });

    // Assert
    expect(screen.getByLabelText('Modèle Claude')).toHaveValue('claude-opus-5-5');
  });

  it('should refuse a model name that cannot be one, and not test the connection with it', () => {
    // Arrange
    const { storages } = show({ key: { value: KEY, remembered: false } });

    // Act
    type('Modèle Claude', 'claude sonnet');

    // Assert
    expect(screen.getByText(/lettres, chiffres/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeDisabled();
    expect(loadSettings(scope.name, storages).settings.anthropicModel).toBe('claude-haiku-5-5');
  });

  it('should explain that any Claude model can be typed', () => {
    // Act
    show();

    // Assert
    expect(screen.getByText(/identifiant d’un modèle Claude/i)).toBeInTheDocument();
  });
});

describe('ProviderSettings Anthropic connection test', () => {
  it('should send one fixed sentence with the typed key and say the connection works', async () => {
    // Arrange
    const { requests } = show();
    typeKey();

    // Act
    click('Tester la connexion');

    // Assert
    expect(await screen.findByText(/Connexion réussie/)).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(requests[0]?.init.headers).toMatchObject({ 'x-api-key': KEY });
    expect(requests[0]?.body).toMatchObject({ model: 'claude-haiku-5-5', messages: [{ role: 'user', content: CONNECTION_TEST_MESSAGE }] });
  });

  it('should use the saved key when none is typed', async () => {
    // Arrange
    const { requests } = show({ key: { value: KEY, remembered: false } });

    // Act
    click('Tester la connexion');

    // Assert
    await screen.findByText(/Connexion réussie/);
    expect(requests[0]?.init.headers).toMatchObject({ 'x-api-key': KEY });
  });

  it('should prefer the key that is typed to the one that is saved', async () => {
    // Arrange
    const { requests } = show({ key: { value: KEY, remembered: false } });
    typeKey('sk-ant-typed-later');

    // Act
    click('Tester la connexion');

    // Assert
    await screen.findByText(/Connexion réussie/);
    expect(requests[0]?.init.headers).toMatchObject({ 'x-api-key': 'sk-ant-typed-later' });
  });

  it('should say the key is refused, without showing it', async () => {
    // Arrange
    show({ answer: () => jsonAnswer({ error: { message: `invalid x-api-key ${KEY}` } }, 401) });
    typeKey();

    // Act
    click('Tester la connexion');

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/clé est refusée par Anthropic/);
    expect(document.body.textContent).not.toContain(KEY);
  });

  it('should show that it is waiting and not allow a second test meanwhile', async () => {
    // Arrange
    let release: (answer: Response) => void = () => undefined;
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    show({ answer: () => waiting });
    typeKey();

    // Act
    click('Tester la connexion');

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent(/Test en cours/);
    expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeDisabled();
    release(goodAnthropic());
    expect(await screen.findByText(/Connexion réussie/)).toBeInTheDocument();
  });

  it('should drop a result that no longer matches what is typed', async () => {
    // Arrange
    show();
    typeKey();
    click('Tester la connexion');
    await screen.findByText(/Connexion réussie/);

    // Act
    type('Modèle Claude', 'claude-sonnet-5-5');

    // Assert
    expect(screen.queryByText(/Connexion réussie/)).not.toBeInTheDocument();
  });

  it('should say nothing of a test that came back after the settings changed', async () => {
    // Arrange
    let release: (answer: Response) => void = () => undefined;
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    show({ answer: () => waiting });
    typeKey();
    click('Tester la connexion');

    // Act
    type('Modèle Claude', 'claude-sonnet-5-5');
    release(goodAnthropic());
    await waitFor(() => {
      expect(screen.queryByText(/Test en cours/)).not.toBeInTheDocument();
    });

    // Assert
    expect(screen.queryByText(/Connexion réussie/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeEnabled();
  });

  it('should cancel the request when the panel goes away', async () => {
    // Arrange
    const { requests, unmount } = show({ answer: () => new Promise<Response>(() => undefined) });
    typeKey();
    click('Tester la connexion');
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });

    // Act
    unmount();

    // Assert
    expect(requests[0]?.init.signal?.aborted).toBe(true);
  });
});

describe('ProviderSettings Ollama', () => {
  const tags = (...names: string[]) => () => jsonAnswer({ models: names.map((name) => ({ name })) });

  it('should say the extracts stay on this computer, and what Ollama has to accept', () => {
    // Arrange
    show();

    // Act
    chooseProvider(/Ollama/);

    // Assert
    expect(screen.getByText(/restent sur cet ordinateur/)).toBeInTheDocument();
    expect(screen.getByText(/OLLAMA_ORIGINS/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(SITE))).toBeInTheDocument();
    expect(screen.queryByLabelText('Clé API Anthropic')).not.toBeInTheDocument();
  });

  it('should keep the provider chosen for the next visit', () => {
    // Arrange
    const { storages } = show();

    // Act
    chooseProvider(/Ollama/);

    // Assert
    expect(loadSettings(scope.name, storages).settings.provider).toBe('ollama');
  });

  it('should test the connection without a key, and offer the models installed', async () => {
    // Arrange
    const { requests } = show({ answer: tags('mistral:latest', 'llama3:8b') });
    chooseProvider(/Ollama/);

    // Act
    click('Tester la connexion');

    // Assert
    expect(await screen.findByText(/2 modèles installés/)).toBeInTheDocument();
    expect(requests[0]?.url).toBe('http://localhost:11434/api/tags');
    const options = screen.getAllByRole<HTMLOptionElement>('option').map((option) => option.textContent);
    expect(options).toEqual(['Choisir un modèle', 'llama3:8b', 'mistral:latest']);
  });

  it('should keep the model the user picks from the list', async () => {
    // Arrange
    const { storages } = show({ answer: tags('llama3:8b') });
    chooseProvider(/Ollama/);
    click('Tester la connexion');
    await screen.findByText(/1 modèle installé/);

    // Act
    fireEvent.change(screen.getByLabelText('Modèle installé'), { target: { value: 'llama3:8b' } });

    // Assert
    expect(loadSettings(scope.name, storages).settings).toMatchObject({ provider: 'ollama', ollamaModel: 'llama3:8b' });
  });

  it('should not keep the models of a test that was given up when the user changed provider', async () => {
    // Arrange
    let release: (answer: Response) => void = () => undefined;
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    show({ answer: () => waiting });
    chooseProvider(/Ollama/);
    click('Tester la connexion');

    // Act
    chooseProvider(/Anthropic/);
    chooseProvider(/Ollama/);
    release(jsonAnswer({ models: [{ name: 'llama3:8b' }] }));
    await waitFor(() => {
      expect(screen.queryByText(/Test en cours/)).not.toBeInTheDocument();
    });

    // Assert
    expect(screen.queryByLabelText('Modèle installé')).not.toBeInTheDocument();
    expect(screen.getByText(/pour lire les modèles installés/)).toBeInTheDocument();
  });

  it('should say when the model chosen before is no longer installed', async () => {
    // Arrange
    show({ answer: tags('mistral:latest'), settings: { ...DEFAULT_AI_SETTINGS, provider: 'ollama', ollamaModel: 'llama3:8b' } });

    // Act
    click('Tester la connexion');

    // Assert
    expect(await screen.findByText(/llama3:8b n’est pas installé/)).toBeInTheDocument();
  });

  it('should say when Ollama runs with no model', async () => {
    // Arrange
    show({ answer: tags() });
    chooseProvider(/Ollama/);

    // Act
    click('Tester la connexion');

    // Assert
    expect(await screen.findByText(/aucun modèle n’est installé/)).toBeInTheDocument();
  });

  it('should tell what to set up when Ollama cannot be reached', async () => {
    // Arrange
    show({ answer: () => new TypeError('Failed to fetch') });
    chooseProvider(/Ollama/);

    // Act
    click('Tester la connexion');

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(/Ollama ne répond pas/);
    expect(screen.getByRole('alert')).toHaveTextContent(SITE);
  });
});

describe('ProviderSettings choice given to the sending', () => {
  const choices = () => {
    const given: (ProviderChoice | null)[] = [];
    return { given, onChoiceChange: (choice: ProviderChoice | null) => given.push(choice), last: () => given.at(-1) };
  };

  it('should give no choice until a usable key is there', () => {
    // Arrange
    const { onChoiceChange, last } = choices();

    // Act
    show({ onChoiceChange });

    // Assert
    expect(last()).toBeNull();
  });

  it('should give the key and the model once the key is typed, without saving it', () => {
    // Arrange
    const { onChoiceChange, last } = choices();
    const { session, local } = show({ onChoiceChange });

    // Act
    typeKey();

    // Assert
    expect(last()).toEqual({ provider: 'anthropic', apiKey: KEY, model: 'claude-haiku-5-5' });
    expect(session.dump()).toEqual({});
    expect(local.dump()).toEqual({});
  });

  it('should give the key that was saved before', () => {
    // Arrange
    const { onChoiceChange, last } = choices();

    // Act
    show({ onChoiceChange, key: { value: KEY, remembered: false } });

    // Assert
    expect(last()).toMatchObject({ provider: 'anthropic', apiKey: KEY });
  });

  it.each([
    ['a key that cannot be sent', () => typeKey('sk ant')],
    ['a model name that cannot be one', () => type('Modèle Claude', 'claude sonnet')],
  ])('should give no choice with %s', (_name, act) => {
    // Arrange
    const { onChoiceChange, last } = choices();
    show({ onChoiceChange, key: { value: KEY, remembered: false } });

    // Act
    act();

    // Assert
    expect(last()).toBeNull();
  });

  it('should give the model chosen for Ollama, and no key', () => {
    // Arrange
    const { onChoiceChange, last } = choices();

    // Act
    show({ onChoiceChange, settings: { ...DEFAULT_AI_SETTINGS, provider: 'ollama', ollamaModel: 'llama3:8b' }, key: { value: KEY, remembered: false } });

    // Assert
    expect(last()).toEqual({ provider: 'ollama', apiKey: '', model: 'llama3:8b' });
  });

  it('should give no choice for Ollama until a model is chosen', () => {
    // Arrange
    const { onChoiceChange, last } = choices();

    // Act
    show({ onChoiceChange, settings: { ...DEFAULT_AI_SETTINGS, provider: 'ollama' } });

    // Assert
    expect(last()).toBeNull();
  });

  it('should give no choice any more once the key is forgotten', () => {
    // Arrange
    const { onChoiceChange, last } = choices();
    show({ onChoiceChange, key: { value: KEY, remembered: false } });

    // Act
    click('Oublier la clé');

    // Assert
    expect(last()).toBeNull();
  });

  it('should give no choice any more when the panel goes away, so that nothing is sent with a key that is no longer on screen', () => {
    // Arrange
    const { onChoiceChange, last } = choices();
    const { unmount } = show({ onChoiceChange, key: { value: KEY, remembered: false } });

    // Act
    unmount();

    // Assert
    expect(last()).toBeNull();
  });
});
