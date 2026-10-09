// Obligate SSO (Obli* suite identity provider), see Obligate's
// docs/connecter-une-app-a-obligate.md. Obligate is the only source of truth:
// it says who signed in and with which role; Ferry never links an Obligate
// identity to an existing local account (og_ accounts, keyed by obligate_id).
import crypto from 'node:crypto';
import type { ConnectedApp, ObligateSettings } from '@ferry/shared';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';
import { getSetting } from './settings.js';

const OUTBOUND_TIMEOUT_MS = 5_000;

/** What Obligate asserts after a sign-in (POST /api/oauth/token/exchange). */
export interface ObligateAssertion {
  obligateUserId: number;
  username: string;
  email: string | null;
  displayName: string | null;
  role: string;
}

/** Obligate user id → the role Obligate gives them on Ferry (GET /api/apps/users). */
export type ObligateRoster = Map<number, string>;

export async function obligateSettings(): Promise<ObligateSettings> {
  return (await getSetting('auth')).obligate;
}

/** Configured and switched on: every Obligate route is off otherwise. */
export function obligateReady(s: ObligateSettings): boolean {
  return s.enabled && !!s.url && !!s.apiKey;
}

export const obligateBase = (s: ObligateSettings) => s.url.trim().replace(/\/+$/, '');

/** Public client_id: lowercase hex SHA-256 of the API key (the key itself never reaches a browser). */
export function obligateClientId(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/** Ferry role from the role Obligate grants on this app. */
export const roleFromObligate = (role: string): 'admin' | 'user' => (role.toLowerCase() === 'admin' ? 'admin' : 'user');

function safeEqual(a: string, b: string): boolean {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

/** Calls made by Obligate to Ferry: Bearer = inbound secret if set, else the API key. Fails closed. */
export async function verifyInboundBearer(header: string | undefined): Promise<boolean> {
  if (!header?.startsWith('Bearer ')) return false;
  const s = await obligateSettings();
  if (!obligateReady(s)) return false;
  return safeEqual(header.slice(7).trim(), s.inboundSecret || s.apiKey);
}

async function call(s: ObligateSettings, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${obligateBase(s)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${s.apiKey}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  });
}

export async function obligateReachable(s: ObligateSettings): Promise<boolean> {
  try {
    const res = await fetch(`${obligateBase(s)}/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function exchangeObligateCode(s: ObligateSettings, code: string, redirectUri: string): Promise<ObligateAssertion | null> {
  try {
    const res = await fetch(`${obligateBase(s)}/api/oauth/token/exchange`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn(`Obligate code exchange failed: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { success?: boolean; data?: Partial<ObligateAssertion> };
    const a = body.success ? body.data : null;
    if (!a || !Number.isSafeInteger(a.obligateUserId) || a.obligateUserId! <= 0 || typeof a.username !== 'string' || typeof a.role !== 'string') return null;
    return {
      obligateUserId: a.obligateUserId!, username: a.username, role: a.role,
      email: typeof a.email === 'string' && a.email ? a.email : null,
      displayName: typeof a.displayName === 'string' && a.displayName ? a.displayName : null,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Obligate code exchange error');
    return null;
  }
}

/** Who may use Ferry according to Obligate, read by us: null when Obligate can't be asked. */
export async function obligateRoster(s: ObligateSettings): Promise<ObligateRoster | null> {
  try {
    const res = await call(s, '/api/apps/users');
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; data?: unknown };
    if (!body.success || !Array.isArray(body.data)) return null;
    const roster: ObligateRoster = new Map();
    for (const item of body.data as Array<{ obligateUserId?: unknown; role?: unknown }>) {
      if (typeof item?.obligateUserId === 'number' && typeof item.role === 'string' && item.role) roster.set(item.obligateUserId, item.role);
    }
    return roster;
  } catch {
    return null;
  }
}

/** Suite apps for the switcher, scoped to the user's Obligate rights (all apps for local accounts). */
export async function connectedApps(s: ObligateSettings, obligateUserId: number | null): Promise<ConnectedApp[]> {
  try {
    const res = await call(s, `/api/apps/connected${obligateUserId ? `?userId=${obligateUserId}` : ''}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) return [];
    return (body.data as Array<Partial<ConnectedApp>>)
      .filter((a) => typeof a?.appType === 'string' && typeof a.baseUrl === 'string' && /^https?:\/\//i.test(a.baseUrl))
      .map((a) => ({
        appType: a.appType!,
        name: typeof a.name === 'string' ? a.name : a.appType!,
        baseUrl: a.baseUrl!.replace(/\/+$/, ''),
        icon: typeof a.icon === 'string' ? a.icon : null,
        color: typeof a.color === 'string' ? a.color : null,
        self: a.self === true || undefined,
        thirdParty: a.thirdParty === true,
      }));
  } catch {
    return [];
  }
}

/** Announces Ferry's accent color to the suite. Best effort, at startup and when settings change. */
export async function announceSelfInfo(): Promise<void> {
  const s = await obligateSettings();
  if (!obligateReady(s)) return;
  const { accent } = await getSetting('branding');
  try {
    const res = await call(s, '/api/apps/self-info', { method: 'POST', body: JSON.stringify(/^#[0-9a-f]{6}$/i.test(accent) ? { color: accent } : {}) });
    if (!res.ok) logger.warn(`Obligate self-info failed: HTTP ${res.status}`);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Obligate self-info error');
  }
}

/** Ends every session of a user (connect-pg-simple rows). */
export async function destroyUserSessions(userId: string): Promise<void> {
  await db('sessions').whereRaw(`sess->>'userId' = ?`, [userId]).delete();
}
