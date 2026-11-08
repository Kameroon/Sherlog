// Writes a synthetic Serilog file of about `megabytes` MiB and returns what a correct scan must find in it, including how many entries mention `/health`.
// Synthetic on purpose: nothing here comes from a real application. Deterministic, so the expected counts are exact.
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';

const ERROR_EVERY = 20;

/**
 * @param {string} path - File to write.
 * @param {number} megabytes - Approximate size.
 * @param {'mixed' | 'errors'} [kind] - `mixed`: one entry in twenty is an error with a stack. `errors`: every entry is a one-line error.
 * @returns {Promise<{ bytes: number, entries: number, errors: number, distinct: number, health: number }>}
 */
export async function generateLog(path, megabytes, kind = 'mixed') {
  const target = megabytes * 1024 * 1024;
  const stream = createWriteStream(path);

  let seed = 12345;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  let second = 0;
  const stamp = () => {
    second += 1;
    const [s, m, h] = [second % 60, Math.floor(second / 60) % 60, Math.floor(second / 3600) % 24];
    return `2026-11-04 ${pad(h)}:${pad(m)}:${pad(s)}.${pad(Math.floor(random() * 1000), 3)} +01:00`;
  };

  // Messages that differ only by numbers, ids, addresses: each of the six errors is one fingerprint.
  const infoMessages = [
    () => `Request finished HTTP/1.1 GET http://localhost:8080/api/orders/${Math.floor(random() * 99999)} - 200 null application/json; charset=utf-8 ${(random() * 50).toFixed(4)}ms`,
    () => `Executed endpoint 'HTTP: GET /health'`,
    () => `Resolved ${Math.floor(random() * 9)} handlers for request GetProduct`,
  ];
  const errorMessages = [
    () => `Timeout after ${Math.floor(random() * 40000)} ms while calling PaymentGateway for order ${Math.floor(random() * 99999)}`,
    () => `Unhandled exception while processing request GET /api/customers/${crypto.randomUUID()}`,
    () => `Failed to send email to user${Math.floor(random() * 9999)}@example.com: SMTP server returned 550`,
    () => `Database update failed for order ${Math.floor(random() * 99999)}`,
    () => `Connection to 10.0.${Math.floor(random() * 255)}.${Math.floor(random() * 255)}:5432 refused`,
    () => `Background job SyncCatalog failed after ${Math.floor(random() * 5)} attempts`,
  ];
  const stack = ['System.TimeoutException: The operation has timed out.']
    .concat(Array.from({ length: 6 }, (_, i) => `   at Shop.Layer${i}.Service${i}.Run${i}(Order order) in /src/Shop/Layer${i}/Service${i}.cs:line ${10 + i * 7}`))
    .join('\n');

  let bytes = 0;
  let entries = 0;
  let errors = 0;
  let health = 0;
  while (bytes < target) {
    let block = '';
    for (let i = 0; i < 2000 && bytes < target; i += 1, entries += 1) {
      const isError = kind === 'errors' || entries % ERROR_EVERY === 0;
      const text = isError
        ? `${stamp()} [ERR] ${errorMessages[errors % errorMessages.length]()}\n${kind === 'errors' ? '' : `${stack}\n`}`
        : `${stamp()} [INF] ${infoMessages[entries % infoMessages.length]()}\n`;
      errors += isError ? 1 : 0;
      health += text.includes('/health') ? 1 : 0;
      block += text;
      bytes += Buffer.byteLength(text);
    }
    if (!stream.write(block)) {
      await once(stream, 'drain');
    }
  }
  stream.end();
  await once(stream, 'finish');
  return { bytes, entries, errors, distinct: Math.min(errors, errorMessages.length), health };
}
