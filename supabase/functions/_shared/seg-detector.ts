/**
 * SEG (Secure Email Gateway) Detector
 *
 * Detects whether a domain routes mail through a known SEG vendor
 * by performing DNS-over-HTTPS (DoH) MX record lookups.
 *
 * Deno edge functions cannot use Deno.resolveDns(), so we use
 * Cloudflare/Google DoH endpoints via fetch().
 */

// ============================================================================
// Types
// ============================================================================

export interface SEGDetectionResult {
  domain: string;
  hasSEG: boolean;
  segProvider: string | null;
  mxRecords: string[];
}

// ============================================================================
// SEG Vendor MX Patterns
// ============================================================================

const SEG_MX_PATTERNS: [RegExp, string][] = [
  [/\.barracudanetworks\.com$/i, 'Barracuda'],
  [/\.mimecast\.com$/i, 'Mimecast'],
  [/\.pphosted\.com$/i, 'Proofpoint'],
  [/\.ciscocloud\.net$/i, 'Cisco IronPort'],
  [/\.iphmx\.com$/i, 'Cisco IronPort'],
  [/\.fortimailcloud\.com$/i, 'FortiMail'],
  [/\.hes\.trendmicro\.(com|eu)$/i, 'Trend Micro'],
  [/\.sophos\.com$/i, 'Sophos'],
  [/\.fireeyecloud\.com$/i, 'FireEye/Trellix'],
];

/** Standard email providers — not SEGs */
const SAFE_MX_PATTERNS: RegExp[] = [
  /\.mail\.protection\.outlook\.com$/i,
  /\.google\.com$/i,
  /\.googlemail\.com$/i,
];

// ============================================================================
// DoH MX Lookup
// ============================================================================

/**
 * Resolve MX records for a domain using DNS-over-HTTPS.
 * Tries Cloudflare first, falls back to Google.
 */
export async function resolveMX(domain: string): Promise<string[]> {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
    `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
  ];

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/dns-json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) continue;

      const data = await resp.json();

      if (data.Answer && Array.isArray(data.Answer)) {
        return data.Answer
          .filter((record: any) => record.type === 15) // MX record type
          .map((record: any) => {
            // MX data format: "priority exchange" e.g. "10 mail.example.com."
            const parts = String(record.data).trim().split(/\s+/);
            const exchange = parts.length > 1 ? parts[1] : parts[0];
            return exchange.replace(/\.$/, '').toLowerCase();
          });
      }

      return [];
    } catch (err) {
      console.warn(`[SEG] DoH lookup failed for ${domain} via ${url}:`, err);
      continue;
    }
  }

  console.error(`[SEG] All DoH endpoints failed for ${domain}`);
  return [];
}

// ============================================================================
// SEG Detection
// ============================================================================

function matchSEGVendor(mxHost: string): string | null {
  for (const safe of SAFE_MX_PATTERNS) {
    if (safe.test(mxHost)) return null;
  }

  for (const [pattern, vendor] of SEG_MX_PATTERNS) {
    if (pattern.test(mxHost)) return vendor;
  }

  return null;
}

/** Detect SEG for a single domain. */
export async function detectSEG(domain: string): Promise<SEGDetectionResult> {
  const mxRecords = await resolveMX(domain);

  for (const mx of mxRecords) {
    const vendor = matchSEGVendor(mx);
    if (vendor) {
      return { domain, hasSEG: true, segProvider: vendor, mxRecords };
    }
  }

  return { domain, hasSEG: false, segProvider: null, mxRecords };
}

/**
 * Batch detect SEG for multiple domains.
 * Processes in chunks to avoid overwhelming DoH endpoints.
 */
export async function detectSEGBatch(
  domains: string[],
  concurrency = 5,
): Promise<SEGDetectionResult[]> {
  const results: SEGDetectionResult[] = [];

  for (let i = 0; i < domains.length; i += concurrency) {
    const batch = domains.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(detectSEG));
    results.push(...batchResults);
  }

  return results;
}
