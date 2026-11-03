/**
 * Prospeo Enrichment Adapter
 *
 * Prospeo specializes in finding and verifying email addresses from LinkedIn URLs.
 *
 * API Documentation: https://prospeo.io/api-doc
 *
 * Key Features:
 * - Email finder from LinkedIn URL
 * - Email verification
 * - Domain search
 *
 * Pricing:
 * - Free trial available
 * - Paid plans start at $39/month
 *
 * Credit costs:
 * - LinkedIn email finder: 1 credit
 * - Email verification: 0.5 credits
 */

import type {
  EnrichmentAdapter,
  EnrichmentInput,
  EnrichmentResult,
  EnrichmentType,
  EnrichedData,
  EnrichmentErrorCode,
} from './index.ts';
import { extractLinkedInUsername, normalizeDomain } from './index.ts';

const PROSPEO_API_BASE = 'https://api.prospeo.io';

// ============================================================================
// Prospeo API Types
// ============================================================================

interface ProspeoLinkedInResponse {
  response?: {
    email?: {
      email?: string;
      email_status?: 'valid' | 'invalid' | 'accept_all' | 'unknown';
    };
    first_name?: string;
    last_name?: string;
    company?: string;
    title?: string;
    linkedin_url?: string;
  };
  error?: boolean;
  message?: string;
}

interface ProspeoEmailVerifyResponse {
  response?: {
    email?: string;
    email_status?: 'valid' | 'invalid' | 'accept_all' | 'unknown';
    disposable?: boolean;
    role_account?: boolean;
    mx_records?: boolean;
    smtp_check?: boolean;
  };
  error?: boolean;
  message?: string;
}

interface ProspeoEmailFinderResponse {
  response?: {
    email?: string;
    email_status?: 'valid' | 'invalid' | 'accept_all' | 'unknown';
    first_name?: string;
    last_name?: string;
    domain?: string;
  };
  error?: boolean;
  message?: string;
  person?: {
    email?: {
      email?: string;
      status?: string;
      email_status?: string;
    };
  };
}

// ============================================================================
// Prospeo Adapter Implementation
// ============================================================================

export class ProspeoAdapter implements EnrichmentAdapter {
  readonly provider = 'prospeo' as const;
  readonly supportedTypes: EnrichmentType[] = ['email'];
  readonly creditsPerEnrichment = 1;

  /**
   * Check if this adapter can handle the given input
   */
  canHandle(input: EnrichmentInput, types: EnrichmentType[]): boolean {
    // Prospeo is best for LinkedIn URL to email lookups
    // Also supports name + domain email finder

    if (!types.includes('email') && !types.includes('full')) {
      return false; // Prospeo only does email
    }

    const hasLinkedIn = !!(input.linkedinUrl || input.linkedinId);
    const hasNameAndDomain = !!(
      (input.firstName || input.fullName) &&
      input.companyDomain
    );
    const hasEmail = !!input.email; // For verification

    return hasLinkedIn || hasNameAndDomain || hasEmail;
  }

  /**
   * Enrich a contact using Prospeo
   */
  async enrich(
    apiKey: string,
    input: EnrichmentInput,
    types: EnrichmentType[]
  ): Promise<EnrichmentResult> {
    try {
      const data: EnrichedData = {};

      // Method 1: LinkedIn URL lookup (most accurate for Prospeo)
      if (input.linkedinUrl) {
        const linkedinResult = await this.findEmailFromLinkedIn(apiKey, input.linkedinUrl);

        if (linkedinResult?.response?.email?.email) {
          data.email = linkedinResult.response.email.email;
          data.emailVerified = linkedinResult.response.email.email_status === 'valid';
          data.emailConfidence = this.getEmailConfidence(linkedinResult.response.email.email_status);
        }

        // Add any additional data from response
        if (linkedinResult?.response?.title) {
          data.title = linkedinResult.response.title;
        }
      }
      // Method 2: Name + Domain email finder
      else if ((input.firstName || input.fullName) && input.companyDomain) {
        const firstName = input.firstName || input.fullName?.split(' ')[0] || '';
        const lastName = input.lastName || input.fullName?.split(' ').slice(1).join(' ') || '';

        const finderResult = await this.findEmailByName(
          apiKey,
          firstName,
          lastName,
          input.companyDomain
        );

        const finderEmail = finderResult?.response?.email
          || finderResult?.person?.email?.email;
        const finderStatus = finderResult?.response?.email_status
          || finderResult?.person?.email?.email_status
          || finderResult?.person?.email?.status;
        if (finderEmail) {
          data.email = finderEmail;
          data.emailVerified = finderStatus?.toLowerCase() === 'valid' || finderStatus?.toLowerCase() === 'verified';
          data.emailConfidence = this.getEmailConfidence(finderStatus);
        }
      }
      // Method 3: Verify existing email
      else if (input.email) {
        const verifyResult = await this.verifyEmail(apiKey, input.email);

        if (verifyResult?.response) {
          data.email = input.email;
          data.emailVerified = verifyResult.response.email_status === 'valid';
          data.emailConfidence = this.getEmailConfidence(verifyResult.response.email_status);
        }
      }

      // Check if we found anything
      if (!data.email) {
        return {
          success: false,
          provider: this.provider,
          creditsUsed: 1,
          data: {},
          error: {
            code: 'NOT_FOUND',
            message: 'No email found for this contact',
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
      const response = await fetch(`${PROSPEO_API_BASE}/account`, {
        method: 'GET',
        headers: {
          'X-KEY': apiKey,
          'Content-Type': 'application/json',
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
   * Find email from LinkedIn URL
   */
  private async findEmailFromLinkedIn(
    apiKey: string,
    linkedinUrl: string
  ): Promise<ProspeoLinkedInResponse | null> {
    const response = await fetch(`${PROSPEO_API_BASE}/linkedin-email-finder`, {
      method: 'POST',
      headers: {
        'X-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: linkedinUrl,
      }),
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const result: ProspeoLinkedInResponse = await response.json();

    if (result.error) {
      throw new Error(result.message || 'Prospeo API error');
    }

    return result;
  }

  /**
   * Find email by name and domain
   */
  private async findEmailByName(
    apiKey: string,
    firstName: string,
    lastName: string,
    domain: string
  ): Promise<ProspeoEmailFinderResponse | null> {
    const response = await fetch(`${PROSPEO_API_BASE}/enrich-person`, {
      method: 'POST',
      headers: {
        'X-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        only_verified_email: false,
        data: {
          first_name: firstName,
          last_name: lastName,
          company_website: normalizeDomain(domain),
        },
      }),
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const result: ProspeoEmailFinderResponse = await response.json();

    if (result.error) {
      throw new Error(result.message || 'Prospeo API error');
    }

    return result;
  }

  /**
   * Verify an email address
   */
  private async verifyEmail(
    apiKey: string,
    email: string
  ): Promise<ProspeoEmailVerifyResponse | null> {
    const response = await fetch(`${PROSPEO_API_BASE}/email-verifier`, {
      method: 'POST',
      headers: {
        'X-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
      }),
    });

    if (!response.ok) {
      await this.handleApiError(response);
    }

    const result: ProspeoEmailVerifyResponse = await response.json();

    if (result.error) {
      throw new Error(result.message || 'Prospeo API error');
    }

    return result;
  }

  /**
   * Get email confidence score based on status
   */
  private getEmailConfidence(status?: string): number {
    switch (status?.toLowerCase()) {
      case 'valid':
      case 'verified':
        return 100;
      case 'accept_all':
        return 70;
      case 'unknown':
        return 40;
      case 'invalid':
        return 0;
      default:
        return 50;
    }
  }

  /**
   * Handle API error response
   */
  private async handleApiError(response: Response): Promise<never> {
    const text = await response.text();
    let message = `Prospeo API error: ${response.status}`;

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
