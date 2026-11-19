import crypto from 'node:crypto';
import type { Request } from 'express';
import type { AiKeyDTO, AiKeyKind, AiKeyScope } from '@ferry/shared';
import { db } from '../db/knex.js';
import { getSetting } from './settings.js';
import { getUser, type UserRow } from './users.js';
import { logger } from '../logger.js';
import { ipAllowed } from '../utils/ip.js';

// Access keys of AI agents. A key acts as the account that created it, with that
// account's CURRENT limits (re-read on every call), restricted to its rights.
// It only opens the MCP server (/mcp): the REST API never accepts it, so a leaked
// key can send files and read the owner's shares, never change the account.
//
// Format `frk_<43 base64url>` (256 bits); only its sha256 is stored.
// A key of kind 'connector' has no bearer secret: it is an OAuth client
// (services/oauth.ts) whose access tokens `fat_…` act as the key.

export const KEY_PREFIX = 'frk_';
export const MAX_KEYS_PER_USER = 20;
const KEY_RE = /^frk_[A-Za-z0-9_-]{43}$/;

export interface AiKeyRow {
  id: string;
  user_id: string;
  kind: AiKeyKind;
  oauth_client_id: string | null;
  oauth_secret_hash: string | null;
  name: string;
  key_hash: string;
  key_hint: string;
  scopes: AiKeyScope[];
  expires_at: Date | null;
  created_at: Date;
  last_used_at: Date | null;
  last_ip: string | null;
  allowed_ips: string[];
}

export interface AiKeyContext { key: AiKeyRow; user: UserRow }

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const ACCESS_RE = /^fat_[A-Za-z0-9_-]{43}$/;

export function newKey(): { key: string; hash: string; hint: string } {
  const key = `${KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  return { key, hash: sha256(key), hint: `${key.slice(0, 8)}…${key.slice(-4)}` };
}

export function aiKeyDTO(k: AiKeyRow): AiKeyDTO {
  return {
    id: k.id, kind: k.kind, name: k.name, hint: k.key_hint, scopes: k.scopes, clientId: k.oauth_client_id, allowedIps: k.allowed_ips ?? [],
    expiresAt: k.expires_at ? new Date(k.expires_at).toISOString() : null,
    createdAt: new Date(k.created_at).toISOString(),
    lastUsedAt: k.last_used_at ? new Date(k.last_used_at).toISOString() : null,
    lastIp: k.last_ip,
  };
}

export type KeyRefusal = 'missing' | 'invalid' | 'expired' | 'disabled' | 'account' | 'ip';

/** Resolves `Authorization: Bearer frk_…` (key) or `fat_…` (connector token); every check is redone on each call. */
export async function authenticateKey(req: Request): Promise<AiKeyContext | KeyRefusal> {
  const header = req.get('authorization') ?? '';
  const raw = /^Bearer /i.test(header) ? header.slice(7).trim() : '';
  if (!raw) return 'missing';
  let key: AiKeyRow | undefined;
  if (ACCESS_RE.test(raw)) {
    const tok = await db('ai_oauth_tokens').where({ token_hash: sha256(raw), kind: 'access' }).first('key_id', 'expires_at');
    if (!tok) return 'invalid';
    if (new Date(tok.expires_at).getTime() <= Date.now()) return 'invalid';
    key = await db<AiKeyRow>('ai_keys').where({ id: tok.key_id, kind: 'connector' }).first();
  } else if (KEY_RE.test(raw)) {
    key = await db<AiKeyRow>('ai_keys').where({ key_hash: sha256(raw), kind: 'key' }).first();
  } else {
    return 'invalid';
  }
  return keyContext(req, key);
}

/** The checks shared by keys and connector tokens. */
export async function keyContext(req: Request, key: AiKeyRow | undefined): Promise<AiKeyContext | KeyRefusal> {
  if (!key) return 'invalid';
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return 'expired';
  if (!(await getSetting('limits')).aiKeysEnabled) return 'disabled';
  const user = await getUser(key.user_id);
  if (!user || user.disabled || user.pending_approval) return 'account';
  if (!ipAllowed(key.allowed_ips ?? [], req.ip)) {
    logger.warn({ key: key.id, ip: req.ip }, 'ai key used from an address it does not allow');
    return 'ip';
  }
  db('ai_keys').where({ id: key.id }).update({ last_used_at: db.fn.now(), last_ip: req.ip ?? null }).catch(() => {});
  return { key, user };
}

export const REFUSALS: Record<KeyRefusal, string> = {
  missing: 'Access key required: Authorization: Bearer frk_... (or connect through OAuth)',
  invalid: 'Unknown or revoked access key',
  expired: 'This access key has expired',
  disabled: 'AI access keys are disabled on this instance',
  account: 'The account of this key is disabled',
  ip: 'This access is not allowed from this address',
};
