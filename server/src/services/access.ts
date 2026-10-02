import type { Request } from 'express';
import { db } from '../db/knex.js';
import { isExpired, type ShareRow } from './shares.js';

export type Access =
  | { ok: true }
  | { ok: false; reason: 'login' | 'locked' | 'expired' | 'limit' | 'deleted' | 'notfound' };

/**
 * Who may open a share:
 *  - gone (expired, download cap, purged) → nobody but owner/admin can see metadata
 *  - private → any signed-in user of the instance
 *  - password → only once unlocked in this browser session
 * The owner and admins bypass login and password checks.
 */
export function checkShareAccess(req: Request, share: ShareRow): Access {
  if (share.status === 'pending') return { ok: false, reason: 'notfound' };
  if (share.status === 'deleted') return { ok: false, reason: 'deleted' };
  if (share.status === 'expired') return { ok: false, reason: 'expired' };
  const gone = isExpired(share);
  if (gone) return { ok: false, reason: gone };
  const privileged = !!req.user && (req.user.id === share.owner_id || req.user.role === 'admin');
  if (privileged) return { ok: true };
  if (share.visibility === 'private' && !req.user) return { ok: false, reason: 'login' };
  if (share.password_hash && !req.session?.unlocked?.includes(share.id)) return { ok: false, reason: 'locked' };
  return { ok: true };
}

export async function loadShare(id: string): Promise<ShareRow | undefined> {
  return db<ShareRow>('shares').where({ id }).first();
}

export function markUnlocked(req: Request, id: string) {
  const list = req.session.unlocked ?? [];
  if (!list.includes(id)) list.push(id);
  req.session.unlocked = list.slice(-200);
}
