import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';

export function baseUrl(req: Request): string {
  return config.appUrl || `${req.protocol}://${req.get('host')}`;
}

export function absoluteUrl(req: Request, path: string): string {
  return `${baseUrl(req)}${path}`;
}

/** Wraps an async handler so rejections reach the error middleware (Express 4). */
export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Données invalides', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  }
  const status = typeof err.status === 'number' ? err.status : 500;
  if (status >= 500) logger.error({ err, url: req.originalUrl }, 'request failed');
  if (res.headersSent) return res.end();
  res.status(status).json({ error: status >= 500 ? 'Erreur interne' : err.message });
}
