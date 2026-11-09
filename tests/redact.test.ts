// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENABLED_RULES, REDACTION_RULES, countOccurrences, redact, rulesForSending } from '../src/core/redact';
import type { RedactionRuleId } from '../src/core/redact';
import { readSample } from './helpers/samples';

const only = (...ids: RedactionRuleId[]): ReadonlySet<RedactionRuleId> => new Set(ids);
const mask = (text: string, ...ids: RedactionRuleId[]): string => redact(text, only(...ids)).text;
const ALL = only('email', 'secret', 'ip', 'card', 'guid', 'urlHost');

describe('redact e-mail addresses', () => {
  it('should replace an address and keep the text around it', () => {
    // Act
    const text = mask('Failed to send email to john.doe@example.com: SMTP server returned 550', 'email');

    // Assert
    expect(text).toBe('Failed to send email to [EMAIL]: SMTP server returned 550');
  });

  it('should replace every address, with a plus tag and capitals', () => {
    // Act
    const text = mask('from Alice+tag@Mail.Example.ORG to bob_1@sub.example.co.uk', 'email');

    // Assert
    expect(text).toBe('from [EMAIL] to [EMAIL]');
  });

  it.each([
    ['a file name with a density suffix', 'loaded icon@2x.png from the bundle'],
    ['an assembly reference', 'loaded Shop.Core@1.4.dll'],
    ['a mention without a name before it', 'ping @team.lead about this'],
    ['a host without a top-level domain', 'connected as svc@localhost'],
    ['an at sign inside a word', 'price@2 each'],
  ])('should leave %s as it is', (_, line) => {
    // Act
    const text = mask(line, 'email');

    // Assert
    expect(text).toBe(line);
  });
});

describe('redact IP addresses', () => {
  it('should replace private and public IPv4 addresses and keep the port', () => {
    // Act
    const text = mask('Connection to 10.0.4.17:5432 refused, fallback 203.0.113.9', 'ip');

    // Assert
    expect(text).toBe('Connection to [IP]:5432 refused, fallback [IP]');
  });

  it('should replace an IPv6 address written with its eight groups', () => {
    // Act
    const text = mask('peer 2001:0db8:85a3:0000:0000:8a2e:0370:7334 closed', 'ip');

    // Assert
    expect(text).toBe('peer [IP] closed');
  });

  it.each([
    ['a version written after its name', 'System.Private.CoreLib, Version=8.0.0.0, Culture=neutral'],
    ['a version with a v prefix', 'running v1.2.3.4 of the agent'],
    ['a build number whose parts are too large', 'OS version 10.0.19041.1'],
    ['five dotted numbers', 'revision 1.2.3.4.5 of the schema'],
    ['a number with a part above 255', 'checksum 999.168.1.1'],
    ['the loopback address', 'listening on 127.0.0.1:8080'],
    ['the unspecified address', 'bound to 0.0.0.0'],
    ['a time of day', 'at 12:05:38 and 08:16:10.123'],
    ['a hardware address', 'adapter aa:bb:cc:dd:ee:ff is up'],
    ['a scoped name', 'threw Dead::Beef while loading'],
    ['a duration', 'finished in 0.7792ms'],
    ['a browser version in a user agent', 'UserAgent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'],
    ['the version of another browser', 'UserAgent=Mozilla/5.0 Edg/120.0.0.0'],
  ])('should leave %s as it is', (_, line) => {
    // Act
    const text = mask(line, 'ip');

    // Assert
    expect(text).toBe(line);
  });
});

describe('redact an address that follows a scheme', () => {
  it('should replace an address in a web address, since a scheme is not a product name', () => {
    // Act
    const text = mask('calling http://10.0.4.17:8080/health', 'ip');

    // Assert
    expect(text).toBe('calling http://[IP]:8080/health');
  });
});

describe('redact secrets', () => {
  it('should replace a JSON Web Token', () => {
    // Act
    const text = mask('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl was rejected', 'secret');

    // Assert
    expect(text).toBe('token [SECRET] was rejected');
  });

  it('should replace the value of an Authorization header and keep its scheme', () => {
    // Act
    const text = mask('sent header Authorization: Bearer abc123.def456 upstream', 'secret');

    // Assert
    expect(text).toBe('sent header Authorization: Bearer [SECRET] upstream');
  });

  it('should replace a bearer token that has a digit, outside a header', () => {
    // Act
    const text = mask('using Bearer a8Fk29sLq0Zx7Pw3Nd5T for the call', 'secret');

    // Assert
    expect(text).toBe('using Bearer [SECRET] for the call');
  });

  it.each([
    ['Anthropic or OpenAI style', 'key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv0123 leaked'],
    ['GitHub', 'pushed with ghp_abcdefghijklmnopqrstuvwxyz0123456789 today'],
    ['AWS access key', 'role AKIAIOSFODNN7EXAMPLE assumed'],
  ])('should replace a %s key', (_, line) => {
    // Act
    const text = mask(line, 'secret');

    // Assert
    expect(text).toContain('[SECRET]');
    expect(text).not.toMatch(/sk-ant|ghp_|AKIA/);
  });

  it('should replace the password of a connection string and keep the other parts', () => {
    // Act
    const text = mask('ConnectionString=Server=db01;User Id=app;Password=S3cr3t!', 'secret');

    // Assert
    expect(text).toBe('ConnectionString=Server=db01;User Id=app;Password=[SECRET]');
  });

  it('should stop a password at the semicolon of a connection string', () => {
    // Act
    const text = mask('Server=db01;Password=S3cr3t!;Database=shop', 'secret');

    // Assert
    expect(text).toBe('Server=db01;Password=[SECRET];Database=shop');
  });

  it.each([
    ['a query parameter', 'GET /api?api_key=abc123def456&page=2', 'GET /api?api_key=[SECRET]&page=2'],
    ['a JSON property', '{"user":"a","password":"hunter2hunter2"}', '{"user":"a","password":"[SECRET]"}'],
    ['a client secret', 'client_secret=Zx81-kLq_90Pw', 'client_secret=[SECRET]'],
    ['an access token', 'access_token=ya29.a0AfH6SMB', 'access_token=[SECRET]'],
    ['a JSON access token', '{"access_token":"ya29.a0AfH6SMB"}', '{"access_token":"[SECRET]"}'],
    ['a JSON name with a prefix', '{"db_password":"hunter2hunter2"}', '{"db_password":"[SECRET]"}'],
    ['a JSON name in camel case', '{"dbPassword":"hunter2hunter2"}', '{"dbPassword":"[SECRET]"}'],
    ['a name in camel case', 'dbPassword=hunter2hunter2', 'dbPassword=[SECRET]'],
  ])('should replace the value of %s', (_, line, expected) => {
    // Act
    const text = mask(line, 'secret');

    // Assert
    expect(text).toBe(expected);
  });

  it('should replace the password written inside an address', () => {
    // Act
    const text = mask('fetching https://deploy:pa55w0rd@git.example.net/repo.git', 'secret');

    // Assert
    expect(text).toBe('fetching https://deploy:[SECRET]@git.example.net/repo.git');
  });

  it.each([
    ['an empty value', 'password= and nothing else'],
    ['prose after a colon', 'Password: incorrect, try again'],
    ['a null value', 'password=null'],
    ['a boolean', 'token=true'],
    ['an already masked value', 'password=[SECRET]'],
    ['stars', 'password=********'],
    ['a name that only starts with token', 'tokenCount=42 maxTokens=4000'],
    ['a JSON name that only ends with token', '{"maxToken":"4000","nextPageToken":"abcd1234efgh"}'],
    ['a JSON name that says what kind of token it is', '{"tokenType":"Bearer"}'],
    ['a message about a token', 'Token expired for user, refresh needed'],
    ['bearer followed by a plain word', 'Bearer authentication failed'],
    ['bearer followed by a class name', 'registered Bearer AuthenticationHandlerDefaults'],
    ['a key that is only similar', 'skip-list sk-1 and sk-short'],
  ])('should leave %s as it is', (_, line) => {
    // Act
    const text = mask(line, 'secret');

    // Assert
    expect(text).toBe(line);
  });
});

describe('redact probable payment cards', () => {
  it.each([
    ['spaces', 'paid with 4111 1111 1111 1111 today'],
    ['dashes', 'paid with 4111-1111-1111-1111 today'],
    ['an American Express number', 'paid with 3782 822463 10005 today'],
    ['a number given as the card', 'cardNumber=4111111111111111 declined'],
  ])('should replace a card written with %s', (_, line) => {
    // Act
    const text = mask(line, 'card');

    // Assert
    expect(text).toContain('[CARD]');
    expect(text).not.toMatch(/4111|3782/);
  });

  it.each([
    ['a number that fails the Luhn check', 'paid with 4111 1111 1111 1112 today'],
    ['a long number without any context', 'order 4111111111111111 shipped'],
    ['a timestamp of digits', 'trace 20261104080200123456 started'],
    ['groups of four that pass the Luhn check but do not start like a card', 'serial 9999 9999 9999 9995'],
  ])('should leave %s as it is', (_, line) => {
    // Act
    const text = mask(line, 'card');

    // Assert
    expect(text).toBe(line);
  });
});

describe('redact identifiers (GUID), an option', () => {
  const guid = '7ecb1df3-8db1-4137-8038-9584ac6f3083';

  it('should replace a GUID and keep the text around it', () => {
    // Act
    const text = mask(`[${guid}] Executing endpoint`, 'guid');

    // Assert
    expect(text).toBe('[[GUID]] Executing endpoint');
  });

  it.each([
    ['the nil GUID', '00000000-0000-0000-0000-000000000000'],
    ['hex groups that are not a version and a variant', '12345678-1234-1234-1234-123456789012'],
    ['a GUID with one more group', `${guid}-0001`],
    ['hex continued after the last group', `${guid}ab`],
  ])('should leave %s as it is', (_, value) => {
    // Act
    const text = mask(`id ${value} seen`, 'guid');

    // Assert
    expect(text).toBe(`id ${value} seen`);
  });
});

describe('redact host names in web addresses, an option', () => {
  it('should replace the host and keep the scheme, the port and the path', () => {
    // Act
    const text = mask('calling https://api.billing.internal.corp:8443/v2/orders?id=7', 'urlHost');

    // Assert
    expect(text).toBe('calling https://[HOST]:8443/v2/orders?id=7');
  });

  it('should replace the host that follows credentials', () => {
    // Act
    const text = mask('fetching https://deploy@git.corp.net/repo', 'urlHost');

    // Assert
    expect(text).toBe('fetching https://deploy@[HOST]/repo');
  });

  it.each([
    ['localhost', 'http://localhost:8080/health'],
    ['an IP address', 'http://10.0.0.5/health'],
    ['a name reserved for examples', 'https://www.example.com/docs'],
    ['a name that is not in an address', 'System.Net.Http.HttpClient timed out'],
    ['a file name', 'wrote report.final.csv to disk'],
  ])('should leave %s as it is', (_, line) => {
    // Act
    const text = mask(line, 'urlHost');

    // Assert
    expect(text).toBe(line);
  });
});

describe('redact as a whole', () => {
  it('should apply only the rules it is given', () => {
    // Arrange
    const line = 'mail a@b.example.org from 10.0.4.17';

    // Act
    const result = redact(line, only('email'));

    // Assert
    expect(result.text).toBe('mail [EMAIL] from 10.0.4.17');
  });

  it('should give back the same text when nothing matches', () => {
    // Arrange
    const line = '2026-11-04 08:00:00.000 +01:00 [ERR] Database update failed for order 77';

    // Act
    const result = redact(line, ALL);

    // Assert
    expect(result.text).toBe(line);
    expect(result.count).toBe(0);
  });

  it('should count what it replaced', () => {
    // Act
    const result = redact('a@b.example.org and c@d.example.org via 10.0.4.17', only('email', 'ip'));

    // Assert
    expect(result.count).toBe(3);
  });

  it('should replace an overlapping match once, the secret winning over the shorter one inside it', () => {
    // Arrange
    const line = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';

    // Act
    const result = redact(line, ALL);

    // Assert
    expect(result.text).toBe('Authorization: Bearer [SECRET]');
    expect(result.count).toBe(1);
  });

  it('should not change a text it has already masked', () => {
    // Arrange
    const once = redact('Password=S3cr3t! mail a@b.example.org from 10.0.4.17', ALL).text;

    // Act
    const twice = redact(once, ALL).text;

    // Assert
    expect(twice).toBe(once);
  });

  it('should keep the line breaks and the rest of a stack trace', () => {
    // Arrange
    const entry = 'boom for a@b.example.org\n   at Shop.Orders.Run() in /src/Run.cs:line 12\n   at Shop.Main()';

    // Act
    const result = redact(entry, only('email'));

    // Assert
    expect(result.text).toBe('boom for [EMAIL]\n   at Shop.Orders.Run() in /src/Run.cs:line 12\n   at Shop.Main()');
  });
});

describe('countOccurrences', () => {
  it('should count each rule on its own, even where two rules match the same text', () => {
    // Arrange: the password is a secret, and « pa55w0rd@git.corp.net » is also an address.
    const line = 'fetching https://deploy:pa55w0rd@git.corp.net/x';

    // Act
    const counts = countOccurrences(line);

    // Assert
    expect(counts).toEqual({ email: 1, secret: 1, ip: 0, card: 0, guid: 0, urlHost: 1 });
  });

  it('should count a token once, though two patterns of the same rule find it', () => {
    // Arrange
    const line = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';

    // Act
    const counts = countOccurrences(line);

    // Assert
    expect(counts.secret).toBe(1);
  });

  it('should count the options too, so that the user sees what they would hide', () => {
    // Act
    const counts = countOccurrences('id 7ecb1df3-8db1-4137-8038-9584ac6f3083 at https://api.corp.net/x');

    // Assert
    expect(counts.guid).toBe(1);
    expect(counts.urlHost).toBe(1);
  });
});

describe('the rules offered', () => {
  it('should have e-mails, secrets, IP addresses and cards on by default, and the GUID and host options off', () => {
    // Assert
    expect([...DEFAULT_ENABLED_RULES].sort()).toEqual(['card', 'email', 'ip', 'secret']);
    expect(REDACTION_RULES.map((rule) => rule.id).sort()).toEqual(['card', 'email', 'guid', 'ip', 'secret', 'urlHost']);
  });

  it('should have a label, a placeholder and a description for each rule', () => {
    // Assert
    for (const rule of REDACTION_RULES) {
      expect([rule.label, rule.placeholder, rule.description].every((value) => value.length > 0)).toBe(true);
    }
  });

  it('should add the rules that are on by default to those the user chose, when something is sent', () => {
    // Act
    const rules = rulesForSending(only('guid'));

    // Assert
    expect([...rules].sort()).toEqual(['card', 'email', 'guid', 'ip', 'secret']);
  });

  it('should still apply the default rules when the user chose none, when something is sent', () => {
    // Act
    const rules = rulesForSending(only());

    // Assert
    expect([...rules].sort()).toEqual(['card', 'email', 'ip', 'secret']);
  });
});

describe('redact on the sample logs', () => {
  it.each(['real-serilog.log', 'real-mixed-formats.log'])('should not change a line of %s, which holds nothing sensitive, with the default rules', (name) => {
    // Arrange
    const log = readSample(name);

    // Act
    const result = redact(log, DEFAULT_ENABLED_RULES);

    // Assert
    expect(result.text).toBe(log);
  });

  it('should hide the password and the address of the connection error, and nothing else, in sample.log', () => {
    // Arrange
    const log = readSample('sample.log');

    // Act
    const result = redact(log, DEFAULT_ENABLED_RULES);

    // Assert
    const changed = result.text.split('\n').filter((line, index) => line !== log.split('\n')[index]);
    expect(changed).toEqual([
      '2026-11-04 10:03:09.552 +01:00 [FTL] Unable to connect to database. ConnectionString=Server=db01;User Id=app;Password=[SECRET]',
      '2026-11-04 10:12:33.894 +01:00 [ERR] Failed to send email to [EMAIL]: SMTP server returned 550',
    ]);
  });

  it('should hide only the e-mails and the addresses in serilog-pieges.log', () => {
    // Arrange
    const log = readSample('serilog-pieges.log');

    // Act
    const result = redact(log, DEFAULT_ENABLED_RULES);

    // Assert
    expect(result.count).toBe(4);
    expect(result.text).toContain('Connection to [IP]:5432 refused');
    expect(result.text).toContain('Failed to send email to [EMAIL]: SMTP');
  });

  it('should hide the token and the address, and the stack lines stay as they are, in serilog-realistic.log', () => {
    // Arrange
    const log = readSample('serilog-realistic.log');

    // Act
    const result = redact(log, DEFAULT_ENABLED_RULES);

    // Assert
    expect(result.text).toContain('Authorization: Bearer [SECRET]');
    expect(result.text).toContain('at Shop.Catalog.SyncJob.RunAsync(CancellationToken ct) in /src/Shop.Catalog/SyncJob.cs:line 40');
    expect(result.text).not.toContain('eyJ');
  });

  it('should find the correlation identifiers of the real sample only when the GUID option is on', () => {
    // Arrange
    const log = readSample('real-serilog.log');

    // Act
    const without = redact(log, DEFAULT_ENABLED_RULES);
    const withOption = redact(log, only('guid'));

    // Assert
    expect(without.count).toBe(0);
    expect(withOption.count).toBeGreaterThan(0);
    expect(withOption.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe('redact on hostile text', () => {
  // Generous limits: they catch a regular expression that backtracks without end, not a slow machine.
  const LIMIT_MS = 1500;
  const timed = (text: string): number => {
    const start = performance.now();
    redact(text, ALL);
    countOccurrences(text);
    return performance.now() - start;
  };

  it.each([
    ['a very long word before an at sign', `${'a'.repeat(200_000)}@`],
    ['many at signs', 'a@'.repeat(100_000)],
    ['a long chain of dotted labels after an at sign', `x@${'a.'.repeat(100_000)}`],
    ['a long run of dotted numbers', '1.'.repeat(100_000)],
    ['a long run of digits', '4'.repeat(200_000)],
    ['a long run of digits and spaces', '4111 '.repeat(50_000)],
    ['a token start repeated', 'eyJ'.repeat(70_000)],
    ['a long token that never ends its parts', `eyJ${'a'.repeat(100_000)}.eyJ${'b'.repeat(100_000)}.`],
    ['a header repeated', 'Authorization: Bearer '.repeat(10_000)],
    ['a key that is never given a value', 'password='.repeat(30_000)],
    ['a long address', `https://${'a'.repeat(200_000)}`],
    ['long hexadecimal groups', `${'a'.repeat(100_000)}-${'b'.repeat(100_000)}`],
  ])('should finish quickly on %s', (_, text) => {
    // Act
    const elapsed = timed(text);

    // Assert
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });

  it('should read a megabyte of ordinary log lines in well under a second', () => {
    // Arrange
    const line = '2026-11-04 08:00:00.000 +01:00 [ERR] Timeout after 1234 ms while calling PaymentGateway for order 54321\n';
    const text = line.repeat(Math.ceil((1024 * 1024) / line.length));

    // Act
    const elapsed = timed(text);

    // Assert
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });
});
