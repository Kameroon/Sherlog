import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UrlSource } from '../src/ui/UrlSource';
import { fakeFetch, hangingFetch } from './helpers/fakeFetch';
import { streamOf } from './helpers/streams';

const HOST = 'sherlogjournaux.blob.core.windows.net';
const SECRET = 'SECRETSIG0123';
const sasUrl = `https://${HOST}/journaux/sample.log?sv=2022-11-02&sp=r&sig=${SECRET}`;
const ORIGIN = 'https://mango-plant-0313ba703.4.azurestaticapps.net';

const field = (): HTMLInputElement => screen.getByLabelText(/Adresse du fichier/);
const type = (value: string): void => {
  fireEvent.change(field(), { target: { value } });
};
const downloadButton = (): HTMLElement => screen.getByRole('button', { name: 'Télécharger et lire ce journal' });
const answer = (text: string, headers: Record<string, string> = {}) => new Response(streamOf([text]), { status: 200, headers });

function setup(answerWith: Parameters<typeof fakeFetch>[0] = () => answer('[08:00:00 INF] ok\n')) {
  const { fetchImpl, requests } = fakeFetch(answerWith);
  const onFile = vi.fn<(file: File) => void>();
  render(<UrlSource onFile={onFile} fetchImpl={fetchImpl} siteOrigin={ORIGIN} />);
  return { onFile, requests };
}

describe('URL source', () => {
  it('should ask for the address in a masked field that the browser does not fill in', () => {
    // Act
    setup();

    // Assert
    expect(field()).toHaveAttribute('type', 'password');
    expect(field()).toHaveAttribute('autocomplete', 'off');
  });

  it('should say which accounts are allowed and what the limit is', () => {
    // Act
    setup();

    // Assert
    expect(screen.getByText(new RegExp(`${HOST.replaceAll('.', '\\.')}.*256 Mio`))).toBeInTheDocument();
  });

  it('should advise a token that is read-only and short-lived, and say it is neither shown nor kept', () => {
    // Act
    setup();

    // Assert
    expect(screen.getByText(/lecture seule et de courte durée/)).toBeInTheDocument();
    expect(screen.getByText(/ni affiché, ni gardé/)).toBeInTheDocument();
  });

  it('should not offer to download until an address is typed', () => {
    // Act
    setup();

    // Assert
    expect(downloadButton()).toBeDisabled();
  });

  it('should send nothing while the address is typed', () => {
    // Arrange
    const { requests } = setup();

    // Act
    type(sasUrl);

    // Assert
    expect(downloadButton()).toBeEnabled();
    expect(requests).toHaveLength(0);
  });

  it('should hand over the file, named after the one in the address, once it is downloaded', async () => {
    // Arrange
    const { onFile } = setup();
    type(sasUrl);

    // Act
    fireEvent.click(downloadButton());

    // Assert
    await waitFor(() => {
      expect(onFile).toHaveBeenCalledTimes(1);
    });
    const file = onFile.mock.calls[0]?.[0];
    expect(file?.name).toBe('sample.log');
    expect(await file?.text()).toBe('[08:00:00 INF] ok\n');
  });

  it('should send one request, to the address as it was typed', async () => {
    // Arrange
    const { onFile, requests } = setup();
    type(sasUrl);

    // Act
    fireEvent.click(downloadButton());
    await waitFor(() => {
      expect(onFile).toHaveBeenCalled();
    });

    // Assert
    expect(requests.map((request) => request.url)).toEqual([sasUrl]);
  });

  it('should send the address that was checked, without the spaces around it nor its fragment', async () => {
    // Arrange
    const { onFile, requests } = setup();
    type(`  ${sasUrl}#section \n`);

    // Act
    fireEvent.click(downloadButton());
    await waitFor(() => {
      expect(onFile).toHaveBeenCalled();
    });

    // Assert
    expect(requests.map((request) => request.url)).toEqual([sasUrl]);
  });

  it('should empty the field, so that the token is not kept, once the file is handed over', async () => {
    // Arrange
    const { onFile } = setup();
    type(sasUrl);

    // Act
    fireEvent.click(downloadButton());
    await waitFor(() => {
      expect(onFile).toHaveBeenCalled();
    });

    // Assert
    expect(field()).toHaveValue('');
  });

  it('should show the host and the file while it downloads, never the address, and let the user cancel', async () => {
    // Arrange
    const { fetchImpl } = hangingFetch();
    render(<UrlSource onFile={vi.fn()} fetchImpl={fetchImpl} siteOrigin={ORIGIN} />);
    type(sasUrl);

    // Act
    fireEvent.click(downloadButton());

    // Assert
    expect(await screen.findByRole('status')).toHaveTextContent(`Téléchargement de sample.log depuis ${HOST}…`);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.getByRole('button', { name: 'Annuler le téléchargement' })).toBeEnabled();
    expect(field()).toBeDisabled();
    expect(downloadButton()).toBeDisabled();
  });

  it('should show a file name that holds markup as text, never as markup', async () => {
    // Arrange
    const { fetchImpl } = hangingFetch();
    const { container } = render(<UrlSource onFile={vi.fn()} fetchImpl={fetchImpl} siteOrigin={ORIGIN} />);
    type(`https://${HOST}/journaux/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E.log?sig=${SECRET}`);

    // Act
    fireEvent.click(downloadButton());

    // Assert
    expect(await screen.findByRole('status')).toHaveTextContent('<img src=x onerror=alert(1)>.log');
    expect(container.querySelector('img')).toBeNull();
  });

  it('should show how much has arrived against the size announced', async () => {
    // Arrange
    let release: () => void = () => undefined;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new Uint8Array(512 * 1024));
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        controller.close();
      },
    });
    const { fetchImpl } = fakeFetch(() => new Response(body, { status: 200, headers: { 'content-length': String(2 * 1024 * 1024) } }));
    render(<UrlSource onFile={vi.fn()} fetchImpl={fetchImpl} siteOrigin={ORIGIN} />);
    type(sasUrl);

    // Act
    fireEvent.click(downloadButton());

    // Assert
    expect(await screen.findByText('512 Kio sur 2 Mio')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Progression du téléchargement' })).toHaveAttribute('max', String(2 * 1024 * 1024));
    release();
  });

  it('should give up the download, say nothing, and keep the address for another try when the user cancels', async () => {
    // Arrange
    const { fetchImpl } = hangingFetch();
    const onFile = vi.fn();
    render(<UrlSource onFile={onFile} fetchImpl={fetchImpl} siteOrigin={ORIGIN} />);
    type(sasUrl);
    fireEvent.click(downloadButton());

    // Act
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler le téléchargement' }));

    // Assert
    await waitFor(() => {
      expect(downloadButton()).toBeEnabled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(field()).toHaveValue(sasUrl);
    expect(onFile).not.toHaveBeenCalled();
  });

  it('should give up a download that is going when the screen goes away', async () => {
    // Arrange
    const { fetchImpl, requests } = hangingFetch();
    const { unmount } = render(<UrlSource onFile={vi.fn()} fetchImpl={fetchImpl} siteOrigin={ORIGIN} />);
    type(sasUrl);
    fireEvent.click(downloadButton());
    await screen.findByRole('status');

    // Act
    unmount();

    // Assert
    expect(requests[0]?.init.signal?.aborted).toBe(true);
  });

  describe('an address that is refused', () => {
    it.each<[string, RegExp]>([
      ['not an address', /pas une adresse web valide/],
      [`http://${HOST}/journaux/a.log`, /commencer par https/],
      [`https://user@${HOST}/journaux/a.log`, /ni nom d’utilisateur ni mot de passe/],
      [`https://${HOST}:8443/journaux/a.log`, /pas préciser de port/],
      ['https://evil.example/journaux/a.log?sig=x', /compte de stockage n’est pas autorisé/],
      [`https://${HOST}/journaux?sig=x`, /désigner un fichier/],
    ])('should say why, and send nothing, for %s', (input, sentence) => {
      // Arrange
      const { requests } = setup();
      type(input);

      // Act
      fireEvent.click(downloadButton());

      // Assert
      expect(screen.getByRole('alert')).toHaveTextContent(sentence);
      expect(requests).toHaveLength(0);
    });

    it('should list the accounts that are allowed when the host is refused', () => {
      // Arrange
      setup();
      type('https://evil.example/journaux/a.log?sig=x');

      // Act
      fireEvent.click(downloadButton());

      // Assert
      expect(screen.getByRole('alert')).toHaveTextContent(`Comptes autorisés : ${HOST}`);
    });

    it('should not repeat the address in the message', () => {
      // Arrange
      setup();
      type(`http://evil.example/journaux/a.log?sig=${SECRET}`);

      // Act
      fireEvent.click(downloadButton());

      // Assert
      expect(document.body.textContent).not.toContain(SECRET);
      expect(document.body.textContent).not.toContain('evil.example');
    });

    it('should take the message away once the address is changed', () => {
      // Arrange
      setup();
      type('not an address');
      fireEvent.click(downloadButton());

      // Act
      type(sasUrl);

      // Assert
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('a download that fails', () => {
    it('should say the token is the problem when the storage refuses it, without showing the address', async () => {
      // Arrange
      const { onFile } = setup(() => new Response('<Error><Code>AuthenticationFailed</Code></Error>', { status: 403 }));
      type(sasUrl);

      // Act
      fireEvent.click(downloadButton());

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent(/jeton est invalide, expiré.*\(code 403\)/);
      expect(document.body.textContent).not.toContain(SECRET);
      expect(onFile).not.toHaveBeenCalled();
    });

    it('should tell the site to allow in the CORS rules when the storage cannot be reached', async () => {
      // Arrange
      setup(() => new TypeError(`Failed to fetch ${sasUrl}`));
      type(sasUrl);

      // Act
      fireEvent.click(downloadButton());

      // Assert
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(ORIGIN);
      expect(alert).toHaveTextContent('CORS');
      expect(document.body.textContent).not.toContain(SECRET);
    });

    it('should say the limit when the file is too large, and give nothing', async () => {
      // Arrange
      const { fetchImpl } = fakeFetch(() => answer('abcdef', { 'content-length': String(3 * 1024 * 1024) }));
      const onFile = vi.fn();
      render(<UrlSource onFile={onFile} fetchImpl={fetchImpl} siteOrigin={ORIGIN} maxBytes={1024 * 1024} />);
      type(sasUrl);

      // Act
      fireEvent.click(downloadButton());

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('3 Mio, au-delà de la limite de 1 Mio');
      expect(onFile).not.toHaveBeenCalled();
    });

    it('should say so, without the address, when something unforeseen breaks the download', async () => {
      // Arrange
      const broken = { ok: true, status: 200, headers: new Headers(), get body(): never { throw new Error(`broken ${sasUrl}`); } } as unknown as Response;
      const { onFile } = setup(() => broken);
      type(sasUrl);

      // Act
      fireEvent.click(downloadButton());

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('Erreur inattendue pendant le téléchargement.');
      expect(document.body.textContent).not.toContain(SECRET);
      expect(onFile).not.toHaveBeenCalled();
    });

    it('should keep the address, and allow another try, after a failure', async () => {
      // Arrange
      let attempt = 0;
      const { onFile } = setup(() => {
        attempt += 1;
        return attempt === 1 ? new Response('', { status: 503 }) : answer('[08:00:00 INF] ok\n');
      });
      type(sasUrl);
      fireEvent.click(downloadButton());
      await screen.findByRole('alert');

      // Act
      fireEvent.click(downloadButton());

      // Assert
      await waitFor(() => {
        expect(onFile).toHaveBeenCalledTimes(1);
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
