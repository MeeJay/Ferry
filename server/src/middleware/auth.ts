import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/knex.js';
import { getUser, type UserRow } from '../services/users.js';

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

/** Attaches req.user from the session cookie or an API token (ShareX / curl). */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.get('authorization');
    const raw = header?.startsWith('Bearer ') ? header.slice(7).trim() : req.get('x-ferry-token');
    if (raw) {
      const tok = await db('api_tokens').where({ token_hash: hashToken(raw) }).first();
      if (tok) {
        const user = await getUser(tok.user_id);
        if (user && !user.disabled) {
          req.user = user;
          req.viaToken = true;
          db('api_tokens').where({ id: tok.id }).update({ last_used_at: db.fn.now() }).catch(() => {});
        }
      }
    } else if (req.session?.userId) {
      const user = await getUser(req.session.userId);
      if (user && !user.disabled) req.user = user;
      else delete req.session.userId;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs' });
  next();
}

/**
 * CSRF guard for cookie-authenticated writes: a cross-site form cannot set a
 * custom header, and a cross-site fetch with one would need a CORS preflight
 * we never grant. Token-authenticated requests carry no ambient credential.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.viaToken) return next();
  if (req.get('x-requested-with') !== 'ferry') return res.status(403).json({ error: 'En-tête X-Requested-With manquant' });
  next();
}

export function isOwnerOrAdmin(user: UserRow | undefined, ownerId: string) {
  return !!user && (user.id === ownerId || user.role === 'admin');
}
