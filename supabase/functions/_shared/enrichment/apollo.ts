/**
 * Apollo.io Enrichment Adapter
 *
 * Apollo.io provides comprehensive contact enrichment including:
 * - Email addresses (personal and work)
 * - Phone numbers (mobile and direct)
 * - Company data
 * - Social profiles
 *
 * API Documentation: https://apolloio.github.io/apollo-api-docs/
 *
 * Pricing:
 * - Free: 50 credits/month
 * - Paid: Starting at $49/month
 *
 * Credit costs:
 * - People search: 1 credit
 * - Email/phone enrichment: 1 credit
 * - Company enrichment: 1 credit
 */

import type {
  EnrichmentAdapter,
  EnrichmentInput,
  EnrichmentResult,
  EnrichmentType,
  EnrichedData,
  EnrichedCompany,
  SocialProfile,
  EnrichmentErrorCode,
} from './index.ts';
import { extractLinkedInUsername, parseName, normalizeDomain } from './index.ts';

const APOLLO_API_BASE = 'https://api.apollo.io/v1';

// ============================================================================
// Apollo API Types
// ============================================================================

interface ApolloPersonMatch {
  id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  email?: string;
  email_status?: 'verified' | 'valid' | 'invalid' | 'guessed' | 'unknown';
  personal_emails?: string[];
  phone_numbers?: Array<{
    raw_number: string;
    sanitized_number?: string;
    type?: string;
  }>;
  linkedin_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  github_url?: string;
  city?: string;
  state?: string;
  country?: string;
  seniority?: string;
  departments?: string[];
  organization?: ApolloOrganization;
  organization_id?: string;
}

interface ApolloOrganization {
  id: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  linkedin_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  annual_revenue?: number;
  annual_revenue_printed?: string;
  short_description?: string;
  city?: string;
  state?: string;
  country?: string;
  founded_year?: number;
  technologies?: string[];
}

interface ApolloSearchResponse {
  people?: ApolloPersonMatch[];
  pagination?: {
    page: number;
    per_page: number;
    total_entries: number;
  };
}

interface ApolloEnrichResponse {
  person?: ApolloPersonMatch;
  organization?: ApolloOrganization;
}

// ============================================================================
// Apollo Adapter Implementation
// ============================================================================

export class ApolloAdapter implements EnrichmentAdapter {
  readonly provider = 'apollo' as const;
  readonly supportedTypes: EnrichmentType[] = ['email', 'phone', 'company', 'social', 'full'];
  readonly creditsPerEnrichment = 1;

  /**
   * Check if this adapter can handle the given input
   */
  canHandle(input: EnrichmentInput, types: EnrichmentType[]): boolean {
    // Apollo needs at least one of: LinkedIn URL, name+company, or email
    const hasLinkedIn = !!(input.linkedinUrl || input.linkedinId);
    const hasNameAndCompany = !!(
      (input.firstName || input.fullName) &&
      (input.companyName || input.companyDomain)
    );
    const hasEmail = !!input.email;

    return hasLinkedIn || hasNameAndCompany || hasEmail;
  }

  /**
   * Enrich a contact using Apollo.io
   */
  async enrich(
    apiKey: string,
    input: EnrichmentInput,
    types: EnrichmentType[]
  ): Promise<EnrichmentResult> {
    try {
      console.log('Apollo enrich called with input:', JSON.stringify({
        hasLinkedIn: !!input.linkedinUrl,
        hasEmail: !!input.email,
        hasName: !!(input.firstName || input.fullName),
        linkedinUrl: input.linkedinUrl,
      }));

      // Determine best enrichment method
      let result: ApolloPersonMatch | null = null;

      // Method 1: LinkedIn URL enrichment (most accurate)
      if (input.linkedinUrl) {
        console.log('Apollo: Trying LinkedIn enrichment for:', input.linkedinUrl);
        result = await this.enrichByLinkedIn(apiKey, input.linkedinUrl);
        console.log('Apollo LinkedIn result:', result ? 'Found person' : 'No result');
      }

      // Method 2: Email enrichment
      if (!result && input.email) {
        console.log('Apollo: Trying email enrichment for:', input.email);
        result = await this.enrichByEmail(apiKey, input.email);
        console.log('Apollo email result:', result ? 'Found person' : 'No result');
      }

      // Method 3: Name + Company search
      if (!result && (input.firstName || input.fullName)) {
        console.log('Apollo: Trying name search for:', input.firstName || input.fullName);
        result = await this.searchPerson(apiKey, input);
        console.log('Apollo name search result:', result ? 'Found person' : 'No result');
      }

      if (!result) {
        return {
          success: false,
          provider: this.provider,
          creditsUsed: 1,
          data: {},
          error: {
            code: 'NOT_FOUND',
            message: 'No matching contact found in Apollo',
            retryable: false,
          },
        };
      }

      // Transform to our format
      const enrichedData = this.transformResponse(result, types);

      return {
        success: true,
        provider: this.provider,
        creditsUsed: 1,
        data: enrichedData,
        metadata: {
          apolloId: result.id,
          emailStatus: result.email_status,
        },
      };
    } catch (error) {
      console.error('Apollo enrich error:', error);
      return this.handleError(error);
    }
  }

  /**
   * Validate API key
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${APOLLO_API_BASE}/auth/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apiKey,
        },
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
   * Enrich by LinkedIn URL
   */
  private async enrichByLinkedIn(
    apiKey: string,
    linkedinUrl: string
  ): Promise<ApolloPersonMatch | null> {
    const response = await fetch(`${APOLLO_API_BASE}/people/match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        linkedin_url: linkedinUrl,
        reveal_personal_emails: true,
      }),
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const data: ApolloEnrichResponse = await response.json();
    return data.person || null;
  }

  /**
   * Enrich by email
   */
  private async enrichByEmail(
    apiKey: string,
    email: string
  ): Promise<ApolloPersonMatch | null> {
    const response = await fetch(`${APOLLO_API_BASE}/people/match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        email: email,
        reveal_personal_emails: true,
      }),
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const data: ApolloEnrichResponse = await response.json();
    return data.person || null;
  }

  /**
   * Search for a person by name and company
   */
  private async searchPerson(
    apiKey: string,
    input: EnrichmentInput
  ): Promise<ApolloPersonMatch | null> {
    const { firstName, lastName } = input.fullName
      ? parseName(input.fullName)
      : { firstName: input.firstName || '', lastName: input.lastName || '' };

    const searchParams: Record<string, unknown> = {
      page: 1,
      per_page: 1,
      reveal_personal_emails: true,
    };

    if (firstName) searchParams.person_name = `${firstName} ${lastName}`.trim();
    if (input.companyName) searchParams.q_organization_name = input.companyName;
    if (input.companyDomain) searchParams.q_organization_domains = input.companyDomain;

    const response = await fetch(`${APOLLO_API_BASE}/mixed_people/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(searchParams),
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const data: ApolloSearchResponse = await response.json();
    return data.people?.[0] || null;
  }

  /**
   * Transform Apollo response to our format
   */
  private transformResponse(
    person: ApolloPersonMatch,
    types: EnrichmentType[]
  ): EnrichedData {
    const data: EnrichedData = {};
    const includeAll = types.includes('full');

    // Email
    if (includeAll || types.includes('email')) {
      if (person.email) {
        data.email = person.email;
        data.emailVerified = person.email_status === 'verified';
        data.emailConfidence = this.getEmailConfidence(person.email_status);
      }
      if (person.personal_emails?.length) {
        data.alternateEmails = person.personal_emails;
      }
    }

    // Phone
    if (includeAll || types.includes('phone')) {
      const phones = person.phone_numbers || [];
      const primaryPhone = phones[0];
      if (primaryPhone) {
        data.phone = primaryPhone.sanitized_number || primaryPhone.raw_number;
        data.phoneType = this.mapPhoneType(primaryPhone.type);
      }
      if (phones.length > 1) {
        data.alternatePhones = phones.slice(1).map(p => p.sanitized_number || p.raw_number);
      }
    }

    // Company
    if (includeAll || types.includes('company')) {
      if (person.organization) {
        data.company = this.transformCompany(person.organization);
      }
    }

    // Social profiles
    if (includeAll || types.includes('social')) {
      const profiles: SocialProfile[] = [];

      if (person.linkedin_url) {
        profiles.push({
          platform: 'linkedin',
          url: person.linkedin_url,
          username: extractLinkedInUsername(person.linkedin_url) || undefined,
        });
      }
      if (person.twitter_url) {
        profiles.push({
          platform: 'twitter',
          url: person.twitter_url,
        });
      }
      if (person.facebook_url) {
        profiles.push({
          platform: 'facebook',
          url: person.facebook_url,
        });
      }
      if (person.github_url) {
        profiles.push({
          platform: 'github',
          url: person.github_url,
        });
      }

      if (profiles.length > 0) {
        data.socialProfiles = profiles;
      }
    }

    // Professional info (always include if available)
    if (person.title) data.title = person.title;
    if (person.seniority) data.seniority = person.seniority;
    if (person.departments?.length) data.department = person.departments[0];

    // Location
    if (person.city || person.state || person.country) {
      const parts = [person.city, person.state, person.country].filter(Boolean);
      data.location = parts.join(', ');
      data.city = person.city;
      data.state = person.state;
      data.country = person.country;
    }

    return data;
  }

  /**
   * Transform company data
   */
  private transformCompany(org: ApolloOrganization): EnrichedCompany {
    const company: EnrichedCompany = {
      name: org.name || '',
    };

    if (org.primary_domain) company.domain = org.primary_domain;
    if (org.website_url) company.website = org.website_url;
    if (org.linkedin_url) company.linkedinUrl = org.linkedin_url;
    if (org.industry) company.industry = org.industry;
    if (org.short_description) company.description = org.short_description;
    if (org.founded_year) company.foundedYear = org.founded_year;
    if (org.technologies?.length) company.technologies = org.technologies;

    // Employee count
    if (org.estimated_num_employees) {
      company.size = this.formatEmployeeCount(org.estimated_num_employees);
      company.sizeRange = this.getEmployeeRange(org.estimated_num_employees);
    }

    // Revenue
    if (org.annual_revenue_printed) {
      company.revenue = org.annual_revenue_printed;
    }
    if (org.annual_revenue) {
      company.revenueRange = {
        min: org.annual_revenue * 0.8,
        max: org.annual_revenue * 1.2,
      };
    }

    // Location
    const locationParts = [org.city, org.state, org.country].filter(Boolean);
    if (locationParts.length > 0) {
      company.location = locationParts.join(', ');
    }

    return company;
  }

  /**
   * Get email confidence score based on status
   */
  private getEmailConfidence(status?: string): number {
    switch (status) {
      case 'verified':
        return 100;
      case 'valid':
        return 90;
      case 'guessed':
        return 60;
      case 'unknown':
        return 40;
      case 'invalid':
        return 0;
      default:
        return 50;
    }
  }

  /**
   * Map Apollo phone type to our format
   */
  private mapPhoneType(type?: string): 'mobile' | 'work' | 'direct' | 'hq' {
    switch (type?.toLowerCase()) {
      case 'mobile':
      case 'cell':
        return 'mobile';
      case 'direct':
      case 'direct_dial':
        return 'direct';
      case 'hq':
      case 'corporate':
        return 'hq';
      default:
        return 'work';
    }
  }

  /**
   * Format employee count as string
   */
  private formatEmployeeCount(count: number): string {
    if (count < 10) return '1-10';
    if (count < 50) return '11-50';
    if (count < 200) return '51-200';
    if (count < 500) return '201-500';
    if (count < 1000) return '501-1000';
    if (count < 5000) return '1001-5000';
    if (count < 10000) return '5001-10000';
    return '10000+';
  }

  /**
   * Get employee count range
   */
  private getEmployeeRange(count: number): { min: number; max: number } {
    if (count < 10) return { min: 1, max: 10 };
    if (count < 50) return { min: 11, max: 50 };
    if (count < 200) return { min: 51, max: 200 };
    if (count < 500) return { min: 201, max: 500 };
    if (count < 1000) return { min: 501, max: 1000 };
    if (count < 5000) return { min: 1001, max: 5000 };
    if (count < 10000) return { min: 5001, max: 10000 };
    return { min: 10000, max: 100000 };
  }

  /**
   * Handle API error response
   */
  private async handleApiError(response: Response): Promise<never> {
    const text = await response.text();
    let message = `Apollo API error: ${response.status}`;

    try {
      const json = JSON.parse(text);
      message = json.message || json.error || message;
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
