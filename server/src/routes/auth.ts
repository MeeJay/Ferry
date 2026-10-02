import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { getSetting } from '../services/settings.js';
import { authorizeUrl, exchangeCode, randomUrlToken } from '../services/oidc.js';
import { newUserCode, toMe, uniqueUsername, verifyPassword, type UserRow } from '../services/users.js';
import { audit } from '../services/audit.js';
import { ah, baseUrl } from '../utils/http.js';

export const authApi = Router();
export const authRedirects = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

function establishSession(req: Request, userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const unlocked = req.session.unlocked;
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.unlocked = unlocked;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

/** Only same-site relative paths are accepted as post-login destinations. */
function safeNext(next: unknown): string {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/';
}

authApi.post('/login', loginLimiter, ah(async (req, res) => {
  const auth = await getSetting('auth');
  if (!auth.localLogin) return res.status(403).json({ error: 'Connexion locale désactivée' });
  const { username, password } = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
  const user = await db<UserRow>('users').whereRaw('lower(username) = ?', [username.toLowerCase().trim()]).first();
  if (!user || user.disabled || user.auth_provider !== 'local' || !(await verifyPassword(password, user.password_hash))) {
    audit(req, 'auth.login_failed', username, {}, null);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  await establishSession(req, user.id);
  await db('users').where({ id: user.id }).update({ last_login_at: db.fn.now() });
  audit(req, 'auth.login', user.username, { provider: 'local' }, user.id);
  res.json(await toMe(user));
}));

authApi.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── Entra ID ───────────────────────────────────────────────────────────────

const redirectUri = (req: Request) => `${baseUrl(req)}/auth/oidc/callback`;

authRedirects.get('/oidc/login', ah(async (req, res) => {
  const { oidc } = await getSetting('auth');
  if (!oidc.enabled || !oidc.clientId || !oidc.tenantId) return res.redirect('/login?error=sso_disabled');
  const state = randomUrlToken();
  const nonce = randomUrlToken();
  const verifier = randomUrlToken(48);
  req.session.oidc = { state, nonce, verifier, next: safeNext(req.query.next) };
  req.session.save(() => res.redirect(authorizeUrl(oidc, redirectUri(req), state, nonce, verifier)));
}));

authRedirects.get('/oidc/callback', ah(async (req, res) => {
  const { oidc } = await getSetting('auth');
  const pending = req.session.oidc;
  delete req.session.oidc;
  const fail = (code: string, detail?: string) => {
    logger.warn({ code, detail }, 'oidc login failed');
    res.redirect(`/login?error=${code}`);
  };
  if (!oidc.enabled) return fail('sso_disabled');
  if (req.query.error) return fail('sso_denied', String(req.query.error_description || req.query.error));
  if (!pending || req.query.state !== pending.state || typeof req.query.code !== 'string') return fail('sso_state');

  let claims;
  try {
    claims = await exchangeCode(oidc, redirectUri(req), req.query.code, pending.verifier, pending.nonce);
  } catch (err: any) {
    return fail('sso_token', err.message);
  }

  const subject = `${claims.tid ?? oidc.tenantId}:${claims.oid ?? claims.sub}`;
  const groups = claims.groups ?? [];
  if (oidc.allowedGroups.length && !groups.some((g) => oidc.allowedGroups.includes(g))) return fail('sso_forbidden');

  const email = claims.email || (claims.preferred_username?.includes('@') ? claims.preferred_username : null) || null;
  const displayName = claims.name || claims.preferred_username || email || 'Utilisateur';

  // Group → profile mapping is re-evaluated at every login so Entra stays the source of truth.
  const profiles = await db('quota_profiles').whereRaw('cardinality(oidc_groups) > 0').orderBy('created_at');
  const mappedProfile = profiles.find((p: any) => p.oidc_groups.some((g: string) => groups.includes(g)));

  let user = await db<UserRow>('users').where({ oidc_sub: subject }).first();
  if (!user) {
    if (!oidc.autoCreate) return fail('sso_no_account');
    [user] = await db<UserRow>('users').insert({
      username: await uniqueUsername(claims.preferred_username || email || displayName),
      display_name: displayName,
      email,
      role: oidc.adminGroups.some((g) => groups.includes(g)) ? 'admin' : 'user',
      auth_provider: 'oidc',
      oidc_sub: subject,
      user_code: await newUserCode(),
      quota_profile_id: mappedProfile?.id ?? null,
    }).returning('*');
    audit(req, 'user.created', user.username, { provider: 'oidc' }, user.id);
  } else {
    if (user.disabled) return fail('account_disabled');
    const patch: Partial<UserRow> = { display_name: displayName, email, last_login_at: new Date() };
    if (oidc.adminGroups.length) patch.role = oidc.adminGroups.some((g) => groups.includes(g)) ? 'admin' : 'user';
    if (profiles.length && mappedProfile) patch.quota_profile_id = mappedProfile.id;
    [user] = await db<UserRow>('users').where({ id: user.id }).update(patch).returning('*');
  }

  await establishSession(req, user.id);
  audit(req, 'auth.login', user.username, { provider: 'oidc' }, user.id);
  res.redirect(pending.next);
}));

authApi.get('/me', ah(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Non connecté' });
  res.json(await toMe(req.user));
}));
