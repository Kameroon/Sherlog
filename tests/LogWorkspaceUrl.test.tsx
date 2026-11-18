import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogWorkspace } from '../src/ui/LogWorkspace';
import { fakeFetch } from './helpers/fakeFetch';
import { consoleLog, fakeScanner } from './helpers/fakeScanner';
import { streamOf } from './helpers/streams';

const HOST = 'sherlogjournaux.blob.core.windows.net';
const SECRET = 'SECRETSIG0123';
const sasUrl = `https://${HOST}/journaux/app.log?sp=r&sig=${SECRET}`;

function setup() {
  const scanner = fakeScanner();
  const { fetchImpl, requests } = fakeFetch(() => new Response(streamOf([consoleLog]), { status: 200 }));
  render(<LogWorkspace dependencies={{ startScan: scanner.startScan }} urlDependencies={{ fetchImpl }} />);
  return { scanner, requests };
}

describe('LogWorkspace URL source', () => {
  it('should go from an address to the preparation of the file downloaded, with nothing analysed', async () => {
    // Arrange
    const { scanner } = setup();
    fireEvent.change(screen.getByLabelText(/Adresse du fichier/), { target: { value: sasUrl } });

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger et lire ce journal' }));

    // Assert
    expect(await screen.findByRole('button', { name: 'Choisir un autre journal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'app.log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyser ce journal' })).toBeInTheDocument();
    expect(scanner.requests).toHaveLength(0);
  });

  it('should not show the address, token included, once the file is being prepared', async () => {
    // Arrange
    setup();
    fireEvent.change(screen.getByLabelText(/Adresse du fichier/), { target: { value: sasUrl } });

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger et lire ce journal' }));
    await screen.findByRole('button', { name: 'Choisir un autre journal' });

    // Assert
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('should still offer the file and the pasted text next to the address', () => {
    // Act
    setup();

    // Assert
    expect(screen.getByLabelText('Choisir un fichier')).toBeInTheDocument();
    expect(screen.getByLabelText('Collez ici des logs que vous avez copiés')).toBeInTheDocument();
  });

  it('should send nothing before the user asks for the download', () => {
    // Act
    const { requests } = setup();

    // Assert
    expect(requests).toHaveLength(0);
  });
});
