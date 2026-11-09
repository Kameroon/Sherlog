import { useEffect, useId, useState } from 'react';
import { isPlausibleApiKey, testAnthropicConnection } from '../ai/anthropic';
import { failureMessage } from '../ai/failureMessage';
import { listOllamaModels } from '../ai/ollama';
import { isValidModelName } from '../ai/provider';
import type { ProviderId } from '../ai/provider';
import type { StorageScope } from '../auth/storageScope';
import { browserStorages, forgetApiKey, loadApiKey, loadSettings, saveApiKey, saveSettings } from '../store/aiSettings';
import type { AiSettings, BrowserStorages } from '../store/aiSettings';
import { countOf } from './format';

/** What the panel reaches for outside the page; replaced by the tests. */
export interface AiDependencies {
  readonly storages: BrowserStorages;
  readonly fetchImpl: typeof fetch;
  /** The address of this site, which Ollama has to be told to accept. */
  readonly siteOrigin: string;
}

interface ProviderSettingsProps extends Partial<AiDependencies> {
  /** Whose key and settings these are; `null` while the identity is being read. */
  scope: StorageScope | null;
}

/** The outcome of the last connection test, or the fact that one is under way. */
type TestState = { readonly status: 'idle' } | { readonly status: 'running' } | { readonly status: 'ok'; readonly message: string } | { readonly status: 'failed'; readonly message: string };

/** What a click on "Tester la connexion" asks for, as it was when the user clicked: later edits do not change a test under way. */
interface TestRequest {
  readonly provider: ProviderId;
  readonly apiKey: string;
  readonly model: string;
}

const NOT_TESTED: TestState = { status: 'idle' };

const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = {
  anthropic: 'Anthropic (clé personnelle)',
  ollama: 'Ollama (modèle sur cet ordinateur)',
};

interface FormProps {
  scope: StorageScope;
  storages: BrowserStorages;
  fetchImpl: typeof fetch;
  siteOrigin: string;
}

function ProviderForm({ scope, storages, fetchImpl, siteOrigin }: FormProps) {
  const id = useId();
  // Read once when the form appears: the form is created again when the identity changes (see `ProviderSettings`).
  const [initial] = useState(() => ({ settings: loadSettings(scope.name, storages), key: loadApiKey(scope.name, storages) }));
  const [settings, setSettings] = useState<AiSettings>(initial.settings.settings);
  const [savedKey, setSavedKey] = useState<string | null>(initial.key.key);
  const [savedOnComputer, setSavedOnComputer] = useState(initial.key.remembered);
  const [typedKey, setTypedKey] = useState('');
  const [remember, setRemember] = useState(initial.key.remembered && scope.identified);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(initial.settings.warning ?? initial.key.warning);
  const [request, setRequest] = useState<TestRequest | null>(null);
  const [test, setTest] = useState<TestState>(NOT_TESTED);
  const [ollamaModels, setOllamaModels] = useState<readonly string[] | null>(null);

  // Runs the test the user asked for, and gives it up when another is asked for, the settings change, or the panel goes away.
  useEffect(() => {
    if (request === null) {
      return undefined;
    }
    const controller = new AbortController();
    const run = async (): Promise<TestState> => {
      if (request.provider === 'anthropic') {
        const result = await testAnthropicConnection({ apiKey: request.apiKey, model: request.model, fetchImpl }, controller.signal);
        return result.ok
          ? { status: 'ok', message: `Connexion réussie : le modèle ${request.model} a répondu.` }
          : { status: 'failed', message: failureMessage(result.failure, { provider: 'anthropic', siteOrigin }) };
      }
      const result = await listOllamaModels({ fetchImpl }, controller.signal);
      if (!result.ok) {
        setOllamaModels(null);
        return { status: 'failed', message: failureMessage(result.failure, { provider: 'ollama', siteOrigin }) };
      }
      setOllamaModels(result.models);
      return {
        status: 'ok',
        message: result.models.length === 0 ? 'Ollama répond, mais aucun modèle n’est installé.' : `Ollama répond : ${countOf(result.models.length, 'modèle installé', 'modèles installés')}.`,
      };
    };
    void run().then((outcome) => {
      // A test that was given up has nothing to say: the screen has moved on.
      if (!controller.signal.aborted) {
        setTest(outcome);
      }
    });
    return () => {
      controller.abort();
    };
  }, [request, fetchImpl, siteOrigin]);

  const dropTest = (): void => {
    setRequest(null);
    setTest(NOT_TESTED);
  };

  const changeSettings = (next: AiSettings): void => {
    setSettings(next);
    setProblem(saveSettings(scope.name, next, storages));
    dropTest();
  };

  const typed = typedKey.trim();
  const typedIsUsable = typed !== '' && isPlausibleApiKey(typed);
  const typedIsRefused = typed !== '' && !typedIsUsable;
  const keyInUse = typed !== '' ? typed : (savedKey ?? '');
  const modelIsValid = isValidModelName(settings.anthropicModel);
  const anthropic = settings.provider === 'anthropic';
  const canTest = test.status !== 'running' && (!anthropic || (isPlausibleApiKey(keyInUse) && modelIsValid));
  const canSave = typedIsUsable || (typed === '' && savedKey !== null && remember !== savedOnComputer);

  const saveKey = (): void => {
    const key = typedIsUsable ? typed : savedKey;
    if (key === null) {
      return;
    }
    const warning = saveApiKey(scope.name, key, remember, storages);
    if (warning !== null) {
      setProblem(warning);
      return;
    }
    setProblem(null);
    setSavedKey(key);
    setSavedOnComputer(remember);
    setTypedKey('');
    setKeyMessage(remember ? 'Clé enregistrée sur cet ordinateur.' : 'Clé enregistrée pour cet onglet : elle disparaît quand il est fermé.');
    dropTest();
  };

  const forgetKey = (): void => {
    const warning = forgetApiKey(scope.name, storages);
    setProblem(warning);
    setSavedKey(null);
    setSavedOnComputer(false);
    setTypedKey('');
    setRemember(false);
    setKeyMessage('Clé oubliée : elle a été effacée de ce navigateur.');
    dropTest();
  };

  const startTest = (): void => {
    setTest({ status: 'running' });
    setRequest({ provider: settings.provider, apiKey: keyInUse, model: settings.anthropicModel });
  };

  const chosenOllamaModel = ollamaModels?.includes(settings.ollamaModel) === true ? settings.ollamaModel : '';

  return (
    <div className="provider-settings" role="group" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Fournisseur d’IA</h3>
      <fieldset className="provider-choice">
        <legend>Fournisseur</legend>
        {(['anthropic', 'ollama'] as const).map((provider) => (
          <label key={provider} className="provider-option">
            <input
              type="radio"
              name={`${id}-provider`}
              checked={settings.provider === provider}
              onChange={() => {
                changeSettings({ ...settings, provider });
              }}
            />
            <span>{PROVIDER_LABELS[provider]}</span>
          </label>
        ))}
      </fieldset>
      <p className="small-note">
        {anthropic
          ? 'Les extraits masqués partiront vers Anthropic (api.anthropic.com), avec votre clé.'
          : 'Les extraits masqués restent sur cet ordinateur : ils sont envoyés à Ollama (localhost:11434).'}
      </p>

      {anthropic ? (
        <>
          <div className="field">
            <label htmlFor={`${id}-key`}>Clé API Anthropic</label>
            <input
              id={`${id}-key`}
              className="text-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={typedKey}
              placeholder={savedKey === null ? '' : 'Saisissez une autre clé pour la remplacer'}
              aria-describedby={`${id}-key-help`}
              onChange={(event) => {
                setTypedKey(event.target.value);
                setKeyMessage(null);
                dropTest();
              }}
            />
            <p id={`${id}-key-help`} className="small-note">
              Utilisez une clé dédiée à Sherlog, avec un plafond de dépense défini chez Anthropic. La clé n’est envoyée qu’à Anthropic : elle n’est ni exportée ni écrite dans la console.
            </p>
            {typedIsRefused && <p className="notice notice-error">La clé contient des caractères que le navigateur ne peut pas envoyer (espace, accent…).</p>}
            {savedKey !== null && <p className="small-note">Une clé est enregistrée {savedOnComputer ? 'sur cet ordinateur' : 'pour cet onglet'}.</p>}
          </div>
          <label className="provider-option">
            <input
              type="checkbox"
              checked={remember}
              disabled={!scope.identified}
              onChange={(event) => {
                setRemember(event.target.checked);
              }}
            />
            <span>Me souvenir de ma clé sur cet ordinateur</span>
          </label>
          {!scope.identified && <p className="small-note">Votre identité n’a pas pu être lue : la clé ne peut être gardée que pour cet onglet.</p>}
          {remember && scope.identified && (
            <p className="notice notice-warning">
              La clé restera enregistrée dans ce navigateur après sa fermeture, lisible par tout script de cette page. Ne cochez pas sur un ordinateur partagé.
            </p>
          )}
          <div className="actions">
            <button type="button" className="button-secondary" disabled={!canSave} onClick={saveKey}>
              Enregistrer la clé
            </button>
            {savedKey !== null && (
              <button type="button" className="button-link" onClick={forgetKey}>
                Oublier la clé
              </button>
            )}
          </div>
          {keyMessage !== null && (
            <p className="small-note" role="status">
              {keyMessage}
            </p>
          )}
          <div className="field">
            <label htmlFor={`${id}-model`}>Modèle Claude</label>
            <input
              id={`${id}-model`}
              className="text-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={settings.anthropicModel}
              aria-describedby={`${id}-model-help`}
              onChange={(event) => {
                changeSettings({ ...settings, anthropicModel: event.target.value.trim() });
              }}
            />
            <p id={`${id}-model-help`} className="small-note">
              Identifiant d’un modèle Claude, par exemple claude-haiku-5-5 (le plus léger, choisi par défaut) ou claude-sonnet-5-5. Tout autre modèle Anthropic peut être saisi.
            </p>
            {!modelIsValid && <p className="notice notice-error">Un identifiant de modèle ne contient que des lettres, chiffres et les signes . _ - : /</p>}
          </div>
        </>
      ) : (
        <>
          <p className="small-note">
            Ollama doit être lancé sur cet ordinateur et accepter l’adresse de ce site : la variable d’environnement OLLAMA_ORIGINS doit contenir {siteOrigin}, puis Ollama doit être redémarré.
          </p>
          {ollamaModels === null ? (
            <p className="small-note">Cliquez sur « Tester la connexion » pour lire les modèles installés.</p>
          ) : (
            <div className="field">
              <label htmlFor={`${id}-ollama-model`}>Modèle installé</label>
              <select
                id={`${id}-ollama-model`}
                className="select"
                value={chosenOllamaModel}
                onChange={(event) => {
                  changeSettings({ ...settings, ollamaModel: event.target.value });
                }}
              >
                <option value="">Choisir un modèle</option>
                {ollamaModels.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {settings.ollamaModel !== '' && chosenOllamaModel === '' && (
                <p className="notice notice-warning">Le modèle {settings.ollamaModel} n’est pas installé dans Ollama : choisissez-en un autre.</p>
              )}
            </div>
          )}
        </>
      )}

      <div className="actions">
        <button type="button" className="button-secondary" disabled={!canTest} onClick={startTest}>
          Tester la connexion
        </button>
      </div>
      {test.status === 'running' && (
        <p className="hint" role="status">
          Test en cours…
        </p>
      )}
      {test.status === 'ok' && (
        <p className="notice notice-ok" role="status">
          {test.message}
        </p>
      )}
      {test.status === 'failed' && (
        <p className="notice notice-error" role="alert">
          {test.message}
        </p>
      )}
      {problem !== null && (
        <p className="notice notice-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * Where the user chooses the provider of the explanations, gives their key and tests the connection. It only appears
 * once a log has been analysed (SPEC §3). The test sends one fixed sentence to Anthropic, or reads the list of the
 * models installed in Ollama: no word of a log leaves the browser from here. The key is typed in a field that does not
 * show it, kept only when the user asks (for the tab, or on the computer), and never shown again.
 */
export function ProviderSettings({ scope, storages = browserStorages, fetchImpl = fetch, siteOrigin = window.location.origin }: ProviderSettingsProps) {
  if (scope === null) {
    return (
      <p className="hint" role="status">
        Lecture de votre identité…
      </p>
    );
  }
  // Keyed by the identity: another identity starts from its own key and settings, never from the previous one's.
  return <ProviderForm key={scope.name} scope={scope} storages={storages} fetchImpl={fetchImpl} siteOrigin={siteOrigin} />;
}
