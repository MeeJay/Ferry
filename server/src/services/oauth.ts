import crypto from 'node:crypto';
import express, { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { aiConnectorRedirectAllowed, type AiOAuthAuthorizeInfo } from '@ferry/shared';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { ah, baseUrl } from '../utils/http.js';
import { HttpError } from './shares.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { getUser } from './users.js';
import { sha256, type AiKeyRow } from './aiKeys.js';
import { ipAllowed } from '../utils/ip.js';

// ─── OAuth 2.1 authorization server of the Claude connectors ────────────────
//
// An AI key of kind 'connector' is a confidential, pre-registered OAuth client
// (client id + secret shown once, pasted in claude.ai « Advanced settings »):
// no dynamic registration. As the MCP authorization spec (2025-06-18) expects:
//
//   GET  /.well-known/oauth-protected-resource[/mcp]    RFC 9728 (resource /mcp)
//   GET  /.well-known/oauth-authorization-server[/mcp]  RFC 8414
//   GET  /oauth/authorize       consent page (SPA, client OAuthAuthorize.tsx)
//   GET  /api/oauth/authorize   (session) what the consent page shows
//   POST /api/oauth/authorize   (session) approve / deny → { redirectUrl }
//   POST /oauth/token           authorization_code (PKCE S256) | refresh_token
//
// Only the connector's OWNER may approve it; the tokens then act as the key
// (its owner's current limits, its rights), checked again on every /mcp call.
// Codes: 5 min, single use. Access tokens: 1 h. Refresh tokens: 60 days,
// rotated at each use; a code or refresh token presented twice revokes the
// whole authorization (a stolen copy). Only sha256 of any of them is stored.

const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TTL_SEC = 3600;
const REFRESH_TTL_MS = 60 * 86_400_000;
export const CLIENT_ID_RE = /^ferry-[A-Za-z0-9_-]{16}$/;
const DUMMY = sha256('ferry-dummy-secret');

export function newConnectorClient() {
  const clientId = `ferry-${crypto.randomBytes(12).toString('base64url')}`;
  const clientSecret = `fcs_${crypto.randomBytes(32).toString('base64url')}`;
  return { clientId, clientSecret, secretHash: sha256(clientSecret) };
}

const newToken = (prefix: 'fac' | 'fat' | 'frt') => `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;

/** Constant time, the same work whether the client exists or not. */
function secretMatches(raw: string, storedHex: string | null): boolean {
  const got = Buffer.from(sha256(raw), 'hex');
  const expected = Buffer.from(storedHex && /^[0-9a-f]{64}$/.test(storedHex) ? storedHex : DUMMY, 'hex');
  return crypto.timingSafeEqual(got, expected) && !!storedHex;
}

/** WWW-Authenticate of /mcp on 401 (RFC 9728: where a connector finds the authorization server). */
export function mcpChallenge(req: Request, description: string): string {
  return `Bearer realm="ferry", resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${description}"`;
}

async function loadConnector(clientId: unknown): Promise<AiKeyRow | null> {
  if (typeof clientId !== 'string' || !CLIENT_ID_RE.test(clientId)) return null;
  const row = await db<AiKeyRow>('ai_keys').where({ oauth_client_id: clientId, kind: 'connector' }).first();
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

const str = (v: unknown, max = 2048): string => (typeof v === 'string' ? v.slice(0, max) : '');

interface AuthorizeParams { redirectUri: string; state: string; codeChallenge: string }

/** Errors about the client or the redirect URI are shown on the page, never redirected (RFC 6749 §4.1.2.1). */
async function checkAuthorize(q: Record<string, unknown>, userId: string): Promise<{ p: AuthorizeParams; connector: AiKeyRow }> {
  if (!(await getSetting('limits')).aiKeysEnabled) throw new HttpError(403, 'Les accès IA sont désactivés sur cette instance');
  const connector = await loadConnector(q.client_id);
  if (!connector) throw new HttpError(400, 'Connecteur inconnu, expiré ou révoqué (client_id)');
  if (connector.user_id !== userId) throw new HttpError(403, 'Seul le compte qui a créé ce connecteur peut l’autoriser');
  const redirectUri = str(q.redirect_uri);
  if (!redirectUri || !aiConnectorRedirectAllowed(redirectUri)) throw new HttpError(400, 'Adresse de retour non autorisée pour un connecteur');
  if (str(q.response_type) !== 'code') throw new HttpError(400, 'Seul response_type=code est pris en charge');
  const codeChallenge = str(q.code_challenge, 256);
  if (str(q.code_challenge_method) !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    throw new HttpError(400, 'PKCE requis (code_challenge_method=S256)');
  }
  return { p: { redirectUri, state: str(q.state, 1024), codeChallenge }, connector };
}

function withParams(uri: string, params: Record<string, string>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}

interface TokenRow {
  id: number; key_id: string; kind: string; family: string; code_challenge: string | null;
  redirect_uri: string | null; expires_at: Date; used_at: Date | null;
}

type TokenResponse = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string, description: string): TokenResponse => ({ status, body: { error, error_description: description } });

async function token(body: Record<string, unknown>, authorization: string | undefined, ip: string | undefined): Promise<TokenResponse> {
  // Client authentication: client_secret_basic or client_secret_post.
  let clientId = str(body.client_id, 128);
  let secret = str(body.client_secret, 256);
  const basic = typeof authorization === 'string' && /^Basic\s+/i.test(authorization) ? authorization.replace(/^Basic\s+/i, '') : '';
  if (basic) {
    const decoded = Buffer.from(basic, 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i > 0) {
      try { clientId = decodeURIComponent(decoded.slice(0, i)); secret = decodeURIComponent(decoded.slice(i + 1)); } catch { /* invalid client below */ }
    }
  }
  const connector = await loadConnector(clientId);
  const secretOk = secretMatches(secret, connector?.oauth_secret_hash ?? null);
  if (!connector || !secretOk) return fail(401, 'invalid_client', 'Unknown client or wrong client secret');
  if (!ipAllowed(connector.allowed_ips ?? [], ip)) {
    logger.warn({ key: connector.id, ip }, 'oauth: token request from an address the connector does not allow');
    return fail(403, 'access_denied', 'This connector is not allowed from this address');
  }

  // Housekeeping: rows of this connector expired for a day.
  db('ai_oauth_tokens').where({ key_id: connector.id }).where('expires_at', '<', new Date(Date.now() - 86_400_000)).delete()
    .catch((err: Error) => logger.warn({ err: err.message }, 'oauth: cleanup failed'));

  const grant = str(body.grant_type, 64);
  const kind = grant === 'authorization_code' ? 'code' : grant === 'refresh_token' ? 'refresh' : null;
  if (!kind) return fail(400, 'unsupported_grant_type', 'grant_type is authorization_code or refresh_token');
  const raw = str(kind === 'code' ? body.code : body.refresh_token, 128);
  const row: TokenRow | undefined = raw ? await db('ai_oauth_tokens').where({ token_hash: sha256(raw), kind, key_id: connector.id }).first() : undefined;
  if (!row) return fail(400, 'invalid_grant', kind === 'code' ? 'Unknown authorization code' : 'Unknown or revoked refresh token');
  if (row.used_at) {
    // Presented twice: someone holds a copy. Revoke everything this authorization produced.
    await db('ai_oauth_tokens').where({ family: row.family }).delete();
    logger.warn({ key: connector.id, kind }, 'oauth: token replayed, authorization revoked');
    return fail(400, 'invalid_grant', 'Already used: the authorization is revoked');
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) return fail(400, 'invalid_grant', 'Expired');
  if (kind === 'code') {
    if (str(body.redirect_uri) !== row.redirect_uri) return fail(400, 'invalid_grant', 'redirect_uri does not match the authorization request');
    if (!pkceMatches(str(body.code_verifier, 256), row.code_challenge ?? '')) return fail(400, 'invalid_grant', 'PKCE verification failed');
  }
  const used = await db('ai_oauth_tokens').where({ id: row.id }).whereNull('used_at').update({ used_at: db.fn.now() });
  if (!used) return fail(400, 'invalid_grant', 'Already used');

  // The owner must still be able to use it (same checks as /mcp).
  const owner = await getUser(connector.user_id);
  if (!owner || owner.disabled || owner.pending_approval || !(await getSetting('limits')).aiKeysEnabled) {
    await db('ai_oauth_tokens').where({ family: row.family }).delete();
    return fail(400, 'invalid_grant', 'This connector cannot be used now');
  }
  const access = newToken('fat');
  const refresh = newToken('frt');
  await db.transaction(async (trx) => {
    await trx('ai_oauth_tokens').where({ family: row.family, kind: 'access' }).delete();
    await trx('ai_oauth_tokens').insert([
      { key_id: connector.id, kind: 'access', token_hash: sha256(access), family: row.family, expires_at: new Date(Date.now() + ACCESS_TTL_SEC * 1000) },
      { key_id: connector.id, kind: 'refresh', token_hash: sha256(refresh), family: row.family, expires_at: new Date(Date.now() + REFRESH_TTL_MS) },
    ]);
  });
  return { status: 200, body: { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_SEC, refresh_token: refresh, scope: connector.scopes.join(' ') } };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

/** Public part, mounted at the root before the session (no cookie involved). */
export const oauthPublicRouter = Router({ caseSensitive: true });

const publicJson = (res: Response, body: unknown) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }).json(body);
};

oauthPublicRouter.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (req, res) => {
  const origin = baseUrl(req);
  publicJson(res, { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'], resource_name: 'Ferry' });
});

oauthPublicRouter.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'], (req, res) => {
  const origin = baseUrl(req);
  publicJson(res, {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [],
  });
});

// The token endpoint is a secret-guessing surface: 30 attempts per 15 min per address.
const tokenLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true,
  handler: (_req, res) => { res.status(429).json({ error: 'slow_down', error_description: 'Too many attempts, try again later' }); } });

oauthPublicRouter.post('/oauth/token', tokenLimiter, express.urlencoded({ extended: false, limit: '16kb' }), express.json({ limit: '16kb' }), ah(async (req, res) => {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const out = await token(body, req.get('authorization'), req.ip);
  if (out.status === 401) res.set('WWW-Authenticate', 'Basic realm="ferry"');
  res.status(out.status).json(out.body);
}));

/** Session part, /api/oauth (signed in, behind the CSRF guard). */
export const oauthApiRouter = Router();
oauthApiRouter.use(requireAuth);

oauthApiRouter.get('/authorize', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { p, connector } = await checkAuthorize(req.query as Record<string, unknown>, req.user!.id);
  const info: AiOAuthAuthorizeInfo = {
    connector: { id: connector.id, name: connector.name, scopes: connector.scopes, expiresAt: connector.expires_at ? new Date(connector.expires_at).toISOString() : null },
    redirectHost: new URL(p.redirectUri).host,
  };
  res.json(info);
}));

oauthApiRouter.post('/authorize', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.viaToken) throw new HttpError(403, 'Autorisation réservée à l’interface web');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { p, connector } = await checkAuthorize(body, req.user!.id);
  const iss = baseUrl(req);
  if (body.approve !== true) return res.json({ redirectUrl: withParams(p.redirectUri, { error: 'access_denied', state: p.state, iss }) });
  const code = newToken('fac');
  await db('ai_oauth_tokens').insert({
    key_id: connector.id, kind: 'code', token_hash: sha256(code), family: crypto.randomUUID(),
    code_challenge: p.codeChallenge, redirect_uri: p.redirectUri, expires_at: new Date(Date.now() + CODE_TTL_MS),
  });
  audit(req, 'ai_key.connector_authorized', connector.id, { name: connector.name, client: new URL(p.redirectUri).host });
  res.json({ redirectUrl: withParams(p.redirectUri, { code, state: p.state, iss }) });
}));

/** Revoking a connector's authorizations (its tokens) without deleting it. */
export async function revokeConnectorTokens(keyId: string) {
  await db('ai_oauth_tokens').where({ key_id: keyId }).delete();
}
