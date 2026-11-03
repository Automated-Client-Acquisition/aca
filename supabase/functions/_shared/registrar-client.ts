/**
 * Registrar DNS Client
 *
 * Unified interface for managing DNS records and URL forwarding
 * via the Porkbun API.
 */

// ============================================================================
// Types
// ============================================================================

export interface RegistrarDomain {
  domain: string;
  expiry: string;
  status: string;
}

export interface RegistrarDnsRecord {
  id?: string;
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
}

export interface RegistrarResult {
  success: boolean;
  error?: string;
}

export interface UrlForwarding {
  id?: string;
  subdomain?: string;
  url: string;
  type: string;
}

export interface RegistrarClient {
  listDomains(): Promise<RegistrarDomain[]>;
  listDnsRecords(domain: string): Promise<RegistrarDnsRecord[]>;
  createDnsRecord(domain: string, record: RegistrarDnsRecord): Promise<RegistrarResult>;
  deleteDnsRecord(domain: string, type: string, name: string, value?: string): Promise<RegistrarResult>;
  getUrlForwarding(domain: string): Promise<UrlForwarding[]>;
  setUrlForwarding(domain: string, url: string, type?: string, subdomain?: string): Promise<RegistrarResult>;
  deleteUrlForwarding(domain: string, id?: string): Promise<RegistrarResult>;
}

// ============================================================================
// Porkbun Client
// ============================================================================

class PorkbunClient implements RegistrarClient {
  private baseUrl = 'https://api.porkbun.com/api/json/v3';
  private apiKey: string;
  private secretKey: string;

  constructor(apiKey: string, secretKey: string) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
  }

  private authBody(): Record<string, string> {
    return { apikey: this.apiKey, secretapikey: this.secretKey };
  }

  private async post(path: string, body: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...this.authBody(), ...body }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      await res.text();
      throw new Error(
        `Porkbun API returned non-JSON response (${res.status}). ` +
        `This usually means the API endpoint is unavailable or the domain is not managed by Porkbun.`
      );
    }

    return res.json();
  }

  async listDomains(): Promise<RegistrarDomain[]> {
    const data = await this.post('/domain/listAll');

    if (data.status !== 'SUCCESS') {
      throw new Error(data.message || 'Failed to list domains from Porkbun');
    }

    return (data.domains || []).map((d: any) => ({
      domain: d.domain || '',
      expiry: d.expireDate || '',
      status: d.status || 'active',
    }));
  }

  async listDnsRecords(domain: string): Promise<RegistrarDnsRecord[]> {
    const data = await this.post(`/dns/retrieve/${encodeURIComponent(domain)}`);

    if (data.status !== 'SUCCESS') {
      throw new Error(data.message || 'Failed to list DNS records');
    }

    return (data.records || []).map((r: any) => ({
      id: r.id,
      type: r.type || '',
      name: r.name || '',
      value: r.content || '',
      ttl: r.ttl ? parseInt(r.ttl) : undefined,
      priority: r.prio ? parseInt(r.prio) : undefined,
    }));
  }

  /** Convert FQDN record name to Porkbun subdomain (empty string for root). */
  private toSubdomain(name: string, domain: string): string {
    if (name === domain || name === `${domain}.`) return '';
    if (name.endsWith(`.${domain}`)) return name.slice(0, -(`.${domain}`.length));
    if (name.endsWith(`.${domain}.`)) return name.slice(0, -(`.${domain}.`.length));
    return name;
  }

  async createDnsRecord(domain: string, record: RegistrarDnsRecord): Promise<RegistrarResult> {
    try {
      const subdomain = this.toSubdomain(record.name, domain);

      const body: Record<string, unknown> = {
        type: record.type,
        name: subdomain,
        content: record.value,
      };
      if (record.ttl) body.ttl = String(record.ttl);
      if (record.priority !== undefined) body.prio = String(record.priority);

      console.log(`[Porkbun] Creating ${record.type} record: name="${subdomain}" content="${record.value}" for ${domain}`);
      const data = await this.post(`/dns/create/${encodeURIComponent(domain)}`, body);

      if (data.status !== 'SUCCESS') {
        // For TXT records, editByNameType replaces ALL TXT records at that name — never use it.
        // TXT create failures are surfaced as errors instead.
        if (record.type === 'TXT') {
          return { success: false, error: data.message || 'Failed to create TXT record' };
        }
        console.warn(`[Porkbun] Create failed for ${record.type} ${record.name}: ${data.message}. Trying editByNameType...`);
        return this.editDnsRecordByNameType(domain, record);
      }

      return { success: true };
    } catch (error) {
      if (record.type === 'TXT') {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to create TXT record' };
      }
      console.warn(`[Porkbun] Create threw for ${record.type} ${record.name}: ${error}. Trying editByNameType...`);
      return this.editDnsRecordByNameType(domain, record);
    }
  }

  /** Edit an existing DNS record by type+name (Porkbun editByNameType endpoint). */
  private async editDnsRecordByNameType(domain: string, record: RegistrarDnsRecord): Promise<RegistrarResult> {
    try {
      const subdomain = this.toSubdomain(record.name, domain);
      const body: Record<string, unknown> = {
        type: record.type,
        content: record.value,
      };
      if (record.ttl) body.ttl = String(record.ttl);
      if (record.priority !== undefined) body.prio = String(record.priority);

      const path = subdomain
        ? `/dns/editByNameType/${encodeURIComponent(domain)}/${record.type}/${encodeURIComponent(subdomain)}`
        : `/dns/editByNameType/${encodeURIComponent(domain)}/${record.type}`;

      console.log(`[Porkbun] editByNameType ${record.type} subdomain="${subdomain}" for ${domain}`);
      const data = await this.post(path, body);

      if (data.status !== 'SUCCESS') {
        return { success: false, error: data.message || 'Failed to edit DNS record' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to edit DNS record' };
    }
  }

  async deleteDnsRecord(domain: string, type: string, name: string): Promise<RegistrarResult> {
    try {
      const records = await this.listDnsRecords(domain);
      const match = records.find(r => r.type === type && r.name === name);

      if (!match?.id) {
        return { success: false, error: `Record not found: ${type} ${name}` };
      }

      const data = await this.post(`/dns/delete/${encodeURIComponent(domain)}/${match.id}`);

      if (data.status !== 'SUCCESS') {
        return { success: false, error: data.message || 'Failed to delete DNS record' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete DNS record' };
    }
  }

  async getUrlForwarding(domain: string): Promise<UrlForwarding[]> {
    try {
      const data = await this.post(`/domain/getUrlForwarding/${encodeURIComponent(domain)}`);

      if (data.status !== 'SUCCESS') return [];

      return (data.forwards || []).map((f: any) => ({
        id: f.id,
        subdomain: f.subdomain || '',
        url: f.location || f.destination || '',
        type: f.type || 'temporary',
      }));
    } catch {
      return [];
    }
  }

  async setUrlForwarding(domain: string, url: string, type = 'redirect_301', subdomain = ''): Promise<RegistrarResult> {
    try {
      const pbType = type === 'redirect_302' ? 'temporary' : 'permanent';

      const data = await this.post(`/domain/addUrlForward/${encodeURIComponent(domain)}`, {
        subdomain: subdomain || '',
        location: url,
        type: pbType,
        includePath: 'yes',
        wildcard: 'yes',
      });

      if (data.status !== 'SUCCESS') {
        return { success: false, error: data.message || 'Failed to set URL forwarding' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to set URL forwarding' };
    }
  }

  async deleteUrlForwarding(domain: string, id?: string): Promise<RegistrarResult> {
    try {
      if (!id) {
        const forwards = await this.getUrlForwarding(domain);
        for (const f of forwards) {
          if (f.id) {
            await this.post(`/domain/deleteUrlForward/${encodeURIComponent(domain)}/${f.id}`);
          }
        }
        return { success: true };
      }

      const data = await this.post(`/domain/deleteUrlForward/${encodeURIComponent(domain)}/${id}`);

      if (data.status !== 'SUCCESS') {
        return { success: false, error: data.message || 'Failed to delete URL forwarding' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete URL forwarding' };
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export type RegistrarProvider = 'porkbun';

export function createRegistrarClient(
  provider: RegistrarProvider,
  credentials: { apiKey: string; secondaryKey: string }
): RegistrarClient {
  switch (provider) {
    case 'porkbun':
      return new PorkbunClient(credentials.apiKey, credentials.secondaryKey);
    default:
      throw new Error(`Unsupported registrar provider: ${provider}`);
  }
}
