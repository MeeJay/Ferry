// Obligate SSO routes. Browser side (mounted on /auth): /sso-redirect, the
// fixed entry point the suite's app switchers link to, and /callback.
// Server side (mounted on /api/auth before the CSRF guard): what the login
// page and the sidebar ask, and what Obligate calls with its Bearer secret.
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { formatBytes } from '@ferry/shared';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { audit } from '../services/audit.js';
import {
  connectedApps, destroyUserSessions, exchangeObligateCode, obligateBase, obligateClientId, obligateReachable,
  obligateReady, obligateRoster, obligateSettings, roleFromObligate, verifyInboundBearer,
} from '../services/obligate.js';
import { newUserCode, uniqueUsername, type UserRow } from '../services/users.js';
import { ah, baseUrl } from '../utils/http.js';
import { establishSession, safeNext } from './auth.js';

export const obligateRedirects = Router();
export const obligateApi = Router();

const callbackUri = (req: Request) => `${baseUrl(req)}/auth/callback`;

obligateRedirects.get('/sso-redirect', ah(async (req, res) => {
  const s = await obligateSettings();
  if (!obligateReady(s)) return res.redirect('/login');
  const self = baseUrl(req).replace(/\/+$/, '');
  // Never bounce to ourselves (Obligate URL set to Ferry's own address).
  if (obligateBase(s) === self) {
    logger.error({ url: s.url }, 'Obligate URL points to Ferry itself: SSO aborted');
    return res.redirect('/login?error=obligate_failed');
  }
  if (!(await obligateReachable(s))) return res.redirect('/login?error=obligate_unreachable');
  const state = crypto.randomBytes(32).toString('hex');
  const redirectUri = callbackUri(req);
  req.session.obligate = { state, redirectUri, next: safeNext(req.query.next) };
  const target = `${obligateBase(s)}/authorize?client_id=${obligateClientId(s.apiKey)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  req.session.save(() => res.redirect(target));
}));

obligateRedirects.get('/callback', ah(async (req, res) => {
  const s = await obligateSettings();
  const pending = req.session.obligate;
  delete req.session.obligate;
  const fail = (code: string, detail?: string) => {
    logger.warn({ code, detail }, 'Obligate sign-in failed');
    res.redirect(`/login?error=${code}`);
  };
  if (!obligateReady(s)) return fail('obligate_failed', 'disabled');
  if (!pending || typeof req.query.state !== 'string' || req.query.state !== pending.state) return fail('sso_state');
  if (typeof req.query.code !== 'string' || !req.query.code) return fail('obligate_failed', 'no code');

  const a = await exchangeObligateCode(s, req.query.code, pending.redirectUri);
  if (!a) return fail('obligate_failed', 'code exchange');

  const role = roleFromObligate(a.role);
  const displayName = a.displayName || a.username;
  // Our own link only (obligate_id): never an existing local account.
  let user = await db<UserRow>('users').where({ obligate_id: a.obligateUserId }).first();
  if (!user) {
    if (!s.autoCreate) return fail('sso_no_account');
    [user] = await db<UserRow>('users').insert({
      username: await uniqueUsername(`og_${a.username}`),
      display_name: displayName,
      email: a.email,
      role,
      auth_provider: 'obligate',
      obligate_id: a.obligateUserId,
      user_code: await newUserCode(),
      quota_profile_id: s.defaultProfileId ?? null,
      email_verified: true,
      last_login_at: new Date(),
    }).returning('*');
    audit(req, 'user.created', user.username, { provider: 'obligate' }, user.id);
  } else {
    // Obligate is the source of truth: identity, role and status follow it at every sign-in.
    [user] = await db<UserRow>('users').where({ id: user.id }).update({
      display_name: displayName, email: a.email, role, disabled: false, pending_approval: false, last_login_at: new Date(),
    }).returning('*');
  }
  await establishSession(req, user.id);
  audit(req, 'auth.login', user.username, { provider: 'obligate' }, user.id);
  res.redirect(pending.next);
}));

/** Login page: is Obligate on, and answering? (it then offers / redirects to it) */
obligateApi.get('/sso-config', ah(async (_req, res) => {
  const s = await obligateSettings();
  const enabled = obligateReady(s);
  res.set('Cache-Control', 'no-store').json({ enabled, reachable: enabled && (await obligateReachable(s)), autoRedirect: s.autoRedirect });
}));

/** Sidebar app switcher: suite apps the signed-in user may open. */
obligateApi.get('/connected-apps', ah(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
  const s = await obligateSettings();
  if (!obligateReady(s)) return res.json([]);
  res.json(await connectedApps(s, req.user.obligate_id));
}));

// ── Called by Obligate (Bearer) ─────────────────────────────────────────────

const SYNC_ACTIONS = ['deactivate', 'reactivate', 'delete', 'update-role', 'credentials-changed'] as const;

/**
 * A change pushed by Obligate. The push alone proves nothing (the API key may
 * be known to others), so it is only applied as far as Obligate's own roster,
 * read by us, confirms it: off the roster = access revoked; a demotion is
 * applied at once; a promotion or a reactivation waits for the next verified
 * sign-in, which carries them.
 */
obligateApi.post('/sso-user-sync', ah(async (req, res) => {
  if (!(await verifyInboundBearer(req.get('authorization')))) return res.status(401).json({ success: false });
  const id = Number(req.body?.obligateUserId);
  const action = SYNC_ACTIONS.find((x) => x === req.body?.action);
  if (!Number.isSafeInteger(id) || id <= 0 || !action) return res.status(400).json({ success: false, error: 'Missing fields' });

  const user = await db<UserRow>('users').where({ obligate_id: id }).first();
  if (!user) return res.json({ success: true });

  if (action === 'credentials-changed') {
    // Password / 2FA changed on Obligate: sign in again there.
    await destroyUserSessions(user.id);
    return res.json({ success: true });
  }
  if (action === 'reactivate') return res.json({ success: true });

  const roster = await obligateRoster(await obligateSettings());
  if (!roster) return res.status(503).json({ success: false, error: 'Obligate roster unavailable' });
  const granted = roster.get(id);
  if (!granted) {
    // deactivate / delete / role removed: the account is kept (its files stay with the admin), but locked.
    await db('users').where({ id: user.id }).update({ disabled: true });
    await destroyUserSessions(user.id);
    logger.info({ obligateUserId: id, user: user.username, action }, 'Obligate SSO: access revoked');
  } else if (roleFromObligate(granted) === 'user' && user.role === 'admin') {
    await db('users').where({ id: user.id }).update({ role: 'user' });
    await destroyUserSessions(user.id);
    logger.info({ obligateUserId: id, user: user.username }, 'Obligate SSO: admin role removed');
  }
  res.json({ success: true });
}));

/** Roles Obligate can map permission groups to. */
obligateApi.get('/app-info', ah(async (req, res) => {
  if (!(await verifyInboundBearer(req.get('authorization')))) return res.status(401).json({ success: false });
  res.json({ success: true, data: { roles: ['admin', 'user'], teams: [], tenants: [{ slug: 'default', name: 'Default' }] } });
}));

/** Counters on Ferry's card in Obligate's dashboard. */
obligateApi.get('/dashboard-stats', ah(async (req, res) => {
  if (!(await verifyInboundBearer(req.get('authorization')))) return res.status(401).json({ success: false });
  const live = () => db('shares').where({ status: 'ready' }).where((w) => w.whereNull('expires_at').orWhere('expires_at', '>', db.fn.now()));
  const [active, storage, users] = await Promise.all([
    live().count({ n: '*' }).first(),
    db('shares').whereIn('status', ['ready', 'pending']).sum({ s: 'total_size' }).first(),
    db('users').where({ disabled: false }).count({ n: '*' }).first(),
  ]);
  res.json({ success: true, data: { stats: [
    { label: 'Partages actifs', value: Number(active?.n ?? 0), color: '#3b82f6' },
    { label: 'Stockage', value: formatBytes(Number(storage?.s ?? 0)), color: '#38bdf8' },
    { label: 'Utilisateurs', value: Number(users?.n ?? 0), color: '#8b949e' },
  ] } });
}));
