// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ALLOWED_STORAGE_HOSTS, DownloadError, MAX_DOWNLOAD_BYTES, checkSourceUrl, downloadLog } from '../src/sources/urlSource';
import type { DownloadFailureKind } from '../src/sources/urlSource';
import { fakeFetch, hangingFetch } from './helpers/fakeFetch';
import { streamOf } from './helpers/streams';

const HOST = 'sherlogjournaux.blob.core.windows.net';
const SECRET = 'SECRETSIG0123';
const sasUrl = `https://${HOST}/journaux/sample.log?sv=2022-11-02&sp=r&sig=${SECRET}`;
const text = (blob: Blob): Promise<string> => blob.text();

describe('allowed storage accounts', () => {
  it('should hold the exact host of the account of the author and no wildcard', () => {
    // Act & Assert
    expect(ALLOWED_STORAGE_HOSTS).toEqual([HOST]);
  });
});

describe('checking the address of a source', () => {
  it('should accept the address of a file of an allowed account, with its access token', () => {
    // Act
    const checked = checkSourceUrl(sasUrl);

    // Assert
    expect(checked).toEqual({ ok: true, url: sasUrl, host: HOST, name: 'sample.log' });
  });

  it('should accept the host whatever its case, and a default port written out', () => {
    // Act
    const checked = checkSourceUrl(`HTTPS://SherlogJournaux.Blob.Core.Windows.NET:443/journaux/a.log?sig=x`);

    // Assert
    expect(checked).toMatchObject({ ok: true, host: HOST });
  });

  it('should ignore the spaces around the address', () => {
    // Act & Assert
    expect(checkSourceUrl(`  ${sasUrl}\n`)).toMatchObject({ ok: true, url: sasUrl });
  });

  it('should not keep the fragment, which is not part of what is requested', () => {
    // Act
    const checked = checkSourceUrl(`${sasUrl}#section`);

    // Assert
    expect(checked).toMatchObject({ ok: true, url: sasUrl });
  });

  it.each(['', '   ', '\n'])('should say it is empty when nothing but spaces was given (%j)', (input) => {
    // Act & Assert
    expect(checkSourceUrl(input)).toEqual({ ok: false, reason: 'empty' });
  });

  it.each(['not an address', 'sherlogjournaux.blob.core.windows.net/journaux/a.log', 'https://', '://x'])('should refuse what is not an address (%s)', (input) => {
    // Act & Assert
    expect(checkSourceUrl(input)).toEqual({ ok: false, reason: 'malformed' });
  });

  it.each([
    `http://${HOST}/journaux/a.log?sig=x`,
    `ftp://${HOST}/journaux/a.log`,
    'javascript:alert(1)',
    'data:text/plain,hello',
    `blob:https://${HOST}/0b3c`,
    `wss://${HOST}/journaux/a.log`,
  ])('should refuse any address that is not https (%s)', (input) => {
    // Act & Assert
    expect(checkSourceUrl(input)).toEqual({ ok: false, reason: 'not-https' });
  });

  it.each([
    `https://user@${HOST}/journaux/a.log`,
    `https://user:password@${HOST}/journaux/a.log`,
    `https://:password@${HOST}/journaux/a.log`,
    // The classic trick: the allowed name before the `@` is only the user name, the host is the other.
    `https://${HOST}@evil.example/journaux/a.log`,
    `https://evil.example@${HOST}/journaux/a.log`,
  ])('should refuse an address that carries credentials, whatever follows (%s)', (input) => {
    // Act & Assert
    expect(checkSourceUrl(input)).toEqual({ ok: false, reason: 'credentials' });
  });

  it.each([`https://${HOST}:8443/journaux/a.log`, `https://${HOST}:80/journaux/a.log`, `https://${HOST}:0/journaux/a.log`])('should refuse a port that is not the default one (%s)', (input) => {
    // Act & Assert
    expect(checkSourceUrl(input)).toEqual({ ok: false, reason: 'port' });
  });

  it.each([
    'https://evil.blob.core.windows.net/journaux/a.log',
    `https://${HOST}.evil.example/journaux/a.log`,
    `https://evil${HOST}/journaux/a.log`,
    `https://x.${HOST}/journaux/a.log`,
    'https://sherlogjournaux.dfs.core.windows.net/journaux/a.log',
    'https://sherlogjournaux.file.core.windows.net/journaux/a.log',
    'https://20.50.1.1/journaux/a.log',
    'https://[::1]/journaux/a.log',
    'https://localhost/journaux/a.log',
    `https://${HOST}./journaux/a.log`,
    // Letters that look like Latin ones, in an address that looks like the allowed one.
    'https://sherlogjournaux.blob.core.windоws.net/journaux/a.log',
  ])('should refuse a host that is not exactly an allowed one (%s)', (input) => {
    // Act & Assert
    expect(checkSourceUrl(input)).toEqual({ ok: false, reason: 'host' });
  });

  it('should only accept the hosts of the list it is given', () => {
    // Arrange
    const other = 'https://autrecompte.blob.core.windows.net/journaux/a.log?sig=x';

    // Act & Assert
    expect(checkSourceUrl(other, ['autrecompte.blob.core.windows.net'])).toMatchObject({ ok: true, host: 'autrecompte.blob.core.windows.net' });
    expect(checkSourceUrl(sasUrl, ['autrecompte.blob.core.windows.net'])).toEqual({ ok: false, reason: 'host' });
  });

  it.each([`https://${HOST}`, `https://${HOST}/`, `https://${HOST}/journaux?restype=container&comp=list&sig=x`, `https://${HOST}/journaux/`, `https://${HOST}/journaux/dossier/`])(
    'should refuse an address that does not name a file, only an account or a container (%s)',
    (input) => {
      // Act & Assert
      expect(checkSourceUrl(input)).toEqual({ ok: false, reason: 'no-file' });
    },
  );

  it('should name the source after the file, decoded', () => {
    // Act
    const checked = checkSourceUrl(`https://${HOST}/journaux/2026/mon%20journal%20%C3%A9t%C3%A9.log?sig=x`);

    // Assert
    expect(checked).toMatchObject({ ok: true, name: 'mon journal été.log' });
  });

  it('should keep the file name as it is when it is not valid once decoded', () => {
    // Act
    const checked = checkSourceUrl(`https://${HOST}/journaux/a%E0%A4%A.log?sig=x`);

    // Assert
    expect(checked).toMatchObject({ ok: true, name: 'a%E0%A4%A.log' });
  });

  it('should take control characters out of the name and keep it short', () => {
    // Act
    const checked = checkSourceUrl(`https://${HOST}/journaux/a%00b%0Ac${'x'.repeat(300)}.log`);

    // Assert
    expect(checked.ok && checked.name).toBe(`abc${'x'.repeat(197)}`);
  });

  it('should never give back anything of the address in a refusal', () => {
    // Act
    const refused = checkSourceUrl(`https://evil.example/journaux/a.log?sig=${SECRET}`);

    // Assert
    expect(JSON.stringify(refused)).not.toContain(SECRET);
  });
});

describe('downloading a log', () => {
  const answerWith = (chunks: readonly (string | Uint8Array)[], headers: Record<string, string> = {}) => new Response(streamOf(chunks), { status: 200, headers });

  it('should give the bytes of the file as a Blob, in order', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => answerWith(['[08:00:00 INF] un\n', '[08:00:01 ERR] deux\n']));

    // Act
    const blob = await downloadLog({ url: sasUrl, fetchImpl });

    // Assert
    expect(await text(blob)).toBe('[08:00:00 INF] un\n[08:00:01 ERR] deux\n');
  });

  it('should send one GET request to the address, with no cookie, no referrer, no cache and no redirection', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(() => answerWith(['x']));

    // Act
    await downloadLog({ url: sasUrl, fetchImpl });

    // Assert
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(sasUrl);
    expect(requests[0]?.init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' });
  });

  it('should send no header of its own, so that the storage has nothing to be asked about by the browser', async () => {
    // Arrange
    const { fetchImpl, requests } = fakeFetch(() => answerWith(['x']));

    // Act
    await downloadLog({ url: sasUrl, fetchImpl });

    // Assert
    expect(requests[0]?.init.headers).toEqual({});
  });

  it('should give a file of zero bytes as an empty Blob', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => answerWith([]));

    // Act
    const blob = await downloadLog({ url: sasUrl, fetchImpl });

    // Assert
    expect(blob.size).toBe(0);
  });

  it('should report the progress against the size the storage announced', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => answerWith(['abcd', 'efgh', 'ij'], { 'content-length': '10' }));
    const seen: Array<[number, number | null]> = [];

    // Act
    await downloadLog({ url: sasUrl, fetchImpl, onProgress: (received, total) => seen.push([received, total]) });

    // Assert
    expect(seen).toEqual([
      [4, 10],
      [8, 10],
      [10, 10],
    ]);
  });

  it('should report no total when the storage announced no size', async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => answerWith(['abc']));
    const seen: Array<[number, number | null]> = [];

    // Act
    await downloadLog({ url: sasUrl, fetchImpl, onProgress: (received, total) => seen.push([received, total]) });

    // Assert
    expect(seen).toEqual([[3, null]]);
  });

  it.each(['abc', '-1', '1.5', '1.0', '', '1e3', '0x10'])('should not trust an announced size that is not a whole number of bytes (%j)', async (announced) => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => answerWith(['abc'], { 'content-length': announced }));
    const seen: Array<number | null> = [];

    // Act
    await downloadLog({ url: sasUrl, fetchImpl, onProgress: (_received, total) => seen.push(total) });

    // Assert
    expect(seen).toEqual([null]);
  });

  describe('limit of size', () => {
    it('should accept a file of exactly the limit', async () => {
      // Arrange
      const { fetchImpl } = fakeFetch(() => answerWith(['abcde'], { 'content-length': '5' }));

      // Act
      const blob = await downloadLog({ url: sasUrl, fetchImpl, maxBytes: 5 });

      // Assert
      expect(blob.size).toBe(5);
    });

    it('should apply the limit of the application when none is given', async () => {
      // Arrange
      const { fetchImpl } = fakeFetch(() => answerWith(['x'], { 'content-length': String(MAX_DOWNLOAD_BYTES + 1) }));

      // Act
      const failure = await downloadLog({ url: sasUrl, fetchImpl }).catch((error: unknown) => error);

      // Assert
      expect(failure).toMatchObject({ kind: 'too-large', announcedBytes: MAX_DOWNLOAD_BYTES + 1, limitBytes: MAX_DOWNLOAD_BYTES });
    });

    it('should refuse, before reading anything, a file that is announced larger than the limit', async () => {
      // Arrange
      let cancelled = false;
      let pulled = false;
      // A queue of size zero: nothing is asked of the source until somebody reads.
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            pulled = true;
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      const { fetchImpl } = fakeFetch(() => new Response(body, { status: 200, headers: { 'content-length': '6' } }));

      // Act
      const failure = await downloadLog({ url: sasUrl, fetchImpl, maxBytes: 5 }).catch((error: unknown) => error);

      // Assert
      expect(failure).toBeInstanceOf(DownloadError);
      expect(failure).toMatchObject({ kind: 'too-large', announcedBytes: 6, limitBytes: 5 });
      expect(cancelled).toBe(true);
      expect(pulled).toBe(false);
    });

    it('should stop as soon as more than the limit has arrived when no size was announced, and give nothing', async () => {
      // Arrange
      const { fetchImpl } = fakeFetch(() => answerWith(['abc', 'def', 'ghi']));

      // Act
      const failure = await downloadLog({ url: sasUrl, fetchImpl, maxBytes: 5 }).catch((error: unknown) => error);

      // Assert
      expect(failure).toMatchObject({ kind: 'too-large', announcedBytes: undefined, limitBytes: 5 });
    });

    it('should stop when the file is larger than the storage said, and cancel what was left to read', async () => {
      // Arrange
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('abcdefgh'));
        },
        cancel() {
          cancelled = true;
        },
      });
      const { fetchImpl } = fakeFetch(() => new Response(body, { status: 200, headers: { 'content-length': '3' } }));

      // Act
      const failure = await downloadLog({ url: sasUrl, fetchImpl, maxBytes: 5 }).catch((error: unknown) => error);

      // Assert
      expect(failure).toMatchObject({ kind: 'too-large' });
      expect(cancelled).toBe(true);
    });
  });

  describe('failures', () => {
    it.each<[number, DownloadFailureKind]>([
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not-found'],
      [400, 'rejected'],
      [416, 'rejected'],
      [429, 'rate-limited'],
      [500, 'unavailable'],
      [503, 'unavailable'],
    ])('should fail with the kind of the status when the storage answers %i', async (status, kind) => {
      // Arrange
      const { fetchImpl } = fakeFetch(() => new Response('<Error><Code>AuthenticationFailed</Code></Error>', { status }));

      // Act
      const failure = await downloadLog({ url: sasUrl, fetchImpl }).catch((error: unknown) => error);

      // Assert
      expect(failure).toBeInstanceOf(DownloadError);
      expect(failure).toMatchObject({ kind, status });
    });

    it('should fail as unreachable when the browser could not make the request (offline, blocked, or refused by CORS)', async () => {
      // Arrange
      const { fetchImpl } = fakeFetch(() => new TypeError('Failed to fetch'));

      // Act
      const failure = await downloadLog({ url: sasUrl, fetchImpl }).catch((error: unknown) => error);

      // Assert
      expect(failure).toMatchObject({ kind: 'network' });
    });

    it('should fail as timed out when the storage does not start to answer', async () => {
      // Arrange
      const { fetchImpl } = hangingFetch();

      // Act
      const failure = await downloadLog({ url: sasUrl, fetchImpl, headersTimeoutMs: 20 }).catch((error: unknown) => error);

      // Assert
      expect(failure).toMatchObject({ kind: 'timeout' });
    });

    it('should fail as interrupted, and give nothing, when the file breaks off', async () => {
      // Arrange
      const { fetchImpl } = fakeFetch(() => new Response(streamOf(['abc'], new TypeError('network error')), { status: 200 }));

      // Act
      const failure = await downloadLog({ url: sasUrl, fetchImpl }).catch((error: unknown) => error);

      // Assert
      expect(failure).toMatchObject({ kind: 'interrupted' });
    });

    it('should fail as cancelled, without a request, when it is already cancelled', async () => {
      // Arrange
      const { fetchImpl, requests } = fakeFetch(() => answerWith(['x']));
      const controller = new AbortController();
      controller.abort();

      // Act
      const failure = await downloadLog({ url: sasUrl, fetchImpl, signal: controller.signal }).catch((error: unknown) => error);

      // Assert
      expect(failure).toMatchObject({ kind: 'cancelled' });
      expect(requests).toHaveLength(0);
    });

    it('should fail as cancelled, and stop reading, when it is cancelled while the file arrives', async () => {
      // Arrange
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('abc'));
        },
        cancel() {
          cancelled = true;
        },
      });
      const { fetchImpl } = fakeFetch(() => new Response(body, { status: 200 }));
      const controller = new AbortController();

      // Act
      const failure = await downloadLog({ url: sasUrl, fetchImpl, signal: controller.signal, onProgress: () => controller.abort() }).catch((error: unknown) => error);

      // Assert
      expect(failure).toMatchObject({ kind: 'cancelled' });
      expect(cancelled).toBe(true);
    });

    it('should fail as cancelled when it is cancelled while the file is awaited', async () => {
      // Arrange
      const body = new ReadableStream<Uint8Array>({ start() {} });
      const { fetchImpl } = fakeFetch(() => new Response(body, { status: 200 }));
      const controller = new AbortController();

      // Act
      const pending = downloadLog({ url: sasUrl, fetchImpl, signal: controller.signal }).catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();

      // Assert
      expect(await pending).toMatchObject({ kind: 'cancelled' });
    });

    it.each<[string, () => Response | Error]>([
      ['a refused access', () => new Response('<Error>denied</Error>', { status: 403 })],
      ['an unreachable storage', () => new TypeError(`Failed to fetch ${sasUrl}`)],
      ['a file that is too large', () => new Response(streamOf(['abcdef']), { status: 200, headers: { 'content-length': '6' } })],
      ['a broken file', () => new Response(streamOf(['abc'], new TypeError(`broken ${sasUrl}`)), { status: 200 })],
    ])('should keep nothing of the address, token included, in the failure of %s', async (_name, answer) => {
      // Arrange
      const { fetchImpl } = fakeFetch(answer);

      // Act
      const failure = (await downloadLog({ url: sasUrl, fetchImpl, maxBytes: 5 }).catch((error: unknown) => error)) as Error;

      // Assert
      expect(JSON.stringify({ ...failure, message: failure.message, stack: undefined })).not.toContain(SECRET);
      expect(failure.message).not.toContain(HOST);
    });
  });
});
