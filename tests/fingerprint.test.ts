// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { firstApplicationFrame, fingerprint, MAX_MESSAGE_KEY_CHARS, normalizeMessage } from '../src/core/fingerprint';
import { createCustomProfile, DEFAULT_PROFILE } from '../src/core/profiles';
import type { LogProfile } from '../src/core/profiles';
import { errorEntries, parseBytes } from './helpers/parseLog';

describe('normalizeMessage', () => {
  const volatileValues: [string, string, string][] = [
    [
      'numbers',
      'Timeout after 30012 ms while calling PaymentGateway for order 8841',
      'Timeout after <n> ms while calling PaymentGateway for order <n>',
    ],
    ['decimal numbers', 'Disk usage at 87.5%', 'Disk usage at <n>%'],
    [
      'GUIDs in any case',
      'Unhandled exception while processing request GET /api/customers/7F3C9A52-1b6e-4A0D-9b8e-2d5c1a6e44f1',
      'Unhandled exception while processing request GET /api/customers/<guid>',
    ],
    ['ISO timestamps with an offset', 'Job started at 2026-11-04 08:01:10.123 +01:00 and failed', 'Job started at <time> and failed'],
    ['ISO timestamps in UTC', 'Deadline 2026-11-04T08:01:10Z passed', 'Deadline <time> passed'],
    ['times without a date', 'Lock held since 08:01:10', 'Lock held since <time>'],
    ['dates without a time', 'Expired on 2026-11-04', 'Expired on <time>'],
    [
      'e-mail addresses',
      'Failed to send email to john.doe@example.com: SMTP server returned 550',
      'Failed to send email to <email>: SMTP server returned <n>',
    ],
    ['IPv4 addresses and their port', 'Connection to 10.0.4.17:5432 refused', 'Connection to <ip>:<n> refused'],
    ['URLs', 'Call to https://api.example.com/v1/orders?id=42 failed', 'Call to <url> failed'],
    ['alphanumeric identifiers with digits', 'Duplicate key ORD-2026-7710 rejected', 'Duplicate key <id> rejected'],
    ['identifiers made of letters and digits', 'Order ord_ab12 is missing', 'Order <id> is missing'],
    ['Unix temporary paths', 'Cannot write /tmp/upload-4412.bin now', 'Cannot write <tmp> now'],
    ['Unix variable temporary paths', 'Cannot write /var/tmp/cache/a.bin now', 'Cannot write <tmp> now'],
    [
      'Windows user temporary paths',
      String.raw`Cannot write C:\Users\alice\AppData\Local\Temp\upload.tmp now`,
      'Cannot write <tmp> now',
    ],
    ['Windows system temporary paths', String.raw`Cannot write C:\Windows\Temp\x.log now`, 'Cannot write <tmp> now'],
    ['memory addresses', 'Access violation at 0x7FFD1A2B3C4D', 'Access violation at <addr>'],
  ];

  it.each(volatileValues)('should replace %s with a placeholder', (_label, message, expected) => {
    // Act
    const result = normalizeMessage(message);

    // Assert
    expect(result).toBe(expected);
  });

  const stableValues: [string, string][] = [
    ['plain words', 'Unable to connect to database'],
    ['digits glued to letters in a type name', 'Cannot cast the value to Int32'],
    ['hyphenated words without digits', 'Content-Type header is missing'],
    ['paths that are not temporary', 'Cannot read /api/template/list'],
  ];

  it.each(stableValues)('should keep %s unchanged', (_label, message) => {
    // Act
    const result = normalizeMessage(message);

    // Assert
    expect(result).toBe(message);
  });

  // Log lines are untrusted and may be about 1 MiB: none of the rules may take quadratic time on them.
  const hostileInputs: [string, string][] = [
    ['a single long word', 'x'.repeat(1_000_000)],
    ['a long chain of hyphenated words', 'a-'.repeat(500_000)],
    ['a long path', '/a'.repeat(500_000)],
    ['a long chain of dotted numbers', '1.'.repeat(500_000)],
    ['a long e-mail-like prefix without at sign', 'a.'.repeat(500_000)],
    ['a long run of URL schemes', 'http://'.repeat(100_000)],
  ];

  it.each(hostileInputs)('should finish quickly when the message is %s', (_label, message) => {
    // Arrange
    const start = performance.now();

    // Act
    normalizeMessage(message);

    // Assert
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('firstApplicationFrame', () => {
  const libraryPrefixes = ['System.', 'Microsoft.'];

  it('should skip the library frames and drop the source location when an application frame follows', () => {
    // Arrange
    const text = [
      '[ERR] Failed',
      'System.TimeoutException: The operation has timed out.',
      '   at System.Net.Http.HttpClient.Send(HttpRequestMessage request)',
      '   at Microsoft.AspNetCore.Routing.EndpointMiddleware.Invoke(HttpContext httpContext)',
      '   at Shop.Orders.OrderService.CheckoutAsync(Int32 orderId) in /src/Shop/Orders/OrderService.cs:line 142',
      '   at Shop.Api.Program.Main(String[] args) in /src/Shop.Api/Program.cs:line 24',
    ].join('\n');

    // Act
    const frame = firstApplicationFrame(text, libraryPrefixes);

    // Assert
    expect(frame).toBe('Shop.Orders.OrderService.CheckoutAsync(Int32 orderId)');
  });

  it('should return the first frame when every frame is library code', () => {
    // Arrange
    const text = ['[ERR] Failed', '   at System.A.B()', '   at Microsoft.C.D()'].join('\n');

    // Act
    const frame = firstApplicationFrame(text, libraryPrefixes);

    // Assert
    expect(frame).toBe('System.A.B()');
  });

  it('should return the first frame when the profile declares no library prefix', () => {
    // Arrange
    const text = ['[ERR] Failed', '   at System.A.B()', '   at Shop.C.D()'].join('\n');

    // Act
    const frame = firstApplicationFrame(text, []);

    // Assert
    expect(frame).toBe('System.A.B()');
  });

  it('should read a frame written with the Java syntax when it is indented with a tab', () => {
    // Arrange
    const text = ['ERROR Failed', '\tat com.shop.Orders.get(Orders.java:42)'].join('\n');

    // Act
    const frame = firstApplicationFrame(text, []);

    // Assert
    expect(frame).toBe('com.shop.Orders.get(Orders.java:42)');
  });

  it('should return null when the entry has no stack', () => {
    // Act
    const frame = firstApplicationFrame('[ERR] Failed to send email', libraryPrefixes);

    // Assert
    expect(frame).toBeNull();
  });

  it('should not take a message line that merely starts with "at" for a frame', () => {
    // Arrange
    const text = ['[ERR] Import failed', '   at least 3 rows were rejected', '   at Shop.Import.CsvReader.Parse(String line)'].join('\n');

    // Act
    const frame = firstApplicationFrame(text, libraryPrefixes);

    // Assert
    expect(frame).toBe('Shop.Import.CsvReader.Parse(String line)');
  });

  it('should not read the header line as a frame', () => {
    // Act
    const frame = firstApplicationFrame('   at Shop.A.B() looks like a frame but is the header', libraryPrefixes);

    // Assert
    expect(frame).toBeNull();
  });
});

describe('fingerprint', () => {
  const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

  function fingerprintsOf(lines: readonly string[], profile: LogProfile = DEFAULT_PROFILE): string[] {
    const { entries } = parseBytes(utf8(lines.join('\n')), undefined, profile);
    return errorEntries(entries).map((entry) => fingerprint(entry, profile));
  }

  const header = (time: string, level: string, message: string) => `2026-11-04 ${time}.000 +01:00 [${level}] ${message}`;

  it('should join the level, the normalised message and the first application frame with line breaks', () => {
    // Act
    const [key] = fingerprintsOf([
      header('08:16:10', 'ERR', 'Timeout after 30012 ms'),
      'System.TimeoutException: The operation has timed out.',
      '   at Shop.Payments.GatewayClient.ChargeAsync(Order order) in /src/GatewayClient.cs:line 87',
    ]);

    // Assert
    expect(key).toBe('ERR\nTimeout after <n> ms\nShop.Payments.GatewayClient.ChargeAsync(Order order)');
  });

  it('should end with an empty frame when the entry has no stack', () => {
    // Act
    const [key] = fingerprintsOf([header('08:16:10', 'ERR', 'Disk full')]);

    // Assert
    expect(key).toBe('ERR\nDisk full\n');
  });

  it('should give the same fingerprint when two entries differ only by timestamps, numbers and source line numbers', () => {
    // Act
    const [first, second] = fingerprintsOf([
      header('08:16:10', 'ERR', 'Timeout after 30012 ms for order 8841'),
      '   at Shop.Payments.GatewayClient.ChargeAsync(Order order) in /src/GatewayClient.cs:line 87',
      header('09:40:55', 'ERR', 'Timeout after 29977 ms for order 9120'),
      '   at Shop.Payments.GatewayClient.ChargeAsync(Order order) in /src/GatewayClient.cs:line 91',
    ]);

    // Assert
    expect(second).toBe(first);
  });

  it('should give different fingerprints when the level differs', () => {
    // Act
    const [error, fatal] = fingerprintsOf([header('08:16:10', 'ERR', 'Disk full'), header('08:16:11', 'FTL', 'Disk full')]);

    // Assert
    expect(fatal).not.toBe(error);
  });

  it('should give the same fingerprint when the level differs only by case', () => {
    // Act
    const [upper, lower] = fingerprintsOf([header('08:16:10', 'ERR', 'Disk full'), header('08:16:11', 'err', 'Disk full')]);

    // Assert
    expect(lower).toBe(upper);
  });

  it('should give different fingerprints when the first application frame differs', () => {
    // Act
    const [first, second] = fingerprintsOf([
      header('08:16:10', 'ERR', 'Unhandled exception'),
      '   at Shop.Orders.OrdersController.Get(Guid id)',
      header('08:16:11', 'ERR', 'Unhandled exception'),
      '   at Shop.Customers.CustomerController.Get(Guid id)',
    ]);

    // Assert
    expect(second).not.toBe(first);
  });

  it('should give the same fingerprint when only the library frames in front of the application frame differ', () => {
    // Act
    const [first, second] = fingerprintsOf([
      header('08:16:10', 'ERR', 'Unhandled exception'),
      '   at System.Threading.Tasks.Task.Wait()',
      '   at Shop.Orders.OrdersController.Get(Guid id)',
      header('08:16:11', 'ERR', 'Unhandled exception'),
      '   at Microsoft.AspNetCore.Routing.EndpointMiddleware.Invoke(HttpContext httpContext)',
      '   at Shop.Orders.OrdersController.Get(Guid id)',
    ]);

    // Assert
    expect(second).toBe(first);
  });

  it('should keep the key short when the message is far longer than the limit', () => {
    // Act
    const [key] = fingerprintsOf([header('08:16:10', 'ERR', 'x'.repeat(1024 * 1024))]);

    // Assert
    expect(key).toBe(`ERR\n${'x'.repeat(MAX_MESSAGE_KEY_CHARS)}\n`);
  });

  it('should give the same fingerprint when two messages differ only after the limit', () => {
    // Arrange
    const common = 'y'.repeat(MAX_MESSAGE_KEY_CHARS);

    // Act
    const [first, second] = fingerprintsOf([header('08:16:10', 'ERR', `${common} alpha`), header('08:16:11', 'ERR', `${common} beta`)]);

    // Assert
    expect(second).toBe(first);
  });

  it('should give different fingerprints when two long messages differ before the limit', () => {
    // Arrange
    const tail = 'z'.repeat(MAX_MESSAGE_KEY_CHARS);

    // Act
    const [first, second] = fingerprintsOf([header('08:16:10', 'ERR', `alpha ${tail}`), header('08:16:11', 'ERR', `beta ${tail}`)]);

    // Assert
    expect(second).not.toBe(first);
  });

  it('should keep the header text of the first line when the profile has no message group', () => {
    // Arrange
    const result = createCustomProfile(String.raw`^(?<level>[A-Z]{3}): `);
    if (result.status !== 'ok') {
      throw new Error(result.reason);
    }

    // Act
    const [first, second, other] = fingerprintsOf(['ERR: Timeout after 12 ms', 'ERR: Timeout after 13 ms', 'ERR: Disk full'], result.profile);

    // Assert
    expect({ sameWhenNumbersDiffer: second === first, differentMessage: other !== first }).toEqual({
      sameWhenNumbersDiffer: true,
      differentMessage: true,
    });
  });
});
