import { BlockList, isIP } from 'node:net';

// Allow-lists of AI keys / connectors: single addresses or CIDR ranges, IPv4 or IPv6.

/** "10.0.0.1", "10.0.0.0/8", "2001:db8::/32" → canonical form, or null when invalid. */
export function canonicalIpEntry(raw: string): string | null {
  const s = raw.trim();
  const [addr, bits, extra] = s.split('/');
  if (extra !== undefined) return null;
  const family = isIP(addr);
  if (!family) return null;
  if (bits === undefined) return addr.toLowerCase();
  if (!/^\d{1,3}$/.test(bits)) return null;
  const n = Number(bits);
  if (n > (family === 4 ? 32 : 128)) return null;
  return `${addr.toLowerCase()}/${n}`;
}

/** Normalizes a list; throws the first invalid entry. */
export function normalizeIpList(list: string[]): { ok: true; ips: string[] } | { ok: false; invalid: string } {
  const out: string[] = [];
  for (const raw of list) {
    if (!raw.trim()) continue;
    const c = canonicalIpEntry(raw);
    if (!c) return { ok: false, invalid: raw.slice(0, 64) };
    if (!out.includes(c)) out.push(c);
  }
  return { ok: true, ips: out };
}

/** Does `ip` (as Express reports it, possibly IPv4-mapped IPv6) match one entry? Empty list = anywhere. */
export function ipAllowed(list: string[], ip: string | undefined): boolean {
  if (!list.length) return true;
  if (!ip) return false;
  const addr = ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const family = isIP(addr);
  if (!family) return false;
  const bl = new BlockList();
  for (const e of list) {
    const [a, bits] = e.split('/');
    const f = isIP(a) === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) bl.addAddress(a, f);
    else bl.addSubnet(a, Number(bits), f);
  }
  return bl.check(addr, family === 6 ? 'ipv6' : 'ipv4');
}
