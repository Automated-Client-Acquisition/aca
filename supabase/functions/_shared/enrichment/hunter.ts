/**
 * Hunter.io Enrichment Adapter
 *
 * Hunter.io specializes in finding and verifying email addresses:
 * - Email finder: Find email by name + domain
 * - Email verifier: Verify if email is deliverable
 * - Domain search: Find all emails at a domain
 *
 * API Documentation: https://hunter.io/api-documentation/v2
 *
 * Pricing:
 * - Free: 25 searches/month
 * - Starter: $49/month (500 searches)
 * - Growth: $149/month (5000 searches)
 *
 * Credit costs:
 * - Email finder: 1 search
 * - Email verifier: 1 verification
 * - Domain search: 1 search per 10 results
 */

import type {
  EnrichmentAdapter,
  EnrichmentInput,
  EnrichmentResult,
  EnrichmentType,
  EnrichedData,
  EnrichedCompany,
  EnrichmentErrorCode,
} from './index.ts';
import { parseName, normalizeDomain, extractDomainFromEmail } from './index.ts';

const HUNTER_API_BASE = 'https://api.hunter.io/v2';

// ============================================================================
// Hunter API Types
// ============================================================================

interface HunterEmailFinderResponse {
  data?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    score?: number;
    position?: string;
    twitter?: string;
    linkedin_url?: string;
    phone_number?: string;
    company?: string;
    verification?: {
      date?: string;
      status?: 'valid' | 'invalid' | 'accept_all' | 'unknown' | 'webmail' | 'disposable';
    };
    sources?: Array<{
      domain: string;
      uri: string;
      extracted_on: string;
    }>;
  };
  meta?: {
    params?: Record<string, string>;
  };
  errors?: Array<{ id: string; code: number; details: string }>;
}

interface HunterDomainSearchResponse {
  data?: {
    domain?: string;
    disposable?: boolean;
    webmail?: boolean;
    accept_all?: boolean;
    pattern?: string;
    organization?: string;
    country?: string;
    state?: string;
    city?: string;
    emails?: HunterEmail[];
  };
  meta?: {
    results?: number;
    limit?: number;
    offset?: number;
  };
  errors?: Array<{ id: string; code: number; details: string }>;
}

interface HunterEmail {
  value: string;
  type?: 'personal' | 'generic';
  confidence?: number;
  first_name?: string;
  last_name?: string;
  position?: string;
  seniority?: string;
  department?: string;
  linkedin?: string;
  twitter?: string;
  phone_number?: string;
  sources?: Array<{
    domain: string;
    uri: string;
    extracted_on: string;
  }>;
}

interface HunterEmailVerifyResponse {
  data?: {
    email?: string;
    status?: 'valid' | 'invalid' | 'accept_all' | 'unknown' | 'webmail' | 'disposable';
    score?: number;
    regexp?: boolean;
    gibberish?: boolean;
    disposable?: boolean;
    webmail?: boolean;
    mx_records?: boolean;
    smtp_server?: boolean;
    smtp_check?: boolean;
    accept_all?: boolean;
    block?: boolean;
    sources?: Array<{
      domain: string;
      uri: string;
    }>;
  };
  errors?: Array<{ id: string; code: number; details: string }>;
}

// ============================================================================
// Hunter Adapter Implementation
// ============================================================================

export class HunterAdapter implements EnrichmentAdapter {
  readonly provider = 'hunter' as const;
  readonly supportedTypes: EnrichmentType[] = ['email', 'company'];
  readonly creditsPerEnrichment = 1;

  /**
   * Check if this adapter can handle the given input
   */
  canHandle(input: EnrichmentInput, types: EnrichmentType[]): boolean {
    // Hunter needs domain + name for email finder, or just domain for domain search
    // Does not support phone lookup

    if (types.includes('phone') && !types.includes('email') && !types.includes('company')) {
      return false; // Hunter doesn't do phone
    }

    const hasDomain = !!(input.companyDomain || (input.email && extractDomainFromEmail(input.email)));
    const hasName = !!(input.firstName || input.fullName);
    const hasCompany = !!input.companyName;

    // Can find email if we have name + domain
    if (types.includes('email') && hasName && hasDomain) {
      return true;
    }

    // Can search domain for all emails
    if (types.includes('company') && (hasDomain || hasCompany)) {
      return true;
    }

    // Can verify existing email
    if (types.includes('email') && input.email) {
      return true;
    }

    return false;
  }

  /**
   * Enrich a contact using Hunter.io
   */
  async enrich(
    apiKey: string,
    input: EnrichmentInput,
    types: EnrichmentType[]
  ): Promise<EnrichmentResult> {
    try {
      const data: EnrichedData = {};

      // Get domain
      const domain = input.companyDomain ||
        (input.email && extractDomainFromEmail(input.email)) ||
        null;

      // If we have name + domain, use email finder
      if ((input.firstName || input.fullName) && domain) {
        const { firstName, lastName } = input.fullName
          ? parseName(input.fullName)
          : { firstName: input.firstName || '', lastName: input.lastName || '' };

        const finderResult = await this.findEmail(apiKey, domain, firstName, lastName);

        if (finderResult) {
          if (finderResult.email) {
            data.email = finderResult.email;
            data.emailConfidence = finderResult.score;
            data.emailVerified = finderResult.verification?.status === 'valid';
          }
          if (finderResult.phone_number) {
            data.phone = finderResult.phone_number;
          }
          if (finderResult.position) {
            data.title = finderResult.position;
          }
          if (finderResult.linkedin_url) {
            data.socialProfiles = [{
              platform: 'linkedin',
              url: finderResult.linkedin_url,
            }];
          }
        }
      }
      // If we just have email, verify it
      else if (input.email) {
        const verifyResult = await this.verifyEmail(apiKey, input.email);

        if (verifyResult) {
          data.email = input.email;
          data.emailVerified = verifyResult.status === 'valid';
          data.emailConfidence = verifyResult.score;
        }
      }

      // If we want company data and have domain
      if (types.includes('company') && domain) {
        const domainResult = await this.searchDomain(apiKey, domain);

        if (domainResult) {
          data.company = this.transformDomainToCompany(domainResult);
        }
      }

      // Check if we found anything useful
      const hasData = data.email || data.company || data.phone;

      if (!hasData) {
        return {
          success: false,
          provider: this.provider,
          creditsUsed: 1,
          data: {},
          error: {
            code: 'NOT_FOUND',
            message: 'No matching data found in Hunter',
            retryable: false,
          },
        };
      }

      return {
        success: true,
        provider: this.provider,
        creditsUsed: 1,
        data,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Validate API key
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${HUNTER_API_BASE}/account?api_key=${apiKey}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Find email by name and domain
   */
  private async findEmail(
    apiKey: string,
    domain: string,
    firstName: string,
    lastName: string
  ): Promise<HunterEmailFinderResponse['data'] | null> {
    const params = new URLSearchParams({
      api_key: apiKey,
      domain: normalizeDomain(domain),
      first_name: firstName,
      last_name: lastName,
    });

    const response = await fetch(`${HUNTER_API_BASE}/email-finder?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const result: HunterEmailFinderResponse = await response.json();

    if (result.errors?.length) {
      const error = result.errors[0];
      if (error.code === 404 || error.id === 'not_found') {
        return null;
      }
      throw new Error(error.details || 'Hunter API error');
    }

    return result.data || null;
  }

  /**
   * Verify an email address
   */
  private async verifyEmail(
    apiKey: string,
    email: string
  ): Promise<HunterEmailVerifyResponse['data'] | null> {
    const params = new URLSearchParams({
      api_key: apiKey,
      email: email,
    });

    const response = await fetch(`${HUNTER_API_BASE}/email-verifier?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const result: HunterEmailVerifyResponse = await response.json();

    if (result.errors?.length) {
      const error = result.errors[0];
      throw new Error(error.details || 'Hunter API error');
    }

    return result.data || null;
  }

  /**
   * Search domain for company data and emails
   */
  private async searchDomain(
    apiKey: string,
    domain: string
  ): Promise<HunterDomainSearchResponse['data'] | null> {
    const params = new URLSearchParams({
      api_key: apiKey,
      domain: normalizeDomain(domain),
      limit: '10',
    });

    const response = await fetch(`${HUNTER_API_BASE}/domain-search?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const result: HunterDomainSearchResponse = await response.json();

    if (result.errors?.length) {
      const error = result.errors[0];
      if (error.code === 404 || error.id === 'not_found') {
        return null;
      }
      throw new Error(error.details || 'Hunter API error');
    }

    return result.data || null;
  }

  /**
   * Transform domain search result to company data
   */
  private transformDomainToCompany(data: NonNullable<HunterDomainSearchResponse['data']>): EnrichedCompany {
    const company: EnrichedCompany = {
      name: data.organization || data.domain || '',
    };

    if (data.domain) {
      company.domain = data.domain;
      company.website = `https://${data.domain}`;
    }

    if (data.country || data.state || data.city) {
      const parts = [data.city, data.state, data.country].filter(Boolean);
      company.location = parts.join(', ');
    }

    return company;
  }

  /**
   * Handle API error response
   */
  private async handleApiError(response: Response): Promise<never> {
    const text = await response.text();
    let message = `Hunter API error: ${response.status}`;

    try {
      const json = JSON.parse(text);
      if (json.errors?.length) {
        message = json.errors[0].details || message;
      }
    } catch {
      message = text || message;
    }

    const error = new Error(message) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  /**
   * Handle any error and return enrichment result
   */
  private handleError(error: unknown): EnrichmentResult {
    let code: EnrichmentErrorCode = 'UNKNOWN';
    let message = 'Unknown error';
    let retryable = false;

    if (error instanceof Error) {
      message = error.message;
      const status = (error as Error & { status?: number }).status;

      switch (status) {
        case 401:
        case 403:
          code = 'AUTHENTICATION_FAILED';
          break;
        case 404:
          code = 'NOT_FOUND';
          break;
        case 429:
          code = 'RATE_LIMITED';
          retryable = true;
          break;
        case 402:
          code = 'QUOTA_EXCEEDED';
          break;
        default:
          if (status && status >= 500) {
            code = 'PROVIDER_ERROR';
            retryable = true;
          }
      }
    }

    return {
      success: false,
      provider: this.provider,
      creditsUsed: 0,
      data: {},
      error: { code, message, retryable },
    };
  }
}
