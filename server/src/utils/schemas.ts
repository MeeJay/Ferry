import { z } from 'zod';

export const linkOptionsSchema = z.object({
  prefixMode: z.enum(['username', 'usercode', 'random', 'vanity', 'none']),
  prefixLength: z.number().int().min(3).max(32),
  nameMode: z.enum(['original', 'random', 'original_random', 'words', 'timestamp', 'uuid']),
  nameLength: z.number().int().min(2).max(32),
  alphabet: z.enum(['base62', 'lower', 'unambiguous']),
  keepExtension: z.boolean(),
  sanitize: z.boolean(),
});

export const partialLinkOptions = linkOptionsSchema.partial();

/** Link options a user may set (preferences, per-share override): no "none" prefix. */
export const userLinkOptions = partialLinkOptions.refine((o) => o.prefixMode !== 'none', {
  message: 'Le préfixe « Aucun » est réservé à l’administrateur', path: ['prefixMode'],
});

const layerEntry = <T extends z.ZodTypeAny>(t: T) => z.object({ value: t.optional(), locked: z.boolean().optional() }).optional();

export const policyLayerSchema = z.object(
  Object.fromEntries(Object.entries(linkOptionsSchema.shape).map(([k, v]) => [k, layerEntry(v as z.ZodTypeAny)])),
).partial();

export const shareOptionsSchema = z.object({
  title: z.string().max(200).nullish(),
  message: z.string().max(5000).nullish(),
  visibility: z.enum(['private', 'public']).optional(),
  password: z.string().max(200).nullish(),
  expiryHours: z.number().int().min(0).max(24 * 365 * 10).nullish(),
  maxDownloads: z.number().int().min(0).max(1_000_000).nullish(),
  notifyOnDownload: z.boolean().optional(),
  linkOverride: userLinkOptions.nullish(),
});

export const uuid = z.string().uuid();

/** Addresses a share / drop link is e-mailed to (deduplicated, max 50). */
export const recipientsSchema = z.array(z.string().trim().toLowerCase().email()).max(50).default([])
  .transform((a) => [...new Set(a)]);
