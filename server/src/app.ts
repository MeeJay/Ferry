import express from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import helmet from 'helmet';
import { config } from './config.js';
import { csrfGuard, loadUser } from './middleware/auth.js';
import { authApi, authRedirects } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { sharesRouter } from './routes/shares.js';
import { requestsRouter } from './routes/requests.js';
import { meRouter } from './routes/me.js';
import { adminRouter } from './routes/admin.js';
import { sharexRouter } from './routes/sharex.js';
import { serveRouter } from './routes/serve.js';
import { tus } from './routes/upload.js';
import { chunksRouter } from './routes/chunks.js';
import { errorHandler } from './utils/http.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustedProxies.split(',').map((s) => s.trim()).filter(Boolean));
  app.set('chunkSize', config.uploadChunkMb * 1024 * 1024);
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => res.json({ ok: true, version: config.version }));

  // tus must see the raw body: mounted before any parser.
  const tusHandler: express.RequestHandler = (req, res) => { tus.handle(req, res); };
  app.all('/api/upload', tusHandler);
  app.all('/api/upload/*', tusHandler);
  // Parallel chunked uploads: raw request bodies, token-authenticated.
  app.use('/api/chunks', chunksRouter);

  app.use(helmet({
    contentSecurityPolicy: false, // the SPA's CSP is set by the client nginx; raw files set their own
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // let chat apps embed public images
  }));
  app.use(express.json({ limit: '1mb' }));

  const PgStore = connectPg(session);
  app.use(session({
    store: new PgStore({ conString: config.databaseUrl, createTableIfMissing: true, tableName: 'sessions', pruneSessionInterval: 3600 }),
    name: 'ferry.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies === 'auto' ? 'auto' : config.secureCookies === 'true',
      maxAge: 14 * 24 * 3600_000,
    },
  }));
  app.use(loadUser);

  app.use('/branding', express.static(config.dirs.branding, {
    maxAge: '7d',
    setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox"),
  }));
  app.use('/auth', authRedirects);

  // ShareX first: token-authenticated, multipart, exempt from the CSRF header.
  app.use('/api/sharex', sharexRouter);
  app.use('/api', csrfGuard);
  app.use('/api/auth', authApi);
  app.use('/api/public', publicRouter);
  app.use('/api/shares', sharesRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/me', meRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue' }));

  app.use(serveRouter);
  app.use(errorHandler);
  return app;
}

