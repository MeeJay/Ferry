import crypto from 'node:crypto';
import type { Request } from 'express';
import type { InviteDTO } from '@ferry/shared';
import { db } from '../db/knex.js';
import { hashToken } from '../middleware/auth.js';
import { notifyEvent } from './mail.js';
import { absoluteUrl, baseUrl } from '../utils/http.js';
import type { UserRow } from './users.js';

export interface InviteRow {
  id: string;
  token_hash: string;
  email: string | null;
  display_name: string | null;
  role: 'admin' | 'user';
  profile_id: string | null;
  note: string | null;
  expires_at: Date;
  used_at: Date | null;
  used_by: string | null;
  created_by: string | null;
  created_at: Date;
}

export const newSecret = () => crypto.randomBytes(24).toString('base64url');

export function inviteDTO(i: InviteRow): InviteDTO {
  return {
    id: i.id,
    email: i.email,
    displayName: i.display_name,
    role: i.role,
    profileId: i.profile_id,
    note: i.note,
    expiresAt: new Date(i.expires_at).toISOString(),
    usedAt: i.used_at ? new Date(i.used_at).toISOString() : null,
    usedBy: i.used_by,
    createdBy: i.created_by,
    createdAt: new Date(i.created_at).toISOString(),
  };
}

/** A usable invite for this raw token, or null (unknown, used or expired). */
export async function findInvite(token: string): Promise<InviteRow | null> {
  const row = await db<InviteRow>('invites').where({ token_hash: hashToken(token) }).first();
  if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

export const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Issues a 48 h e-mail verification link and mails it. */
export async function sendVerification(req: Request, user: UserRow) {
  if (!user.email) return;
  const token = newSecret();
  await db('email_tokens').where({ user_id: user.id, purpose: 'verify', used_at: null }).delete();
  await db('email_tokens').insert({
    user_id: user.id, token_hash: hashToken(token), purpose: 'verify', expires_at: new Date(Date.now() + 48 * 3600_000),
  });
  notifyEvent('account_verify', user.email, {
    name: user.display_name, link: absoluteUrl(req, `/verify-email?token=${token}`),
  }, baseUrl(req));
}

/** Tells every active administrator with an e-mail that an account awaits approval. */
export async function notifyAdminsPending(req: Request, user: UserRow) {
  const admins = await db<UserRow>('users').where({ role: 'admin', disabled: false }).whereNotNull('email').select('email');
  const to = admins.map((a) => a.email!).filter(Boolean);
  if (!to.length) return;
  notifyEvent('account_pending', to, {
    name: user.display_name, username: user.username, email: user.email ?? '—',
    link: absoluteUrl(req, '/admin/users?filter=pending'),
  }, baseUrl(req));
}
