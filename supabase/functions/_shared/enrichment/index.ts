/**
 * Contact Enrichment System
 *
 * Provides a unified interface for enriching contact data from multiple providers:
 * - Apollo.io: Email + phone enrichment from LinkedIn profiles
 * - Hunter.io: Email finder from company/domain
 * - Clearbit: Company data enrichment
 * - RocketReach: Email + phone + social profiles
 * - Prospeo: Email finder and verification
 *
 * @see Plan Phase 8: Enrichment Backend
 */

import { decryptApiKey } from '../unipile-client.ts';

// ============================================================================
// Provider Types
// ============================================================================

export type EnrichmentProvider = 'apollo' | 'hunter' | 'clearbit' | 'rocketreach' | 'prospeo' | 'moltsets' | 'quickenrich';

export type EnrichmentType = 'email' | 'phone' | 'company' | 'social' | 'full';

// ============================================================================
// Input Types
// ============================================================================

export interface EnrichmentInput {
  // LinkedIn data (most common source)
  linkedinUrl?: string;
  linkedinId?: string;

  // Name-based lookup
  firstName?: string;
  lastName?: string;
  fullName?: string;

  // Company/domain lookup
  companyName?: string;
  companyDomain?: string;

  // Existing identifiers
  email?: string;
  phone?: string;
}

export interface EnrichmentRequest {
  contactId: string;
  organizationId: string;
  input: EnrichmentInput;
  enrichmentTypes: EnrichmentType[];
  preferredProviders?: EnrichmentProvider[];
  /** Restrict execution to preferredProviders instead of falling through. */
  strictPreferredProviders?: boolean;
  priority?: number;
}

// ============================================================================
// Result Types
// ============================================================================

export interface EnrichmentResult {
  success: boolean;
  provider: EnrichmentProvider;
  creditsUsed: number;
  data: EnrichedData;
  error?: EnrichmentError;
  metadata?: Record<string, unknown>;
}

export interface EnrichedData {
  // Email data
  email?: string;
  emailVerified?: boolean;
  emailConfidence?: number; // 0-100
  alternateEmails?: string[];
  /** Raw classification returned by the provider (e.g. MoltSets), NOT a confidence/verification signal */
  emailType?: 'business' | 'personal';
  /** Raw last-validated timestamp returned by the provider, if any */
  emailLastValidatedAt?: string | null;

  // Phone data
  phone?: string;
  phoneType?: 'mobile' | 'work' | 'direct' | 'hq';
  alternatePhones?: string[];

  // Company data
  company?: EnrichedCompany;

  // Social profiles
  socialProfiles?: SocialProfile[];

  // Professional info
  title?: string;
  seniority?: string;
  department?: string;

  // Location
  location?: string;
  city?: string;
  state?: string;
  country?: string;

  // Raw response for debugging
  rawResponse?: Record<string, unknown>;
}

export interface EnrichedCompany {
  name: string;
  domain?: string;
  industry?: string;
  size?: string;
  sizeRange?: { min: number; max: number };
  revenue?: string;
  revenueRange?: { min: number; max: number };
  linkedinUrl?: string;
  website?: string;
  description?: string;
  location?: string;
  foundedYear?: number;
  technologies?: string[];
}

export interface SocialProfile {
  platform: 'linkedin' | 'twitter' | 'facebook' | 'instagram' | 'github';
  url: string;
  username?: string;
}

export interface EnrichmentError {
  code: EnrichmentErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type EnrichmentErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'AUTHENTICATION_FAILED'
  | 'PROVIDER_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

// ============================================================================
// Provider Interface
// ============================================================================

export interface EnrichmentAdapter {
  /** Provider identifier */
  readonly provider: EnrichmentProvider;

  /** Enrichment types this provider supports */
  readonly supportedTypes: EnrichmentType[];

  /** Credits per enrichment (for cost tracking) */
  readonly creditsPerEnrichment: number;

  /**
   * Enrich a contact using this provider
   */
  enrich(
    apiKey: string,
    input: EnrichmentInput,
    types: EnrichmentType[]
  ): Promise<EnrichmentResult>;

  /**
   * Check if this provider can handle the given input
   */
  canHandle(input: EnrichmentInput, types: EnrichmentType[]): boolean;

  /**
   * Validate API key (optional health check)
   */
  validateApiKey?(apiKey: string): Promise<boolean>;
}

// ============================================================================
// Provider Configuration
// ============================================================================

export interface ProviderConfig {
  apiKeyEncrypted: string;
  isEnabled: boolean;
  priority: number;
  monthlyCreditsLimit?: number;
  creditsUsedThisMonth?: number;
  settings?: Record<string, unknown>;
  /** Return an error result to skip the provider before spending a request. */
  beforeEnrich?: () => Promise<EnrichmentResult | null>;
  /** Observe/refund provider-level outcomes after the API call. */
  afterEnrich?: (result: EnrichmentResult) => Promise<void>;
}

// ============================================================================
// Enrichment Router
// ============================================================================

export class EnrichmentRouter {
  private adapters: Map<EnrichmentProvider, EnrichmentAdapter> = new Map();
  private providerConfigs: Map<EnrichmentProvider, ProviderConfig> = new Map();
  private encryptionKey: string;

  constructor(encryptionKey: string) {
    this.encryptionKey = encryptionKey;
  }

  /**
   * Register an enrichment adapter
   */
  registerAdapter(adapter: EnrichmentAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  /**
   * Configure a provider with API key and settings
   */
  configureProvider(provider: EnrichmentProvider, config: ProviderConfig): void {
    this.providerConfigs.set(provider, config);
  }

  /**
   * Get all configured and enabled providers
   */
  getAvailableProviders(): EnrichmentProvider[] {
    return Array.from(this.providerConfigs.entries())
      .filter(([_, config]) => config.isEnabled)
      .filter(([provider]) => this.adapters.has(provider))
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([provider]) => provider);
  }

  /**
   * Check if a provider has quota remaining
   */
  hasQuotaRemaining(provider: EnrichmentProvider): boolean {
    const config = this.providerConfigs.get(provider);
    if (!config) return false;
    if (!config.monthlyCreditsLimit) return true; // No limit set

    const adapter = this.adapters.get(provider);
    const creditsNeeded = adapter?.creditsPerEnrichment || 1;

    return (config.creditsUsedThisMonth || 0) + creditsNeeded <= config.monthlyCreditsLimit;
  }

  /**
   * Find the best provider for a given enrichment request
   */
  findBestProvider(
    input: EnrichmentInput,
    types: EnrichmentType[],
    preferredProviders?: EnrichmentProvider[]
  ): EnrichmentProvider | null {
    const available = this.getAvailableProviders();

    // Filter by preference if specified
    const candidates = preferredProviders
      ? available.filter(p => preferredProviders.includes(p))
      : available;

    // Find first provider that can handle the request and has quota
    for (const provider of candidates) {
      const adapter = this.adapters.get(provider);
      if (!adapter) continue;

      if (adapter.canHandle(input, types) && this.hasQuotaRemaining(provider)) {
        return provider;
      }
    }

    // If no preferred provider found, try all available
    if (preferredProviders && preferredProviders.length > 0) {
      for (const provider of available) {
        if (candidates.includes(provider)) continue;

        const adapter = this.adapters.get(provider);
        if (!adapter) continue;

        if (adapter.canHandle(input, types) && this.hasQuotaRemaining(provider)) {
          return provider;
        }
      }
    }

    return null;
  }

  /**
   * Enrich a contact using the best available provider with fallback
   */
  async enrich(request: EnrichmentRequest): Promise<EnrichmentResult> {
    const { input, enrichmentTypes, preferredProviders, strictPreferredProviders } = request;

    // Get all available providers, sorted by priority
    const availableProviders = this.getAvailableProviders();

    // If preferred providers specified, try them first
    const providersToTry: EnrichmentProvider[] = [];
    if (preferredProviders && preferredProviders.length > 0) {
      for (const p of preferredProviders) {
        if (availableProviders.includes(p)) {
          providersToTry.push(p);
        }
      }
    }
    // Most callers want a broad fallback. List-processing policies instead
    // supply an explicit ordered chain, so preserve it exactly.
    if (!strictPreferredProviders) {
      for (const p of availableProviders) {
        if (!providersToTry.includes(p)) providersToTry.push(p);
      }
    }

    if (providersToTry.length === 0) {
      return {
        success: false,
        provider: 'apollo', // default for error
        creditsUsed: 0,
        data: {},
        error: {
          code: 'PROVIDER_ERROR',
          message: 'No available provider can handle this enrichment request',
          retryable: false,
        },
      };
    }

    // Try each provider until we get an email
    let lastResult: EnrichmentResult | null = null;
    let totalCreditsUsed = 0;

    for (const provider of providersToTry) {
      const adapter = this.adapters.get(provider);
      const config = this.providerConfigs.get(provider);

      if (!adapter || !config) continue;
      if (!adapter.canHandle(input, enrichmentTypes)) continue;
      if (!this.hasQuotaRemaining(provider)) continue;

      const preflightResult = await config.beforeEnrich?.();
      if (preflightResult) {
        lastResult = preflightResult;
        continue;
      }

      // Decrypt API key
      let apiKey: string;
      try {
        apiKey = await decryptApiKey(config.apiKeyEncrypted, this.encryptionKey);
      } catch (error) {
        console.error(`Failed to decrypt API key for ${provider}:`, error);
        continue;
      }

      // Execute enrichment
      console.log(`Trying enrichment with provider: ${provider}`);
      const result = await adapter.enrich(apiKey, input, enrichmentTypes);
      await config.afterEnrich?.(result);
      totalCreditsUsed += result.creditsUsed;
      lastResult = result;

      // If we found an email, we're done
      if (result.success && result.data.email) {
        console.log(`Found email with ${provider}: ${result.data.email}`);
        return { ...result, creditsUsed: totalCreditsUsed };
      }

      console.log(`No email found with ${provider}, trying next provider...`);
    }

    // Return last result (or error if none)
    if (lastResult) {
      return { ...lastResult, creditsUsed: totalCreditsUsed };
    }

    return {
      success: false,
      provider: providersToTry[0] || 'apollo',
      creditsUsed: totalCreditsUsed,
      data: {},
      error: {
        code: 'NOT_FOUND',
        message: 'No email found with any available provider',
        retryable: false,
      },
    };
  }

  /**
   * Enrich with a specific provider
   */
  async enrichWithProvider(
    provider: EnrichmentProvider,
    input: EnrichmentInput,
    types: EnrichmentType[]
  ): Promise<EnrichmentResult> {
    const adapter = this.adapters.get(provider);
    const config = this.providerConfigs.get(provider);

    if (!adapter) {
      return {
        success: false,
        provider,
        creditsUsed: 0,
        data: {},
        error: {
          code: 'PROVIDER_ERROR',
          message: `Provider ${provider} not registered`,
          retryable: false,
        },
      };
    }

    if (!config || !config.isEnabled) {
      return {
        success: false,
        provider,
        creditsUsed: 0,
        data: {},
        error: {
          code: 'PROVIDER_ERROR',
          message: `Provider ${provider} not configured or disabled`,
          retryable: false,
        },
      };
    }

    if (!this.hasQuotaRemaining(provider)) {
      return {
        success: false,
        provider,
        creditsUsed: 0,
        data: {},
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'Monthly quota exceeded for this provider',
          retryable: false,
        },
      };
    }

    const preflightResult = await config.beforeEnrich?.();
    if (preflightResult) return preflightResult;

    // Decrypt API key
    let apiKey: string;
    try {
      apiKey = await decryptApiKey(config.apiKeyEncrypted, this.encryptionKey);
    } catch (error) {
      return {
        success: false,
        provider,
        creditsUsed: 0,
        data: {},
        error: {
          code: 'AUTHENTICATION_FAILED',
          message: 'Failed to decrypt API key',
          retryable: false,
        },
      };
    }

    const result = await adapter.enrich(apiKey, input, types);
    await config.afterEnrich?.(result);
    return result;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract LinkedIn username from URL
 */
export function extractLinkedInUsername(url: string): string | null {
  if (!url) return null;

  // Match patterns like:
  // https://www.linkedin.com/in/username/
  // https://linkedin.com/in/username
  // linkedin.com/in/username
  const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/i);
  return match ? match[1] : null;
}

/**
 * Extract domain from email
 */
export function extractDomainFromEmail(email: string): string | null {
  if (!email) return null;
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}

/**
 * Normalize company domain
 */
export function normalizeDomain(domain: string): string {
  if (!domain) return '';
  return domain
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .replace(/\/$/, '')
    .split('/')[0];
}

/**
 * Parse name into first/last
 */
export function parseName(fullName: string): { firstName: string; lastName: string } {
  if (!fullName) return { firstName: '', lastName: '' };

  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone format (basic)
 */
export function isValidPhone(phone: string): boolean {
  if (!phone) return false;
  // Remove non-digits
  const digits = phone.replace(/\D/g, '');
  // Should have 10-15 digits
  return digits.length >= 10 && digits.length <= 15;
}

// Re-export adapters
export { ApolloAdapter } from './apollo.ts';
export { HunterAdapter } from './hunter.ts';
export { ProspeoAdapter } from './prospeo.ts';
export { MoltsetsAdapter } from './moltsets.ts';
export { QuickenrichAdapter } from './quickenrich.ts';
