/**
 * DNS Verification Utilities
 *
 * Shared helpers for verifying DNS records (SPF, DKIM, DMARC, MTA-STS, TLS-RPT, etc.).
 * Extracted from infra-dns-setup for reuse across edge functions.
 */

// ============================================================================
// Types
// ============================================================================

export interface VerifyResult {
  ok: boolean;
  foundValue?: string;
  error?: string;
  // Set when the expected record is present but the zone has additional
  // conflicting records that will harm deliverability (e.g. multiple SPF
  // records cause PERMERROR per RFC 7208 §3.2; multiple DMARC records cause
  // the policy to be ignored per RFC 7489 §6.6.3; extra MX records steal
  // a share of inbound mail). Surfaced to the user as a warning even when
  // `ok` is true.
  conflict?: string;
}

// ============================================================================
// DNS Verification
// ============================================================================

// Use Cloudflare + Google DNS for consistent lookups (avoids flaky results from
// Deno runtime's default resolver which may hit different nameservers each call)
const DNS_RESOLVERS = [
  { name: 'cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  { name: 'google', url: 'https://dns.google/resolve' },
];

/**
 * Query DNS over HTTPS for reliable, consistent results.
 * Falls back to Deno.resolveDns if DoH fails.
 */
async function dohQuery(name: string, type: string): Promise<{ Answer?: Array<{ type: number; data: string }> }> {
  for (const resolver of DNS_RESOLVERS) {
    try {
      const url = `${resolver.url}?name=${encodeURIComponent(name)}&type=${type}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Try next resolver
    }
  }
  throw new Error('All DNS resolvers failed');
}

// DNS record type numbers
const DNS_TYPE_MAP: Record<string, number> = { A: 1, CNAME: 5, MX: 15, TXT: 16 };

export async function verifyDnsRecord(record: { type: string; name: string; value: string; priority?: number }): Promise<VerifyResult> {
  const { type, name, value } = record;

  try {
    const result = await dohQuery(name, type);
    const answers = (result.Answer || []).filter((a) => a.type === DNS_TYPE_MAP[type]);

    switch (type) {
      case 'A': {
        const found = answers.find((a) => a.data === value);
        return {
          ok: !!found,
          foundValue: answers.map((a) => a.data).join(', '),
          error: found ? undefined : `Expected ${value}, found: ${answers.map((a) => a.data).join(', ') || 'none'}`,
        };
      }

      case 'MX': {
        // MX data format: "10 mail.example.com."
        const expectedHost = value.replace(/\.$/, '').toLowerCase();
        const parsedMx = answers
          .map((a) => {
            const parts = a.data.trim().split(/\s+/);
            return { priority: parseInt(parts[0], 10), host: (parts[1] || '').replace(/\.$/, '').toLowerCase() };
          })
          .filter((m) => m.host && !Number.isNaN(m.priority));
        const found = parsedMx.some((m) => m.host === expectedHost);
        // Any MX that isn't ours steals a share of inbound mail (round-robin
        // when priorities are equal, fallback target when ours is unreachable).
        const conflicts = parsedMx.filter((m) => m.host !== expectedHost);
        return {
          ok: found,
          foundValue: answers.map((a) => a.data).join(', '),
          error: found ? undefined : `Expected MX ${value}, found: ${answers.map((a) => a.data).join(', ') || 'none'}`,
          conflict: found && conflicts.length > 0
            ? `Extra MX record(s) detected — inbound mail will be split between hosts. Remove: ${conflicts.map((c) => `${c.host} (prio ${c.priority})`).join(', ')}`
            : undefined,
        };
      }

      case 'TXT': {
        // TXT data from DoH comes quoted, strip outer quotes
        const flatRecords = answers.map((a) => a.data.replace(/^"|"$/g, '').replace(/" "/g, ''));
        const found = flatRecords.find((r) => {
          if (value.startsWith('v=spf1')) {
            // SPF: must contain our specific IP (not just any SPF record)
            const ourIp = value.match(/ip4:([\d.]+)/)?.[1];
            return r.startsWith('v=spf1') && (!ourIp || r.includes(`ip4:${ourIp}`));
          }
          if (value.startsWith('v=DMARC1')) {
            // DMARC: must match our policy level and contain our domain
            const ourPolicy = value.match(/p=(\w+)/)?.[1];
            return r.startsWith('v=DMARC1') && (!ourPolicy || r.includes(`p=${ourPolicy}`));
          }
          if (value.startsWith('v=DKIM1') || value.includes('p=')) {
            // DKIM: must contain our actual public key (not just any p= record)
            const ourKey = value.match(/p=([A-Za-z0-9+/=]+)/)?.[1];
            if (ourKey && ourKey.length > 20) {
              // Compare first 40 chars of the key to handle minor formatting differences
              return r.includes('p=') && r.includes(ourKey.substring(0, 40));
            }
            return r.includes('p=');
          }
          if (value.startsWith('v=STSv1')) return r.startsWith('v=STSv1');
          if (value.startsWith('v=TLSRPTv1')) return r.startsWith('v=TLSRPTv1');
          return r === value;
        });

        // Duplicate-policy detection. RFC 7208 §3.2: multiple SPF records →
        // PERMERROR, SPF is treated as absent. RFC 7489 §6.6.3: multiple
        // DMARC records → policy ignored. Both kill deliverability silently
        // even when our specific record is present, so we flag them as
        // conflicts (record stays `ok`, user sees a warning).
        let conflict: string | undefined;
        if (found && value.startsWith('v=spf1')) {
          const spfRecords = flatRecords.filter((r) => r.startsWith('v=spf1'));
          if (spfRecords.length > 1) {
            conflict = `Multiple SPF records detected (${spfRecords.length}) — receivers will return PERMERROR per RFC 7208 and ignore SPF entirely. Merge into a single record. Found: ${spfRecords.join(' | ')}`;
          }
        }
        if (found && value.startsWith('v=DMARC1')) {
          const dmarcRecords = flatRecords.filter((r) => r.startsWith('v=DMARC1'));
          if (dmarcRecords.length > 1) {
            conflict = `Multiple DMARC records detected (${dmarcRecords.length}) — RFC 7489 requires a single record; receivers will ignore the policy entirely. Keep only one. Found: ${dmarcRecords.join(' | ')}`;
          }
        }

        return {
          ok: !!found,
          foundValue: flatRecords.join(' | '),
          error: found ? undefined : `Expected TXT containing our values, found: ${flatRecords.join(' | ') || 'none'}`,
          conflict,
        };
      }

      case 'CNAME': {
        const found = answers.find((a) => a.data.replace(/\.$/, '') === value.replace(/\.$/, ''));
        return {
          ok: !!found,
          foundValue: answers.map((a) => a.data).join(', '),
          error: found ? undefined : `Expected ${value}, found: ${answers.map((a) => a.data).join(', ') || 'none'}`,
        };
      }

      default:
        return { ok: false, error: `Unsupported record type: ${type}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DNS lookup failed';
    return { ok: false, error: message };
  }
}

/**
 * Resolve MX records for a domain via DoH, sorted by priority ascending.
 * Returns the bare hostnames (trailing dot stripped). Empty array on any
 * failure — never throws. Used by the list-building SMTP verifier.
 */
export async function resolveMx(domain: string): Promise<string[]> {
  if (!domain) return [];
  try {
    const result = await dohQuery(domain, 'MX');
    const answers = (result.Answer || []).filter((a) => a.type === DNS_TYPE_MAP.MX);
    const parsed: Array<{ priority: number; host: string }> = [];
    for (const a of answers) {
      // Format: "10 mail.example.com."
      const parts = a.data.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const priority = parseInt(parts[0], 10);
      const host = parts[1].replace(/\.$/, '').toLowerCase();
      if (!host || Number.isNaN(priority)) continue;
      parsed.push({ priority, host });
    }
    parsed.sort((a, b) => a.priority - b.priority);
    return parsed.map((p) => p.host);
  } catch {
    return [];
  }
}
