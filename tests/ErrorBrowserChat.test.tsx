import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProviderChoice } from '../src/ai/createProvider';
import { DEFAULT_ENABLED_RULES } from '../src/core/redact';
import type { ErrorRecord } from '../src/core/scanLog';
import type { EntryPosition, EntryText } from '../src/sources/readEntryText';
import type { NeighbourLines } from '../src/sources/readNeighbourLines';
import { ErrorBrowser } from '../src/ui/ErrorBrowser';
import { anthropicEvent, eventStream, fakeFetch, jsonAnswer, textDelta } from './helpers/fakeFetch';
import type { RecordedRequest } from './helpers/fakeFetch';

const analysisOf = (summary: string) => ({
  summary,
  probableCause: 'Délai dépassé.',
  severity: 'high',
  confidence: 'medium',
  evidence: ['TimeoutException'],
  suggestedFixes: [{ title: 'Augmenter le délai', details: 'Passer à 60 s.', codeHint: null }],
  missingInfo: [],
});
const FIRST_SUMMARY = 'Le paiement échoue.';
const anthropic: ProviderChoice = { provider: 'anthropic', apiKey: 'sk-ant-test-0123456789', model: 'claude-haiku-5-5' };

const reply = (...pieces: string[]) => eventStream([...pieces.map((piece) => textDelta(piece)), anthropicEvent('message_stop', {})]);

/** The analysis and the chat are told apart by their instructions: only the analysis' ones hold the schema. */
const isAnalysis = (request: RecordedRequest): boolean => ((request.body as { system?: string }).system ?? '').includes('probableCause');
const isChat = (request: RecordedRequest): boolean => !isAnalysis(request);

const record = (index: number, fingerprintId: number): ErrorRecord => ({
  offset: index * 100,
  length: 90,
  timestamp: `2026-11-04 08:00:${String(index).padStart(2, '0')}`,
  level: 'ERR',
  message: `failure ${index}`,
  messageCut: false,
  lineCount: 1,
  fingerprintId,
});

const entryOf = (position: EntryPosition): EntryText => ({ text: `entry at ${position.offset}`, cut: false });
const noLines: NeighbourLines = { before: [], after: [], beforeLimited: false, afterLimited: false };

interface Options {
  provider?: ProviderChoice | null;
  /** What a chat question gets; the default is a short answer. */
  chatAnswer?: (request: RecordedRequest) => Response | Error | Promise<Response | Error>;
  /** What an analysis gets; the default is a valid analysis, then (for the next ones) another summary. */
  analysisAnswer?: (request: RecordedRequest, call: number) => Response | Error | Promise<Response | Error>;
  readText?: (position: EntryPosition) => Promise<EntryText>;
}

function show(records: readonly ErrorRecord[], options: Options = {}) {
  let analyses = 0;
  const { fetchImpl, requests } = fakeFetch((request) => {
    if (isAnalysis(request)) {
      const call = analyses;
      analyses += 1;
      return (options.analysisAnswer ?? ((_request, number) => reply(JSON.stringify(analysisOf(number === 0 ? FIRST_SUMMARY : 'Autre résumé.')))))(request, call);
    }
    return (options.chatAnswer ?? (() => reply('Le délai est', ' trop court.')))(request);
  });
  const ui = (provider: ProviderChoice | null) => (
    <ErrorBrowser
      records={records}
      readText={options.readText ?? ((position) => Promise.resolve(entryOf(position)))}
      readNeighbours={() => Promise.resolve(noLines)}
      limitReached={false}
      masking={DEFAULT_ENABLED_RULES}
      hasDate
      fileName="app.log"
      provider={provider}
      aiFetch={fetchImpl}
      siteOrigin="https://sherlog.test"
    />
  );
  const view = render(ui(options.provider === undefined ? anthropic : options.provider));
  return { requests, chatRequests: () => requests.filter(isChat), rerenderWith: (provider: ProviderChoice | null) => view.rerender(ui(provider)) };
}

const rows = () => within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option');
const select = (row: number): void => {
  fireEvent.click(rows()[row] as HTMLElement);
};
const sendPanel = () => screen.getByRole('region', { name: 'Envoi à l’IA' });
/** Has the model analyse the error of a row, and waits for its answer: the chat opens after it. */
const analyse = async (row = 0, summary = FIRST_SUMMARY): Promise<void> => {
  select(row);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' }));
  fireEvent.click(within(sendPanel()).getByRole('button', { name: 'Envoyer à l’IA' }));
  await screen.findByText(summary);
};
const chat = () => screen.getByRole('region', { name: 'Discussion sur cette erreur' });
const queryChat = () => screen.queryByRole('region', { name: 'Discussion sur cette erreur' });
const type = (text: string): void => {
  fireEvent.change(within(chat()).getByLabelText('Votre question'), { target: { value: text } });
};
const ask = (text: string): void => {
  type(text);
  fireEvent.click(within(chat()).getByRole('button', { name: 'Envoyer la question' }));
};
const sendButton = () => within(chat()).getByRole('button', { name: 'Envoyer la question' });
const thread = () => within(chat()).getByRole('list', { name: 'Conversation' });
const bodyOf = (request: RecordedRequest | undefined) => request?.body as { system: string; messages: { role: string; content: string }[] };

describe('ErrorBrowser chat is opened by the analysis of the model', () => {
  it('should not offer the chat for an error the model has not analysed, even when it is selected', () => {
    // Act
    show([record(0, 0)]);
    select(0);

    // Assert
    expect(queryChat()).not.toBeInTheDocument();
  });

  it('should not offer the chat while the analysis is under way', async () => {
    // Arrange
    show([record(0, 0)], { analysisAnswer: () => new Promise<Response>(() => undefined) });
    select(0);

    // Act
    fireEvent.click(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' }));
    fireEvent.click(within(sendPanel()).getByRole('button', { name: 'Envoyer à l’IA' }));

    // Assert
    await screen.findByText('Analyse en cours…', { selector: '.hint' });
    expect(queryChat()).not.toBeInTheDocument();
  });

  it('should not offer the chat when the analysis failed', async () => {
    // Arrange
    show([record(0, 0)], { analysisAnswer: () => jsonAnswer({ error: { message: 'invalid x-api-key' } }, 401) });
    select(0);

    // Act
    fireEvent.click(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' }));
    fireEvent.click(within(sendPanel()).getByRole('button', { name: 'Envoyer à l’IA' }));

    // Assert
    expect((await screen.findAllByText(/clé est refusée par Anthropic/)).length).toBeGreaterThan(0);
    expect(queryChat()).not.toBeInTheDocument();
  });

  it('should offer the chat under the analysis once the model has answered for the error', async () => {
    // Arrange
    show([record(0, 0)]);

    // Act
    await analyse();

    // Assert
    expect(chat()).toBeInTheDocument();
    expect(within(chat()).getByLabelText('Votre question')).toBeEnabled();
    expect(within(chat()).getByText(/approfondit l’analyse du modèle/)).toBeInTheDocument();
  });

  it('should offer the chat too when the answer did not follow the schema and is shown as it came', async () => {
    // Arrange
    show([record(0, 0)], { analysisAnswer: () => reply('Je pense que c’est le réseau.') });
    select(0);

    // Act
    fireEvent.click(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' }));
    fireEvent.click(within(sendPanel()).getByRole('button', { name: 'Envoyer à l’IA' }));
    await screen.findByText(/Format non structuré/);

    // Assert
    expect(chat()).toBeInTheDocument();
  });

  it('should offer the chat only for the errors that were analysed, and for the ones that are identical to them', async () => {
    // Arrange
    show([record(0, 0), record(1, 0), record(2, 1)]);
    await analyse(0);

    // Act & Assert
    select(1);
    expect(chat()).toBeInTheDocument();
    select(2);
    expect(queryChat()).not.toBeInTheDocument();
  });

  it('should not allow asking without a provider, and say what to do', async () => {
    // Arrange
    const { rerenderWith, chatRequests } = show([record(0, 0)]);
    await analyse();

    // Act
    rerenderWith(null);
    type('Pourquoi ?');

    // Assert
    expect(sendButton()).toBeDisabled();
    expect(within(chat()).getByText(/Choisissez un fournisseur/)).toBeInTheDocument();
    expect(chatRequests()).toHaveLength(0);
  });

  it('should not allow an empty question', async () => {
    // Arrange
    show([record(0, 0)]);
    await analyse();

    // Act
    type('   ');

    // Assert
    expect(sendButton()).toBeDisabled();
  });

  it('should say where each message goes before the click, and send nothing by typing or by opening the context', async () => {
    // Arrange
    const { chatRequests } = show([record(0, 0)]);
    await analyse();

    // Act
    type('Pourquoi ?');
    fireEvent.click(within(chat()).getByRole('button', { name: 'Voir le contexte envoyé avec la première question' }));

    // Assert
    expect(within(chat()).getByText(/part vers Anthropic \(api\.anthropic\.com\), modèle claude-haiku-5-5, avec toute la conversation/)).toBeInTheDocument();
    expect(chatRequests()).toHaveLength(0);
  });
});

describe('ErrorBrowser chat first question', () => {
  it('should send the context, the analysis and the question in one message, with the instructions apart, and show the answer', async () => {
    // Arrange
    const { chatRequests } = show([record(0, 0)]);
    await analyse();

    // Act
    ask('Pourquoi ce délai ?');

    // Assert
    expect(await within(thread()).findByText('Le délai est trop court.')).toBeInTheDocument();
    expect(chatRequests()).toHaveLength(1);
    const body = bodyOf(chatRequests()[0]);
    expect(body.system).toContain('ingénieur logiciel expert');
    expect(body.system).toContain("N'invente rien");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.content).toMatch(/^<log_data_[0-9a-f]{32}>\n/);
    expect(body.messages[0]?.content).toContain('entry at 0');
    expect(body.messages[0]?.content).toContain('--- Analyse précédente ---');
    expect(body.messages[0]?.content).toContain(FIRST_SUMMARY);
    expect(body.messages[0]?.content.endsWith('\n\nPourquoi ce délai ?')).toBe(true);
    expect(within(thread()).getByText('Pourquoi ce délai ?')).toBeInTheDocument();
  });

  it('should put the answer that did not follow the schema in the context, said to be unstructured', async () => {
    // Arrange
    const { chatRequests } = show([record(0, 0)], { analysisAnswer: () => reply('Je pense que c’est le réseau.') });
    select(0);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' }));
    fireEvent.click(within(sendPanel()).getByRole('button', { name: 'Envoyer à l’IA' }));
    await screen.findByText(/Format non structuré/);

    // Act
    ask('Que faire ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    const content = bodyOf(chatRequests()[0]).messages[0]?.content ?? '';
    expect(content).toContain('--- Analyse précédente (format non structuré) ---');
    expect(content).toContain('Je pense que c’est le réseau.');
  });

  it('should send with the key and model chosen to the provider chosen', async () => {
    // Arrange
    const { chatRequests } = show([record(0, 0)]);
    await analyse();

    // Act
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    expect(chatRequests()[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(chatRequests()[0]?.init.headers).toMatchObject({ 'x-api-key': anthropic.apiKey });
    expect(chatRequests()[0]?.body).toMatchObject({ model: 'claude-haiku-5-5' });
  });

  it('should clear the field once the question is sent, and not allow another while the answer is awaited', async () => {
    // Arrange
    let release: (answer: Response) => void = () => undefined;
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    show([record(0, 0)], { chatAnswer: () => waiting });
    await analyse();

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(within(chat()).getByLabelText('Votre question')).toHaveValue('');
    expect(sendButton()).toBeDisabled();
    expect(within(chat()).getByRole('button', { name: 'Arrêter la réponse' })).toBeInTheDocument();
    release(reply('Voilà.'));
    expect(await within(thread()).findByText('Voilà.')).toBeInTheDocument();
    expect(within(chat()).queryByRole('button', { name: 'Arrêter la réponse' })).not.toBeInTheDocument();
  });

  it('should mask the question as it masks the rest, show what was sent, and say how many were hidden', async () => {
    // Arrange
    const { chatRequests } = show([record(0, 0)]);
    await analyse();

    // Act
    type('Le client jane.doe@example.com a échoué');
    expect(within(chat()).getByText(/1 donnée de ce message sera masquée/)).toBeInTheDocument();
    fireEvent.click(sendButton());
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    expect(JSON.stringify(chatRequests()[0]?.body)).toContain('[EMAIL]');
    expect(JSON.stringify(chatRequests()[0]?.body)).not.toContain('jane.doe@example.com');
    expect(within(thread()).getByText('Le client [EMAIL] a échoué')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('jane.doe@example.com');
  });

  it('should refuse a question over the limit instead of cutting it', async () => {
    // Arrange
    show([record(0, 0)]);

    // Act
    await analyse();

    // Assert
    expect(within(chat()).getByLabelText('Votre question')).toHaveAttribute('maxlength', '4000');
  });

  it('should show the answer as text, never as markup', async () => {
    // Arrange
    show([record(0, 0)], { chatAnswer: () => reply('<img src=x onerror=alert(1)> [clic](https://evil.example)') });
    await analyse();

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(await within(thread()).findByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(thread().querySelector('img, a')).toBeNull();
  });
});

describe('ErrorBrowser chat conversation', () => {
  it('should send the whole conversation for the next question, with the context in the first message only and a new delimiter', async () => {
    // Arrange
    const { chatRequests } = show([record(0, 0)]);
    await analyse();
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Act
    ask('Et le correctif ?');
    await waitFor(() => {
      expect(chatRequests()).toHaveLength(2);
      expect(within(chat()).queryByRole('button', { name: 'Arrêter la réponse' })).not.toBeInTheDocument();
    });

    // Assert
    const [first, second] = [bodyOf(chatRequests()[0]), bodyOf(chatRequests()[1])];
    expect(second.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(second.messages[1]?.content).toBe('Le délai est trop court.');
    expect(second.messages[2]?.content).toBe('Et le correctif ?');
    expect(second.messages.filter((message) => message.content.includes('log_data_'))).toHaveLength(1);
    const nonceOf = (body: typeof first) => /<log_data_([0-9a-f]{32})>/.exec(body.messages[0]?.content ?? '')?.[1];
    expect(nonceOf(first)).not.toBe(nonceOf(second));
    expect(second.system).toContain(`log_data_${nonceOf(second) ?? ''}`);
  });

  it('should keep the conversation of an error when another is selected, and share it between the identical errors', async () => {
    // Arrange
    show([record(0, 0), record(1, 0), record(2, 1)]);
    await analyse(0);
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Act & Assert
    select(1);
    expect(within(thread()).getByText('Pourquoi ?')).toBeInTheDocument();
  });

  it('should clear the conversation on request, and start again with the context', async () => {
    // Arrange
    const { chatRequests } = show([record(0, 0)]);
    await analyse();
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Act
    fireEvent.click(within(chat()).getByRole('button', { name: 'Effacer la conversation' }));
    ask('Autre question');
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    expect(within(thread()).queryByText('Pourquoi ?')).not.toBeInTheDocument();
    expect(bodyOf(chatRequests()[1]).messages).toHaveLength(1);
    expect(bodyOf(chatRequests()[1]).messages[0]?.content).toContain('<log_data_');
  });

  it('should keep the analysis it started with for the whole conversation, even if the model analyses again meanwhile', async () => {
    // Arrange
    const { chatRequests } = show([record(0, 0)]);
    await analyse();
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');
    fireEvent.click(within(sendPanel()).getByRole('button', { name: 'Envoyer à l’IA' }));
    await screen.findByText('Autre résumé.');

    // Act
    ask('Et ensuite ?');
    await waitFor(() => {
      expect(chatRequests()).toHaveLength(2);
    });

    // Assert
    const content = bodyOf(chatRequests()[1]).messages[0]?.content ?? '';
    expect(content).toContain(FIRST_SUMMARY);
    expect(content).not.toContain('Autre résumé.');
  });

  it('should show the exact context that goes with the first question, with the analysis, before it is sent', async () => {
    // Arrange
    const { chatRequests } = show([record(0, 0)]);
    await analyse();

    // Act
    fireEvent.click(within(chat()).getByRole('button', { name: 'Voir le contexte envoyé avec la première question' }));
    const preview = (await within(chat()).findByLabelText(/Texte exact envoyé/)).textContent ?? '';
    const analysisPreview = within(chat()).getByLabelText('Analyse jointe au contexte').textContent ?? '';
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    expect(preview).toContain('entry at 0');
    expect(analysisPreview).toContain(FIRST_SUMMARY);
    const content = bodyOf(chatRequests()[0]).messages[0]?.content ?? '';
    expect(content).toContain(`\n${preview}\n`);
    expect(content).toContain(analysisPreview);
  });
});

describe('ErrorBrowser chat failures', () => {
  it('should say why a question failed, keep the conversation as it was, and offer to try again', async () => {
    // Arrange
    let calls = 0;
    const { chatRequests } = show([record(0, 0)], { chatAnswer: () => (calls++ === 0 ? jsonAnswer({ error: { message: 'invalid x-api-key' } }, 401) : reply('Réessayé.')) });
    await analyse();

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/clé est refusée par Anthropic/);
    expect(within(chat()).queryByRole('list', { name: 'Conversation' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(anthropic.apiKey);

    // Act
    fireEvent.click(within(chat()).getByRole('button', { name: 'Réessayer' }));

    // Assert
    expect(await within(thread()).findByText('Réessayé.')).toBeInTheDocument();
    expect(chatRequests()).toHaveLength(2);
    expect(bodyOf(chatRequests()[1]).messages.at(-1)?.content.endsWith('Pourquoi ?')).toBe(true);
    expect(within(chat()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should say when the answer was cut off, and keep nothing of it', async () => {
    // Arrange
    show([record(0, 0)], { chatAnswer: () => eventStream([textDelta('Début de la répo')]) });
    await analyse();

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/interrompue/);
    expect(within(chat()).queryByText('Début de la répo')).not.toBeInTheDocument();
  });

  it('should say when the model answered nothing', async () => {
    // Arrange
    show([record(0, 0)], { chatAnswer: () => eventStream([anthropicEvent('message_stop', {})]) });
    await analyse();

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/n’a rien répondu/);
  });

  it('should stop the request and the answer when the user stops it, keeping the question to ask again', async () => {
    // Arrange
    const { chatRequests } = show([record(0, 0)], { chatAnswer: () => new Promise<Response>(() => undefined) });
    await analyse();
    ask('Pourquoi ?');
    await waitFor(() => {
      expect(chatRequests()).toHaveLength(1);
    });

    // Act
    fireEvent.click(within(chat()).getByRole('button', { name: 'Arrêter la réponse' }));

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/arrêté la réponse/);
    expect(chatRequests()[0]?.init.signal?.aborted).toBe(true);
    expect(within(chat()).getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(within(chat()).queryByRole('list', { name: 'Conversation' })).not.toBeInTheDocument();
  });

  it('should not keep an answer that comes after the user stopped it', async () => {
    // Arrange
    let release: (answer: Response) => void = () => undefined;
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { chatRequests } = show([record(0, 0)], { chatAnswer: () => waiting });
    await analyse();
    ask('Pourquoi ?');
    await waitFor(() => {
      expect(chatRequests()).toHaveLength(1);
    });
    fireEvent.click(within(chat()).getByRole('button', { name: 'Arrêter la réponse' }));

    // Act
    release(reply('Trop tard.'));
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Assert
    expect(screen.queryByText('Trop tard.')).not.toBeInTheDocument();
  });

  it('should say when the log can no longer be read, without sending anything', async () => {
    // Arrange
    let reads = 0;
    const { chatRequests } = show([record(0, 0)], { readText: (position) => (reads++ < 2 ? Promise.resolve(entryOf(position)) : Promise.reject(new DOMException('gone', 'NotFoundError'))) });
    await analyse();

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/Le fichier a été modifié, déplacé/);
    expect(chatRequests()).toHaveLength(0);
  });

  it('should say the conversation is too long rather than cut it, and let the user start again', async () => {
    // Arrange
    const long = 'x'.repeat(59_900);
    const { chatRequests } = show([record(0, 0)], { chatAnswer: () => reply(long) });
    await analyse();
    ask('Pourquoi ?');
    await within(thread()).findByText(long);

    // Act
    ask('Et ensuite ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/conversation est trop longue/);
    expect(chatRequests()).toHaveLength(1);
    fireEvent.click(within(chat()).getByRole('button', { name: 'Effacer la conversation' }));
    expect(within(chat()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should refuse an answer that never ends rather than keep it', async () => {
    // Arrange
    show([record(0, 0)], { chatAnswer: () => reply('y'.repeat(61_000)) });
    await analyse();

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/trop longue/);
  });
});
