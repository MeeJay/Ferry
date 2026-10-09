import bcrypt from 'bcryptjs';
import {
  LINK_SOURCES, MB, randomString, resolveLinkPolicy, isValidHandle, isReservedHandle, sanitizeSegment,
  type EffectiveLimits, type LinkSource, type Me, type PolicyLayer, type ResolvedLinkPolicy, type UserLinkPrefs,
} from '@ferry/shared';
import { db } from '../db/knex.js';
import { getSetting } from './settings.js';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  password_hash: string | null;
  role: 'admin' | 'user';
  auth_provider: 'local' | 'oidc';
  oidc_sub: string | null;
  user_code: string;
  vanity: string | null;
  quota_profile_id: string | null;
  link_prefs: UserLinkPrefs;
  disabled: boolean;
  email_verified: boolean;
  pending_approval: boolean;
  upload_parallel: number | null;
  created_at: Date;
  last_login_at: Date | null;
}

export interface ProfileRow {
  id: string;
  name: string;
  description: string;
  max_file_size_mb: number | null;
  max_share_size_mb: number | null;
  storage_quota_mb: number | null;
  default_expiry_hours: number | null;
  max_expiry_hours: number | null;
  allow_never_expire: boolean | null;
  allow_public: boolean | null;
  sharex_enabled: boolean | null;
  link_policy: PolicyLayer;
  oidc_groups: string[];
  is_default: boolean;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string | null) => (hash ? bcrypt.compare(pw, hash) : Promise.resolve(false));

export async function getUser(id: string): Promise<UserRow | undefined> {
  return db<UserRow>('users').where({ id }).first();
}

export async function profileFor(user: UserRow): Promise<ProfileRow | null> {
  const q = db<ProfileRow>('quota_profiles');
  const row = user.quota_profile_id
    ? await q.where({ id: user.quota_profile_id }).first()
    : await q.where({ is_default: true }).first();
  return row ?? null;
}

export async function storageUsed(userId: string): Promise<number> {
  const row = await db('shares').where({ owner_id: userId }).whereIn('status', ['pending', 'ready']).sum({ s: 'total_size' }).first();
  return Number(row?.s ?? 0);
}

export async function effectiveLimits(user: UserRow): Promise<EffectiveLimits> {
  const g = await getSetting('limits');
  const p = await profileFor(user);
  const pick = <T>(a: T | null | undefined, b: T): T => (a === null || a === undefined ? b : a);
  return {
    maxFileSize: pick(p?.max_file_size_mb, g.maxFileSizeMb) * MB,
    maxShareSize: pick(p?.max_share_size_mb, g.maxShareSizeMb) * MB,
    storageQuota: pick(p?.storage_quota_mb, g.storageQuotaMb) * MB,
    storageUsed: await storageUsed(user.id),
    defaultExpiryHours: pick(p?.default_expiry_hours, g.defaultExpiryHours),
    maxExpiryHours: pick(p?.max_expiry_hours, g.maxExpiryHours),
    allowNeverExpire: pick(p?.allow_never_expire, g.allowNeverExpire),
    allowPublic: pick(p?.allow_public, g.allowPublic),
    defaultVisibility: g.defaultVisibility,
    sharexEnabled: pick(p?.sharex_enabled, g.sharexEnabled),
    sharexDomains: g.sharexDomains,
  };
}

export async function linkPolicies(user: UserRow): Promise<Record<LinkSource, ResolvedLinkPolicy>> {
  const links = await getSetting('links');
  const p = await profileFor(user);
  return Object.fromEntries(
    LINK_SOURCES.map((s) => [s, resolveLinkPolicy(s, links, p?.link_policy, user.link_prefs)]),
  ) as Record<LinkSource, ResolvedLinkPolicy>;
}

/**
 * Chunks in flight for an uploader: their choice (or the admin default), never
 * above the admin ceiling. 0 = auto: the uploader adapts it to the measured speed.
 */
export async function effectiveParallel(user: Pick<UserRow, 'upload_parallel'> | null): Promise<{ parallel: number; parallelMax: number }> {
  const l = await getSetting('limits');
  const parallelMax = Math.max(1, l.uploadParallelMax);
  const v = user?.upload_parallel ?? l.uploadParallel;
  return { parallel: v === 0 ? 0 : Math.min(parallelMax, Math.max(1, v)), parallelMax };
}

export async function toMe(user: UserRow): Promise<Me> {
  const links = await getSetting('links');
  const limitsSetting = await getSetting('limits');
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
    role: user.role,
    authProvider: user.auth_provider,
    userCode: user.user_code,
    vanity: user.vanity,
    linkPrefs: user.link_prefs ?? {},
    limits: await effectiveLimits(user),
    linkPolicies: await linkPolicies(user),
    publicMinRandom: links.publicMinRandom,
    uploadParallel: (await effectiveParallel(user)).parallel,
    uploadParallelPref: user.upload_parallel,
    uploadParallelMax: Math.max(1, limitsSetting.uploadParallelMax),
  };
}

export async function newUserCode(): Promise<string> {
  for (;;) {
    const code = randomString(5, 'unambiguous');
    if (!(await db('users').where({ user_code: code }).first())) return code;
  }
}

/** Validates a handle usable as a link prefix (username or vanity alias). */
export async function checkHandle(handle: string, exceptUserId?: string): Promise<string | null> {
  if (!isValidHandle(handle)) return 'Format invalide : 2 à 32 caractères, minuscules, chiffres, « . », « - » ou « _ ».';
  const links = await getSetting('links');
  if (isReservedHandle(handle, links)) return 'Ce nom est réservé.';
  const clash = await db('users')
    .where((q) => q.where({ username: handle }).orWhere({ vanity: handle }).orWhere({ user_code: handle }))
    .modify((q) => { if (exceptUserId) q.whereNot({ id: exceptUserId }); })
    .first();
  return clash ? 'Ce nom est déjà utilisé.' : null;
}

/** Derives a free username from an e-mail / UPN / display name. */
export async function uniqueUsername(seed: string): Promise<string> {
  let base = sanitizeSegment(seed.split('@')[0] || 'user', true).replace(/[^a-z0-9._-]/g, '').slice(0, 28);
  if (base.length < 2) base = `user${base}`;
  if (!/^[a-z0-9]/.test(base)) base = `u${base}`;
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? base : `${base}${i + 1}`;
    if (!(await checkHandle(candidate))) return candidate;
  }
}
