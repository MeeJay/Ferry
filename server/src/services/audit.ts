import type { Request } from 'express';
import { db } from '../db/knex.js';
import { logger } from '../logger.js';

export function audit(req: Request | null, action: string, target?: string | null, meta: Record<string, unknown> = {}, userId?: string | null) {
  db('audit_log')
    .insert({
      user_id: userId ?? req?.user?.id ?? null,
      action,
      target: target ?? null,
      ip: req?.ip ?? null,
      meta: JSON.stringify(meta),
    })
    .catch((err) => logger.warn({ err }, 'audit insert failed'));
}
