// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DownloadError } from '../src/sources/urlSource';
import type { DownloadFailureKind, UrlRefusal } from '../src/sources/urlSource';
import { downloadFailureMessage, refusalMessage } from '../src/ui/urlMessages';

const ORIGIN = 'https://mango-plant-0313ba703.4.azurestaticapps.net';
const HOSTS = ['sherlogjournaux.blob.core.windows.net'];
const REFUSALS: UrlRefusal[] = ['empty', 'malformed', 'not-https', 'credentials', 'port', 'host', 'no-file'];
const KINDS: DownloadFailureKind[] = ['unauthorized', 'forbidden', 'not-found', 'rejected', 'rate-limited', 'unavailable', 'network', 'timeout', 'interrupted', 'protocol', 'cancelled', 'too-large'];

describe('messages about an address that is refused', () => {
  it.each(REFUSALS)('should say something for the refusal %s', (reason) => {
    // Act & Assert
    expect(refusalMessage(reason, HOSTS).length).toBeGreaterThan(10);
  });

  it('should give a different sentence for each refusal, since each asks the user for something else', () => {
    // Act
    const sentences = new Set(REFUSALS.map((reason) => refusalMessage(reason, HOSTS)));

    // Assert
    expect(sentences.size).toBe(REFUSALS.length);
  });

  it('should list the accounts that are allowed when the host is refused', () => {
    // Act & Assert
    expect(refusalMessage('host', ['a.blob.core.windows.net', 'b.blob.core.windows.net'])).toContain('a.blob.core.windows.net, b.blob.core.windows.net');
  });

  it('should say that the address has to start with https when it does not', () => {
    // Act & Assert
    expect(refusalMessage('not-https', HOSTS)).toContain('https://');
  });
});

describe('messages about a download that failed', () => {
  const context = { siteOrigin: ORIGIN };

  it.each(KINDS)('should say something for the failure %s', (kind) => {
    // Act & Assert
    expect(downloadFailureMessage(new DownloadError(kind), context).length).toBeGreaterThan(5);
  });

  it.each<[DownloadFailureKind, number]>([
    ['unauthorized', 401],
    ['forbidden', 403],
  ])('should say the access token is the problem, with the code, when the storage answers %s', (kind, status) => {
    // Act
    const message = downloadFailureMessage(new DownloadError(kind, { status }), context);

    // Assert
    expect(message).toContain('jeton');
    expect(message).toContain(`code ${status}`);
  });

  it('should say which file is not found without quoting the address', () => {
    // Act
    const message = downloadFailureMessage(new DownloadError('not-found', { status: 404 }), context);

    // Assert
    expect(message).toContain('nom du conteneur et du fichier');
  });

  it('should tell what to allow in the CORS rules, and for which site, when the storage cannot be reached', () => {
    // Act
    const message = downloadFailureMessage(new DownloadError('network'), context);

    // Assert
    expect(message).toContain(ORIGIN);
    expect(message).toContain('CORS');
    expect(message).toContain('GET, HEAD et OPTIONS');
  });

  it('should give the size and the limit when a file was refused before it was downloaded', () => {
    // Act
    const message = downloadFailureMessage(new DownloadError('too-large', { announcedBytes: 300 * 1024 * 1024, limitBytes: 256 * 1024 * 1024 }), context);

    // Assert
    expect(message).toContain('300 Mio');
    expect(message).toContain('256 Mio');
    expect(message).toContain('pas été téléchargé');
  });

  it('should give the limit, and say it was stopped, when a file turned out too large on the way', () => {
    // Act
    const message = downloadFailureMessage(new DownloadError('too-large', { limitBytes: 256 * 1024 * 1024 }), context);

    // Assert
    expect(message).toContain('arrêté');
    expect(message).toContain('256 Mio');
  });

  it('should say nothing is kept when the download broke off', () => {
    // Act & Assert
    expect(downloadFailureMessage(new DownloadError('interrupted'), context)).toContain('rien n’a été gardé');
  });

  it('should show the code of a refusal that has no sentence of its own', () => {
    // Act & Assert
    expect(downloadFailureMessage(new DownloadError('rejected', { status: 416 }), context)).toContain('code 416');
  });
});
