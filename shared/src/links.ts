// Link engine — builds the `{prefix}/{name}` part of every public URL.
//
// Settings are layered: admin (global, per source) → quota profile → user
// preferences (per source) → per-share override. Every option carries its own
// lock: a layer that locks an option freezes it for every layer below.
// Lives in @ferry/shared so the client can render a live preview with the
// exact same rules the server applies.

export type PrefixMode = 'username' | 'usercode' | 'random' | 'vanity' | 'none';
export type NameMode = 'original' | 'random' | 'original_random' | 'words' | 'timestamp' | 'uuid';
export type Alphabet = 'base62' | 'lower' | 'unambiguous';
export type LinkSource = 'web' | 'sharex' | 'request';

export const LINK_SOURCES: LinkSource[] = ['web', 'sharex', 'request'];

export interface LinkOptions {
  prefixMode: PrefixMode;
  prefixLength: number;
  nameMode: NameMode;
  nameLength: number;
  alphabet: Alphabet;
  keepExtension: boolean;
  sanitize: boolean;
}

export type LinkOptionKey = keyof LinkOptions;
export const LINK_OPTION_KEYS: LinkOptionKey[] = [
  'prefixMode', 'prefixLength', 'nameMode', 'nameLength', 'alphabet', 'keepExtension', 'sanitize',
];

export type PolicyLayer = { [K in LinkOptionKey]?: { value?: LinkOptions[K]; locked?: boolean } };

export interface LinkSettings {
  sources: Record<LinkSource, PolicyLayer>;
  /** Public links must contain at least this many random characters (0 = off). */
  publicMinRandom: number;
  /** Words that can never be used as a prefix (username, vanity alias...). */
  reserved: string[];
}

export type UserLinkPrefs = Partial<Record<LinkSource, Partial<LinkOptions>>>;

export interface ResolvedLinkPolicy {
  options: LinkOptions;
  locked: Record<LinkOptionKey, boolean>;
}

export const DEFAULT_LINK_OPTIONS: Record<LinkSource, LinkOptions> = {
  web: {
    prefixMode: 'username', prefixLength: 6, nameMode: 'original_random', nameLength: 4,
    alphabet: 'unambiguous', keepExtension: true, sanitize: true,
  },
  sharex: {
    prefixMode: 'username', prefixLength: 6, nameMode: 'random', nameLength: 8,
    alphabet: 'base62', keepExtension: true, sanitize: true,
  },
  request: {
    prefixMode: 'username', prefixLength: 6, nameMode: 'original', nameLength: 4,
    alphabet: 'unambiguous', keepExtension: false, sanitize: true,
  },
};

/** Paths owned by the app itself — never usable as a link prefix. */
export const SYSTEM_RESERVED = [
  'api', 'auth', 'raw', 'assets', 'branding', 'health', 'login', 'logout', 'register', 'verify-email', 'my', 'admin',
  'settings', 'setup', 'favicon.ico', 'favicon.svg', 'robots.txt', 'static', 'fonts', 'sharex',
];

export const DEFAULT_LINK_SETTINGS: LinkSettings = {
  sources: {
    web: Object.fromEntries(LINK_OPTION_KEYS.map((k) => [k, { value: DEFAULT_LINK_OPTIONS.web[k], locked: false }])),
    sharex: Object.fromEntries(LINK_OPTION_KEYS.map((k) => [k, { value: DEFAULT_LINK_OPTIONS.sharex[k], locked: false }])),
    request: Object.fromEntries(LINK_OPTION_KEYS.map((k) => [k, { value: DEFAULT_LINK_OPTIONS.request[k], locked: false }])),
  } as Record<LinkSource, PolicyLayer>,
  publicMinRandom: 6,
  reserved: ['www', 'mail', 'help', 'support', 'docs', 'status', 'about'],
};

export function resolveLinkPolicy(
  source: LinkSource,
  admin: LinkSettings,
  profile?: PolicyLayer | null,
  user?: UserLinkPrefs | null,
  override?: Partial<LinkOptions> | null,
): ResolvedLinkPolicy {
  const options = { ...DEFAULT_LINK_OPTIONS[source] } as LinkOptions;
  const locked = Object.fromEntries(LINK_OPTION_KEYS.map((k) => [k, false])) as Record<LinkOptionKey, boolean>;
  const set = <K extends LinkOptionKey>(k: K, v: unknown) => { (options as any)[k] = v; };

  for (const layer of [admin.sources?.[source], profile]) {
    if (!layer) continue;
    for (const k of LINK_OPTION_KEYS) {
      const entry = layer[k];
      if (!entry || locked[k]) continue;
      if (entry.value !== undefined && entry.value !== null) set(k, entry.value);
      if (entry.locked) locked[k] = true;
    }
  }
  for (const layer of [user?.[source], override]) {
    if (!layer) continue;
    for (const k of LINK_OPTION_KEYS) {
      if (!locked[k] && layer[k] !== undefined && layer[k] !== null) set(k, layer[k]);
    }
  }
  options.prefixLength = clamp(options.prefixLength, 3, 32);
  options.nameLength = clamp(options.nameLength, 2, 32);
  return { options, locked };
}

// ── Generators ────────────────────────────────────────────────────────────────

const ALPHABETS: Record<Alphabet, string> = {
  base62: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  lower: 'abcdefghijklmnopqrstuvwxyz0123456789',
  unambiguous: 'abcdefghjkmnpqrstuvwxyz23456789',
};

function clamp(n: number, min: number, max: number) {
  const v = Number.isFinite(n) ? Math.round(n) : min;
  return Math.min(max, Math.max(min, v));
}

export function randomString(length: number, alphabet: Alphabet = 'base62'): string {
  const chars = ALPHABETS[alphabet];
  const out: string[] = [];
  // Rejection sampling keeps the distribution uniform.
  const limit = 256 - (256 % chars.length);
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit) out.push(chars[b % chars.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

const ADJECTIVES = [
  'amber', 'bold', 'brave', 'bright', 'calm', 'clever', 'cosmic', 'crisp', 'eager', 'fancy', 'fast', 'fierce',
  'gentle', 'glad', 'golden', 'grand', 'happy', 'humble', 'jolly', 'keen', 'lively', 'lucky', 'mellow', 'mighty',
  'misty', 'noble', 'polar', 'proud', 'quick', 'quiet', 'rapid', 'royal', 'rusty', 'shiny', 'silent', 'silver',
  'sleek', 'smooth', 'snowy', 'solar', 'steady', 'sunny', 'swift', 'tidy', 'vivid', 'warm', 'wild', 'witty',
];
const NOUNS = [
  'anchor', 'badger', 'beacon', 'breeze', 'canyon', 'comet', 'coral', 'falcon', 'ferry', 'fjord', 'forest', 'fox',
  'glacier', 'harbor', 'heron', 'island', 'koala', 'lagoon', 'lynx', 'maple', 'meadow', 'otter', 'owl', 'panda',
  'pebble', 'pine', 'puffin', 'raven', 'reef', 'river', 'rocket', 'sail', 'salmon', 'seal', 'shore', 'sparrow',
  'summit', 'tide', 'tiger', 'tulip', 'valley', 'walrus', 'wave', 'willow', 'wolf', 'yak', 'zebra', 'kayak',
];

function pick<T>(list: T[]): T {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return list[buf[0] % list.length];
}

export function randomWords(): string {
  return `${pick(ADJECTIVES)}-${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}

/** Splits "archive.tar.gz" into ["archive", ".tar.gz"]; dotfiles keep their name. */
export function splitExtension(name: string): [string, string] {
  const m = /^(.+?)((?:\.(?:tar))?\.[A-Za-z0-9]{1,10})$/.exec(name);
  return m ? [m[1], m[2]] : [name, ''];
}

export function sanitizeSegment(input: string, sanitize = true): string {
  let s = input.replace(/[\/\\?#%\u0000-\u001f]/g, '-').trim();
  if (sanitize) {
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  }
  return s.slice(0, 120) || 'file';
}

/** '.PDF' → '.pdf', '' → ''. */
export function cleanExtension(ext: string): string {
  const e = ext.toLowerCase().replace(/[^a-z0-9.]/g, '').replace(/^\.+/, '');
  return e ? `.${e}` : '';
}

function pad(n: number) { return String(n).padStart(2, '0'); }

/** Number of random characters a policy puts in the link (used for public-link entropy). */
export function randomCharsIn(o: LinkOptions): number {
  let n = 0;
  if (o.prefixMode === 'random') n += o.prefixLength;
  if (o.nameMode === 'random' || o.nameMode === 'original_random') n += o.nameLength;
  if (o.nameMode === 'words') n += 8;
  if (o.nameMode === 'uuid') n += 32;
  return n;
}

export interface LinkIdentity { username: string; userCode: string; vanity?: string | null }

export function buildPrefix(o: LinkOptions, who: LinkIdentity): string {
  switch (o.prefixMode) {
    case 'none': return '';
    case 'usercode': return who.userCode;
    case 'random': return randomString(o.prefixLength, o.alphabet);
    case 'vanity': return who.vanity || who.username;
    default: return who.username;
  }
}

/**
 * Builds the name segment. `original` is the uploaded file name (or the share
 * title for multi-file shares). `extraRandom` adds random characters — used to
 * reach the public-link entropy floor or to break a collision.
 */
export function buildName(original: string, o: LinkOptions, extraRandom = 0, now: Date = new Date()): string {
  const [rawBase, rawExt] = splitExtension(original);
  const ext = o.keepExtension ? cleanExtension(rawExt) : '';
  const base = sanitizeSegment(rawBase, o.sanitize);
  // Random modes absorb the extra entropy into their own random part.
  const randomLen = o.nameLength + extraRandom;
  let name: string;
  switch (o.nameMode) {
    case 'original': name = base; break;
    case 'random': name = randomString(randomLen, o.alphabet); extraRandom = 0; break;
    case 'original_random': name = `${base}-${randomString(randomLen, o.alphabet)}`; extraRandom = 0; break;
    case 'words': name = randomWords(); break;
    case 'uuid': name = globalThis.crypto.randomUUID().replace(/-/g, ''); break;
    case 'timestamp':
      name = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      break;
  }
  if (extraRandom > 0) name += `-${randomString(extraRandom, o.alphabet)}`;
  return name + ext;
}

export function isValidHandle(handle: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,31}$/.test(handle);
}

export function isReservedHandle(handle: string, settings: Pick<LinkSettings, 'reserved'>): boolean {
  const h = handle.toLowerCase();
  return SYSTEM_RESERVED.includes(h) || settings.reserved.map((r) => r.toLowerCase()).includes(h);
}

export function joinLink(prefix: string, name: string): string {
  return '/' + [prefix, name].filter(Boolean).map(encodeURIComponent).join('/');
}
