import './env.js';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

// src/ under tsx, dist/src/ once compiled: walk up to the server package.json.
const pkgPath = ['../package.json', '../../package.json'].map((p) => path.resolve(import.meta.dirname, p)).find(existsSync)!;
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

function bool(v: string | undefined, def: boolean) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const dataDir = path.resolve(process.env.DATA_DIR || './data');

export const config = {
  version: pkg.version,
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3001),
  databaseUrl: process.env.DATABASE_URL || 'postgres://ferry:changeme@localhost:5432/ferry',
  sessionSecret: process.env.SESSION_SECRET || 'change-this-in-production',
  /** Public base URL (https://share.example.com). Empty = derived from the request. */
  appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),
  /** Where the server fetches index.html to inject OpenGraph tags on share pages. */
  clientInternalUrl: (process.env.CLIENT_INTERNAL_URL || 'http://client').replace(/\/+$/, ''),
  trustedProxies: process.env.TRUSTED_PROXIES || 'loopback, linklocal, uniquelocal',
  defaultAdmin: {
    username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
    password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
  },
  secureCookies: process.env.SECURE_COOKIES || 'auto',
  dataDir,
  dirs: {
    files: path.join(dataDir, 'files'),
    tus: path.join(dataDir, 'tus'),
    tmp: path.join(dataDir, 'tmp'),
    thumbs: path.join(dataDir, 'thumbs'),
    branding: path.join(dataDir, 'branding'),
  },
  /** tus chunk ceiling: keep each request under the body limit of any reverse proxy in front. */
  uploadChunkMb: Number(process.env.UPLOAD_CHUNK_MB || 50),
  logPretty: bool(process.env.LOG_PRETTY, process.env.NODE_ENV !== 'production'),
};
