/**
 * Masking of what must not leave the browser (SPEC §6). It is a best effort and says so: the preview of what is sent
 * is the real control.
 *
 * Every rule is strict on purpose. A rule that cannot tell a sensitive text from an ordinary one by its shape does not
 * guess: it asks for a context (a key name, a scheme, a check digit) or it is left out. A missed secret is the worse
 * mistake, so the rules that hide secrets are the ones kept on by default; the options, which are about identifiers
 * rather than secrets, are off until the user turns them on.
 *
 * Each pattern starts after a lookbehind that forbids the characters it is made of. Without it, the engine would
 * try the pattern again from every position of a long run of such characters, which grows with the square of the run.
 */

export type RedactionRuleId = 'email' | 'secret' | 'ip' | 'card' | 'guid' | 'urlHost';

/** Where a rule found something to hide: `start` is included, `end` is not. */
interface Range {
  readonly start: number;
  readonly end: number;
}

export interface RedactionRule {
  readonly id: RedactionRuleId;
  /** What the screen calls the rule. */
  readonly label: string;
  /** What replaces what the rule finds. */
  readonly placeholder: string;
  /** What the rule hides and what it leaves alone, for the screen. */
  readonly description: string;
  /** `true` for the rules that are on until the user turns them off, and that the last safety net applies to. */
  readonly enabledByDefault: boolean;
  find(text: string): readonly Range[];
}

/** The ranges that a pattern with the `d` flag found: the whole match, or its first group when `group` is `true`. */
function rangesOf(text: string, pattern: RegExp, group: boolean, accepts: (found: string) => boolean = () => true): Range[] {
  const ranges: Range[] = [];
  for (const match of text.matchAll(pattern)) {
    const span = group ? match.indices?.[1] : match.indices?.[0];
    if (span !== undefined && accepts(text.slice(span[0], span[1]))) {
      ranges.push({ start: span[0], end: span[1] });
    }
  }
  return ranges;
}

// ---- E-mail addresses ----

const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24})(?![A-Za-z0-9-])/dg;

/** Endings that are file names far more often than top-level domains: `icon@2x.png` is not an address. */
const FILE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'css', 'js', 'json', 'xml', 'dll', 'exe', 'cs', 'txt', 'log', 'yml', 'yaml', 'zip', 'pdf']);

function findEmails(text: string): readonly Range[] {
  const ranges: Range[] = [];
  for (const match of text.matchAll(EMAIL)) {
    const domain = match[1] ?? '';
    const topLevel = domain.slice(domain.lastIndexOf('.') + 1).toLowerCase();
    if (!FILE_EXTENSIONS.has(topLevel)) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

// ---- IP addresses ----

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
// Not after « name/ » (`Chrome/120.0.0.0`, in a user agent): that is a version. After a scheme (`http://`) it is an address.
const IPV4 = new RegExp(`(?<![\\w.])(?<![A-Za-z]/)(?:${OCTET}\\.){3}${OCTET}(?!\\w|\\.\\d)`, 'dg');
const IPV6_FULL = /(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}(?![\w:])/dg;
/** A number written like an address, after one of these words, is a version or a build, not a machine. */
const VERSION_WORD = /\b(?:version|ver|build|release|revision|assembly|framework|runtime)\W{0,4}$/i;
const VERSION_LOOKBACK_CHARS = 24;

/** Loopback and unspecified addresses name no machine of the user: they are not hidden. */
const isNoMachine = (address: string): boolean => address.startsWith('127.') || address === '0.0.0.0';

function findIpAddresses(text: string): readonly Range[] {
  const ranges: Range[] = [];
  for (const match of text.matchAll(IPV4)) {
    const before = text.slice(Math.max(0, match.index - VERSION_LOOKBACK_CHARS), match.index);
    if (!isNoMachine(match[0]) && !VERSION_WORD.test(before)) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  // Only the form with eight groups: the shorter forms cannot be told from a time of day or a scoped name.
  return [...ranges, ...rangesOf(text, IPV6_FULL, false)];
}

// ---- Secrets: tokens, keys, passwords ----

const TOKEN_CHARS = 'A-Za-z0-9_-';
const JSON_WEB_TOKEN = new RegExp(`(?<![${TOKEN_CHARS}])eyJ[${TOKEN_CHARS}]{8,2048}\\.eyJ[${TOKEN_CHARS}]{8,2048}\\.[${TOKEN_CHARS}]{8,2048}(?![${TOKEN_CHARS}])`, 'dg');
const AUTHORIZATION_HEADER = /\bAuthorization["']?\s{0,3}[:=]\s{0,3}["']?(?:Bearer|Basic|Token|Digest|Negotiate|NTLM)\s+([^\s"',;]{8,2048})/dgi;
/** A bearer token outside a header must contain a digit: « Bearer AuthenticationHandler » is a class name. */
const BARE_BEARER = /\bBearer\s+(?=[A-Za-z0-9._~+/=-]{0,512}\d)([A-Za-z0-9._~+/=-]{16,512})(?![A-Za-z0-9._~+/=-])/dg;
const PROVIDER_KEY = new RegExp(
  `(?<![${TOKEN_CHARS}])(?:sk-[${TOKEN_CHARS}]{20,200}|AKIA[0-9A-Z]{16}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})(?![${TOKEN_CHARS}])`,
  'dg',
);
const URL_PASSWORD = /(?<![A-Za-z0-9+.-])[a-z][a-z0-9+.-]{1,15}:\/\/[^\s/:@]{1,128}:([^\s/@]{1,256})@/dgi;

/** Names whose value is a secret, written with a boundary before them so that `maxTokens` is not one. */
const SECRET_KEYS = 'api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|pwd|token|accountkey|sharedaccesskey';
const KEY_VALUE = new RegExp(`(?<![A-Za-z0-9])(?:${SECRET_KEYS})(?![\\w-])["']?\\s{0,2}=\\s{0,2}["']?([^\\s;"'&,]{4,256})`, 'dgi');
/** The same names in camel case, which are secrets whatever comes before them (`dbPassword`). `token` is left out: `maxToken` is a number. */
const CAMEL_KEY_VALUE = /(?<=[a-z])(?:ApiKey|ClientSecret|Secret|Password)(?![\w-])["']?\s{0,2}=\s{0,2}["']?([^\s;"'&,]{4,256})/dg;
// The name is one of the keys, alone or after a prefix and a separator (`db_password`): `maxToken` and `nextPageToken` are not secrets.
const JSON_KEY_VALUE = new RegExp(`"(?:[A-Za-z0-9]{0,40}[_-])?(?:${SECRET_KEYS})"\\s{0,2}:\\s{0,2}"([^"\\\\]{4,256})"`, 'dgi');
const CAMEL_JSON_KEY_VALUE = /"[A-Za-z0-9]{0,40}[a-z](?:ApiKey|ClientSecret|Secret|Password)"\s{0,2}:\s{0,2}"([^"\\]{4,256})"/dg;

/** Values that say « no secret here »: an empty template, a flag, stars, or what was already masked. */
const NOT_A_SECRET = /^(?:null|none|nil|true|false|undefined|redacted|empty|[*x]+|[{$<%[].*)$/i;

function findSecrets(text: string): readonly Range[] {
  const isValue = (found: string): boolean => !NOT_A_SECRET.test(found);
  return [
    ...rangesOf(text, JSON_WEB_TOKEN, false),
    ...rangesOf(text, AUTHORIZATION_HEADER, true),
    ...rangesOf(text, BARE_BEARER, true),
    ...rangesOf(text, PROVIDER_KEY, false),
    ...rangesOf(text, URL_PASSWORD, true, isValue),
    ...rangesOf(text, KEY_VALUE, true, isValue),
    ...rangesOf(text, CAMEL_KEY_VALUE, true, isValue),
    ...rangesOf(text, JSON_KEY_VALUE, true, isValue),
    ...rangesOf(text, CAMEL_JSON_KEY_VALUE, true, isValue),
  ];
}

// ---- Payment cards ----

const GROUPED_CARD = /(?<![\d-])(\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,4}|\d{4}[ -]\d{6}[ -]\d{5})(?![\d-]|[ -]\d)/dg;
/** A number given as a card: without a word that says so, a long number is an identifier and is left alone. */
const CARD_AFTER_NAME = /(?<![A-Za-z0-9])(?:card(?:[ _-]?(?:number|num|no))?|cc[ _-]?(?:number|num)|pan)(?![A-Za-z0-9])["']?\s{0,2}[:=]\s{0,2}["']?(\d{13,19})(?!\d)/dgi;
/** Visa, Mastercard, American Express, Discover, Diners and JCB. */
const CARD_PREFIX = /^(?:4|5[1-5]|2(?:2[2-9]\d|[3-6]\d\d|7[01]\d|720)|3[47]|6011|65|64[4-9]|3(?:0[0-5]|[68])|35(?:2[89]|[3-8]\d))/;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      digit = digit > 9 ? digit - 9 : digit;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function isLikelyCard(found: string): boolean {
  const digits = found.replace(/[ -]/g, '');
  return digits.length >= 13 && digits.length <= 19 && CARD_PREFIX.test(digits) && passesLuhn(digits);
}

const findCards = (text: string): readonly Range[] => [...rangesOf(text, GROUPED_CARD, true, isLikelyCard), ...rangesOf(text, CARD_AFTER_NAME, true, isLikelyCard)];

// ---- Options: identifiers and host names ----

/** Version 1 to 8 and the RFC 4122 variant: a dashed group of hexadecimal digits that is not a GUID is left alone, and so is the nil GUID. */
const GUID = /(?<![0-9a-fA-F-])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}(?![0-9a-fA-F-])/dg;

const URL_HOST = /\bhttps?:\/\/(?:[^\s/?#@]{1,128}@)?([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(?![A-Za-z0-9.-])/dgi;
const IP_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** Names that belong to no one (RFC 2606, RFC 6761): hiding them would hide nothing. */
const RESERVED_HOST = /(?:^|\.)(?:example\.(?:com|org|net)|localhost|test|invalid|example)$/i;

const isHostWorthHiding = (host: string): boolean => !IP_LITERAL.test(host) && !RESERVED_HOST.test(host);

export const REDACTION_RULES: readonly RedactionRule[] = [
  {
    id: 'email',
    label: 'Adresses e-mail',
    placeholder: '[EMAIL]',
    description: 'Une adresse complète, avec un domaine et une fin de domaine en lettres. Un nom de fichier comme icon@2x.png est laissé.',
    enabledByDefault: true,
    find: findEmails,
  },
  {
    id: 'secret',
    label: 'Jetons, clés et mots de passe',
    placeholder: '[SECRET]',
    description:
      'Jetons JWT, valeur de l’en-tête Authorization, clés de fournisseurs (sk-, AKIA, ghp_), mots de passe d’adresse, valeur de password=, token=, secret=, api_key= et de leurs formes JSON. Une valeur vide, nulle ou déjà masquée est laissée.',
    enabledByDefault: true,
    find: findSecrets,
  },
  {
    id: 'ip',
    label: 'Adresses IP',
    placeholder: '[IP]',
    description: 'Adresses IPv4 et IPv6 écrites en entier. Les numéros de version, l’adresse locale (127.x) et 0.0.0.0 sont laissés ; les formes IPv6 abrégées ne sont pas reconnues.',
    enabledByDefault: true,
    find: findIpAddresses,
  },
  {
    id: 'card',
    label: 'Numéros de carte bancaire probables',
    placeholder: '[CARD]',
    description: 'Un numéro de 13 à 19 chiffres qui commence comme une carte et passe le contrôle de Luhn, écrit par groupes ou donné après « card= ». Un long nombre isolé est laissé.',
    enabledByDefault: true,
    find: findCards,
  },
  {
    id: 'guid',
    label: 'Identifiants GUID',
    placeholder: '[GUID]',
    description: 'Un GUID de version 1 à 8, par exemple un identifiant de corrélation. Pas coché d’office : il aide souvent à suivre une requête.',
    enabledByDefault: false,
    find: (text) => rangesOf(text, GUID, false),
  },
  {
    id: 'urlHost',
    label: 'Noms d’hôte dans les adresses web',
    placeholder: '[HOST]',
    description: 'Le nom de machine d’une adresse http:// ou https:// ; le schéma, le port et le chemin sont gardés. localhost, les adresses IP et les noms d’exemple sont laissés. Pas coché d’office.',
    enabledByDefault: false,
    find: (text) => rangesOf(text, URL_HOST, true, isHostWorthHiding),
  },
];

export const DEFAULT_ENABLED_RULES: ReadonlySet<RedactionRuleId> = new Set(REDACTION_RULES.filter((rule) => rule.enabledByDefault).map((rule) => rule.id));

/**
 * The rules applied to what is sent: those the user chose, and always those that are on by default. `redact` is the
 * last safety net (SPEC §6): unticking a box in the preparation does not let an address or a key leave.
 */
export function rulesForSending(chosen: ReadonlySet<RedactionRuleId>): ReadonlySet<RedactionRuleId> {
  return new Set([...DEFAULT_ENABLED_RULES, ...chosen]);
}

interface Found extends Range {
  readonly placeholder: string;
}

/** Keeps the ranges that start first, the longer one when two start together, and drops those that overlap a kept range. */
function withoutOverlaps<T extends Range>(found: readonly T[]): T[] {
  const sorted = [...found].sort((left, right) => left.start - right.start || right.end - left.end);
  const kept: T[] = [];
  let lastEnd = 0;
  for (const range of sorted) {
    if (range.start >= lastEnd) {
      kept.push(range);
      lastEnd = range.end;
    }
  }
  return kept;
}

export interface RedactionResult {
  readonly text: string;
  /** What was replaced. */
  readonly count: number;
}

/** Replaces what the enabled rules find with their placeholders, once per stretch of text even when two rules find it. */
export function redact(text: string, enabled: ReadonlySet<RedactionRuleId>): RedactionResult {
  const found: Found[] = [];
  for (const rule of REDACTION_RULES) {
    if (enabled.has(rule.id)) {
      found.push(...rule.find(text).map((range) => ({ ...range, placeholder: rule.placeholder })));
    }
  }
  const kept = withoutOverlaps(found);
  if (kept.length === 0) {
    return { text, count: 0 };
  }
  const parts: string[] = [];
  let position = 0;
  for (const range of kept) {
    parts.push(text.slice(position, range.start), range.placeholder);
    position = range.end;
  }
  parts.push(text.slice(position));
  return { text: parts.join(''), count: kept.length };
}

/**
 * How many times each rule finds something in the text, the options included, so that the user sees what a box would
 * hide before ticking it. Each rule counts on its own: a stretch of text two rules find counts for both.
 */
export function countOccurrences(text: string): Record<RedactionRuleId, number> {
  const counts = { email: 0, secret: 0, ip: 0, card: 0, guid: 0, urlHost: 0 };
  for (const rule of REDACTION_RULES) {
    counts[rule.id] = withoutOverlaps(rule.find(text)).length;
  }
  return counts;
}
