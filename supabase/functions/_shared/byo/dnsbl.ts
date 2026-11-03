/**
 * DNSBL (DNS-based blocklist) checker.
 *
 * For each provider, we query <reversed-ip>.<zone> as A. If any record comes
 * back the IP is listed; the returned data byte (e.g. 127.0.0.2) tells you the
 * specific list within a zone (e.g. SBL vs PBL inside Spamhaus ZEN).
 *
 * We use DoH (Cloudflare + Google) via the existing dohQuery helper from
 * dns-utils so this works inside Deno edge functions where Deno.resolveDns
 * is unreliable on some Supabase regions.
 */

import { resolveMx as _resolveMx } from '../dns-utils.ts';

export interface DnsblProvider {
  /** Stable id for storage (e.g. 'spamhaus_zen') */
  id: string;
  /** Human label */
  label: string;
  /** DNSBL zone, e.g. 'zen.spamhaus.org' */
  zone: string;
  /**
   * Optional translation from DNSBL return code (e.g. '127.0.0.4') to a human
   * sub-list name. Spamhaus is the most useful here.
   */
  describeCode?: (code: string) => string | undefined;
}

export const DNSBL_PROVIDERS: DnsblProvider[] = [
  {
    id: 'spamhaus_zen',
    label: 'Spamhaus ZEN',
    zone: 'zen.spamhaus.org',
    describeCode: (code: string) => {
      if (!code) return undefined;
      const last = parseInt(code.split('.').pop() ?? '0', 10);
      if (last === 2) return 'SBL — Spamhaus Block List (manual listing)';
      if (last === 3) return 'CSS — Spamhaus CSS (snowshoe spam)';
      if (last === 4 || last === 5) return 'XBL — Exploits Block List (compromised host)';
      if (last === 9) return 'PBL — Policy Block List (residential / dynamic)';
      if (last === 10 || last === 11) return 'PBL — ISP-flagged dynamic block';
      return undefined;
    },
  },
  { id: 'barracuda', label: 'Barracuda', zone: 'b.barracudacentral.org' },
  { id: 'spamcop',   label: 'SpamCop',   zone: 'bl.spamcop.net' },
  { id: 'sorbs',     label: 'SORBS',     zone: 'dnsbl.sorbs.net' },
];

export interface DnsblHit {
  provider: string;
  label: string;
  code: string;
  description?: string;
}

export interface DnsblCheckResult {
  ip_address: string;
  hits: DnsblHit[];
  checked_at: string;
}

const DOH_RESOLVERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
];

function reverseIp(ip: string): string {
  return ip.split('.').reverse().join('.');
}

/**
 * Resolve an A record via DoH. Returns the data string of the first answer,
 * or null if there's no answer (NXDOMAIN / empty). Uses both Cloudflare and
 * Google for redundancy.
 */
async function dohResolveA(name: string, timeoutMs = 4000): Promise<string | null> {
  for (const resolver of DOH_RESOLVERS) {
    try {
      const res = await fetch(`${resolver}?name=${encodeURIComponent(name)}&type=A`, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const data = await res.json() as { Answer?: Array<{ type: number; data: string }> };
      const aRecord = (data.Answer ?? []).find((a) => a.type === 1);
      if (aRecord) return aRecord.data;
      // NXDOMAIN comes back as `Answer` undefined or `Status` != 0.
      return null;
    } catch {
      // try next resolver
    }
  }
  // All resolvers failed — treat as "unknown" (caller decides).
  return null;
}

/**
 * Check an IP against all configured DNSBLs in parallel. Returns the list of
 * providers that listed it (empty array means clean OR all queries timed out).
 */
export async function checkDnsbl(ip: string): Promise<DnsblCheckResult> {
  const reversed = reverseIp(ip);
  const checks = await Promise.all(
    DNSBL_PROVIDERS.map(async (p) => {
      const result = await dohResolveA(`${reversed}.${p.zone}`);
      if (!result) return null;
      return {
        provider: p.id,
        label: p.label,
        code: result,
        description: p.describeCode?.(result),
      } satisfies DnsblHit;
    }),
  );

  const hits = checks.filter((c): c is DnsblHit => c !== null);
  return {
    ip_address: ip,
    hits,
    checked_at: new Date().toISOString(),
  };
}
