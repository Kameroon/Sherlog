// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AiRequestError } from '../src/ai/errors';
import type { AiFailureKind } from '../src/ai/errors';
import { failureMessage } from '../src/ai/failureMessage';

const ORIGIN = 'https://sherlog.example.net';
const anthropic = (kind: AiFailureKind, options: { status?: number; detail?: string } = {}) => failureMessage(new AiRequestError(kind, options), { provider: 'anthropic', siteOrigin: ORIGIN });
const ollama = (kind: AiFailureKind, options: { status?: number; detail?: string } = {}) => failureMessage(new AiRequestError(kind, options), { provider: 'ollama', siteOrigin: ORIGIN });

describe('failureMessage for Anthropic', () => {
  it.each([
    ['unauthorized', /clé est refusée/],
    ['forbidden', /refuse l’accès/],
    ['not-found', /modèle n’existe pas/],
    ['rate-limited', /limite les demandes|crédit/],
    ['unavailable', /ne peut pas répondre/],
    ['network', /injoignable/],
    ['timeout', /pas répondu à temps/],
    ['interrupted', /interrompue/],
    ['protocol', /forme attendue/],
  ] as const)('should say in words what %s means', (kind, expected) => {
    // Act & Assert
    expect(anthropic(kind)).toMatch(expected);
  });

  it('should name the provider the message is about', () => {
    // Act & Assert
    expect(anthropic('unauthorized')).toContain('Anthropic');
  });

  it('should add what the provider said when it said something', () => {
    // Act & Assert
    expect(anthropic('rejected', { status: 400, detail: 'max_tokens: field required' })).toContain('max_tokens: field required');
  });

  it('should give the status when nothing else explains a refusal', () => {
    // Act & Assert
    expect(anthropic('rejected', { status: 422 })).toContain('422');
  });
});

describe('failureMessage for Ollama', () => {
  it('should tell what to set up when Ollama cannot be reached, with the address of this site', () => {
    // Act
    const message = ollama('network');

    // Assert
    expect(message).toContain('OLLAMA_ORIGINS');
    expect(message).toContain(ORIGIN);
    expect(message).toContain('lancé');
  });

  it('should say the address of this site is refused when Ollama answers 403', () => {
    // Act
    const message = ollama('forbidden', { status: 403 });

    // Assert
    expect(message).toContain('OLLAMA_ORIGINS');
    expect(message).toContain(ORIGIN);
  });

  it('should say the model is not installed, with what Ollama said', () => {
    // Act
    const message = ollama('not-found', { status: 404, detail: "model 'x' not found" });

    // Assert
    expect(message).toContain('pas installé');
    expect(message).toContain("model 'x' not found");
  });

  it('should name Ollama and never Anthropic', () => {
    // Act
    const message = ollama('timeout');

    // Assert
    expect(message).toContain('Ollama');
    expect(message).not.toContain('Anthropic');
  });
});
