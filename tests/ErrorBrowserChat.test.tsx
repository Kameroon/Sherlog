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

const analysis = {
  summary: 'Le paiement échoue.',
  probableCause: 'Délai dépassé.',
  severity: 'high',
  confidence: 'medium',
  evidence: ['TimeoutException'],
  suggestedFixes: [{ title: 'Augmenter le délai', details: 'Passer à 60 s.', codeHint: null }],
  missingInfo: [],
};
const anthropic: ProviderChoice = { provider: 'anthropic', apiKey: 'sk-ant-test-0123456789', model: 'claude-haiku-5-5' };

const reply = (...pieces: string[]) => eventStream([...pieces.map((piece) => textDelta(piece)), anthropicEvent('message_stop', {})]);

/** Answers a chat question with `text`, and an analysis (the request that has the instructions of the analysis) with the schema. */
const answerer = (text: string) => (request: RecordedRequest) => {
  const system = (request.body as { system?: string }).system ?? '';
  return system.includes('"probableCause"') ? reply(JSON.stringify(analysis)) : reply(text.slice(0, 5), text.slice(5));
};

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
  answer?: (request: RecordedRequest) => Response | Error | Promise<Response | Error>;
  readText?: (position: EntryPosition) => Promise<EntryText>;
}

function show(records: readonly ErrorRecord[], options: Options = {}) {
  const { fetchImpl, requests } = fakeFetch(options.answer ?? answerer('Le délai est trop court.'));
  render(
    <ErrorBrowser
      records={records}
      readText={options.readText ?? ((position) => Promise.resolve(entryOf(position)))}
      readNeighbours={() => Promise.resolve(noLines)}
      limitReached={false}
      masking={DEFAULT_ENABLED_RULES}
      hasDate
      fileName="app.log"
      provider={options.provider === undefined ? anthropic : options.provider}
      aiFetch={fetchImpl}
      siteOrigin="https://sherlog.test"
    />,
  );
  return { requests };
}

const rows = () => within(screen.getByRole('listbox', { name: 'Erreurs' })).getAllByRole('option');
const select = (row: number): void => {
  fireEvent.click(rows()[row] as HTMLElement);
};
const chat = () => screen.getByRole('region', { name: 'Discussion sur cette erreur' });
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

describe('ErrorBrowser chat availability', () => {
  it('should offer the chat for the selected error as soon as the log is analysed, with no analysis by the model before', () => {
    // Act
    show([record(0, 0)]);
    select(0);

    // Assert
    expect(chat()).toBeInTheDocument();
    expect(within(chat()).getByLabelText('Votre question')).toBeEnabled();
  });

  it('should not offer a chat before an error is selected: it belongs to an error', () => {
    // Act
    show([record(0, 0)]);

    // Assert
    expect(screen.queryByRole('region', { name: 'Discussion sur cette erreur' })).not.toBeInTheDocument();
  });

  it('should not allow asking without a provider, and say what to do', () => {
    // Arrange
    const { requests } = show([record(0, 0)], { provider: null });
    select(0);

    // Act
    type('Pourquoi ?');

    // Assert
    expect(sendButton()).toBeDisabled();
    expect(within(chat()).getByText(/Choisissez un fournisseur/)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('should not allow an empty question', () => {
    // Arrange
    show([record(0, 0)]);
    select(0);

    // Act
    type('   ');

    // Assert
    expect(sendButton()).toBeDisabled();
  });

  it('should say where each message goes before the click, and send nothing by typing', () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    select(0);

    // Act
    type('Pourquoi ?');

    // Assert
    expect(within(chat()).getByText(/part vers Anthropic \(api\.anthropic\.com\), modèle claude-haiku-5-5, avec toute la conversation/)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });
});

describe('ErrorBrowser chat first question', () => {
  it('should send the context and the question in one message, with the instructions apart, and show the answer', async () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    select(0);

    // Act
    ask('Pourquoi ce délai ?');

    // Assert
    expect(await within(thread()).findByText('Le délai est trop court.')).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    const body = bodyOf(requests[0]);
    expect(body.system).toContain('assistant de diagnostic');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.content).toMatch(/^<log_data_[0-9a-f]{32}>\n/);
    expect(body.messages[0]?.content).toContain('entry at 0');
    expect(body.messages[0]?.content.endsWith('\n\nPourquoi ce délai ?')).toBe(true);
    expect(within(thread()).getByText('Pourquoi ce délai ?')).toBeInTheDocument();
  });

  it('should send with the key and model chosen to the provider chosen', async () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    select(0);

    // Act
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    expect(requests[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(requests[0]?.init.headers).toMatchObject({ 'x-api-key': anthropic.apiKey });
    expect(requests[0]?.body).toMatchObject({ model: 'claude-haiku-5-5' });
  });

  it('should clear the field once the question is sent, and not allow another while the answer is awaited', async () => {
    // Arrange
    let release: (answer: Response) => void = () => undefined;
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    show([record(0, 0)], { answer: () => waiting });
    select(0);

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

  it('should put the analysis of the model in the context when there is one, and none otherwise', async () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    select(0);

    // Act
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    expect(bodyOf(requests[0]).messages[0]?.content).not.toContain('Analyse précédente');
  });

  it('should mask the question as it masks the rest, show what was sent, and say how many were hidden', async () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    select(0);

    // Act
    type('Le client jane.doe@example.com a échoué');
    expect(within(chat()).getByText(/1 donnée de ce message sera masquée/)).toBeInTheDocument();
    fireEvent.click(sendButton());
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    expect(JSON.stringify(requests[0]?.body)).toContain('[EMAIL]');
    expect(JSON.stringify(requests[0]?.body)).not.toContain('jane.doe@example.com');
    expect(within(thread()).getByText('Le client [EMAIL] a échoué')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('jane.doe@example.com');
  });

  it('should refuse a question over the limit instead of cutting it', () => {
    // Arrange
    show([record(0, 0)]);
    select(0);

    // Assert
    expect(within(chat()).getByLabelText('Votre question')).toHaveAttribute('maxlength', '4000');
  });

  it('should show the answer as text, never as markup', async () => {
    // Arrange
    show([record(0, 0)], { answer: () => reply('<img src=x onerror=alert(1)> [clic](https://evil.example)') });
    select(0);

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
    const { requests } = show([record(0, 0)]);
    select(0);
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Act
    ask('Et le correctif ?');
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    await waitFor(() => {
      expect(sendButton()).toBeDisabled();
      expect(within(chat()).queryByRole('button', { name: 'Arrêter la réponse' })).not.toBeInTheDocument();
    });

    // Assert
    const [first, second] = [bodyOf(requests[0]), bodyOf(requests[1])];
    expect(second.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(second.messages[1]?.content).toBe('Le délai est trop court.');
    expect(second.messages[2]?.content).toBe('Et le correctif ?');
    expect(second.messages.filter((message) => message.content.includes('log_data_'))).toHaveLength(1);
    const nonceOf = (body: typeof first) => /<log_data_([0-9a-f]{32})>/.exec(body.messages[0]?.content ?? '')?.[1];
    expect(nonceOf(first)).not.toBe(nonceOf(second));
    expect(second.system).toContain(`log_data_${nonceOf(second) ?? ''}`);
  });

  it('should keep one conversation for each error, and share it between the errors that are identical', async () => {
    // Arrange
    show([record(0, 0), record(1, 0), record(2, 1)]);
    select(0);
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Act & Assert
    select(1);
    expect(within(thread()).getByText('Pourquoi ?')).toBeInTheDocument();
    select(2);
    expect(within(chat()).queryByRole('list', { name: 'Conversation' })).not.toBeInTheDocument();
  });

  it('should clear the conversation on request, and start again with the context', async () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    select(0);
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Act
    fireEvent.click(within(chat()).getByRole('button', { name: 'Effacer la conversation' }));
    ask('Autre question');
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    expect(within(thread()).queryByText('Pourquoi ?')).not.toBeInTheDocument();
    expect(bodyOf(requests[1]).messages).toHaveLength(1);
    expect(bodyOf(requests[1]).messages[0]?.content).toContain('<log_data_');
  });

  it('should keep the context it started with for the whole conversation, even if an analysis is made meanwhile', async () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    select(0);
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Envoi à l’IA' })).getByRole('button', { name: 'Envoyer à l’IA' }));
    await screen.findByText('Le paiement échoue.');

    // Act
    ask('Et ensuite ?');
    await waitFor(() => {
      expect(requests.filter((request) => !(bodyOf(request).system ?? '').includes('"probableCause"'))).toHaveLength(2);
    });

    // Assert
    const chatRequests = requests.filter((request) => !(bodyOf(request).system ?? '').includes('"probableCause"'));
    expect(bodyOf(chatRequests[1]).messages[0]?.content).not.toContain('Analyse précédente');
    expect(bodyOf(chatRequests[1]).messages[0]?.content).toContain('entry at 0');
  });

  it('should use the analysis of the model as part of the context once there is one', async () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    select(0);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Envoi à l’IA' })).getByRole('button', { name: 'Envoyer à l’IA' }));
    await screen.findByText('Le paiement échoue.');

    // Act
    ask('Que faire ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    const content = bodyOf(requests.at(-1)).messages[0]?.content ?? '';
    expect(content).toContain('--- Analyse précédente ---');
    expect(content).toContain('Le paiement échoue.');
  });

  it('should show the exact context that goes with the first question, before it is sent', async () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    select(0);

    // Act
    fireEvent.click(within(chat()).getByRole('button', { name: 'Voir le contexte envoyé avec la première question' }));
    const preview = (await within(chat()).findByLabelText(/Texte exact envoyé/)).textContent ?? '';
    ask('Pourquoi ?');
    await within(thread()).findByText('Le délai est trop court.');

    // Assert
    expect(preview).toContain('entry at 0');
    expect(bodyOf(requests[0]).messages[0]?.content).toContain(`\n${preview}\n`);
  });
});

describe('ErrorBrowser chat failures', () => {
  it('should say why a question failed, keep the conversation as it was, and offer to try again', async () => {
    // Arrange
    let calls = 0;
    const { requests } = show([record(0, 0)], { answer: (request) => (calls++ === 0 ? jsonAnswer({ error: { message: 'invalid x-api-key' } }, 401) : answerer('Réessayé.')(request)) });
    select(0);

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
    expect(requests).toHaveLength(2);
    expect(bodyOf(requests[1]).messages.at(-1)?.content.endsWith('Pourquoi ?')).toBe(true);
    expect(within(chat()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should say when the answer was cut off, and keep nothing of it', async () => {
    // Arrange
    show([record(0, 0)], { answer: () => eventStream([textDelta('Début de la répo')]) });
    select(0);

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/interrompue/);
    expect(within(chat()).queryByText('Début de la répo')).not.toBeInTheDocument();
  });

  it('should say when the model answered nothing', async () => {
    // Arrange
    show([record(0, 0)], { answer: () => eventStream([anthropicEvent('message_stop', {})]) });
    select(0);

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/n’a rien répondu/);
  });

  it('should stop the request and the answer when the user stops it, keeping the question to ask again', async () => {
    // Arrange
    const { requests } = show([record(0, 0)], { answer: () => new Promise<Response>(() => undefined) });
    select(0);
    ask('Pourquoi ?');
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });

    // Act
    fireEvent.click(within(chat()).getByRole('button', { name: 'Arrêter la réponse' }));

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/arrêté la réponse/);
    expect(requests[0]?.init.signal?.aborted).toBe(true);
    expect(within(chat()).getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(within(chat()).queryByRole('list', { name: 'Conversation' })).not.toBeInTheDocument();
  });

  it('should not keep an answer that comes after the user stopped it', async () => {
    // Arrange
    let release: (answer: Response) => void = () => undefined;
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { requests } = show([record(0, 0)], { answer: () => waiting });
    select(0);
    ask('Pourquoi ?');
    await waitFor(() => {
      expect(requests).toHaveLength(1);
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
    const { requests } = show([record(0, 0)], { readText: () => Promise.reject(new DOMException('gone', 'NotFoundError')) });
    select(0);

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/Le fichier a été modifié, déplacé/);
    expect(requests).toHaveLength(0);
  });

  it('should say the conversation is too long rather than cut it, and let the user start again', async () => {
    // Arrange
    const long = 'x'.repeat(59_900);
    const { requests } = show([record(0, 0)], { answer: () => reply(long) });
    select(0);
    ask('Pourquoi ?');
    await within(thread()).findByText(long);

    // Act
    ask('Et ensuite ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/conversation est trop longue/);
    expect(requests).toHaveLength(1);
    fireEvent.click(within(chat()).getByRole('button', { name: 'Effacer la conversation' }));
    expect(within(chat()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should refuse an answer that never ends rather than keep it', async () => {
    // Arrange
    show([record(0, 0)], { answer: () => reply('y'.repeat(61_000)) });
    select(0);

    // Act
    ask('Pourquoi ?');

    // Assert
    expect(await within(chat()).findByRole('alert')).toHaveTextContent(/trop longue/);
  });
});
