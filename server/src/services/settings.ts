import {
  DEFAULT_LINK_SETTINGS, SECRET_PLACEHOLDER,
  type SettingsKey, type SettingsMap,
} from '@ferry/shared';
import { db } from '../db/knex.js';
import { DEFAULT_MAIL_TEMPLATES } from './mailTemplates.js';

export const DEFAULT_SETTINGS: SettingsMap = {
  branding: {
    name: 'Ferry',
    tagline: 'Partage de fichiers',
    welcome: 'Déposez vos fichiers, on s’occupe du reste.',
    accent: '#2563EB',
    footer: '',
    logoLight: null,
    logoDark: null,
    favicon: null,
  },
  limits: {
    maxFileSizeMb: 5120,
    maxShareSizeMb: 10240,
    storageQuotaMb: 51200,
    defaultExpiryHours: 168,
    maxExpiryHours: 720,
    allowNeverExpire: false,
    allowPublic: true,
    defaultVisibility: 'private',
    sharexEnabled: true,
    sharexExpiryHours: 0,
    sharexVisibility: 'public',
    sharexDomains: [],
    requestMaxExpiryHours: 720,
  },
  auth: {
    localLogin: true,
    oidc: {
      enabled: false,
      tenantId: '',
      clientId: '',
      clientSecret: '',
      buttonLabel: 'Se connecter avec Microsoft',
      autoCreate: true,
      adminGroups: [],
      allowedGroups: [],
    },
  },
  mail: {
    provider: 'none',
    from: '',
    smtp: { host: '', port: 587, secure: false, user: '', pass: '' },
    graph: { tenantId: '', clientId: '', clientSecret: '', sender: '' },
    templates: DEFAULT_MAIL_TEMPLATES,
  },
  storage: {
    driver: 'local',
    s3: { endpoint: '', region: 'us-east-1', bucket: '', accessKeyId: '', secretAccessKey: '', forcePathStyle: true, prefix: '' },
  },
  links: DEFAULT_LINK_SETTINGS,
};

/** Dotted paths of fields that are never sent back to the browser. */
const SECRETS: Partial<Record<SettingsKey, string[]>> = {
  auth: ['oidc.clientSecret'],
  mail: ['smtp.pass', 'graph.clientSecret'],
  storage: ['s3.secretAccessKey'],
};

const cache = new Map<SettingsKey, unknown>();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep merge: stored values over defaults, so new default fields appear after upgrades. */
function merge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? merge(out[k], v) : v;
  return out as T;
}

export async function getSetting<K extends SettingsKey>(key: K): Promise<SettingsMap[K]> {
  if (cache.has(key)) return cache.get(key) as SettingsMap[K];
  const row = await db('settings').where({ key }).first();
  const value = merge(DEFAULT_SETTINGS[key], row?.value);
  cache.set(key, value);
  return value;
}

export async function setSetting<K extends SettingsKey>(key: K, value: SettingsMap[K]): Promise<SettingsMap[K]> {
  const current = await getSetting(key);
  const next = merge(DEFAULT_SETTINGS[key], value) as SettingsMap[K];
  // A masked secret coming back from the UI means "keep the stored one".
  for (const p of SECRETS[key] ?? []) {
    if (getPath(next, p) === SECRET_PLACEHOLDER) setPath(next, p, getPath(current, p));
  }
  await db('settings')
    .insert({ key, value: JSON.stringify(next), updated_at: db.fn.now() })
    .onConflict('key').merge();
  cache.set(key, next);
  return next;
}

export function maskSecrets<K extends SettingsKey>(key: K, value: SettingsMap[K]): SettingsMap[K] {
  const copy = structuredClone(value);
  for (const p of SECRETS[key] ?? []) {
    if (getPath(copy, p)) setPath(copy, p, SECRET_PLACEHOLDER);
  }
  return copy;
}

function getPath(obj: unknown, p: string): unknown {
  return p.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj: unknown, p: string, v: unknown) {
  const keys = p.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<any>((o, k) => o[k], obj);
  target[last] = v;
}
