import type { Knex } from 'knex';
import {
  buildName, buildPrefix, isReservedHandle, randomCharsIn, resolveLinkPolicy, splitExtension,
  type LinkOptions, type LinkSource, type Visibility,
} from '@ferry/shared';
import { db } from '../db/knex.js';
import { getSetting } from './settings.js';
import { profileFor, type UserRow } from './users.js';

export interface LinkRow { prefix: string; slug: string; kind: 'share' | 'request'; target_id: string }

/**
 * Reserves a unique `/{prefix}/{slug}` for a share or a request, following the
 * owner's resolved link policy. Deterministic names (original file name,
 * timestamp) get a `-2`, `-3`… suffix on collision; random names are redrawn.
 */
export async function allocateLink(opts: {
  owner: UserRow;
  source: LinkSource;
  kind: LinkRow['kind'];
  targetId: string;
  original: string;
  visibility: Visibility;
  override?: Partial<LinkOptions> | null;
  trx?: Knex.Transaction;
}): Promise<{ prefix: string; slug: string }> {
  const q = opts.trx ?? db;
  const settings = await getSetting('links');
  const profile = await profileFor(opts.owner);
  const { options } = resolveLinkPolicy(opts.source, settings, profile?.link_policy, opts.owner.link_prefs, opts.override);

  let extra = 0;
  if (opts.visibility === 'public' && settings.publicMinRandom > 0) {
    extra = Math.max(0, settings.publicMinRandom - randomCharsIn(options));
  }
  const deterministic = ['original', 'timestamp'].includes(options.nameMode) && options.prefixMode !== 'random' && extra === 0;
  const who = { username: opts.owner.username, userCode: opts.owner.user_code, vanity: opts.owner.vanity };

  for (let attempt = 0; attempt < 50; attempt++) {
    let prefix = buildPrefix(options, who);
    // e.g. the bootstrap account "admin": its handle would shadow the /admin pages.
    if (prefix && isReservedHandle(prefix, settings)) prefix = opts.owner.user_code;
    let slug = buildName(opts.original, options, extra);
    if (deterministic && attempt > 0) {
      const [base, ext] = splitExtension(slug);
      slug = `${base}-${attempt + 1}${ext}`;
    }
    // A prefixless slug must not shadow a user handle (it would hide their links).
    if (!prefix && (await q('users').where({ username: slug }).orWhere({ vanity: slug }).orWhere({ user_code: slug }).first())) continue;
    const inserted = await q('links')
      .insert({ prefix, slug, kind: opts.kind, target_id: opts.targetId })
      .onConflict(['prefix', 'slug']).ignore()
      .returning('slug');
    if (inserted.length) return { prefix, slug };
    if (!deterministic && attempt > 10) extra = Math.max(extra, 2);
  }
  throw new Error('Impossible de générer un lien unique');
}

export function linkPath(prefix: string | null, slug: string | null, file?: string): string {
  return '/' + [prefix, slug, file].filter(Boolean).map((s) => encodeURIComponent(s!)).join('/');
}

/**
 * Maps URL segments to a link row. `/a/b` is either prefix=a slug=b, or the
 * prefixless share `a` with file `b`; the prefixed reading wins.
 */
export async function resolveSegments(segs: string[]): Promise<{ link: LinkRow; fileSlug: string | null } | null> {
  if (segs.length === 0 || segs.length > 3) return null;
  const find = (prefix: string, slug: string) => db<LinkRow>('links').where({ prefix, slug }).first();
  if (segs.length === 1) {
    const link = await find('', segs[0]);
    return link ? { link, fileSlug: null } : null;
  }
  if (segs.length === 2) {
    const a = await find(segs[0], segs[1]);
    if (a) return { link: a, fileSlug: null };
    const b = await find('', segs[0]);
    return b ? { link: b, fileSlug: segs[1] } : null;
  }
  const link = await find(segs[0], segs[1]);
  return link ? { link, fileSlug: segs[2] } : null;
}
