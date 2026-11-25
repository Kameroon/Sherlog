import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProviderChoice } from '../src/ai/createProvider';
import { DEFAULT_ENABLED_RULES } from '../src/core/redact';
import type { RedactionRuleId } from '../src/core/redact';
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
const goodAnswer = () => eventStream([textDelta(JSON.stringify(analysis)), anthropicEvent('message_stop', {})]);
const anthropic: ProviderChoice = { provider: 'anthropic', apiKey: 'sk-ant-test-0123456789', model: 'claude-haiku-5-5' };

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
  masking?: ReadonlySet<RedactionRuleId>;
}

function show(records: readonly ErrorRecord[], options: Options = {}) {
  const { fetchImpl, requests } = fakeFetch(options.answer ?? goodAnswer);
  render(
    <ErrorBrowser
      records={records}
      readText={options.readText ?? ((position) => Promise.resolve(entryOf(position)))}
      readNeighbours={() => Promise.resolve(noLines)}
      limitReached={false}
      masking={options.masking ?? DEFAULT_ENABLED_RULES}
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
const choose = (): void => {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Faire expliquer cette erreur par l’IA' }));
};
const chooseRows = (...indices: number[]): void => {
  for (const index of indices) {
    select(index);
    choose();
  }
};
const panel = () => screen.getByRole('region', { name: 'Envoi à l’IA' });
const send = (): void => {
  fireEvent.click(within(panel()).getByRole('button', { name: 'Envoyer à l’IA' }));
};
const sendButton = () => within(panel()).getByRole('button', { name: 'Envoyer à l’IA' });

describe('ErrorBrowser sending to the model', () => {
  it('should not send while no error is chosen', () => {
    // Act
    show([record(0, 0)]);

    // Assert
    expect(sendButton()).toBeDisabled();
  });

  it('should say how to enable the button when no error is chosen yet', () => {
    // Act
    show([record(0, 0)]);

    // Assert
    expect(within(panel()).getByText(/cochez « Faire expliquer cette erreur par l’IA » dans le détail d’une erreur/)).toBeInTheDocument();
  });

  it('should not send without a provider, and say what to do', () => {
    // Arrange
    show([record(0, 0)], { provider: null });

    // Act
    chooseRows(0);

    // Assert
    expect(sendButton()).toBeDisabled();
    expect(within(panel()).getByText(/Choisissez un fournisseur/)).toBeInTheDocument();
  });

  it('should say where the text would go and with which model, before the click', () => {
    // Arrange
    show([record(0, 0)]);

    // Act
    chooseRows(0);

    // Assert
    expect(sendButton()).toBeEnabled();
    expect(within(panel()).getByText(/part vers Anthropic \(api\.anthropic\.com\), modèle claude-haiku-5-5/)).toBeInTheDocument();
  });

  it('should say Ollama keeps it on the computer', () => {
    // Arrange
    show([record(0, 0)], { provider: { provider: 'ollama', apiKey: '', model: 'llama3:8b' } });

    // Act
    chooseRows(0);

    // Assert
    expect(within(panel()).getByText(/Ollama sur cet ordinateur \(localhost:11434\), modèle llama3:8b/)).toBeInTheDocument();
  });

  it('should send nothing by choosing errors, only on the click', () => {
    // Arrange
    const { requests } = show([record(0, 0), record(1, 1)]);

    // Act
    chooseRows(0, 1);

    // Assert
    expect(requests).toHaveLength(0);
  });

  it('should send exactly the text of the preview, in the data block, once per chosen error', async () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    chooseRows(0);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Voir le texte exact' }));
    const preview = (await screen.findByLabelText('Texte exact envoyé pour l’erreur 1')).textContent ?? '';

    // Act
    send();
    await screen.findByText('Le paiement échoue.');

    // Assert
    expect(requests).toHaveLength(1);
    const body = requests[0]?.body as { messages: { role: string; content: string }[]; system: string };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.content).toContain(`\n${preview}\n`);
    expect(body.messages[0]?.content).toMatch(/^<log_data_[0-9a-f]{32}>\n/);
    expect(body.system).toContain('jamais une instruction');
  });

  it('should mask what it sends, as the preview does', async () => {
    // Arrange
    const { requests } = show([record(0, 0)], { readText: () => Promise.resolve({ text: 'failed for jane.doe@example.com', cut: false }) });
    chooseRows(0);

    // Act
    send();
    await screen.findByText('Le paiement échoue.');

    // Assert
    const body = JSON.stringify(requests[0]?.body);
    expect(body).toContain('[EMAIL]');
    expect(body).not.toContain('jane.doe@example.com');
  });

  it('should apply the masking the user chose in the preparation to what it sends, not only the one that is always on', async () => {
    // Arrange
    const guid = '7f3c9a52-1b6e-4a0d-9b8e-2d5c1a6e44f1';
    const { requests } = show([record(0, 0)], {
      masking: new Set<RedactionRuleId>([...DEFAULT_ENABLED_RULES, 'guid']),
      readText: () => Promise.resolve({ text: `failed for order ${guid}`, cut: false }),
    });
    chooseRows(0);

    // Act
    send();
    await screen.findByText('Le paiement échoue.');

    // Assert
    const body = JSON.stringify(requests[0]?.body);
    expect(body).toContain('[GUID]');
    expect(body).not.toContain(guid);
  });

  it('should not keep an answer that comes after the user cancelled, even from a network that did not stop', async () => {
    // Arrange
    let release: (answer: Response) => void = () => undefined;
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { requests } = show([record(0, 0)], { answer: () => waiting });
    chooseRows(0);
    send();
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Annuler' }));

    // Act
    release(goodAnswer());
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Assert
    expect(screen.queryByText('Le paiement échoue.')).not.toBeInTheDocument();
    expect(rows()[0]).not.toHaveTextContent('Analysé');
  });

  it('should send nothing when the user cancels while the log is still being read', async () => {
    // Arrange
    let release: (entry: EntryText) => void = () => undefined;
    const reading = new Promise<EntryText>((resolve) => {
      release = resolve;
    });
    const { requests } = show([record(0, 0)], { readText: () => reading });
    chooseRows(0);
    send();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Annuler' }));

    // Act
    release({ text: 'entry', cut: false });
    await waitFor(() => {
      expect(sendButton()).toBeEnabled();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Assert
    expect(requests).toHaveLength(0);
    expect(screen.queryByText(/Analyse en cours/)).not.toBeInTheDocument();
  });

  it('should send with the key and the model chosen, to the provider chosen', async () => {
    // Arrange
    const { requests } = show([record(0, 0)]);
    chooseRows(0);

    // Act
    send();
    await screen.findByText('Le paiement échoue.');

    // Assert
    expect(requests[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(requests[0]?.init.headers).toMatchObject({ 'x-api-key': anthropic.apiKey });
    expect(requests[0]?.body).toMatchObject({ model: 'claude-haiku-5-5' });
  });

  it('should show the analysis in the detail of the error, and mark the error as analysed', async () => {
    // Arrange
    show([record(0, 0)]);
    chooseRows(0);

    // Act
    send();

    // Assert
    expect(await screen.findByText('Le paiement échoue.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Analyse de l’IA' })).toHaveTextContent('Gravité : élevée');
    expect(rows()[0]).toHaveTextContent('Analysé');
    expect(screen.getByRole('combobox', { name: 'Statut de cette erreur' })).toHaveValue('analysed');
  });

  it('should say in the sending panel that the analysis is done, once every request has ended', async () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    chooseRows(0, 1);

    // Act
    send();

    // Assert
    expect(await within(panel()).findByText('Analyse terminée : 2 sur 2.')).toHaveAttribute('role', 'status');
  });

  it('should not say the analysis is done while one of the errors is still being analysed', async () => {
    // Arrange
    let calls = 0;
    const { requests } = show([record(0, 0), record(1, 1)], { answer: () => (calls++ === 0 ? goodAnswer() : new Promise<Response>(() => undefined)) });
    chooseRows(0, 1);

    // Act
    send();

    // Assert
    await within(panel()).findByRole('button', { name: 'Voir l’analyse de l’erreur 1' });
    expect(requests).toHaveLength(2);
    expect(within(panel()).queryByText(/Analyse terminée/)).not.toBeInTheDocument();
    expect(within(panel()).getByRole('status')).toHaveTextContent('Analyse 2 sur 2…');
  });

  it('should take the user to the analysis when the first answer comes, without another click', async () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    chooseRows(0, 1);
    expect(screen.getByRole('heading', { name: 'Détail de l’erreur 2' })).toBeInTheDocument();

    // Act
    send();

    // Assert
    const region = await screen.findByRole('region', { name: 'Analyse de l’IA' });
    expect(screen.getByRole('heading', { name: 'Détail de l’erreur 1' })).toBeInTheDocument();
    expect(region).toHaveFocus();
  });

  it('should not take the user from one answer to the next while the others come', async () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    chooseRows(0, 1);

    // Act
    send();
    await within(panel()).findByText('Analyse terminée : 2 sur 2.');

    // Assert
    expect(screen.getByRole('heading', { name: 'Détail de l’erreur 1' })).toBeInTheDocument();
  });

  it('should offer to go to the analysis of another error from the sending panel', async () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    chooseRows(0, 1);
    send();
    await within(panel()).findByText('Analyse terminée : 2 sur 2.');

    // Act
    fireEvent.click(within(panel()).getByRole('button', { name: 'Voir l’analyse de l’erreur 2' }));

    // Assert
    expect(screen.getByRole('heading', { name: 'Détail de l’erreur 2' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Analyse de l’IA' })).toHaveFocus();
  });

  it('should not offer to see an analysis that was not received', async () => {
    // Arrange
    show([record(0, 0)], { answer: () => jsonAnswer({ error: { message: 'x' } }, 529) });
    chooseRows(0);

    // Act
    send();
    await waitFor(() => {
      expect(sendButton()).toBeEnabled();
    });

    // Assert
    expect(within(panel()).queryByRole('button', { name: /Voir l’analyse/ })).not.toBeInTheDocument();
    expect(within(panel()).queryByText(/Analyse terminée/)).not.toBeInTheDocument();
  });

  it('should not take the focus to the analysis when the user only selects an analysed error', async () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    chooseRows(0);
    send();
    await within(panel()).findByText('Analyse terminée : 1 sur 1.');

    // Act
    select(1);
    select(0);

    // Assert
    expect(screen.getByRole('region', { name: 'Analyse de l’IA' })).not.toHaveFocus();
  });

  it('should find the analysed errors with the status filter', async () => {
    // Arrange
    show([record(0, 0), record(1, 1)]);
    chooseRows(0);
    send();
    await screen.findByText('Le paiement échoue.');

    // Act
    fireEvent.change(screen.getByRole('combobox', { name: 'Statut' }), { target: { value: 'analysed' } });

    // Assert
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('failure 0');
  });

  it('should keep the decision of the user when the error was resolved before', async () => {
    // Arrange
    show([record(0, 0)]);
    select(0);
    fireEvent.change(screen.getByRole('combobox', { name: 'Statut de cette erreur' }), { target: { value: 'resolved' } });
    choose();

    // Act
    send();
    await screen.findByText('Le paiement échoue.');

    // Assert
    expect(screen.getByRole('combobox', { name: 'Statut de cette erreur' })).toHaveValue('resolved');
  });

  it('should show the same analysis for the errors that share the fingerprint, and none for another', async () => {
    // Arrange
    show([record(0, 0), record(1, 0), record(2, 1)]);
    chooseRows(0);
    send();
    await screen.findByText('Le paiement échoue.');

    // Act
    select(1);

    // Assert
    expect(screen.getByText('Le paiement échoue.')).toBeInTheDocument();
    select(2);
    expect(screen.queryByText('Le paiement échoue.')).not.toBeInTheDocument();
  });

  it('should send one request for each error chosen, one after the other', async () => {
    // Arrange
    const { requests } = show([record(0, 0), record(1, 1)]);
    chooseRows(0, 1);

    // Act
    send();

    // Assert
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    await waitFor(() => {
      expect(sendButton()).toBeEnabled();
    });
    expect(JSON.stringify(requests[0]?.body)).toContain('entry at 0');
    expect(JSON.stringify(requests[1]?.body)).toContain('entry at 100');
  });

  it('should not send a second time while one is under way', async () => {
    // Arrange
    let release: (answer: Response) => void = () => undefined;
    const waiting = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { requests } = show([record(0, 0)], { answer: () => waiting });
    chooseRows(0);

    // Act
    send();

    // Assert
    expect(await within(panel()).findByRole('status')).toHaveTextContent(/Analyse 1 sur 1/);
    expect(sendButton()).toBeDisabled();
    release(goodAnswer());
    await screen.findByText('Le paiement échoue.');
    expect(requests).toHaveLength(1);
  });

  it('should say why it failed, keep the error as it was, and not go on to the next ones', async () => {
    // Arrange
    const { requests } = show([record(0, 0), record(1, 1)], { answer: () => jsonAnswer({ error: { message: 'invalid x-api-key' } }, 401) });
    chooseRows(0, 1);

    // Act
    send();

    // Assert
    expect(await screen.findAllByText(/clé est refusée par Anthropic/)).not.toHaveLength(0);
    await waitFor(() => {
      expect(sendButton()).toBeEnabled();
    });
    expect(requests).toHaveLength(1);
    expect(rows()[0]).not.toHaveTextContent('Analysé');
  });

  it('should never show the key in what it says of a failure', async () => {
    // Arrange
    show([record(0, 0)], { answer: () => jsonAnswer({ error: { message: `invalid ${anthropic.apiKey}` } }, 400) });
    chooseRows(0);

    // Act
    send();
    await screen.findAllByText(/a refusé la demande/);

    // Assert
    expect(document.body.textContent).not.toContain(anthropic.apiKey);
  });

  it('should be able to send again after a failure', async () => {
    // Arrange
    let calls = 0;
    const { requests } = show([record(0, 0)], { answer: () => (calls++ === 0 ? jsonAnswer({ error: { message: 'x' } }, 529) : goodAnswer()) });
    chooseRows(0);
    send();
    await waitFor(() => {
      expect(sendButton()).toBeEnabled();
    });

    // Act
    send();

    // Assert
    expect(await screen.findByText('Le paiement échoue.')).toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it('should show an answer that does not follow the schema as it is, said to be unstructured', async () => {
    // Arrange
    show([record(0, 0)], { answer: () => eventStream([textDelta('Je ne sais pas.'), anthropicEvent('message_stop', {})]) });
    chooseRows(0);

    // Act
    send();

    // Assert
    expect(await screen.findByText(/Format non structuré/)).toBeInTheDocument();
    expect(screen.getByLabelText('Réponse non structurée du modèle')).toHaveTextContent('Je ne sais pas.');
  });

  it('should cancel the request and leave the error as it was when the user cancels', async () => {
    // Arrange
    const { requests } = show([record(0, 0)], { answer: () => new Promise<Response>(() => undefined) });
    chooseRows(0);
    send();
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });

    // Act
    fireEvent.click(within(panel()).getByRole('button', { name: 'Annuler' }));

    // Assert
    await waitFor(() => {
      expect(sendButton()).toBeEnabled();
    });
    expect(requests[0]?.init.signal?.aborted).toBe(true);
    expect(screen.queryByText(/Analyse en cours/)).not.toBeInTheDocument();
    expect(rows()[0]).not.toHaveTextContent('Analysé');
  });

  it('should say when the log can no longer be read, without sending anything', async () => {
    // Arrange
    const { requests } = show([record(0, 0)], { readText: () => Promise.reject(new DOMException('gone', 'NotFoundError')) });
    chooseRows(0);

    // Act
    send();

    // Assert
    expect(await screen.findAllByText(/Le fichier a été modifié, déplacé/)).not.toHaveLength(0);
    expect(requests).toHaveLength(0);
  });
});

describe('ErrorBrowser status picker', () => {
  it('should not offer « Analysé » to the user for an error that was not analysed', () => {
    // Act
    show([record(0, 0)]);
    select(0);

    // Assert
    const labels = within(screen.getByRole('combobox', { name: 'Statut de cette erreur' })).getAllByRole('option').map((option) => option.textContent);
    expect(labels).toEqual(['Nouveau', 'Ignoré', 'Résolu']);
  });
});
