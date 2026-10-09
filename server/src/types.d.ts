import type { UserRow } from './services/users.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
      /** Set when the request authenticated with an API token (ShareX) instead of a session. */
      viaToken?: boolean;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    /** Share / request ids whose password was entered in this browser session. */
    unlocked?: string[];
    oidc?: { state: string; nonce: string; verifier: string; next: string };
    obligate?: { state: string; redirectUri: string; next: string };
  }
}

export {};
