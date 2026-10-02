import crypto from 'node:crypto';
import type { OidcSettings } from '@ferry/shared';

// Microsoft Entra ID (Azure AD) — authorization code flow + PKCE, implemented
// directly against the v2.0 endpoints. The ID token comes straight from the
// token endpoint over TLS with our client secret, so per OIDC Core §3.1.3.7
// the TLS channel authenticates the issuer; we still check iss/aud/nonce/exp.

const authority = (s: OidcSettings) => `https://login.microsoftonline.com/${encodeURIComponent(s.tenantId)}`;

export interface OidcClaims {
  sub: string;
  oid?: string;
  tid?: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  groups?: string[];
  nonce?: string;
  iss: string;
  aud: string;
  exp: number;
}

export const randomUrlToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function authorizeUrl(s: OidcSettings, redirectUri: string, state: string, nonce: string, verifier: string): string {
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({
    client_id: s.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${authority(s)}/oauth2/v2.0/authorize?${params}`;
}

export async function exchangeCode(s: OidcSettings, redirectUri: string, code: string, verifier: string, nonce: string): Promise<OidcClaims> {
  const res = await fetch(`${authority(s)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: s.clientId,
      client_secret: s.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: 'openid profile email',
    }),
  });
  const json = (await res.json()) as { id_token?: string; error_description?: string };
  if (!res.ok || !json.id_token) throw new Error(json.error_description || `Token endpoint HTTP ${res.status}`);

  const [, payload] = json.id_token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as OidcClaims;
  if (claims.aud !== s.clientId) throw new Error('ID token: audience invalide');
  if (claims.nonce !== nonce) throw new Error('ID token: nonce invalide');
  if (claims.exp * 1000 < Date.now() - 60_000) throw new Error('ID token expiré');
  if (!/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/.test(claims.iss)) throw new Error('ID token: émetteur invalide');
  if (/^[0-9a-f-]{36}$/i.test(s.tenantId) && claims.tid && claims.tid.toLowerCase() !== s.tenantId.toLowerCase()) {
    throw new Error('ID token: tenant inattendu');
  }
  return claims;
}
