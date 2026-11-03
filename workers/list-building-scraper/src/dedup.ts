import type { DiscoveredCompany } from './types.js';

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const withProto = input.startsWith('http') ? input : `https://${input}`;
    const u = new URL(withProto);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return input.replace(/^www\./i, '').toLowerCase() || null;
  }
}

export function dedupeCompanies(list: DiscoveredCompany[]): DiscoveredCompany[] {
  const byKey = new Map<string, DiscoveredCompany>();
  for (const c of list) {
    const key =
      normalizeDomain(c.domain) ||
      normalizeDomain(c.website_url) ||
      c.linkedin_url ||
      c.company_name.toLowerCase().trim();
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, c);
      continue;
    }
    // Merge — prefer non-null fields from either side.
    byKey.set(key, {
      ...prev,
      domain: prev.domain ?? c.domain ?? normalizeDomain(c.website_url),
      website_url: prev.website_url ?? c.website_url,
      linkedin_url: prev.linkedin_url ?? c.linkedin_url,
      phone: prev.phone ?? c.phone,
      address: prev.address ?? c.address,
      city: prev.city ?? c.city,
      state: prev.state ?? c.state,
      country: prev.country ?? c.country,
      employee_signal: prev.employee_signal ?? c.employee_signal,
      employee_count_estimate: prev.employee_count_estimate ?? c.employee_count_estimate,
    });
  }
  return Array.from(byKey.values());
}
