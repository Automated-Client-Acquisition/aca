/**
 * Vercel DNS client — the DNS half of RegistrarClient, for zones hosted on
 * Vercel DNS (ns1/ns2.vercel-dns.com). ACA's registrar client only spoke Porkbun,
 * so a domain whose nameservers are on Vercel (e.g. last10legal.com) could not
 * have its records changed programmatically.
 *
 * Names follow RegistrarClient: `name` may be a FQDN (`_dmarc.example.com`), the
 * apex (`example.com`), '' or '@'; they are converted to Vercel's relative form.
 * URL forwarding is not a Vercel DNS feature and is reported as unsupported.
 */

import type {
  RegistrarClient,
  RegistrarDnsRecord,
  RegistrarDomain,
  RegistrarResult,
  UrlForwarding,
} from './registrar-client.ts';

const API = 'https://api.vercel.com';

export class VercelDnsClient implements RegistrarClient {
  constructor(private token: string, private teamId?: string) {}

  private url(path: string): string {
    const u = new URL(API + path);
    if (this.teamId) u.searchParams.set('teamId', this.teamId);
    return u.toString();
  }

  private async req(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(this.url(path), {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Vercel DNS ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  /** FQDN / apex / '@' -> Vercel relative name ('' is the apex). */
  static relativeName(domain: string, name: string): string {
    const n = (name || '').trim().replace(/\.$/, '').toLowerCase();
    const d = domain.toLowerCase();
    if (n === '' || n === '@' || n === d) return '';
    return n.endsWith(`.${d}`) ? n.slice(0, -(d.length + 1)) : n;
  }

  async listDomains(): Promise<RegistrarDomain[]> {
    const data = await this.req('/v5/domains?limit=100');
    return (data?.domains ?? []).map((d: any) => ({ domain: d.name, expiry: d.expiresAt ? String(d.expiresAt) : '', status: d.verified ? 'verified' : 'unverified' }));
  }

  async listDnsRecords(domain: string): Promise<RegistrarDnsRecord[]> {
    const out: RegistrarDnsRecord[] = [];
    let until: number | undefined;
    for (let page = 0; page < 20; page++) {
      const q = `/v4/domains/${encodeURIComponent(domain)}/records?limit=100${until ? `&until=${until}` : ''}`;
      const data = await this.req(q);
      for (const r of data?.records ?? []) {
        out.push({
          id: r.id,
          type: r.type,
          name: r.name || '',
          value: r.type === 'MX' && typeof r.value === 'string' ? r.value.replace(/^\d+\s+/, '') : r.value,
          ttl: r.ttl,
          priority: r.mxPriority,
        });
      }
      const next = data?.pagination?.next;
      if (!next) break;
      until = next;
    }
    return out;
  }

  async createDnsRecord(domain: string, record: RegistrarDnsRecord): Promise<RegistrarResult> {
    const body: Record<string, unknown> = {
      type: record.type,
      name: VercelDnsClient.relativeName(domain, record.name),
      value: record.value.replace(/\.$/, ''),
      ttl: record.ttl ?? 3600,
    };
    if (record.type === 'MX') body.mxPriority = record.priority ?? 0;
    try {
      await this.req(`/v2/domains/${encodeURIComponent(domain)}/records`, { method: 'POST', body: JSON.stringify(body) });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async deleteDnsRecord(domain: string, type: string, name: string, value?: string): Promise<RegistrarResult> {
    const rel = VercelDnsClient.relativeName(domain, name);
    const records = await this.listDnsRecords(domain);
    const norm = (v: string) => (v || '').replace(/\.$/, '').toLowerCase();
    const matches = records.filter((r) =>
      r.type === type && VercelDnsClient.relativeName(domain, r.name) === rel &&
      (value === undefined || norm(r.value) === norm(value)),
    );
    try {
      for (const r of matches) {
        await this.req(`/v2/domains/${encodeURIComponent(domain)}/records/${r.id}`, { method: 'DELETE' });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  getUrlForwarding(_domain: string): Promise<UrlForwarding[]> {
    return Promise.resolve([]);
  }
  setUrlForwarding(): Promise<RegistrarResult> {
    return Promise.resolve({ success: false, error: 'URL forwarding is not supported on Vercel DNS' });
  }
  deleteUrlForwarding(): Promise<RegistrarResult> {
    return Promise.resolve({ success: false, error: 'URL forwarding is not supported on Vercel DNS' });
  }
}
