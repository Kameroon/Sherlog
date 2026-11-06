/* global document */
// Throwaway measurement page for step 1: never merged, never reads or writes storage or the console.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2026-10-21';
const MODEL = 'claude-haiku-5-5';
const OLLAMA_URL = 'http://localhost:11434/api/tags';
const OLLAMA_CHAT_URL = 'http://localhost:11434/api/chat';
// Public demonstration workspace and key published in the Microsoft Learn documentation, not a secret.
const LOG_ANALYTICS_URL = 'https://api.loganalytics.azure.com/v1/workspaces/DEMO_WORKSPACE/query';
const LOG_ANALYTICS_DEMO_KEY = 'DEMO_KEY';
const LOG_ANALYTICS_TIMEOUT_MS = 20000;
const OLLAMA_TIMEOUT_MS = 20000;
const OLLAMA_CHAT_TIMEOUT_MS = 120000;

const form = document.getElementById('anthropic-form');
const keyInput = document.getElementById('api-key');
const browserHeaderBox = document.getElementById('browser-header');
const report = document.getElementById('anthropic-report');
const answer = document.getElementById('anthropic-answer');
const ollamaButton = document.getElementById('ollama-probe');
const ollamaReport = document.getElementById('ollama-report');
const ollamaForm = document.getElementById('ollama-form');
const ollamaModelInput = document.getElementById('ollama-model');
const ollamaChatReport = document.getElementById('ollama-chat-report');
const ollamaAnswer = document.getElementById('ollama-answer');

/** Appends one measured line to a report element (text only, never HTML). */
function addLine(target, text) {
  target.textContent += `${text}\n`;
}

/** Milliseconds elapsed since `start`, one decimal. */
function since(start) {
  return (performance.now() - start).toFixed(1);
}

/** Splits an SSE buffer into complete events; returns the events and the unfinished tail. */
function splitEvents(buffer) {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  return { events: parts, rest };
}

/** Extracts the JSON payload of one SSE event, or null when it has no data line. */
function eventData(rawEvent) {
  const line = rawEvent.split('\n').find((candidate) => candidate.startsWith('data:'));
  return line ? JSON.parse(line.slice(5).trim()) : null;
}

async function callAnthropic(apiKey, sendBrowserHeader) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
  if (sendBrowserHeader) {
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 128,
    stream: true,
    messages: [{ role: 'user', content: 'Compte de 1 à 20, un nombre par ligne, sans rien ajouter.' }],
  });

  const start = performance.now();
  addLine(report, `En-tête d'accès navigateur : ${sendBrowserHeader ? 'envoyé' : 'absent'}`);
  const response = await fetch(ANTHROPIC_URL, { method: 'POST', headers, body });
  addLine(report, `Statut HTTP : ${response.status} (${since(start)} ms)`);
  addLine(report, `content-type : ${response.headers.get('content-type')}`);

  if (!response.ok) {
    addLine(report, `Corps de l'erreur : ${await response.text()}`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let networkChunks = 0;
  let textEvents = 0;
  let firstChunkAt = null;
  let firstTextAt = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    networkChunks += 1;
    firstChunkAt ??= since(start);
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = splitEvents(buffer);
    buffer = rest;
    for (const rawEvent of events) {
      const data = eventData(rawEvent);
      if (data?.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
        textEvents += 1;
        firstTextAt ??= since(start);
        answer.textContent += data.delta.text;
      } else if (data?.type === 'error') {
        addLine(report, `Événement d'erreur : ${JSON.stringify(data.error)}`);
      }
    }
  }

  addLine(report, `Premier fragment réseau : ${firstChunkAt} ms`);
  addLine(report, `Premier texte : ${firstTextAt} ms`);
  addLine(report, `Fragments réseau : ${networkChunks} ; événements de texte : ${textEvents}`);
  addLine(report, `Durée totale : ${since(start)} ms`);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  report.textContent = '';
  answer.textContent = '';
  const apiKey = keyInput.value;
  keyInput.value = '';
  try {
    await callAnthropic(apiKey, browserHeaderBox.checked);
  } catch (error) {
    addLine(report, `Échec de l'appel : ${error.name}: ${error.message}`);
    addLine(report, "Cause exacte masquée par le navigateur : voir l'onglet Réseau et la Console des outils de développement.");
  }
});

/** Streams a chat answer from Ollama (one JSON object per line) and reports what the browser allowed. */
async function callOllamaChat(model) {
  const start = performance.now();
  // A JSON POST triggers a CORS preflight, unlike the GET above: this is what the real application will send.
  const response = await fetch(OLLAMA_CHAT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      options: { num_predict: 16 },
      messages: [{ role: 'user', content: 'Compte de 1 à 20, un nombre par ligne, sans rien ajouter.' }],
    }),
    signal: AbortSignal.timeout(OLLAMA_CHAT_TIMEOUT_MS),
  });
  addLine(ollamaChatReport, `Statut HTTP : ${response.status} (${since(start)} ms)`);
  addLine(ollamaChatReport, `content-type : ${response.headers.get('content-type')}`);

  if (!response.ok) {
    addLine(ollamaChatReport, `Corps de l'erreur : ${await response.text()}`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let networkChunks = 0;
  let textLines = 0;
  let firstChunkAt = null;
  let firstTextAt = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    networkChunks += 1;
    firstChunkAt ??= since(start);
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines.filter((candidate) => candidate.trim() !== '')) {
      const data = JSON.parse(line);
      if (data.error) {
        addLine(ollamaChatReport, `Erreur renvoyée par Ollama : ${data.error}`);
      } else if (data.message?.content) {
        textLines += 1;
        firstTextAt ??= since(start);
        ollamaAnswer.textContent += data.message.content;
      }
    }
  }

  addLine(ollamaChatReport, `Premier fragment réseau : ${firstChunkAt} ms`);
  addLine(ollamaChatReport, `Premier texte : ${firstTextAt} ms`);
  addLine(ollamaChatReport, `Fragments réseau : ${networkChunks} ; lignes de texte : ${textLines}`);
  addLine(ollamaChatReport, `Durée totale : ${since(start)} ms`);
}

ollamaForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  ollamaChatReport.textContent = '';
  ollamaAnswer.textContent = '';
  try {
    await callOllamaChat(ollamaModelInput.value.trim());
  } catch (error) {
    addLine(ollamaChatReport, `Échec de l'appel : ${error.name}: ${error.message}`);
  }
});

document.getElementById('loganalytics-probe').addEventListener('click', async () => {
  const target = document.getElementById('loganalytics-report');
  target.textContent = '';
  const start = performance.now();
  try {
    // JSON body plus a custom header: the browser sends a CORS preflight, as it will for a bearer token.
    const response = await fetch(LOG_ANALYTICS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': LOG_ANALYTICS_DEMO_KEY },
      body: JSON.stringify({ query: 'AzureActivity | summarize count() by Category | take 3' }),
      signal: AbortSignal.timeout(LOG_ANALYTICS_TIMEOUT_MS),
    });
    addLine(target, `Statut HTTP : ${response.status} (${since(start)} ms)`);
    addLine(target, `Corps : ${await response.text()}`);
  } catch (error) {
    addLine(target, `Échec après ${since(start)} ms : ${error.name}: ${error.message}`);
  }
});

ollamaButton.addEventListener('click', async () => {
  ollamaReport.textContent = '';
  const start = performance.now();
  addLine(ollamaReport, `Requête vers ${OLLAMA_URL} (délai maximal ${OLLAMA_TIMEOUT_MS / 1000} s, le temps de répondre à une éventuelle invite)`);
  try {
    const response = await fetch(OLLAMA_URL, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });
    addLine(ollamaReport, `Statut HTTP : ${response.status} (${since(start)} ms)`);
    addLine(ollamaReport, `Corps : ${await response.text()}`);
  } catch (error) {
    addLine(ollamaReport, `Échec après ${since(start)} ms : ${error.name}: ${error.message}`);
  }
});
