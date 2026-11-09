import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StorageScope } from '../src/auth/storageScope';
import { LogWorkspace } from '../src/ui/LogWorkspace';
import { chooseFile, finish, startAnalysis } from './helpers/workspace';
import { consoleLog, fakeScanner, scanResult } from './helpers/fakeScanner';
import { eventStream, fakeFetch } from './helpers/fakeFetch';
import { MemoryStorage } from './helpers/memoryStorage';

const scope: StorageScope = { name: 'github/1', identified: true };

function setupWithProvider(storageScope: StorageScope | null = scope) {
  const scanner = fakeScanner();
  const { fetchImpl, requests } = fakeFetch(() => eventStream([]));
  render(
    <LogWorkspace
      dependencies={{ startScan: scanner.startScan }}
      storageScope={storageScope}
      aiDependencies={{ storages: { session: new MemoryStorage(), local: new MemoryStorage() }, fetchImpl, siteOrigin: 'https://sherlog.test' }}
    />,
  );
  return { scanner, requests };
}

const steps = () => within(screen.getByRole('list', { name: 'Étapes' })).getAllByRole('listitem');
const sendPanel = () => screen.getByRole('region', { name: 'Envoi à l’IA' });

describe('LogWorkspace provider settings', () => {
  it('should not offer a key or a model before the log is analysed', async () => {
    // Arrange
    setupWithProvider();

    // Act
    await chooseFile(consoleLog);

    // Assert
    expect(screen.queryByLabelText('Clé API Anthropic')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Ollama/ })).not.toBeInTheDocument();
  });

  it('should offer the provider, the key and the model in the sending panel once the log is analysed', async () => {
    // Arrange
    const { scanner } = setupWithProvider();
    await startAnalysis(scanner);

    // Act
    finish(scanner);

    // Assert
    const panel = sendPanel();
    expect(await within(panel).findByLabelText('Clé API Anthropic')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Modèle Claude')).toBeInTheDocument();
    expect(within(panel).getByRole('radio', { name: /Ollama/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Tester la connexion' })).toBeInTheDocument();
  });

  it('should not offer them when the analysis found no error, since there is nothing to explain', async () => {
    // Arrange
    const { scanner } = setupWithProvider();
    await startAnalysis(scanner);

    // Act
    finish(scanner, [], { ...scanResult, errors: 0, fingerprints: [] });

    // Assert
    expect(screen.queryByLabelText('Clé API Anthropic')).not.toBeInTheDocument();
  });

  it('should wait for the identity before offering the key', async () => {
    // Arrange
    const { scanner } = setupWithProvider(null);
    await startAnalysis(scanner);

    // Act
    finish(scanner);

    // Assert
    expect(await within(sendPanel()).findByText(/Lecture de votre identité/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Clé API Anthropic')).not.toBeInTheDocument();
  });

  it('should send nothing by itself, and keep the sending of the errors disabled', async () => {
    // Arrange
    const { scanner, requests } = setupWithProvider();
    await startAnalysis(scanner);

    // Act
    finish(scanner);
    fireEvent.change(await screen.findByLabelText('Clé API Anthropic'), { target: { value: 'sk-ant-test-0123456789' } });

    // Assert
    expect(requests).toHaveLength(0);
    expect(within(sendPanel()).getByRole('button', { name: 'Envoyer à l’IA' })).toBeDisabled();
  });

  it('should make the sending the current step once the log is analysed, and still say it cannot send', async () => {
    // Arrange
    const { scanner } = setupWithProvider();
    await startAnalysis(scanner);

    // Act
    finish(scanner);

    // Assert
    expect(steps()[3]).toHaveAttribute('aria-current', 'step');
    expect(steps()[3]).toHaveTextContent(/envoi n’est pas encore disponible/);
    expect(steps()[2]).toHaveClass('is-done');
  });

  it('should keep the analysis as the current step when it found no error', async () => {
    // Arrange
    const { scanner } = setupWithProvider();
    await startAnalysis(scanner);

    // Act
    finish(scanner, [], { ...scanResult, errors: 0, fingerprints: [] });

    // Assert
    expect(steps()[2]).toHaveAttribute('aria-current', 'step');
    expect(steps()[3]).toHaveTextContent(/pas encore disponible/);
  });
});
