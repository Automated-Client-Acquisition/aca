/**
 * Analyze Company Edge Function
 *
 * Analyzes a single contact's company for personalization data:
 * 1. Scrapes company website (if provided) - extracts niche, offerings, verbiage
 * 2. Fetches LinkedIn posts (if linkedin_url and Unipile account provided)
 * 3. Runs AI marketing analysis to extract personalization angles
 *
 * Endpoint: POST /analyze-company
 * Body: {
 *   contactId: string,
 *   companyWebsite?: string,      // Will scrape if provided
 *   linkedinUrl?: string,         // Will fetch posts if provided
 *   unipileAccountId?: string,    // Required for LinkedIn posts
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { rateLimitedFetch } from '../_shared/openrouter-rate-limiter.ts';
import { handleOpenRouterKeyBlock, markOpenRouterKeyHealthy } from '../_shared/openrouter-credits.ts';
import { isOllamaModel, resolveOllamaConfig, resolveChatEndpoint, type ChatEndpoint } from '../_shared/llm-client.ts';
import { DEFAULT_FAST_TEXT_MODEL } from '../_shared/default-models.ts';
import { computeDecisionMakerScore, computeGenericDecisionMakerScore } from '../_shared/decision-maker-scoring.ts';
import { detectTechnologies, renderTechSignalsForPrompt, type TechSignals } from '../_shared/tech-detector.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

/**
 * MoltSets tool endpoints. Two quotas live behind this base and they are not
 * interchangeable: the enrich/lookup tools replenish (~15k/5h, 75k/week) while
 * the search tools lock for DAYS once spent. Reach for a lookup by default.
 */
const MOLTSETS_TOOLS_BASE = 'https://api.moltsets.com/api/v1/tools';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LinkedInCompanyData {
  name?: string;
  description?: string;
  tagline?: string;
  industry?: string[];
  employee_count?: number;
  employee_count_range?: { from: number; to: number };
  followers_count?: number;
  organization_type?: string;
  foundation_date?: string;
  website?: string;
  locations?: Array<{ is_headquarter: boolean; country: string; city: string; area?: string }>;
  insights?: {
    employeesCount?: {
      totalCount: number;
      averageTenure?: string;
      growthGraph?: Array<{ monthRange: number; growthPercentage: number }>;
    };
  };
  crunchbase_funding?: {
    last_updated_at?: string;
    company_url?: string;
    rounds?: {
      total_count: number;
      last_round?: {
        announced_on?: string;
        funding_type?: string;
        money_raised?: { amount: number; currency: string };
      };
    };
  };
}

interface AnalyzeCompanyRequest {
  contactId: string;
  companyWebsite?: string;
  linkedinUrl?: string;
  unipileAccountId?: string;
  model?: string; // LLM model to use for analysis
  // Product context - what you're selling (used to generate relevant primary need)
  productContext?: {
    name?: string;           // e.g., "Lead Generation Service"
    description?: string;    // e.g., "We help B2B companies get more qualified leads"
    benefits?: string[];     // e.g., ["More leads", "Higher conversion rates"]
  };
  productId?: string; // UUID of the library_products row — ties the ICP score to a specific product
  icpIds?: string[]; // Explicitly selected library_icps ids — used ahead of the product's linked ICPs
  /**
   * Opt IN to reusing a recent analysis instead of re-crawling and re-running
   * the LLM. Only honoured when the stored analysis was scoped to the SAME
   * product + ICP set (see analysis_scope) — enrichment_data.icp_score is
   * whatever the last run measured, so reusing across scopes would silently
   * gate leads on the wrong score. Omit (the default) to always re-analyze,
   * which is what Regenerate analysis and the manual/batch callers rely on.
   */
  skipIfAnalyzedWithinDays?: number;
}

/** What an analysis was measured against. Stored on enrichment_data.analysis_scope. */
type AnalysisScope = { product_id: string | null; icp_ids: string[] };

function buildAnalysisScope(productId?: string, icpIds?: string[]): AnalysisScope {
  return { product_id: productId ?? null, icp_ids: [...(icpIds ?? [])].sort() };
}

function analysisScopeMatches(stored: unknown, wanted: AnalysisScope): boolean {
  if (!stored || typeof stored !== 'object') return false;
  const scope = stored as Partial<AnalysisScope>;
  if ((scope.product_id ?? null) !== wanted.product_id) return false;
  const storedIcps = Array.isArray(scope.icp_ids) ? [...scope.icp_ids].sort() : [];
  return storedIcps.length === wanted.icp_ids.length
    && storedIcps.every((id, index) => id === wanted.icp_ids[index]);
}

interface CompanyAnalysisOutput {
  // Website analysis
  company_tagline?: string;
  company_niche?: string;
  company_offering?: string;
  company_target?: string;
  company_verbiage?: string[];
  company_priorities?: string[];  // What they're focused on/investing in

  // THE KEY INSIGHT - a HEDGED commercial hypothesis, not an asserted fact. Must
  // be readable alongside primary_need_evidence — the model is required to
  // ground it, not invent pain the evidence doesn't support.
  primary_need?: string;          // What do they need more of? (THE main angle for cold outreach) — phrased as a possibility, never a diagnosis
  primary_need_reasoning?: string; // Why we think they need this
  primary_need_evidence?: string; // The concrete, directly-stated fact this hypothesis is grounded in (quote/paraphrase). Empty if none exists.
  primary_need_confidence?: 'low' | 'medium' | 'high'; // How directly the evidence supports the hypothesis
  cold_email_angle?: string;      // One sentence, phrased as a genuine low-pressure question/observation — safe to use even if the hypothesis is wrong
  selected_outcome?: string;      // Which ICP matched best (stored for backward compat)
  matched_icp?: string;           // Name of the best-matching ICP from the product's linked ICPs

  // ICP QUALIFICATION FIELDS
  is_b2b?: boolean;               // Does the company sell B2B?
  revenue_model?: 'SaaS' | 'Services' | 'Product' | 'Marketplace' | 'Hybrid' | 'Unknown';
  has_outbound_motion?: boolean;  // Evidence of outbound sales activities
  outbound_signals?: string[];    // Evidence of outbound (hiring SDRs, using tools, etc.)
  sales_tools_detected?: string[]; // Sales/outbound tools found in job posts or tech stack
  hiring_sales_roles?: boolean;   // Actively hiring sales roles
  sales_roles_open?: string[];    // Specific sales roles being hired
  estimated_company_size?: 'Small (1-50)' | 'Mid-Market (51-500)' | 'Enterprise (500+)' | 'Unknown';
  icp_score?: number;             // 0-100 fit score based on all criteria
  icp_score_reasoning?: string;   // Why this score was assigned
  // What the score was measured against: real ICPs, the selected product's own
  // description/benefits, or — only when neither is available — generic B2B fit.
  icp_score_basis?: 'icp_match' | 'product_fit' | 'general_b2b';

  // Supplementary breakdown of icp_score — informational only, icp_score itself
  // stays the single number automation/filtering reads.
  product_fit_score?: number;              // 0-100 structural fit, independent of current need
  product_fit_reasoning?: string;
  need_evidence_score?: number;            // 0-100 direct evidence of current need (not inference)
  need_evidence_reasoning?: string;
  outbound_maturity?: 'unknown' | 'low' | 'medium' | 'high'; // absence of evidence -> 'unknown', never 'low'
  outbound_maturity_reasoning?: string;
  personalization_evidence_score?: number; // 0-100 how much concrete material exists to personalize with
  personalization_evidence_reasoning?: string;

  // Supporting context (kept for background info). Each entry separates the
  // stated fact from the model's own interpretation of it - see the
  // GROWTH SIGNALS section of the prompt below.
  growth_signals?: {
    signal: string;
    evidence: string;
    interpretation: string;
    confidence: 'low' | 'medium' | 'high';
    email_usability: 'strong' | 'medium' | 'dont_use';
    safe_use: string;
  }[];
  latest_funding_round?: string;
  funding_amount?: string;
  company_tone?: 'formal' | 'casual' | 'technical' | 'friendly';

  // LinkedIn company page data (verified from LinkedIn)
  linkedin_employee_count?: number;
  linkedin_employee_count_range?: { from: number; to: number };
  linkedin_followers_count?: number;
  linkedin_industry?: string[];
  // Firmographics actually scored against the ICP's size/revenue/industry
  // criteria, plus where they came from. Stored so a score can be explained
  // after the fact — "band 5001+ vs a 2-10 ICP" is the reason, not the model's
  // prose about it. Bands use the public.signal_employee_band() vocabulary.
  firmographic_employee_band?: string | null;
  firmographic_employee_count?: number | null;
  firmographic_revenue_band?: string | null;
  firmographic_industry?: string[] | null;
  firmographic_source?: 'linkedin_company_page' | 'moltsets_reverse_lookup';
  linkedin_organization_type?: string;
  linkedin_foundation_date?: string;
  linkedin_locations?: Array<{ city: string; country: string; is_headquarter: boolean }>;
  linkedin_employee_growth_6mo?: number;  // percentage
  linkedin_funding_last_round?: string;
  linkedin_funding_amount?: string;
  linkedin_funding_total_rounds?: number;

  // LinkedIn posts
  recent_linkedin_posts?: Array<{
    text: string;
    date: string;
    engagement: number;
  }>;
  linkedin_topics?: string[];
  best_post_hook?: string;

  // Decision-maker fit (person-level evaluation)
  decision_maker_score?: number;
  decision_maker_reasoning?: string;

  // User-defined custom questions (scoped to the product) and their AI answers.
  // score = 0-100 affirmativeness (100 = data definitively says YES, 0 = definitively NO).
  custom_analysis?: Array<{ question: string; answer: string; score: number | null }>;

  // Technologies & ad pixels detected from the company's website HTML
  detected_technologies?: TechSignals;
}

// ── Simple scraper utilities ──

// Fetch raw HTML from a URL
async function fetchHtml(url: string, timeoutMs = 15_000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!response.ok) {
      console.log(`fetchHtml: HTTP ${response.status} for ${url}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      console.log(`fetchHtml: non-HTML content type (${contentType}) for ${url}`);
      return null;
    }

    const html = await response.text();
    if (!html || html.length < 100) {
      console.log(`fetchHtml: tiny HTML (${html?.length || 0} chars) for ${url}`);
      return null;
    }

    return html;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log(`fetchHtml: timeout for ${url}`);
    } else {
      console.log(`fetchHtml: error for ${url}: ${error}`);
    }
    return null;
  }
}

// Detect error / parked / suspended / placeholder pages that return HTTP 200 but
// carry no real company content. These poison the scrape cache and cause the AI
// to hallucinate an analysis from the domain name alone. Runs on extracted text.
const ERROR_PAGE_SIGNATURES: RegExp[] = [
  /hosting server read timeout/i,
  /unable to connect to the origin server/i,
  /\b(http|error)\s*50[0-4]\b/i,
  /\b50[234]\s*(bad gateway|service (temporarily )?unavailable|gateway time-?out)\b/i,
  /this (site|account|domain) (has been|is) suspended/i,
  /account suspended/i,
  /this domain (is|may be) for sale/i,
  /buy this domain/i,
  /the domain .{0,40}? is for sale/i,
  /domain (has expired|name has expired|is parked)/i,
  /parked (free|domain) courtesy of/i,
  /future home of something quite cool/i,
  /website is (currently )?(under (construction|maintenance)|down for maintenance)/i,
  /(welcome to nginx|apache2 (ubuntu|debian) default page|it works!)/i,
  /error 10\d\d[\s\S]{0,40}cloudflare/i,
  /web server is (down|returning an unknown error)/i,
  /this page isn.?t working/i,
];

// True when the extracted page text looks like an error/parked/placeholder page
// rather than real company content.
function isErrorPage(text: string): boolean {
  if (!text) return true;
  const head = text.slice(0, 1500);
  // Real company sites are rarely this short AND matching an error signature; a
  // signature hit near the top of a thin page is a strong junk signal.
  const hit = ERROR_PAGE_SIGNATURES.some((re) => re.test(head));
  if (!hit) return false;
  // Guard: only treat as junk when the page is thin (error pages are tiny).
  return text.length < 4000;
}

// SPA app-shell markers — the page is a client-side framework bootstrap that
// renders content via JS after load. Static scraping only sees the empty shell.
const APP_SHELL_MARKERS: RegExp[] = [
  /<app-root[\s>]/i,            // Angular
  /\sng-version=/i,             // Angular
  /\bdata-reactroot\b/i,        // React
  /<div[^>]+id=["'](root|__next|app|__nuxt|svelte)["']/i, // React/Next/Vue/Nuxt/Svelte
  /window\.__NUXT__/i,          // Nuxt
  /id=["']__NEXT_DATA__["']/i,  // Next.js
];

// True when the raw HTML is a JS app-shell AND the extracted text is too thin to
// be real content — i.e. a client-rendered SPA our static scraper can't read.
function isAppShell(rawHtml: string, extractedText: string): boolean {
  if (extractedText.length >= 900) return false; // has enough real text to use
  return APP_SHELL_MARKERS.some((re) => re.test(rawHtml));
}

// AI-generated fields written into enrichment_data by this function. Used to strip
// a stale/hallucinated analysis when a re-scrape confirms the site is unreadable.
const AI_ANALYSIS_KEYS: string[] = [
  'company_tagline', 'company_niche', 'company_offering', 'company_target', 'company_verbiage', 'company_priorities',
  'primary_need', 'primary_need_reasoning', 'primary_need_evidence', 'primary_need_confidence', 'cold_email_angle',
  'selected_outcome', 'matched_icp',
  'is_b2b', 'revenue_model', 'has_outbound_motion', 'outbound_signals', 'sales_tools_detected', 'hiring_sales_roles',
  'sales_roles_open', 'estimated_company_size', 'icp_score', 'icp_score_reasoning',
  'product_fit_score', 'product_fit_reasoning', 'need_evidence_score', 'need_evidence_reasoning',
  'outbound_maturity', 'outbound_maturity_reasoning', 'personalization_evidence_score', 'personalization_evidence_reasoning',
  'growth_signals', 'latest_funding_round', 'funding_amount', 'company_tone',
  'linkedin_employee_count', 'linkedin_employee_count_range', 'linkedin_followers_count', 'linkedin_industry',
  'linkedin_organization_type', 'linkedin_foundation_date', 'linkedin_locations', 'linkedin_employee_growth_6mo',
  'linkedin_funding_last_round', 'linkedin_funding_amount', 'linkedin_funding_total_rounds',
  'recent_linkedin_posts', 'linkedin_topics', 'best_post_hook', 'decision_maker_score', 'decision_maker_reasoning',
  'custom_analysis', 'detected_technologies', 'analyzed_at', 'analysis_scope',
  'firmographic_employee_band', 'firmographic_revenue_band', 'firmographic_industry',
  'firmographic_employee_count', 'firmographic_source',
];

function stripAiAnalysisFields(enrichment: Record<string, unknown>): Record<string, unknown> {
  const out = { ...enrichment };
  for (const k of AI_ANALYSIS_KEYS) delete out[k];
  delete out.analysis_error;
  return out;
}

// Convert raw HTML to readable text
function htmlToText(html: string): string {
  let text = html
    // Remove script and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    // Remove SVG blocks
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Extract title
    .replace(/<title[^>]*>([\s\S]*?)<\/title>/gi, 'PAGE TITLE: $1\n\n')
    // Extract meta description
    .replace(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/gi, 'META DESCRIPTION: $1\n')
    .replace(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/gi, 'META DESCRIPTION: $1\n')
    // Add newlines for block elements
    .replace(/<\/(h[1-6]|p|div|li|tr|section|article|header|footer|main|aside|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  // Remove lines that look like CSS/JS artifacts
  text = text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.length > 500 && !trimmed.includes(' ')) return false;
      if (/^[{}\[\],;:]+$/.test(trimmed)) return false;
      if (/^(var|let|const|function|import|export|module)\s/.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();

  return text;
}

// Extract internal links from HTML and score them by relevance for company analysis
function discoverRelevantPages(html: string, baseUrl: string): string[] {
  // Keywords that indicate high-value pages for company analysis, ordered by priority
  const PAGE_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
    // About pages — who they are
    { pattern: /\babout\b/i, score: 10 },
    { pattern: /\babout[_-]us\b/i, score: 10 },
    { pattern: /\bwho[_-]we[_-]are\b/i, score: 10 },
    { pattern: /\bour[_-]story\b/i, score: 9 },
    { pattern: /\bcompany\b/i, score: 9 },
    { pattern: /\bour[_-]firm\b/i, score: 9 },
    // Services pages — what they sell
    { pattern: /\bservices\b/i, score: 8 },
    { pattern: /\bwhat[_-]we[_-]do\b/i, score: 8 },
    { pattern: /\bsolutions\b/i, score: 8 },
    { pattern: /\bofferings\b/i, score: 7 },
    { pattern: /\bproducts?\b/i, score: 7 },
    { pattern: /\bplatform\b/i, score: 7 },
    { pattern: /\bfeatures\b/i, score: 6 },
    { pattern: /\bcapabilities\b/i, score: 6 },
    // Industries / target market — who they sell to
    { pattern: /\bindustries\b/i, score: 6 },
    { pattern: /\bsectors\b/i, score: 5 },
    { pattern: /\bclients?\b/i, score: 5 },
    { pattern: /\bcustomers?\b/i, score: 5 },
    { pattern: /\bcase[_-]stud/i, score: 5 },
    // Team — company size signals
    { pattern: /\bteam\b/i, score: 4 },
    { pattern: /\bour[_-]team\b/i, score: 5 },
    { pattern: /\bleadership\b/i, score: 4 },
    { pattern: /\bcareers?\b/i, score: 4 },
    { pattern: /\bjobs?\b/i, score: 3 },
    // Pricing — revenue model signals
    { pattern: /\bpricing\b/i, score: 4 },
    { pattern: /\bplans?\b/i, score: 3 },
  ];

  // Extract all <a href="..."> links — capture href and anchor text
  const linkRegex = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  const candidates: Array<{ url: string; score: number; text: string }> = [];

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1].trim();
    const anchorHtml = match[2];
    // Strip tags from anchor text
    const anchorText = anchorHtml.replace(/<[^>]+>/g, '').trim();

    // Skip empty, javascript:, mailto:, tel:, external links
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;

    // Resolve relative URLs
    try {
      const resolved = new URL(href, baseUrl);
      // Only keep same-origin links
      const base = new URL(baseUrl);
      if (resolved.hostname !== base.hostname) continue;
      href = resolved.href;
    } catch {
      continue;
    }

    // Skip already-seen, homepage, anchors, files
    if (seen.has(href)) continue;
    seen.add(href);
    const path = new URL(href).pathname.toLowerCase();
    if (path === '/' || path === '') continue;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|zip|doc|xlsx?)$/i.test(path)) continue;

    // Score by matching the path and anchor text against patterns
    let bestScore = 0;
    const searchText = `${path} ${anchorText}`;
    for (const { pattern, score } of PAGE_PATTERNS) {
      if (pattern.test(searchText) && score > bestScore) {
        bestScore = score;
      }
    }

    if (bestScore > 0) {
      candidates.push({ url: href, score: bestScore, text: anchorText });
    }
  }

  // Sort by score descending, deduplicate by path, take top 3
  candidates.sort((a, b) => b.score - a.score);
  const selectedPaths = new Set<string>();
  const result: string[] = [];
  for (const c of candidates) {
    const path = new URL(c.url).pathname.toLowerCase().replace(/\/+$/, '');
    if (selectedPaths.has(path)) continue;
    selectedPaths.add(path);
    result.push(c.url);
    if (result.length >= 3) break;
  }

  console.log(`Discovered ${candidates.length} relevant links, selected ${result.length}: ${result.map(u => new URL(u).pathname).join(', ')}`);
  return result;
}

// Simple scraper: fetch HTML + convert to text
/** Normalized for comparing a stored company name against a search hit:
 * lowercase, strip punctuation and the usual legal suffixes. "Issquared, Inc."
 * and "IsSquared Inc" have to compare equal. */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,''`"()]/g, '')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|bv|plc|sa|srl|pty|group|holdings)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Company firmographics, whatever their provenance, in one shape. `source` is
 * kept because "500 employees per LinkedIn" and "500 per MoltSets" are not
 * equally trustworthy and the stored analysis should say which one it scored.
 */
interface ResolvedFirmographics {
  employee_count: number | null;
  employee_range: string | null;
  revenue_range: string | null;
  industry: string[] | null;
  source: 'linkedin_company_page' | 'moltsets_reverse_lookup';
}

/**
 * Exact headcount (preferred) or a provider range → one of our bands.
 *
 * A verbatim TypeScript mirror of public.signal_employee_band(). The ICP's
 * target_employee_bands are stored in that vocabulary because the signal
 * auto-add gates already use it, so this has to agree with the SQL exactly —
 * including that the provider's "1-10" yields null. It straddles the 1 / 2-10
 * boundary, which is the whole distinction the "no solopreneurs" cut exists to
 * draw, so it reads as unknown rather than a coin flip.
 */
function employeeBand(count: number | null | undefined, range: string | null | undefined): string | null {
  if (typeof count === 'number' && Number.isFinite(count) && count >= 1) {
    if (count === 1) return '1';
    if (count <= 10) return '2-10';
    if (count <= 50) return '11-50';
    if (count <= 200) return '51-200';
    if (count <= 500) return '201-500';
    if (count <= 1000) return '501-1000';
    if (count <= 5000) return '1001-5000';
    return '5001+';
  }
  switch ((range ?? '').trim().toLowerCase()) {
    case '11-20':
    case '21-50':
      return '11-50';
    case '51-200': return '51-200';
    case '201-500': return '201-500';
    case '501-1000': return '501-1000';
    case '1001-5000': return '1001-5000';
    case '5001+': return '5001+';
    // '1-10' and the provider's dirty values are deliberately absent.
    default: return null;
  }
}

/** TypeScript mirror of public.signal_revenue_band(). */
function revenueBand(range: string | null | undefined): string | null {
  const value = (range ?? '').trim().toLowerCase();
  if (!value) return null;
  if (['unknown', 'n/a', 'none'].includes(value)) return null;
  if (value === '$1 - $1m') return '$500k - $1m';
  return value;
}

/**
 * Resolve a company website from a LinkedIn URL via MoltSets.
 *
 * PREFER THIS over resolveDomainFromCompanyName. The two endpoints draw on
 * DIFFERENT quotas, and only one of them is survivable:
 *
 *   reverse_linkedin_lookup   ENRICH quota — ~15k/5h, 75k/week, replenishing
 *   search_companies          SEARCH quota — locks for DAYS once spent
 *
 * On 2026-08-08 the search quota ran out and this function did not exist, so
 * every name-resolution attempt hit a locked endpoint: 3,829 of 3,924 MoltSets
 * calls failed that day and 1,993 of 2,071 the next. The failures were silent
 * (see the catch in resolveDomainFromCompanyName), so nothing surfaced.
 *
 * The lookup is also strictly more informative — it returns the company's
 * website, real employee_count, revenue_range, industry, and a validated
 * business email in one call, which is the whole reason search was reached for.
 * There is no accuracy tradeoff either: a LinkedIn URL identifies one person
 * exactly, whereas name search is fuzzy enough to need an exact-name guard.
 *
 * Returns the firmographics alongside the domain. They arrive in the same
 * response at no extra cost and are what the ICP's size/revenue/industry
 * criteria are scored against; discarding them (as this did) meant paying for
 * an exact headcount and then asking the model to guess one from website tone.
 */
async function lookupCompanyFromLinkedIn(
  linkedinUrl: string,
  apiKey: string,
): Promise<{ domain: string | null; firmographics: ResolvedFirmographics | null }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(`${MOLTSETS_TOOLS_BASE}/reverse_linkedin_lookup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkedin_url: linkedinUrl }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`[domain-resolve] reverse lookup failed: ${response.status}`);
      return { domain: null, firmographics: null };
    }
    const payload = await response.json();
    // The person is under `results`, and the company under `results.company` —
    // NOT `payload.company`, which is what this read before and which is always
    // undefined. That silently defeated the whole point of preferring this
    // endpoint: every call logged "no company website" and fell through to
    // resolveDomainFromCompanyName, burning the SEARCH quota this exists to
    // avoid. Envelope: { results: {..., company: {...}}, status, metadata }.
    const company = (payload?.results?.company ?? payload?.company) as Record<string, unknown> | undefined;
    if (payload?.status && payload.status !== 'ok') {
      console.log(`[domain-resolve] lookup status "${payload.status}" for ${linkedinUrl}`);
    }

    const rawCount = company?.employee_count ?? company?.employees ?? null;
    const employeeCount = Number.isFinite(Number(rawCount)) && Number(rawCount) > 0
      ? Math.round(Number(rawCount))
      : null;
    const industryValue = company?.industry;
    const firmographics: ResolvedFirmographics | null = (
      employeeCount || company?.revenue_range || industryValue
    )
      ? {
        employee_count: employeeCount,
        employee_range: (company?.employee_range as string | null) ?? null,
        revenue_range: (company?.revenue_range as string | null) ?? null,
        industry: Array.isArray(industryValue)
          ? (industryValue as string[])
          : (typeof industryValue === 'string' && industryValue ? [industryValue] : null),
        source: 'moltsets_reverse_lookup',
      }
      : null;

    const website = company?.website_url as string | undefined;
    if (!website) {
      console.log(`[domain-resolve] lookup returned no company website for ${linkedinUrl}`);
      return { domain: null, firmographics };
    }
    // Store a bare host — the rest of this function expects a domain, not a URL.
    const domain = website
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .trim()
      .toLowerCase();

    console.log(`[domain-resolve] ${linkedinUrl} -> ${domain || '(no domain)'} (reverse lookup), headcount ${employeeCount ?? 'unknown'}`);
    return { domain: domain || null, firmographics };
  } catch (error) {
    console.log(`[domain-resolve] reverse lookup error for ${linkedinUrl}:`, error);
    return { domain: null, firmographics: null };
  }
}

/**
 * Resolve a company website from its NAME via MoltSets.
 *
 * LAST RESORT — only for contacts with no LinkedIn URL at all. This burns the
 * SEARCH quota, which locks for days once exhausted and takes every other
 * search-backed feature down with it. Use resolveDomainFromLinkedIn whenever a
 * LinkedIn URL exists.
 *
 * Deliberately conservative. Name search is fuzzy: "Convergence Networks"
 * returns a 1,483-person firm in India ahead of other matches, and analyzing
 * the wrong company is worse than analyzing none — it produces confident,
 * wrong personalization that goes out to a real prospect. So a hit is accepted
 * only when the normalized names match exactly, never on rank alone.
 */
async function resolveDomainFromCompanyName(
  companyName: string,
  apiKey: string,
): Promise<string | null> {
  const target = normalizeCompanyName(companyName);
  if (target.length < 3) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(`${MOLTSETS_TOOLS_BASE}/search_companies`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: companyName, limit: 5 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      // A spent search quota is not a per-contact miss — it is a days-long
      // outage of every search-backed path, and logging it at the same level
      // as "no match" is how 3,829 failures in one day went unnoticed.
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      if (response.status === 429 || detail.includes('fair_use_limit_exceeded')) {
        console.error(
          '[domain-resolve] MoltSets SEARCH QUOTA EXHAUSTED — locks for days. ' +
            'Every name-resolution attempt will fail until it resets. Contacts ' +
            'with a LinkedIn URL still resolve via reverse lookup (enrich quota). ' +
            detail,
        );
      } else {
        console.log(`[domain-resolve] MoltSets search failed: ${response.status} ${detail}`);
      }
      return null;
    }
    const payload = await response.json();
    const hits = (payload?.results?.results ?? []) as Array<{ name?: string; domain?: string }>;
    const match = hits.find((hit) => hit.domain && hit.name && normalizeCompanyName(hit.name) === target);
    if (!match?.domain) {
      console.log(`[domain-resolve] no exact-name match for "${companyName}" among ${hits.length} hits`);
      return null;
    }
    console.log(`[domain-resolve] "${companyName}" -> ${match.domain}`);
    return match.domain;
  } catch (error) {
    console.log(`[domain-resolve] lookup error for "${companyName}":`, error);
    return null;
  }
}

async function fetchWithSimpleScraper(url: string, timeoutMs = 15_000): Promise<string | null> {
  const html = await fetchHtml(url, timeoutMs);
  if (!html) return null;

  const text = htmlToText(html);
  if (text.length < 50) {
    console.log(`Simple scraper: extracted text too short (${text.length} chars) for ${url}`);
    return null;
  }
  if (isErrorPage(text)) {
    console.log(`Simple scraper: error/parked page detected for ${url}, discarding`);
    return null;
  }
  if (isAppShell(html, text)) {
    console.log(`Simple scraper: JS app-shell detected for ${url}, discarding`);
    return null;
  }

  console.log(`Simple scraper: extracted ${text.length} chars from ${url}`);
  return text.substring(0, 30000);
}

// Fetch page content via crawl4ai async job API (non-blocking, avoids sync endpoint deadlocks)
async function fetchWithCrawl4ai(url: string, crawlerBaseUrl: string, timeoutMs = 30_000): Promise<string | null> {
  try {
    console.log(`crawl4ai: submitting job for ${url}...`);

    // Step 1: Submit async crawl job
    const submitResponse = await fetch(`${crawlerBaseUrl}/crawl/job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: [url],
        crawler_config: {
          type: 'CrawlerRunConfig',
          params: {
            cache_mode: 'bypass',
            word_count_threshold: 50,
            delay_before_return_html: 2.0,
            // Cap page.goto at 15s (crawl4ai default is 60s). Dead/slow SPA domains were
            // holding a browser+memory for a full minute each — even after our 30s poll
            // gave up server-side — exhausting the pool and re-wedging the crawler.
            page_timeout: 15_000,
          },
        },
      }),
    });

    if (!submitResponse.ok) {
      console.log(`crawl4ai job submit failed for ${url}: HTTP ${submitResponse.status}`);
      return null;
    }

    const submitResult = await submitResponse.json();
    const taskId = submitResult?.task_id;
    if (!taskId) {
      console.log(`crawl4ai returned no task_id for ${url}`);
      return null;
    }

    // Step 2: Poll for completion
    const pollInterval = 2000; // 2s between polls
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollInterval));

      const statusResponse = await fetch(`${crawlerBaseUrl}/crawl/job/${taskId}`);
      if (!statusResponse.ok) {
        console.log(`crawl4ai poll failed for ${url} (task ${taskId}): HTTP ${statusResponse.status}`);
        return null;
      }

      const statusResult = await statusResponse.json();

      if (statusResult.status === 'completed') {
        // Extract markdown from result — the async endpoint wraps in .result
        const crawlResult = statusResult?.result?.results?.[0];
        const markdown = crawlResult?.markdown?.raw_markdown
          || crawlResult?.markdown
          || crawlResult?.extracted_content;

        if (!markdown || (typeof markdown === 'string' && markdown.length < 50)) {
          console.log(`crawl4ai returned insufficient content for ${url}: ${typeof markdown === 'string' ? markdown.length : 0} chars`);
          return null;
        }

        const content = typeof markdown === 'string' ? markdown : JSON.stringify(markdown);
        console.log(`crawl4ai succeeded for ${url}: ${content.length} chars of markdown`);
        return content.substring(0, 30000);
      } else if (statusResult.status === 'failed') {
        console.log(`crawl4ai job failed for ${url}: ${statusResult.error || 'unknown'}`);
        return null;
      }
      // else: still pending/running, keep polling
    }

    console.log(`crawl4ai timed out for ${url} after ${timeoutMs}ms (task ${taskId})`);
    return null;
  } catch (error) {
    console.error(`crawl4ai error for ${url}:`, error);
    return null;
  }
}

// Extract domain from URL for cache keying (e.g. "www.wpdcpa.com" → "wpdcpa.com")
function getDomain(url: string): string {
  try {
    const parsed = new URL(normalizeUrl(url));
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }
}

// Normalize URL to ensure it has protocol
function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

// Get base URL from website URL
function getBaseUrl(url: string): string {
  try {
    const parsed = new URL(normalizeUrl(url));
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
}

// ── Dedicated LLM pass for the product's custom questions ──
// Isolating these from the big analysis prompt makes the model answer them
// decisively (the combined prompt tends to leave them blank), and lets us feed
// the detected ad-pixels/tech as hard evidence. Returns answers aligned to
// `questions`; each with a 0-100 affirmativeness score.
async function answerCustomQuestions(opts: {
  questions: string[];
  companyName: string;
  evidence: string;
  endpoint: ChatEndpoint;
  // deno-lint-ignore no-explicit-any
  supabase: any;
  organizationId: string;
}): Promise<Array<{ question: string; answer: string; score: number | null }>> {
  const { questions, companyName, evidence, endpoint, supabase, organizationId } = opts;
  const empty = () => questions.map((q) => ({ question: q, answer: '', score: null as number | null }));

  const systemPrompt = `You are a precise B2B sales research assistant. Answer each question about a company using ONLY the evidence provided below (which may include website content, LinkedIn company data, and — where present — detected website technologies).

For EACH question, return an object with:
- "answer": a short, direct answer (1-2 sentences max), specific to what the question actually asks. Be decisive — prefer a concrete answer with a brief reason over vague hedging.
- "score": integer 0-100 = the degree to which the ANSWER is YES / affirmative for this company. This is NOT your confidence. A clear YES = 90-100. A clear NO = 0-10 (score a confident "No" LOW, not high). ~50 = genuinely unclear or too little evidence.
  Example: for "Are they a real estate firm?" where the company is a staffing agency, answer "No, they're a staffing agency" with score ~5 (a confident No is still a LOW score).

Guidance:
- Use whichever evidence is RELEVANT to each question. Most questions (their industry, business model, services, customers, positioning, size, intent) are answered from the website content and LinkedIn data.
- Only for questions specifically about their tools, tech stack, analytics, or advertising is the "DETECTED WEBSITE TECHNOLOGY" section authoritative (e.g. advertising pixels like Meta Pixel / Google Ads ⇒ they run paid ads). Do NOT force technology into answers for unrelated questions.
- Absence of relevant evidence is itself informative — answer "No" / "Doesn't appear so" with a LOW score rather than leaving it blank.
- Only return "" (score null) when there is genuinely no evidence that bears on the question at all.
- Do not invent facts unsupported by the evidence.

Return ONLY JSON: {"answers": [{"answer": "...", "score": N}, ...]} in the SAME ORDER as the questions.`;

  const userPrompt = `COMPANY: ${companyName}

EVIDENCE:
${evidence || '(no website or LinkedIn content available)'}

QUESTIONS (answer each, in order):
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const resp = await rateLimitedFetch({
      supabase,
      organizationId,
      url: endpoint.url,
      init: {
        method: 'POST',
        headers: endpoint.headers,
        body: JSON.stringify({
          model: endpoint.model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          temperature: 0.2,
          max_tokens: 1200,
        }),
        signal: controller.signal,
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.error('Custom-questions LLM error:', resp.status, (await resp.text()).slice(0, 200));
      return empty();
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return empty();

    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/) || [null, content];
    const parsed = JSON.parse((jsonMatch[1] || content).trim());
    // deno-lint-ignore no-explicit-any
    const answers: any[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.answers) ? parsed.answers : []);

    return questions.map((question, i) => {
      const raw = answers[i];
      const answer = (typeof raw === 'object' && raw !== null ? raw.answer : raw) ?? '';
      const rawScore = (typeof raw === 'object' && raw !== null) ? raw.score : undefined;
      let score: number | null = null;
      if (rawScore !== undefined && rawScore !== null && rawScore !== '') {
        const n = Math.round(Number(rawScore));
        if (Number.isFinite(n)) score = Math.min(100, Math.max(0, n));
      }
      return { question, answer: answer.toString().trim(), score };
    });
  } catch (e) {
    console.error('Custom-questions call failed:', e);
    return empty();
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const body: AnalyzeCompanyRequest = await req.json();
    const { contactId, companyWebsite, linkedinUrl, unipileAccountId, model, productContext, productId, icpIds, skipIfAnalyzedWithinDays } = body;

    // Default to a cheap model if not specified
    const llmModel = model || DEFAULT_FAST_TEXT_MODEL;

    if (!contactId) {
      return new Response(
        JSON.stringify({ success: false, error: 'contactId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get contact to verify it exists and get organization
    const { data: contact, error: contactError } = await supabase
      .from('crm_contacts')
      .select('id, organization_id, company_id, display_name, company, job_title, company_website, primary_linkedin_url, enrichment_data, enriched_at, ai_analysis_status')
      .eq('id', contactId)
      .single();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ success: false, error: 'Contact not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, contact.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // ── Reuse a recent analysis instead of re-crawling (opt-in) ──
    // Every guard below has to hold. Freshness alone is not enough: the ICP
    // score callers read off enrichment_data belongs to whatever product/ICP set
    // the last run used, so a scope mismatch must re-analyze even on a
    // day-old record.
    const wantedScope = buildAnalysisScope(productId, icpIds);
    if (skipIfAnalyzedWithinDays && skipIfAnalyzedWithinDays > 0) {
      const analyzedAtMs = contact.enriched_at ? Date.parse(contact.enriched_at) : NaN;
      const isFresh = Number.isFinite(analyzedAtMs)
        && (Date.now() - analyzedAtMs) <= skipIfAnalyzedWithinDays * 86_400_000;
      const scopeMatches = analysisScopeMatches(
        (contact.enrichment_data as Record<string, unknown> | null)?.analysis_scope,
        wantedScope,
      );
      // icp_score is a REQUIRED field of any real analysis (see the prompt
      // below) — a stored 'analyzed' record without one is a record from a
      // run that hit the swallowed-LLM-failure bug this skip check predates,
      // not a legitimate scoreless result. Reusing it just perpetuates the
      // false "score unavailable, below threshold" rejection every time the
      // freshness window lets this contact skip re-analysis. Require a real
      // score before treating a past run as reusable.
      const hasUsableScore = Number.isFinite(
        Number((contact.enrichment_data as Record<string, unknown> | null)?.icp_score),
      );
      if (contact.ai_analysis_status === 'analyzed' && isFresh && scopeMatches && hasUsableScore) {
        // A product-scoped run also needs its contact_product_scores row: that
        // table, not enrichment_data, is what product-aware callers read.
        let productScorePresent = true;
        if (productId) {
          const { data: existingScore } = await supabase
            .from('contact_product_scores')
            .select('contact_id')
            .eq('contact_id', contactId)
            .eq('product_id', productId)
            .maybeSingle();
          productScorePresent = !!existingScore;
        }
        if (productScorePresent) {
          console.log(`Skipping analysis for ${contactId}: analyzed ${contact.enriched_at} within ${skipIfAnalyzedWithinDays}d, same scope`);
          return new Response(
            JSON.stringify({
              success: true,
              skipped: true,
              reason: 'fresh_analysis',
              analyzedAt: contact.enriched_at,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Fetch product's linked ICPs if a product was specified
    interface LinkedICP {
      name: string;
      summary: string | null;
      description: string | null;
      pain_points: string[] | null;
      desires: string[] | null;
      objections: string[] | null;
      tags: string[] | null;
      target_locations: string[] | null;
      target_seniorities: string[] | null;
      target_departments: string[] | null;
      target_title_keywords: string[] | null;
      decision_maker_notes: string | null;
      // Firmographics (migration 20260813090000). Bands share the
      // public.signal_employee_band() / signal_revenue_band() vocabulary with
      // the signal auto-add gates — same spellings, no mapping layer.
      target_employee_bands: string[] | null;
      target_revenue_bands: string[] | null;
      target_industries: string[] | null;
    }
    let productICPs: LinkedICP[] = [];
    // User-defined analysis questions attached to the selected product
    let customQuestions: string[] = [];
    // What the prompt actually describes as "your offering": the caller's
    // productContext when supplied, otherwise the stored library_products row.
    let effectiveProductContext: AnalyzeCompanyRequest['productContext'] = productContext;

    if (productId) {
      // product_icp_fit has no organization_id: scope through the product's org.
      const { data: icpFits } = await supabase
        .from('product_icp_fit')
        .select('fit_score, library_products!inner(organization_id), library_icps(name, summary, description, pain_points, desires, objections, tags, target_locations, target_seniorities, target_departments, target_title_keywords, decision_maker_notes, target_employee_bands, target_revenue_bands, target_industries)')
        .eq('product_id', productId)
        .eq('library_products.organization_id', contact.organization_id)
        .order('fit_score', { ascending: false })
        .limit(5);

      if (icpFits?.length) {
        // deno-lint-ignore no-explicit-any
        productICPs = icpFits.map((f: any) => f.library_icps).filter(Boolean) as LinkedICP[];
        console.log(`Fetched ${productICPs.length} linked ICPs for product ${productId}: ${productICPs.map(i => i.name).join(', ')}`);
      } else {
        console.log(`No linked ICPs found for product ${productId}, will use product description/benefits only`);
      }

      // Load the product itself: its custom analysis questions AND the offering
      // description that the prompt scores against. Only two frontend dialogs
      // ever passed productContext in the body — every server-driven caller
      // (lead-list processing, campaign-processor, the batch/job paths) sends
      // productId alone, so before this the model was told to analyze the
      // company "to sell them" nothing at all, and fell through to the generic
      // outbound heuristic below regardless of which product was selected.
      // Org-scoped for the same cross-tenant reason as the explicit ICP read.
      const { data: productRow } = await supabase
        .from('library_products')
        .select('name, description, features, key_benefits, category, tags, analysis_questions')
        .eq('id', productId)
        .eq('organization_id', contact.organization_id)
        .maybeSingle();
      customQuestions = (productRow?.analysis_questions as string[] | null | undefined)
        ?.map(q => (q ?? '').trim())
        .filter(Boolean) ?? [];
      if (customQuestions.length) {
        console.log(`Loaded ${customQuestions.length} custom analysis question(s) for product ${productId}`);
      }

      if (productRow) {
        // An explicit body productContext still wins — the caller may be
        // describing an offering that is not the stored product row — but each
        // field falls back independently so a partial payload is topped up.
        const storedBenefits = [
          ...((productRow.key_benefits as string[] | null) ?? []),
          ...((productRow.features as string[] | null) ?? []),
        ].map(b => (b ?? '').trim()).filter(Boolean);
        const storedDescription = [
          (productRow.description as string | null)?.trim() || '',
          (productRow.category as string | null)?.trim() ? `Category: ${(productRow.category as string).trim()}` : '',
          ((productRow.tags as string[] | null) ?? []).length ? `Tags: ${(productRow.tags as string[]).join(', ')}` : '',
        ].filter(Boolean).join('\n');

        effectiveProductContext = {
          name: productContext?.name || (productRow.name as string | null) || undefined,
          description: productContext?.description || storedDescription || undefined,
          benefits: productContext?.benefits?.length ? productContext.benefits
            : (storedBenefits.length ? storedBenefits : undefined),
        };
        // A row with nothing usable in it must not masquerade as context.
        if (!effectiveProductContext.name && !effectiveProductContext.description && !effectiveProductContext.benefits?.length) {
          effectiveProductContext = undefined;
        } else {
          console.log(`Loaded product context for ${productId}: ${effectiveProductContext.name ?? '(unnamed)'}, ${effectiveProductContext.benefits?.length ?? 0} benefit(s), description ${effectiveProductContext.description ? 'present' : 'absent'}`);
        }
      }
    }

    // Explicitly selected ICPs for this run (decoupled from product) — they take
    // precedence over the product's linked ICPs. Org-scoped to prevent cross-tenant reads.
    if (icpIds?.length) {
      const { data: explicitIcps } = await supabase
        .from('library_icps')
        .select('name, summary, description, pain_points, desires, objections, tags, target_locations, target_seniorities, target_departments, target_title_keywords, decision_maker_notes, target_employee_bands, target_revenue_bands, target_industries')
        .in('id', icpIds)
        .eq('organization_id', contact.organization_id);

      if (explicitIcps?.length) {
        const explicitNames = new Set(explicitIcps.map(i => i.name));
        productICPs = [
          ...(explicitIcps as LinkedICP[]),
          ...productICPs.filter(i => !explicitNames.has(i.name)),
        ].slice(0, 5);
        console.log(`Merged ${explicitIcps.length} explicitly selected ICP(s): ${[...explicitNames].join(', ')}`);
      }
    }

    const hasICPs = productICPs.length > 0;

    // Use provided URLs or fall back to contact data
    let websiteToAnalyze = companyWebsite || contact.company_website;
    const linkedinToAnalyze = linkedinUrl || contact.primary_linkedin_url;

    let companyLinkedInData: LinkedInCompanyData | null = null;
    // Technologies & ad pixels detected from the website's raw HTML (before scripts are stripped)
    let detectedTech: TechSignals | null = null;
    // Why website scraping yielded no usable content: 'spa' | 'error_page' | 'unreachable' | null.
    // 'spa'/'error_page' are confident-unreadable states (used to flag the lead honestly).
    let scrapeFailureReason: 'spa' | 'error_page' | 'unreachable' | null = null;
    // Set when OUR OWN scraper infrastructure (crawl4ai) was unreachable at the
    // moment we needed the browser-render fallback. This is a systemic outage,
    // not evidence the target site is dead — the processor parks such contacts
    // without burning their retry budget so an outage can't mass-fail a list.
    let scraperInfraUnavailable = false;
    // Set when the LinkedIn fetch failed at the PROVIDER level — a non-2xx from
    // Unipile (401 on a lapsed subscription, 429, 5xx) or a transport error —
    // as opposed to Unipile answering fine and the person simply having nothing
    // useful. The difference matters enormously: canFetchLinkedIn is derived
    // from database rows (account row + valid key), so an expired Unipile
    // subscription still looks "available" and every LinkedIn-only contact fell
    // through to a generic no-data verdict. That verdict is classified
    // no_source_data, which is TERMINAL — so a billing lapse silently wrote off
    // leads as permanently unanalyzable and nothing re-drove them on renewal.
    let linkedinProviderUnavailable = false;

    // Firmographics the ICP's size/revenue/industry criteria are scored against.
    // Filled from the LinkedIn Company Page when we have one, else from the
    // MoltSets reverse lookup below — never from the model's own guess.
    let resolvedFirmographics: ResolvedFirmographics | null = null;
    // True only when a provider was actually asked for company facts. A miss
    // is persisted too, preventing an immediate repeat purchase.
    let firmographicsChecked = false;

    // The org's MoltSets key, fetched and decrypted at most once per run and
    // shared by the domain resolver and the firmographic fallback.
    let moltsetsKeyCache: string | null | undefined;
    const getMoltsetsKey = async (): Promise<string | null> => {
      if (moltsetsKeyCache !== undefined) return moltsetsKeyCache;
      const { data: moltsetsKeyRow } = await supabase
        .from('api_keys')
        .select('key_encrypted')
        .eq('organization_id', contact.organization_id)
        .eq('provider', 'moltsets')
        .eq('is_valid', true)
        .maybeSingle();
      if (!moltsetsKeyRow?.key_encrypted) {
        moltsetsKeyCache = null;
        return null;
      }
      try {
        moltsetsKeyCache = await decryptApiKey(moltsetsKeyRow.key_encrypted, encryptionKey);
      } catch (error) {
        console.log('[moltsets] could not use MoltSets key:', error);
        moltsetsKeyCache = null;
      }
      return moltsetsKeyCache;
    };

    // ── Resolve a website from the company NAME when we have no domain ──
    // Runs before the capability check, so a contact with a company name but no
    // website becomes analyzable from its own site rather than depending on
    // LinkedIn. That dependency is what made a lapsed Unipile subscription
    // write off 397 LinkedIn-only contacts as permanently unanalyzable.
    if (!websiteToAnalyze && (contact.company || contact.primary_linkedin_url)) {
      const moltsetsKey = await getMoltsetsKey();
      if (moltsetsKey) {
        // Reverse lookup FIRST. It draws on the replenishing enrich quota,
        // identifies the person exactly, and returns the company website
        // directly. Name search draws on the search quota, which locks for
        // days — that lock is what produced a ~97% MoltSets failure rate on
        // 2026-08-08/09, silently, because both paths swallow their errors.
        let resolved: string | null = null;
        if (contact.primary_linkedin_url) {
          firmographicsChecked = true;
          const lookup = await lookupCompanyFromLinkedIn(
            contact.primary_linkedin_url as string,
            moltsetsKey,
          );
          resolved = lookup.domain;
          // Same response, no extra call: keep the firmographics it already paid for.
          if (lookup.firmographics) resolvedFirmographics = lookup.firmographics;
        }
        // Only when there is no LinkedIn URL to look up at all.
        if (!resolved && contact.company) {
          resolved = await resolveDomainFromCompanyName(contact.company as string, moltsetsKey);
        }

        if (resolved) {
          websiteToAnalyze = resolved;
          // Persist it so this lookup happens once per company, not per run.
          await supabase
            .from('crm_contacts')
            .update({ company_website: resolved })
            .eq('id', contactId);
        }
      }
    }

    // Check capabilities upfront
    const canFetchLinkedIn = !!linkedinToAnalyze && !!unipileAccountId;

    if (!websiteToAnalyze && !canFetchLinkedIn) {
      if (linkedinToAnalyze && !unipileAccountId) {
        console.log('Skipping: has LinkedIn but no Unipile account selected');
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No company website available. To analyze LinkedIn posts and fetch company website, please select a LinkedIn account.',
            skipped: true,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log('Skipping: no website or LinkedIn available');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No company website or LinkedIn URL available for analysis',
          skipped: true,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Proceeding with analysis for contact ${contactId}`);

    const analysisResult: CompanyAnalysisOutput = {};
    let websiteContent = '';
    let websiteScrapingAttempted = false;
    let websiteScrapingFailed = false;
    let linkedinPosts: Array<{ text: string; date: string; engagement: number }> = [];
    const crawlerBaseUrl = Deno.env.get('CRAWLER_BASE_URL');

    // ── Resolve Unipile credentials once (shared by all LinkedIn calls) ──
    let unipileApiKey: string | null = null;
    let unipileBaseUrl: string | null = null;
    let linkedinIdentifier: string | null = null;

    if (canFetchLinkedIn) {
      const { data: unipileAccount } = await supabase
        .from('unipile_accounts')
        .select('unipile_account_id')
        .eq('unipile_account_id', unipileAccountId!)
        .eq('organization_id', contact.organization_id)
        .single();

      if (unipileAccount) {
        const { data: unipileKeyData } = await supabase
          .from('api_keys')
          .select('key_encrypted, metadata')
          .eq('organization_id', contact.organization_id)
          .eq('provider', 'unipile')
          .eq('is_valid', true)
          .maybeSingle();

        if (unipileKeyData?.key_encrypted) {
          try {
            unipileApiKey = await decryptApiKey(unipileKeyData.key_encrypted, encryptionKey);
          } catch (decryptErr) {
            console.error('Failed to decrypt Unipile API key:', decryptErr);
          }
          unipileBaseUrl = normalizeDsnUrl((unipileKeyData.metadata as Record<string, string>)?.dsn_url);
          linkedinIdentifier = linkedinToAnalyze!;
          const linkedinMatch = linkedinToAnalyze!.match(/linkedin\.com\/in\/([^\/\?]+)/);
          if (linkedinMatch) linkedinIdentifier = linkedinMatch[1];
        } else {
          // Same class as a 401: LinkedIn is unusable for provider reasons, so
          // contacts relying on it must not be written off as having no data.
          linkedinProviderUnavailable = true;
          console.warn('No Unipile API key configured, skipping all LinkedIn fetches');
        }
      }
    }

    // ── Helper: fetch LinkedIn profile → company data (chained) ──
    async function fetchLinkedInProfileAndCompany(): Promise<void> {
      if (!unipileApiKey || !unipileBaseUrl || !linkedinIdentifier) return;

      try {
        console.log('Fetching LinkedIn profile for company info...');
        const profileParams = new URLSearchParams();
        profileParams.append('account_id', unipileAccountId!);
        profileParams.append('linkedin_sections', 'experience_preview');
        profileParams.append('notify', 'false');

        const profileUrl = `${unipileBaseUrl}/api/v1/users/${encodeURIComponent(linkedinIdentifier)}?${profileParams.toString()}`;
        const profileController = new AbortController();
        const profileTimeout = setTimeout(() => profileController.abort(), 15_000);
        const profileResponse = await fetch(profileUrl, {
          method: 'GET',
          headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
          signal: profileController.signal,
        });
        clearTimeout(profileTimeout);

        if (!profileResponse.ok) {
          console.log(`Failed to fetch profile: ${profileResponse.status}`);
          // Provider said no — not the contact's fault. 401/403 is the signature
          // of an expired Unipile subscription or revoked account.
          linkedinProviderUnavailable = true;
          return;
        }

        const profileData = await profileResponse.json();
        const currentJob = profileData.work_experience?.find((exp: { current?: boolean }) => exp.current)
          || profileData.work_experience?.[0];

        if (!currentJob?.company_url) {
          // No company page URL, but we can still extract basic company info from the profile
          if (currentJob?.company_name || profileData.headline) {
            console.log(`No company_url in profile, using profile-level data as fallback (company: ${currentJob?.company_name || 'unknown'})`);
            companyLinkedInData = {
              name: currentJob?.company_name,
              description: profileData.headline ? `Contact headline: ${profileData.headline}` : undefined,
              industry: profileData.industry ? [profileData.industry] : undefined,
            };
          } else {
            console.log('No company_url and no useful profile data');
          }
          return;
        }

        const companyLinkedInUrl = currentJob.company_url;
        console.log(`Found company LinkedIn URL: ${companyLinkedInUrl}`);
        const companyMatch = companyLinkedInUrl.match(/linkedin\.com\/company\/([^\/\?]+)/);
        if (!companyMatch) return;

        const companyIdentifier = companyMatch[1];
        const companyParams = new URLSearchParams();
        companyParams.append('account_id', unipileAccountId!);
        const companyUrl = `${unipileBaseUrl}/api/v1/linkedin/company/${encodeURIComponent(companyIdentifier)}?${companyParams.toString()}`;

        console.log('Fetching company LinkedIn page...');
        firmographicsChecked = true;
        const companyController = new AbortController();
        const companyTimeout = setTimeout(() => companyController.abort(), 15_000);
        const companyResponse = await fetch(companyUrl, {
          method: 'GET',
          headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
          signal: companyController.signal,
        });
        clearTimeout(companyTimeout);

        if (companyResponse.ok) {
          const companyData = await companyResponse.json();
          companyLinkedInData = companyData;
          console.log(`Company LinkedIn data fetched: ${companyData.name}, employees: ${companyData.employee_count || companyData.employee_count_range?.from + '-' + companyData.employee_count_range?.to || 'unknown'}, followers: ${companyData.followers_count || 'unknown'}`);

          if (!websiteToAnalyze && companyData.website) {
            websiteToAnalyze = companyData.website;
            console.log(`Found company website from LinkedIn: ${websiteToAnalyze}`);
            await supabase
              .from('crm_contacts')
              .update({ company_website: websiteToAnalyze })
              .eq('id', contactId);
          }
        } else {
          console.log(`Failed to fetch company page: ${companyResponse.status}`);
        }
      } catch (error) {
        // Transport failure (timeout, DNS, abort) — provider-side, not no-data.
        linkedinProviderUnavailable = true;
        console.error('Error fetching LinkedIn company data:', error);
      }
    }

    // ── Helper: fetch LinkedIn posts ──
    async function fetchLinkedInPosts(): Promise<void> {
      if (!unipileApiKey || !unipileBaseUrl || !linkedinIdentifier) return;

      try {
        console.log('Fetching LinkedIn posts...');
        const params = new URLSearchParams();
        params.append('account_id', unipileAccountId!);
        params.append('limit', '5');

        const postsUrl = `${unipileBaseUrl}/api/v1/users/${encodeURIComponent(linkedinIdentifier)}/posts?${params.toString()}`;
        const postsController = new AbortController();
        const postsTimeout = setTimeout(() => postsController.abort(), 15_000);
        const postsResponse = await fetch(postsUrl, {
          method: 'GET',
          headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
          signal: postsController.signal,
        });
        clearTimeout(postsTimeout);

        if (postsResponse.ok) {
          const postsData = await postsResponse.json();
          if (postsData.items && Array.isArray(postsData.items)) {
            linkedinPosts = postsData.items.slice(0, 5).map((post: {
              text?: string;
              date?: string;
              parsed_datetime?: string;
              reaction_counter?: number;
              comment_counter?: number;
            }) => ({
              text: (post.text || '').substring(0, 500),
              date: post.parsed_datetime || post.date || '',
              engagement: (post.reaction_counter || 0) + (post.comment_counter || 0),
            }));
            analysisResult.recent_linkedin_posts = linkedinPosts;
            console.log(`Fetched ${linkedinPosts.length} LinkedIn posts`);
          }
        } else {
          console.log(`Failed to fetch LinkedIn posts: ${postsResponse.status}`);
        }
      } catch (error) {
        console.error('Error fetching LinkedIn posts:', error);
      }
    }

    // ── Helper: scrape website ──
    // Smart scraping with platform-level cache:
    // 1. Check cache (keyed by domain, shared across all orgs)
    // 2. If miss: fetch homepage, discover relevant subpages from nav links, scrape them
    // 3. Save to cache for 7 days
    // 4. Escalate to crawl4ai only for JS-rendered SPAs
    async function scrapeWebsite(): Promise<void> {
      if (!websiteToAnalyze) return;

      websiteScrapingAttempted = true;
      const homepageUrl = normalizeUrl(websiteToAnalyze);
      const siteBaseUrl = getBaseUrl(websiteToAnalyze);
      const domain = getDomain(websiteToAnalyze);
      const MIN_USEFUL_CONTENT_LENGTH = 500;
      const CACHE_TTL_DAYS = 7;

      // ── Check platform-level cache first ──
      const { data: cached } = await supabase
        .from('website_scrape_cache')
        .select('pages, total_chars, cached_at, tech_signals')
        .eq('domain', domain)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      // A cache hit only counts if the cached homepage is real content — not a
      // stale error/parked page cached before error detection existed.
      const cachedHomepage = cached ? ((cached.pages as Record<string, string>)['/'] || '') : '';
      const cacheLooksJunk = !!cached && isErrorPage(cachedHomepage);
      if (cacheLooksJunk) {
        console.log(`Cache for ${domain} is a stale error/parked page — ignoring and re-scraping`);
      }

      if (cached && !cacheLooksJunk && cached.total_chars >= MIN_USEFUL_CONTENT_LENGTH) {
        const pages = cached.pages as Record<string, string>;
        const entries = Object.entries(pages);
        const cacheAge = Math.round((Date.now() - new Date(cached.cached_at).getTime()) / 3600000);
        console.log(`Cache HIT for ${domain}: ${entries.length} pages, ${cached.total_chars} chars (${cacheAge}h old)`);

        // Restore detected tech from cache. If the row predates tech detection,
        // backfill from a single homepage fetch so cached domains aren't blind.
        if (cached.tech_signals) {
          detectedTech = cached.tech_signals as TechSignals;
          // Backfill the flat `all` array for cache rows written before it existed
          if (detectedTech && !Array.isArray(detectedTech.all)) {
            detectedTech.all = [
              ...(detectedTech.advertising || []),
              ...(detectedTech.marketing || []),
              ...(detectedTech.cms || []),
              ...(detectedTech.ecommerce || []),
              ...(detectedTech.analytics || []),
              ...(detectedTech.chat || []),
            ];
          }
        } else {
          const rawForTech = await fetchHtml(homepageUrl, 10_000);
          if (rawForTech) {
            detectedTech = detectTechnologies(rawForTech);
            supabase
              .from('website_scrape_cache')
              .update({ tech_signals: detectedTech })
              .eq('domain', domain)
              // deno-lint-ignore no-explicit-any
              .then(({ error }: any) => { if (error) console.log(`Tech backfill failed for ${domain}: ${error.message}`); });
          }
        }

        websiteContent = entries
          .map(([path, text]) => `--- Page: ${siteBaseUrl}${path} ---\n${text}`)
          .join('\n\n')
          .substring(0, 50000);
        return;
      }

      console.log(`Cache ${cached ? 'STALE' : 'MISS'} for ${domain}, scraping...`);
      const pageContents: string[] = [];
      const cachedPages: Record<string, string> = {};

      // ── Step 1: Fetch homepage HTML (raw — we need it for text, link discovery, and tech detection) ──
      const homepageHtml = await fetchHtml(homepageUrl, 15_000);

      if (homepageHtml) {
        // Detect ad pixels & technologies from raw HTML BEFORE scripts are stripped
        detectedTech = detectTechnologies(homepageHtml);
        if (detectedTech.total > 0) {
          console.log(`Tech detected for ${domain}: ads=[${detectedTech.advertising.join(', ')}] marketing=[${detectedTech.marketing.join(', ')}] cms=[${detectedTech.cms.join(', ')}]`);
        }

        const homepageText = htmlToText(homepageHtml);
        if (homepageText.length > 100 && isErrorPage(homepageText)) {
          console.log(`Homepage for ${domain} is an error/parked page — discarding (site likely down/expired)`);
          scrapeFailureReason = 'error_page';
        } else if (isAppShell(homepageHtml, homepageText)) {
          console.log(`Homepage for ${domain} is a JS app-shell (${homepageText.length} chars) — discarding, will attempt JS render`);
          scrapeFailureReason = 'spa';
        } else if (homepageText.length > 100) {
          const trimmed = homepageText.substring(0, 20000);
          pageContents.push(`--- Page: ${homepageUrl} ---\n${trimmed}`);
          cachedPages['/'] = trimmed;
        }

        // ── Step 2: Discover relevant subpages from homepage nav/footer links ──
        const discoveredPages = discoverRelevantPages(homepageHtml, siteBaseUrl);

        if (discoveredPages.length > 0) {
          console.log(`Fetching ${discoveredPages.length} discovered subpages...`);
          const subpageResults = await Promise.all(
            discoveredPages.map(url => fetchWithSimpleScraper(url, 12_000))
          );
          subpageResults.forEach((content, idx) => {
            if (content && content.length > 100) {
              pageContents.push(`--- Page: ${discoveredPages[idx]} ---\n${content}`);
              const path = new URL(discoveredPages[idx]).pathname;
              cachedPages[path] = content.substring(0, 20000);
            }
          });
        } else {
          // No relevant links found — try common fallback paths
          console.log('No relevant nav links discovered, trying common paths...');
          const fallbackPaths = ['/about', '/about-us', '/services', '/company'];
          const fallbackUrls = fallbackPaths.map(p => `${siteBaseUrl}${p}`);
          const fallbackResults = await Promise.all(
            fallbackUrls.map(url => fetchWithSimpleScraper(url, 10_000))
          );
          let added = 0;
          fallbackResults.forEach((content, idx) => {
            if (content && content.length > 100 && added < 2) {
              pageContents.push(`--- Page: ${fallbackUrls[idx]} ---\n${content}`);
              cachedPages[fallbackPaths[idx]] = content.substring(0, 20000);
              added++;
            }
          });
        }
      } else {
        console.log('Homepage fetch failed, trying homepage via simple scraper...');
        const homepageFallback = await fetchWithSimpleScraper(homepageUrl, 15_000);
        if (homepageFallback && homepageFallback.length > 100) {
          pageContents.push(`--- Page: ${homepageUrl} ---\n${homepageFallback}`);
          cachedPages['/'] = homepageFallback.substring(0, 20000);
        }
      }

      websiteContent = pageContents.join('\n\n').substring(0, 50000);
      console.log(`Simple fetch: ${pageContents.length} pages scraped, ${websiteContent.length} chars total`);

      // ── Step 3: Escalate to crawl4ai only if simple fetch returned too little ──
      if (websiteContent.length < MIN_USEFUL_CONTENT_LENGTH && crawlerBaseUrl) {
        console.log('Simple fetch returned thin content, escalating to crawl4ai for JS rendering...');
        pageContents.length = 0;
        websiteContent = '';
        // Clear cached pages — crawl4ai content will replace
        for (const k of Object.keys(cachedPages)) delete cachedPages[k];

        const crawlPages = [homepageUrl, `${siteBaseUrl}/about`];

        let crawlerReachable = false;
        try {
          const hc = new AbortController();
          // 20s (not 5s): a scale-to-zero crawler cold-boots in ~15s, and this probe
          // is what triggers Fly's auto-start. Too short → spurious scraperInfraUnavailable
          // parks on every idle→wake cycle.
          const hcTimer = setTimeout(() => hc.abort(), 20_000);
          const hcResp = await fetch(`${crawlerBaseUrl}/health`, { signal: hc.signal });
          clearTimeout(hcTimer);
          crawlerReachable = hcResp.ok;
          if (!crawlerReachable) {
            scraperInfraUnavailable = true;
            console.log(`crawl4ai health check returned ${hcResp.status}, skipping`);
          }
        } catch {
          scraperInfraUnavailable = true;
          console.log('crawl4ai unreachable (health check failed)');
        }

        if (crawlerReachable) {
          const results = await Promise.all(
            crawlPages.map(url => fetchWithCrawl4ai(url, crawlerBaseUrl, 30_000))
          );
          results.forEach((content, idx) => {
            if (content && content.length > 100 && isErrorPage(content)) {
              console.log(`crawl4ai page ${crawlPages[idx]} is an error/parked page — discarding`);
            } else if (content && content.length > 100) {
              pageContents.push(`--- Page: ${crawlPages[idx]} ---\n${content}`);
              const path = new URL(crawlPages[idx]).pathname || '/';
              cachedPages[path] = content.substring(0, 20000);
            } else {
              console.log(`crawl4ai page ${crawlPages[idx]} returned ${content === null ? 'null (failed)' : `only ${content?.length || 0} chars`}`);
            }
          });

          websiteContent = pageContents.join('\n\n').substring(0, 50000);
          console.log(`crawl4ai: ${pageContents.length}/${crawlPages.length} pages, ${websiteContent.length} chars`);
        }
      }

      // ── Step 4: Save to platform cache (fire-and-forget) ──
      const totalChars = Object.values(cachedPages).reduce((sum, t) => sum + t.length, 0);
      if (totalChars >= MIN_USEFUL_CONTENT_LENGTH) {
        const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400000).toISOString();
        supabase
          .from('website_scrape_cache')
          .upsert({
            domain,
            pages: cachedPages,
            total_chars: totalChars,
            cached_at: new Date().toISOString(),
            expires_at: expiresAt,
            tech_signals: detectedTech,
          }, { onConflict: 'domain' })
          // deno-lint-ignore no-explicit-any
          .then(({ error: cacheErr }: any) => {
            if (cacheErr) console.log(`Cache write failed for ${domain}: ${cacheErr.message}`);
            else console.log(`Cache saved for ${domain}: ${Object.keys(cachedPages).length} pages, ${totalChars} chars, expires ${expiresAt}`);
          });
      }

      if (pageContents.length === 0 || websiteContent.length < MIN_USEFUL_CONTENT_LENGTH) {
        websiteScrapingFailed = true;
        // Confident-unreadable reason (spa/error_page) was set above; otherwise it's a plain failure to reach.
        if (!scrapeFailureReason) scrapeFailureReason = 'unreachable';
        console.log(`All scraping methods failed for ${websiteToAnalyze} (${websiteContent.length} chars, reason=${scrapeFailureReason}) — proceeding without website content.`);
      } else {
        // Usable content was recovered (e.g. crawl4ai rendered the SPA) — not a failure.
        scrapeFailureReason = null;
      }
    }

    // ── PARALLEL EXECUTION: Run all data fetching concurrently ──
    // LinkedIn is a FALLBACK, not a default. It used to run on every analysis
    // even when the website was already in hand, so a 20k-contact list meant
    // 40k+ automated LinkedIn calls through one real account — which is how
    // accounts get rate-limited and restricted. The company's own website is
    // the better source anyway, and domain resolution above means we now have
    // one far more often.
    //
    // The trade is real: skipping LinkedIn loses recent-posts signal and the
    // company page's employee/follower counts. Site content plus detected tech
    // is worth more than that, and it doesn't put the account at risk.
    const hasWebsiteUpfront = !!websiteToAnalyze;

    await Promise.allSettled(
      hasWebsiteUpfront
        ? [scrapeWebsite()]
        : [fetchLinkedInProfileAndCompany(), fetchLinkedInPosts()],
    );

    // If LinkedIn discovered a website we didn't have before, scrape it now
    if (!hasWebsiteUpfront && websiteToAnalyze) {
      console.log(`Website discovered from LinkedIn (${websiteToAnalyze}), scraping now...`);
      await scrapeWebsite();
    }

    // Re-check: do we have anything to analyze?
    const canScrapeWebsite = !!websiteToAnalyze;

    console.log(`Analysis check for contact ${contactId}:`, {
      websiteToAnalyze,
      linkedinToAnalyze,
      unipileAccountId,
      canScrapeWebsite,
      canFetchLinkedIn,
    });

    // Build person context and DM criteria (hoisted for use in both AI prompt and fallback scoring)
    // deno-lint-ignore no-explicit-any
    const enrichmentData = (contact.enrichment_data as Record<string, any>) || {};
    const hasPersonData = !!(contact.job_title || enrichmentData.seniority || enrichmentData.department);
    const allTargetSeniorities = new Set<string>();
    const allTargetDepartments = new Set<string>();
    const allTargetTitleKeywords = new Set<string>();
    const allTargetLocations = new Set<string>();
    const allTargetEmployeeBands = new Set<string>();
    const allTargetRevenueBands = new Set<string>();
    const allTargetIndustries = new Set<string>();
    const dmNotes: string[] = [];

    // Collect DM targeting criteria from all linked ICPs upfront
    if (hasICPs) {
      for (const icp of productICPs) {
        if (icp.target_seniorities?.length) icp.target_seniorities.forEach(s => allTargetSeniorities.add(s));
        if (icp.target_departments?.length) icp.target_departments.forEach(d => allTargetDepartments.add(d));
        if (icp.target_title_keywords?.length) icp.target_title_keywords.forEach(k => allTargetTitleKeywords.add(k));
        if (icp.target_locations?.length) icp.target_locations.forEach(l => allTargetLocations.add(l));
        if (icp.target_employee_bands?.length) icp.target_employee_bands.forEach(b => allTargetEmployeeBands.add(b));
        if (icp.target_revenue_bands?.length) icp.target_revenue_bands.forEach(b => allTargetRevenueBands.add(b));
        if (icp.target_industries?.length) icp.target_industries.forEach(i => allTargetIndustries.add(i));
        if (icp.decision_maker_notes) dmNotes.push(icp.decision_maker_notes);
      }
    }
    const hasDmCriteria = allTargetSeniorities.size > 0 || allTargetDepartments.size > 0 || allTargetTitleKeywords.size > 0;
    const hasIcpLocations = allTargetLocations.size > 0;
    const hasIcpFirmographics = allTargetEmployeeBands.size > 0 || allTargetRevenueBands.size > 0 || allTargetIndustries.size > 0;

    // ── Resolve the firmographics the criteria are scored against ──
    // LinkedIn's Company Page is preferred and free: it is already fetched, and
    // its employee_count is verified. MoltSets is the fallback and only runs
    // when an ICP actually asks about size or revenue — no criterion, no call.
    const linkedInCompany = companyLinkedInData as LinkedInCompanyData | null;
    if (linkedInCompany) {
      const linkedinCount = linkedInCompany.employee_count ?? null;
      const linkedinRange = linkedInCompany.employee_count_range
        ? `${linkedInCompany.employee_count_range.from}-${linkedInCompany.employee_count_range.to}`
        : null;
      if (linkedinCount || linkedinRange || linkedInCompany.industry?.length) {
        resolvedFirmographics = {
          employee_count: linkedinCount,
          employee_range: linkedinRange,
          // LinkedIn Company Pages do not carry revenue; keep whatever MoltSets
          // may already have given us rather than overwriting it with null.
          revenue_range: resolvedFirmographics?.revenue_range ?? null,
          industry: linkedInCompany.industry ?? resolvedFirmographics?.industry ?? null,
          source: 'linkedin_company_page',
        };
      }
    }

    if (
      hasIcpFirmographics &&
      contact.primary_linkedin_url &&
      !resolvedFirmographics?.employee_count &&
      !(allTargetRevenueBands.size > 0 && resolvedFirmographics?.revenue_range)
    ) {
      // The enrich quota, which replenishes (~15k/5h) — NOT search_companies,
      // which locks for days once spent and would take every search-backed path
      // down with it. See lookupCompanyFromLinkedIn.
      const moltsetsKey = await getMoltsetsKey();
      if (moltsetsKey) {
        firmographicsChecked = true;
        const lookup = await lookupCompanyFromLinkedIn(contact.primary_linkedin_url as string, moltsetsKey);
        if (lookup.firmographics) {
          resolvedFirmographics = {
            // An exact count beats LinkedIn's range, but never overwrite a
            // present value with a null one — the two sources fill different gaps.
            employee_count: lookup.firmographics.employee_count ?? resolvedFirmographics?.employee_count ?? null,
            employee_range: resolvedFirmographics?.employee_range ?? lookup.firmographics.employee_range ?? null,
            revenue_range: lookup.firmographics.revenue_range ?? resolvedFirmographics?.revenue_range ?? null,
            industry: resolvedFirmographics?.industry ?? lookup.firmographics.industry ?? null,
            source: resolvedFirmographics?.employee_count ? resolvedFirmographics.source : 'moltsets_reverse_lookup',
          };
        }
      }
    }

    const resolvedEmployeeBand = employeeBand(
      resolvedFirmographics?.employee_count,
      resolvedFirmographics?.employee_range,
    );
    const resolvedRevenueBand = revenueBand(resolvedFirmographics?.revenue_range);
    if (hasIcpFirmographics) {
      console.log(
        `[firmographics] band=${resolvedEmployeeBand ?? 'unknown'} revenue=${resolvedRevenueBand ?? 'unknown'} ` +
        `industry=${resolvedFirmographics?.industry?.join('/') ?? 'unknown'} source=${resolvedFirmographics?.source ?? 'none'}`,
      );
    }

    // Step 3: Run AI analysis if we have content
    console.log(`Content check: websiteContent length=${websiteContent.length}, linkedinPosts count=${linkedinPosts.length}, companyLinkedInData: ${!!companyLinkedInData}`);

    if (websiteContent || linkedinPosts.length > 0 || companyLinkedInData) {
      console.log('Running AI marketing analysis...');

      // Resolve the LLM endpoint: Ollama models route to the org's Ollama
      // server; everything else needs the org's OpenRouter key.
      let chatEndpoint: ChatEndpoint;
      if (isOllamaModel(llmModel)) {
        const ollamaConfig = await resolveOllamaConfig(supabase, contact.organization_id);
        if (!ollamaConfig) {
          return new Response(
            JSON.stringify({ success: false, error: 'Ollama is not configured for this organization' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        chatEndpoint = await resolveChatEndpoint({ model: llmModel, ollamaConfig });
      } else {
        const { data: apiKeyData } = await supabase
          .from('api_keys')
          .select('key_encrypted')
          .eq('organization_id', contact.organization_id)
          .eq('provider', 'openrouter')
          .maybeSingle();

        if (!apiKeyData) {
          return new Response(
            JSON.stringify({ success: false, error: 'OpenRouter API key not configured' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let openRouterKey: string;
        try {
          openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
        } catch (decryptErr) {
          console.error('Failed to decrypt OpenRouter API key:', decryptErr);
          throw new Error('Failed to decrypt OpenRouter API key — key may be corrupted or ENCRYPTION_KEY changed');
        }
        chatEndpoint = await resolveChatEndpoint({ model: llmModel, openRouterApiKey: openRouterKey, referer: supabaseUrl });
      }

      // Build analysis prompt
      const linkedinSection = linkedinPosts.length > 0
        ? `\n\n--- LinkedIn Posts ---\n${linkedinPosts.map((p, i) =>
            `Post ${i + 1} (${p.engagement} engagements, ${p.date}):\n${p.text}`
          ).join('\n\n')}`
        : '';

      // Build LinkedIn company data section (structured data from LinkedIn company page)
      let companyLinkedInSection = '';
      if (companyLinkedInData) {
        const parts: string[] = [];
        if (companyLinkedInData.name) parts.push(`Company Name: ${companyLinkedInData.name}`);
        if (companyLinkedInData.tagline) parts.push(`Tagline: ${companyLinkedInData.tagline}`);
        if (companyLinkedInData.description) parts.push(`Description: ${companyLinkedInData.description}`);
        if (companyLinkedInData.industry?.length) parts.push(`Industry: ${companyLinkedInData.industry.join(', ')}`);
        if (companyLinkedInData.organization_type) parts.push(`Organization Type: ${companyLinkedInData.organization_type}`);
        if (companyLinkedInData.foundation_date) parts.push(`Founded: ${companyLinkedInData.foundation_date}`);

        // Employee count — the most critical piece for ICP sizing
        const insightsTotal = companyLinkedInData.insights?.employeesCount?.totalCount;
        if (insightsTotal) {
          parts.push(`LinkedIn Employee Count (from insights): ${insightsTotal}`);
        }
        if (companyLinkedInData.employee_count) {
          parts.push(`Employee Count: ${companyLinkedInData.employee_count}`);
        }
        if (companyLinkedInData.employee_count_range) {
          parts.push(`Employee Count Range: ${companyLinkedInData.employee_count_range.from}-${companyLinkedInData.employee_count_range.to}`);
        }
        if (companyLinkedInData.followers_count) {
          parts.push(`LinkedIn Followers: ${companyLinkedInData.followers_count}`);
        }

        // Growth signals from insights
        const growth = companyLinkedInData.insights?.employeesCount?.growthGraph;
        if (growth?.length) {
          const recent = growth.find(g => g.monthRange === 6) || growth[0];
          if (recent) {
            parts.push(`Employee Growth (${recent.monthRange}mo): ${recent.growthPercentage > 0 ? '+' : ''}${recent.growthPercentage}%`);
          }
        }
        if (companyLinkedInData.insights?.employeesCount?.averageTenure) {
          parts.push(`Average Employee Tenure: ${companyLinkedInData.insights.employeesCount.averageTenure}`);
        }

        // Locations
        if (companyLinkedInData.locations?.length) {
          const locStrs = companyLinkedInData.locations.map(l =>
            `${l.city}, ${l.country}${l.is_headquarter ? ' (HQ)' : ''}`
          );
          parts.push(`Locations: ${locStrs.join('; ')}`);
        }

        // Funding
        const funding = companyLinkedInData.crunchbase_funding;
        if (funding?.rounds?.last_round) {
          const lr = funding.rounds.last_round;
          const fundingParts = [lr.funding_type];
          if (lr.money_raised) fundingParts.push(`${lr.money_raised.currency} ${lr.money_raised.amount.toLocaleString()}`);
          if (lr.announced_on) fundingParts.push(`announced ${lr.announced_on}`);
          parts.push(`Latest Funding: ${fundingParts.join(', ')}`);
          parts.push(`Total Funding Rounds: ${funding.rounds.total_count}`);
        }

        if (parts.length > 0) {
          companyLinkedInSection = `\n\n--- LinkedIn Company Page (VERIFIED DATA — use this over website guesses) ---\n${parts.join('\n')}`;
        }
      }

      // Build person context section for decision-maker evaluation
      let personContextSection = '';

      if (hasPersonData) {
        const personParts: string[] = ['--- CONTACT BEING EVALUATED ---'];
        personParts.push(`Name: ${contact.display_name}`);
        if (contact.job_title) personParts.push(`Job Title / Headline: ${contact.job_title}`);
        if (enrichmentData.seniority) personParts.push(`Seniority Level: ${enrichmentData.seniority}`);
        if (enrichmentData.department) personParts.push(`Department: ${enrichmentData.department}`);
        personContextSection = '\n\n' + personParts.join('\n');
      }

      // Build product + ICP context section. ICPs render independently of the
      // product — they may come from an explicit picker (icpIds) with no product.
      let productContextSection = '';

      if (effectiveProductContext || hasICPs) {
        const parts: string[] = [];
        if (effectiveProductContext) {
          parts.push('--- YOUR OFFERING (What You\'re Selling) ---');
          if (effectiveProductContext.name) parts.push(`Product/Service: ${effectiveProductContext.name}`);
          if (effectiveProductContext.description) parts.push(`Description: ${effectiveProductContext.description}`);
          if (effectiveProductContext.benefits?.length) parts.push(`Benefits: ${effectiveProductContext.benefits.join(', ')}`);
        }

        if (hasICPs) {
          parts.push('');
          parts.push(`**IDEAL CUSTOMER PROFILES (ICPs)${effectiveProductContext ? ' for this product' : ''}:**`);
          for (const icp of productICPs) {
            parts.push(`\nICP: "${icp.name}"`);
            if (icp.summary) parts.push(`  Summary: ${icp.summary}`);
            if (icp.description) parts.push(`  Description: ${icp.description}`);
            if (icp.pain_points?.length) parts.push(`  Pain Points: ${icp.pain_points.join('; ')}`);
            if (icp.desires?.length) parts.push(`  Desires/Goals: ${icp.desires.join('; ')}`);
            if (icp.tags?.length) parts.push(`  Industry/Tags: ${icp.tags.join(', ')}`);
            if (icp.target_locations?.length) parts.push(`  Target Locations: ${icp.target_locations.join('; ')}`);
            if (icp.target_employee_bands?.length) parts.push(`  Target Company Size (employees): ${icp.target_employee_bands.join(', ')}`);
            if (icp.target_revenue_bands?.length) parts.push(`  Target Revenue: ${icp.target_revenue_bands.join(', ')}`);
            if (icp.target_industries?.length) parts.push(`  Target Industries: ${icp.target_industries.join(', ')}`);
          }
          parts.push('');
          parts.push('CRITICAL: Evaluate how well this company matches these ICPs. The "primary_need" must be derived from the ICP pain points and desires that best match this company\'s situation.');
        }

        productContextSection = '\n\n' + parts.join('\n');
      }

      // Build DM targeting prompt section — always include when person data available
      let dmTargetingPrompt = '';

      if (hasPersonData) {
        const dmParts: string[] = [];
        dmParts.push('**DECISION-MAKER FIT EVALUATION** (REQUIRED — contact info is provided above):');
        dmParts.push('Evaluate whether this specific PERSON is the right decision maker to contact at this company.');
        dmParts.push('');
        if (hasDmCriteria) {
          if (allTargetSeniorities.size > 0) dmParts.push(`Target Seniority Levels: ${[...allTargetSeniorities].join(', ')}`);
          if (allTargetDepartments.size > 0) dmParts.push(`Target Departments: ${[...allTargetDepartments].join(', ')}`);
          if (allTargetTitleKeywords.size > 0) dmParts.push(`Title Keywords: ${[...allTargetTitleKeywords].join(', ')}`);
          if (dmNotes.length > 0) dmParts.push(`\nAdditional context: ${dmNotes.join(' | ')}`);
        } else {
          dmParts.push('No specific targeting criteria defined — use general B2B judgment.');
          dmParts.push('Higher seniority (Director+) and relevance to the product/service being sold = higher score.');
        }
        dmParts.push('');
        dmParts.push('Consider:');
        dmParts.push('- Their title/seniority vs. typical B2B decision-maker roles');
        dmParts.push('- Company size context (at a 5-person company, the CEO handles everything; at 500+, VP-level handles specific functions)');
        dmParts.push('- Department relevance to the product being sold');
        dmParts.push('- LinkedIn employee count to calibrate seniority expectations');
        dmParts.push('');
        dmParts.push('');
        dmParts.push('decision_maker_reasoning must be based only on their title, seniority, and company-size context — never invent or assume facts about the company\'s internal challenges, pipeline, or needs. It answers "is this the right person to contact", not "does the company need this".');
        dmParts.push('');
        dmParts.push('Add to your JSON response:');
        dmParts.push('"decision_maker_score": <0-100 — how well this person matches the target decision-maker profile>,');
        dmParts.push('"decision_maker_reasoning": "<1-2 sentences explaining why this person is/isn\'t the right contact>"');
        dmTargetingPrompt = '\n\n' + dmParts.join('\n');
      }

      // Custom questions are answered by a SEPARATE, focused LLM call after the
      // main analysis (see answerCustomQuestions) — isolating them makes the model
      // answer decisively instead of deprioritizing them inside the big JSON.

      const systemPrompt = `You are an expert B2B sales intelligence analyst specializing in cold email personalization and ICP qualification.

**YOUR MISSION**: Analyze this company and determine:
1. What business they're in (niche, offering, target market)
2. ${hasICPs ? 'Whether they fit our Ideal Customer Profile (ICP) - REQUIRED' : effectiveProductContext ? 'How good a buyer they are for the specific offering described below — NO ICP is defined for this run. Do NOT invent or assume an ICP; score fit for that offering' : 'Their general B2B outbound fit — NO ICP is defined for this run. Do NOT invent or assume an ICP; score general B2B/outbound fit only'}
3. What their primary need is that our product/service addresses
4. WHY that need makes sense for their specific situation

${hasICPs && productICPs.length > 1 ? `
**CRITICAL - ICP MATCHING**
You are targeting ${productICPs.length} Ideal Customer Profiles. You MUST:
1. Evaluate the company against EACH ICP listed in the data below
2. Select the ONE ICP that best matches this company
3. Derive the "primary_need" from that ICP's pain points and desires, customized to this company's context
4. Report which ICP was the best match in "matched_icp"

**HOW TO MATCH**:
- Consider the company's niche, target market, and business model
- Match their challenges to the ICP's pain points
- Match their goals to the ICP's desires
- Consider industry/tags overlap
- If none of the ICPs match well, pick the closest one and note the weak fit in reasoning
` : hasICPs ? `
**ICP MATCHING**:
You are targeting one ICP: "${productICPs[0].name}"
${productICPs[0].pain_points?.length ? `Their typical pain points: ${productICPs[0].pain_points.join('; ')}` : ''}
${productICPs[0].desires?.length ? `Their typical desires: ${productICPs[0].desires.join('; ')}` : ''}

Evaluate how well this company matches this ICP. Derive the "primary_need" from the ICP's pain points and desires that resonate most with this specific company.
` : effectiveProductContext ? `
**CONTEXT**: You're analyzing this company to sell them: "${effectiveProductContext.name || effectiveProductContext.description || 'a B2B service'}".
No ICP is defined for this run, so score fit for THIS OFFERING specifically — how badly this company needs what it delivers, and how plausibly they would buy it. Do NOT fall back to scoring generic outbound-sales readiness unless that is what the offering is actually about.
The "primary_need" should relate to what this offering can provide, based on the product description and benefits.
` : ''}

**ICP QUALIFICATION CRITERIA** (REQUIRED - you MUST evaluate these):

1. **B2B vs B2C**: Do they sell to businesses or consumers?
   - B2B indicators: enterprise pricing, "contact sales", case studies with company logos, terms like "teams", "organizations"
   - B2C indicators: consumer pricing, app store links, individual user focus

2. **Revenue Model**: SaaS | Services | Product | Marketplace | Hybrid | Unknown

3. **Outbound Sales Motion**: Evidence they do outbound prospecting?
   - Look for: SDR/BDR job postings, sales team mentions, "contact sales" CTAs
   - Tools in job posts: Salesforce, HubSpot, Outreach, Apollo, LinkedIn Sales Navigator, ZoomInfo, Instantly, Smartlead

4. **Hiring Sales Roles**: Check careers/jobs pages for SDR, BDR, Account Executive, Sales Manager, etc.

5. **Company Size**: Small (1-50) | Mid-Market (51-500) | Enterprise (500+) | Unknown
   **IMPORTANT**: If LinkedIn Company Page data is provided (section "LinkedIn Company Page"), ALWAYS use the employee_count or employee_count_range from LinkedIn as the source of truth for company size. Do NOT guess company size from website tone or language — LinkedIn data is verified and authoritative.
   If no LinkedIn data is available and the website doesn't explicitly state headcount, use "Unknown" — do NOT guess.

${hasICPs ? `**ICP SCORING** (0-100):
Score based on how well the company matches the ICP definitions AND these general criteria:
- 80-100: Strong fit (B2B, clear outbound motion or sales team, using outbound tools, strong ICP alignment)
- 60-79: Good fit (B2B, some outbound indicators or growth signals, partial ICP alignment)
- 40-59: Moderate fit (B2B but limited outbound evidence, weak ICP alignment)
- 20-39: Poor fit (B2C, no outbound motion, consumer-focused)
- 0-19: Not a fit (Consumer only, no sales function)` : effectiveProductContext ? `**PRODUCT FIT SCORING (no ICP defined — icp_score measures fit for THE OFFERING described above, NOT an ICP match)** (0-100):
Score how good a buyer this company is for "${effectiveProductContext.name || 'the offering described above'}" — nothing else. Judge it on the problem that offering solves and the benefits it lists, using evidence from this company's own site, posts, and LinkedIn data:
- 80-100: Strong fit (clear evidence of the problem this offering solves, plausible budget and buying motion for it)
- 60-79: Good fit (likely to have the problem, no strong contrary signals)
- 40-59: Moderate fit (could benefit, but the need is unproven or the buying motion is unclear)
- 20-39: Poor fit (little sign of the problem, or wrong business model/segment for this offering)
- 0-19: Not a fit (this offering is irrelevant to them, or they sell it themselves)
Outbound-sales readiness (SDR hiring, sales tooling) is only relevant here IF the offering is itself about outbound sales. Otherwise ignore it in the score.` : `**GENERAL B2B FIT SCORING (no ICP and no product defined — icp_score measures generic B2B/outbound fit, NOT an ICP match)** (0-100):
- 80-100: Strong fit (B2B, clear outbound motion or sales team, using outbound tools)
- 60-79: Good fit (B2B, some outbound indicators or growth signals)
- 40-59: Moderate fit (B2B but limited outbound evidence)
- 20-39: Poor fit (B2C, no outbound motion, consumer-focused)
- 0-19: Not a fit (Consumer only, no sales function)`}

**IMPORTANT SCORING RULES**:
- Company size alone should NOT heavily penalize a score. A small B2B company (1-50 employees) with outbound potential is still a good fit. Many successful B2B services firms (agencies, consultancies, recruitment firms) operate with small teams.
- Focus scoring primarily on: ${!hasICPs && effectiveProductContext ? 'relevance to our offering — whether this company plausibly has the problem it solves and can buy it' : 'B2B vs B2C, outbound motion/potential, and relevance to our offering'}.${hasICPs ? '\n- When ICPs are provided, also weigh how closely the company\'s pain points, goals, and industry match the ICP definitions.' : ''}${hasIcpLocations ? `\n- **GEOGRAPHIC FIT**: The ICP targets these locations: ${[...allTargetLocations].join('; ')}. Use the company's location (LinkedIn Company Page locations and any website/address signals) to judge geographic match. A company clearly outside every target location should be penalized (weak fit); a company inside a target location reinforces a strong fit. If the company's location cannot be determined, do NOT penalize for geography — score on the other criteria.` : ''}${hasIcpFirmographics ? `
- **FIRMOGRAPHIC FIT**: The ICP targets these company firmographics:${allTargetEmployeeBands.size ? `
  - Employee bands: ${[...allTargetEmployeeBands].join(', ')}` : ''}${allTargetRevenueBands.size ? `
  - Revenue bands: ${[...allTargetRevenueBands].join(', ')}` : ''}${allTargetIndustries.size ? `
  - Industries: ${[...allTargetIndustries].join(', ')}` : ''}
  RESOLVED for this company (from ${resolvedFirmographics?.source === 'moltsets_reverse_lookup' ? 'a verified data provider' : resolvedFirmographics ? 'their LinkedIn Company Page' : 'no source'}): employee band ${resolvedEmployeeBand ?? 'UNKNOWN'}${resolvedFirmographics?.employee_count ? ` (exact headcount ${resolvedFirmographics.employee_count})` : ''}, revenue ${resolvedRevenueBand ?? 'UNKNOWN'}, industry ${resolvedFirmographics?.industry?.join(', ') || 'UNKNOWN'}.
  How to use each value, in this order:
  1. RESOLVED (not UNKNOWN) — this is VERIFIED. Treat it as fact, do NOT re-estimate it from the website's tone or wording, and weigh it heavily: penalize a company sitting clearly outside every target band (a 5,000-person enterprise for an ICP targeting 2-10), reinforce one sitting inside.
  2. UNKNOWN, but the website or LinkedIn content carries HARD size evidence anyway — a stated headcount, a public-company or Fortune-list mention, hundreds of named locations — you may weigh that, but as a weaker signal than a resolved value, and say in the reasoning that it was inferred.
  3. UNKNOWN with no such evidence — do NOT penalize at all. Score on the other criteria. Missing data is not a bad fit, and a lead must never lose points merely because we could not resolve its headcount.
  Judge industry loosely on meaning, not string equality.` : ''}
- If company size is "Unknown", do NOT penalize the score for size. Score based on other criteria (B2B, outbound motion, etc.)
- LinkedIn followers_count, employee_count, employee_growth, and funding data are VERIFIED — weigh them heavily
- A company with many LinkedIn followers and employees is NOT "small" regardless of how their website reads

**ICP SCORE BREAKDOWN** (SUPPLEMENTARY to icp_score, does not replace or change it):
icp_score stays exactly as scored above — it is the one number automation reads. These four
fields exist because icp_score alone can't distinguish "great fit, no evidence of current need"
from "so-so fit, strong buying signal" — two companies that deserve different outreach.
- product_fit_score (0-100) + product_fit_reasoning: STRUCTURAL fit only — is this the kind of
  business/buyer our offering is built for, regardless of whether they show any need for it
  right now. A company can score high here even with zero need_evidence.
- need_evidence_score (0-100) + need_evidence_reasoning: how much DIRECT evidence (not inference)
  exists that they currently want more of what we offer. This should track primary_need_confidence
  closely — if primary_need_confidence is "low", need_evidence_score should be low too.
- outbound_maturity ("unknown"|"low"|"medium"|"high") + outbound_maturity_reasoning: what outbound
  infrastructure was actually OBSERVED (SDR job posts, sales tooling, dedicated sales team).
  CRITICAL: no visible outbound infrastructure is NOT proof they have none — default to "unknown"
  in that case, never "low". Only use "low" if there's a specific reason to believe outbound
  genuinely isn't happening (e.g. a tiny team where everyone's role is visible and none is sales).
- personalization_evidence_score (0-100) + personalization_evidence_reasoning: how much concrete,
  citable material exists to personalize outreach with (specific facts, projects, posts) —
  independent of whether they're a good fit at all.

**OUTPUT FORMAT**:
Return a JSON object:
{
  "company_tagline": "Their main value proposition",
  "company_niche": "Their specific niche (be precise, e.g., 'AI-powered HR software for mid-market companies')",
  "company_offering": "What they sell in their own words",
  "company_target": "Who their customers are",
  "company_verbiage": ["exact", "phrases", "they", "use", "repeatedly"],
  "company_priorities": ["what they're currently focused on or investing in"],

  ${hasICPs && productICPs.length > 1 ? `"matched_icp": "Name of the best-matching ICP from the list (verbatim)",` : ''}
  "primary_need_evidence": "The concrete, directly-stated fact this is grounded in - quote or closely paraphrase something actually on their website/LinkedIn/posts. Empty string if nothing concrete exists.",
  "primary_need": "A HEDGED, PLAIN-LANGUAGE commercial hypothesis (not a stated fact) for the most relevant need, derived from ${hasICPs ? 'the product ICP pain points/desires' : 'their business context'} - use possibility language ('may benefit from', 'could be looking for'), state it as an internal analytical note not a marketing pitch, and never assert a problem the evidence doesn't establish",
  "primary_need_reasoning": "WHY this is their need - cite the evidence, state the hypothesis it supports, AND explicitly name what the evidence does NOT establish (e.g. it does not show inconsistent revenue, urgency, or a problem with their current model) whenever the hypothesis could plausibly be over-read that way${hasICPs ? '. Also cover how it maps to the ICP' : ''}",
  "primary_need_confidence": "low|medium|high - high only if evidence directly and unambiguously supports the need; low if mostly inferred from indirect signals",
  "cold_email_angle": "An INSTRUCTION for the email copywriter, NOT finished copy. Format: 'Ask/reference X. Do not imply/claim Y.' Say what may be asked about or referenced, and explicitly what must not be implied or claimed. Never phrase it as a sentence addressed to the prospect - no 'I noticed...', no first person, no question mark aimed at the reader. Do not add specifics (industries, geographies, scale) beyond what the evidence actually supports.",

  "is_b2b": true,
  "revenue_model": "SaaS",
  "has_outbound_motion": true,
  "outbound_signals": ["Hiring 3 SDRs", "Uses Salesforce (job post)", "Contact Sales CTA"],
  "sales_tools_detected": ["Salesforce", "HubSpot", "LinkedIn Sales Navigator"],
  "hiring_sales_roles": true,
  "sales_roles_open": ["SDR", "Account Executive"],
  "estimated_company_size": "Mid-Market (51-500)",
  "icp_score": 85,
  "icp_score_reasoning": "B2B SaaS, mid-market, actively hiring SDRs, using multiple sales tools${hasICPs ? ', strong alignment with [ICP name] pain points' : ''}",

  "product_fit_score": 80,
  "product_fit_reasoning": "Structural fit only - is this the kind of business/buyer this offering is built for",
  "need_evidence_score": 45,
  "need_evidence_reasoning": "How much DIRECT evidence exists of current need - should track primary_need_confidence",
  "outbound_maturity": "unknown|low|medium|high",
  "outbound_maturity_reasoning": "What outbound infrastructure was actually observed - 'unknown' when nothing visible, not 'low'",
  "personalization_evidence_score": 70,
  "personalization_evidence_reasoning": "How much concrete, citable material exists to personalize with",

  "growth_signals": [
    {
      "signal": "Short label, e.g. 'Recent cleanroom and healthcare manufacturing projects'",
      "evidence": "The concrete stated fact/source this is based on - empty string if this is inferred rather than stated",
      "interpretation": "What it might mean commercially",
      "confidence": "low|medium|high",
      "email_usability": "strong|medium|dont_use",
      "safe_use": "Instruction for the copywriter: what may be referenced, and what must NOT be claimed - same format as cold_email_angle"
    }
  ],
  "latest_funding_round": "Series X (if mentioned)",
  "funding_amount": "$XM (if mentioned)",
  "company_tone": "formal|casual|technical|friendly"${linkedinPosts.length > 0 ? `,
  "linkedin_topics": ["topics", "they", "post", "about"],
  "best_post_hook": "A specific icebreaker referencing their LinkedIn content"` : ''}
}

**EVIDENCE vs. HYPOTHESIS — DO NOT CONFLATE THEM**:
This is the single most important distinction in this analysis. Keep the two strictly separate:
- primary_need_evidence is a FACT: something the company itself actually states (website copy, LinkedIn post, job posting, tagline). If you can't point to a specific sentence or data point behind it, leave it empty and set primary_need_confidence to "low".
- primary_need is a HYPOTHESIS: your commercial guess about what they might want, built on top of that evidence. It is NOT the evidence restated more dramatically, and it must never smuggle in pain, urgency, or a crisis narrative the evidence doesn't actually support.
- Worked example of the failure mode to avoid: if the evidence is "75% of projects come through previous satisfied customers", that is proof of a HEALTHY referral channel — not proof of "feast-or-famine cycles" or a company desperate to "reduce reliance on referrals". A company thriving on referrals could be swamped with inbound work for all we know. The correct hypothesis here is softer and honest about the guess, e.g. "may benefit from adding a channel for new opportunities alongside their existing referral network" — not an invented pain point.
- When in doubt, prefer a lower-confidence, more modest hypothesis over a punchier but unsupported one. A vague-but-honest guess beats a specific-but-invented crisis.
- primary_need_reasoning must also name what the evidence does NOT establish whenever a reader could plausibly over-read the hypothesis — e.g. for the referrals example: does not establish that revenue is unpredictable, that the current model is a problem, or that they urgently need more work.

**WHAT MAKES A GOOD primary_need**:
- GROUNDED: Must trace back to primary_need_evidence — never invents a problem the evidence doesn't support
- HEDGED: Phrased as a possibility ("may benefit from", "could be looking for", "might value"), never stated as a confirmed fact or diagnosis
- PLAIN, NOT SALES COPY: This is an internal analytical note for a human reviewer, not customer-facing marketing text — avoid stacking qualifiers, geographies, or scale language ("consistent, scalable channel... within UK and European manufacturing sectors") that isn't directly supported by the evidence. Say the minimum the evidence actually earns.
- CONTEXTUAL: Incorporates their target market and business model, but only the parts the evidence supports
- ACTIONABLE: Something tangible they'd want more of
${hasICPs ? '- ICP-DERIVED: Must connect to a pain point or desire from the matching ICP' : ''}

**cold_email_angle IS AN INSTRUCTION, NOT A DRAFTED EMAIL LINE**:
The email-generation model reads this field to decide what it's allowed to ask about — it is not a sentence to be inserted verbatim into an email. Two AI stages should not both be doing copywriting.
- WRONG (this is copy, and it's overspecific): "I noticed that a large majority of your projects come from existing client referrals — curious how you currently balance that with proactive outreach to new manufacturing and healthcare production sites?"
- RIGHT (this is an instruction): "Ask whether previous clients and referrals still account for most new project opportunities. Do not imply this is a weakness, that revenue is unpredictable, or add industries/geographies beyond what's stated."
- Never start it with "I noticed..." or any first-person phrasing — that reads as automated/researched, which the email-writing rules already prohibit.
- Do not add specifics (industries, regions, scale) the evidence doesn't actually support, even if they seem plausible from context elsewhere in the analysis.

**GROWTH SIGNALS — SEPARATE STATED FACT FROM YOUR OWN INTERPRETATION**:
Same evidence-vs-hypothesis discipline as primary_need, applied per signal.
- Worked example: noticing several recent cleanroom/healthcare-adjacent projects on their site is
  EVIDENCE (a fact - list the actual projects/dates in "evidence"). Concluding "they are expanding
  into healthcare manufacturing" is your INTERPRETATION, not a fact - do not word "signal" as if
  the company announced an expansion unless they actually said so in "evidence".
- If a signal is inferred (not explicitly stated), set "evidence" to a specific description of what
  was actually observed (not a restatement of the interpretation), and confidence to "medium" or "low".
- email_usability: "strong" only when there's a citable fact safe to reference; "dont_use" when the
  signal is too speculative to safely bring up in outreach at all.
- safe_use follows the same instruction format as cold_email_angle: what may be referenced, what must
  not be claimed. E.g. "Reference recent healthcare-manufacturing project work if relevant. Do not
  claim the company is 'expanding into healthcare' unless explicitly stated."

**Rules**:
- ${hasICPs ? 'primary_need must be derived from the product\'s ICP pain points and desires, customized to this company' : effectiveProductContext ? 'primary_need must relate to what we can deliver' : 'primary_need should identify what business outcome they need most'}
- primary_need must include their specific target market/customer type, stated plainly
- primary_need must be hedged language, not an assertion — do not state it as something you know to be true
- primary_need_reasoning should explain why this fits based on evidence, and name what the evidence does NOT establish
- primary_need_evidence must be a real, traceable fact — never leave it as a rephrased version of primary_need itself
- primary_need_confidence must honestly reflect how directly the evidence supports the hypothesis, not how confident the writing sounds
- cold_email_angle must be an instruction (what to ask/reference + what not to imply), never a finished sentence addressed to the prospect
- ICP fields are REQUIRED: is_b2b, revenue_model, has_outbound_motion, hiring_sales_roles, estimated_company_size, icp_score, icp_score_reasoning
- The four ICP SCORE BREAKDOWN fields are REQUIRED whenever icp_score is produced — do not omit them
- outbound_maturity must be "unknown" (not "low") when no outbound infrastructure was visible but none was specifically ruled out either
- growth_signals entries must separate "evidence" (stated fact) from "interpretation" (your read on it) — never merge them into one assertion
- If no sales tools or roles found, use empty arrays [] (not null)
- If information isn't available for optional fields, omit them
- Return ONLY valid JSON
${dmTargetingPrompt}`;

      const techSignalsSection = renderTechSignalsForPrompt(detectedTech);

      const userPrompt = `Analyze this company:\n\n${websiteContent}${companyLinkedInSection}${linkedinSection}${techSignalsSection}${productContextSection}${personContextSection}`;

      console.log(`Using LLM model: ${llmModel}`);

      // max_tokens is the budget for EVERYTHING the model emits, and on a
      // reasoning model (qwen3.x, grok, o-series…) the thinking pass is billed
      // against it first. A flat 4000 was enough for a non-reasoning model but
      // this prompt asks for a large structured JSON object (ICP scoring +
      // breakdown fields, firmographics, growth signals, …) — a reasoning
      // model burns the whole budget thinking before writing any of it, so the
      // JSON came back empty ("no content") or cut off mid-fence ("could not be
      // parsed" on the literal ` ```json` token). Same root cause and fix as
      // generate-email-sequence: give it real headroom, cap the reasoning pass,
      // and retry once with a bigger budget if it's still truncated.
      const reasoningCap = chatEndpoint.provider === 'openrouter'
        ? { reasoning: { effort: 'low' } }
        : {};

      let content: string | undefined;
      let finishReason: string | undefined;
      let maxTokens = 9000;

      for (let attempt = 0; attempt < 2; attempt++) {
        const aiController = new AbortController();
        // Generous overall budget: rateLimitedFetch retries 429/5xx (common on
        // :free models) with exponential backoff, which can span well past a
        // single request's worth of time.
        const aiTimeout = setTimeout(() => aiController.abort(), 90_000);
        const aiResponse = await rateLimitedFetch({
          supabase,
          organizationId: contact.organization_id,
          url: chatEndpoint.url,
          init: {
            method: 'POST',
            headers: chatEndpoint.headers,
            body: JSON.stringify({
              model: chatEndpoint.model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: 0.3,
              max_tokens: maxTokens,
              ...reasoningCap,
            }),
            signal: aiController.signal,
          },
        });
        clearTimeout(aiTimeout);

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error('OpenRouter error:', aiResponse.status, errorText);
          const keyBlockMessage = await handleOpenRouterKeyBlock(
            supabase,
            contact.organization_id,
            aiResponse.status,
            errorText,
          );
          if (keyBlockMessage) {
            throw new Error(`OpenRouter key blocked: ${keyBlockMessage}`);
          }
          throw new Error(`OpenRouter API error ${aiResponse.status}: ${errorText.slice(0, 300)}`);
        }
        if (chatEndpoint.provider === 'openrouter') {
          await markOpenRouterKeyHealthy(supabase, contact.organization_id);
        }

        const aiResponseText = await aiResponse.text();
        let aiData: Record<string, unknown>;
        try {
          aiData = JSON.parse(aiResponseText);
        } catch {
          console.error('OpenRouter returned non-JSON response:', aiResponseText.slice(0, 500));
          throw new Error(`OpenRouter returned invalid JSON (status ${aiResponse.status})`);
        }
        // deno-lint-ignore no-explicit-any
        const choice = (aiData as any).choices?.[0];
        content = choice?.message?.content;
        finishReason = choice?.finish_reason;

        if (content && finishReason !== 'length') break;

        console.warn('Truncated AI response in analyze-company:', JSON.stringify({
          attempt, maxTokens, finishReason, hasContent: !!content,
        }));

        if (attempt === 0) maxTokens = Math.min(24000, maxTokens * 2);
      }

      if (content) {
        console.log('AI response received, length:', content.length);
        console.log('AI response preview:', content.substring(0, 500));
        try {
          // Parse JSON from response
          const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                           content.match(/```\s*([\s\S]*?)\s*```/) ||
                           [null, content];
          const jsonText = jsonMatch[1] || content;
          console.log('Extracted JSON text:', jsonText.substring(0, 500));
          const parsed = JSON.parse(jsonText.trim());

          // Merge AI analysis into result
          Object.assign(analysisResult, parsed);
          // custom_answers is handled by the dedicated call — never persist a raw one
          delete (analysisResult as Record<string, unknown>).custom_answers;

          // Record what icp_score was measured against so downstream consumers
          // know whether it's a real ICP match or a generic B2B fit score.
          if (analysisResult.icp_score !== undefined) {
            analysisResult.icp_score_basis = hasICPs ? 'icp_match' : (effectiveProductContext ? 'product_fit' : 'general_b2b');
          }

          // Record the firmographics the score was measured against, so a
          // surprising icp_score can be explained without re-running anything.
          if (resolvedFirmographics) {
            analysisResult.firmographic_employee_band = resolvedEmployeeBand;
            analysisResult.firmographic_employee_count = resolvedFirmographics.employee_count;
            analysisResult.firmographic_revenue_band = resolvedRevenueBand;
            analysisResult.firmographic_industry = resolvedFirmographics.industry;
            analysisResult.firmographic_source = resolvedFirmographics.source;
          }

          // Map matched_icp to selected_outcome for backward compatibility
          if (analysisResult.matched_icp && !analysisResult.selected_outcome) {
            analysisResult.selected_outcome = analysisResult.matched_icp;
          }

          console.log('AI analysis complete, parsed fields:', Object.keys(parsed));
        } catch (e) {
          console.error('Failed to parse AI response:', e);
          console.error('Raw content that failed to parse:', content);
          // Swallowing this used to leave analysisResult without an icp_score,
          // which process-lead-list-processing read as a real score of 0 and
          // permanently rejected on the first attempt (no retry budget spent
          // at all, unlike a genuine analysis). A malformed response is an LLM
          // hiccup, not a verdict on the lead — throw so it's classified
          // transient and retried (bounded by attempts>=4) like any other
          // upstream blip. Worded to match classifyProcessingFailure's
          // transient-first check in process-lead-list-processing.
          throw new Error(finishReason === 'length'
            ? `${llmModel} was cut off mid-analysis at its ${maxTokens}-token output budget even after a retry with a larger budget. Transient; retrying, but consider a model with a smaller reasoning pass.`
            : 'AI analysis response could not be parsed this attempt. Transient; retrying.');
        }
      } else {
        console.log('No content in AI response');
        // Same reasoning as the parse-failure branch above: no content means
        // no icp_score, which the caller would otherwise treat as a
        // permanent below-threshold rejection instead of a retryable miss.
        throw new Error(finishReason === 'length'
          ? `${llmModel} used its entire ${maxTokens}-token output budget on reasoning before writing any analysis, even after a retry with a larger budget. Transient; retrying, but consider a model with a smaller reasoning pass.`
          : 'AI analysis returned no content this attempt. Transient; retrying.');
      }

      // ── Dedicated, focused pass for the product's custom questions ──
      // A separate call answers these reliably (the main prompt tends to leave
      // them blank). Feeds the website + LinkedIn + detected-pixel evidence.
      if (customQuestions.length > 0) {
        const evidence = [
          analysisResult.company_niche ? `Company niche: ${analysisResult.company_niche}` : '',
          analysisResult.company_offering ? `Offering: ${analysisResult.company_offering}` : '',
          websiteContent,
          companyLinkedInSection,
          techSignalsSection,
        ].filter(Boolean).join('\n\n').substring(0, 16000);

        analysisResult.custom_analysis = await answerCustomQuestions({
          questions: customQuestions,
          companyName: contact.company || (analysisResult.company_niche as string) || 'the company',
          evidence,
          endpoint: chatEndpoint,
          supabase,
          organizationId: contact.organization_id,
        });
        console.log(`Custom questions answered: ${analysisResult.custom_analysis.map(c => `"${c.answer}"(${c.score})`).join(', ')}`);
      }
    } else {
      console.log('Skipping AI analysis - no website content, LinkedIn posts, or company data');
    }

    // Merge verified LinkedIn company data into the result (overwrites AI guesses with facts)
    if (companyLinkedInData) {
      if (companyLinkedInData.employee_count) {
        analysisResult.linkedin_employee_count = companyLinkedInData.employee_count;
      }
      if (companyLinkedInData.employee_count_range) {
        analysisResult.linkedin_employee_count_range = companyLinkedInData.employee_count_range;
      }
      const insightsTotal = companyLinkedInData.insights?.employeesCount?.totalCount;
      if (insightsTotal) {
        analysisResult.linkedin_employee_count = insightsTotal;
      }
      if (companyLinkedInData.followers_count) {
        analysisResult.linkedin_followers_count = companyLinkedInData.followers_count;
      }
      if (companyLinkedInData.industry?.length) {
        analysisResult.linkedin_industry = companyLinkedInData.industry;
      }
      if (companyLinkedInData.organization_type) {
        analysisResult.linkedin_organization_type = companyLinkedInData.organization_type;
      }
      if (companyLinkedInData.foundation_date) {
        analysisResult.linkedin_foundation_date = companyLinkedInData.foundation_date;
      }
      if (companyLinkedInData.locations?.length) {
        analysisResult.linkedin_locations = companyLinkedInData.locations.map(l => ({
          city: l.city,
          country: l.country,
          is_headquarter: l.is_headquarter,
        }));
      }
      // Employee growth
      const growth = companyLinkedInData.insights?.employeesCount?.growthGraph;
      if (growth?.length) {
        const sixMo = growth.find(g => g.monthRange === 6);
        if (sixMo) {
          analysisResult.linkedin_employee_growth_6mo = sixMo.growthPercentage;
        }
      }
      // Funding
      const funding = companyLinkedInData.crunchbase_funding;
      if (funding?.rounds?.last_round) {
        const lr = funding.rounds.last_round;
        analysisResult.linkedin_funding_last_round = lr.funding_type || undefined;
        if (lr.money_raised) {
          analysisResult.linkedin_funding_amount = `${lr.money_raised.currency} ${lr.money_raised.amount.toLocaleString()}`;
        }
        analysisResult.linkedin_funding_total_rounds = funding.rounds.total_count;
      }
      console.log('LinkedIn company data merged into analysis result');
    }

    // Persist detected website technologies / ad pixels (factual signal, independent of AI)
    if (detectedTech && detectedTech.total > 0) {
      analysisResult.detected_technologies = detectedTech;
    }

    // Step 4: Update contact with enrichment data
    console.log('Analysis result keys:', Object.keys(analysisResult));
    console.log('Analysis result:', JSON.stringify(analysisResult, null, 2).substring(0, 1000));

    // Only save if we have actual analysis results (beyond just raw LinkedIn posts)
    const aiAnalysisKeys = Object.keys(analysisResult).filter(k => k !== 'recent_linkedin_posts');
    if (aiAnalysisKeys.length === 0) {
      // Determine a specific error message based on what went wrong
      const dataSources: string[] = [];
      if (websiteContent) dataSources.push('website');
      if (linkedinPosts.length > 0) dataSources.push('linkedin_posts');
      if (companyLinkedInData) dataSources.push('linkedin_company');

      let failureReason: string;
      // Retryable = the failure is a "couldn't fetch this attempt" condition
      // (crawler service down, fetch timeout, transient network/upstream error),
      // NOT positive evidence the sources are permanently unusable. A plain
      // 'unreachable' scrape failure carries no such evidence — it is set for
      // timeouts and crawler-infra outages just as much as for genuinely dead
      // domains — so it must be retried (bounded downstream), not permanently
      // binned as no-source-data. Only the CONFIDENT-dead cases (SPA shell,
      // parked/error page) and genuinely-no-input cases are permanent.
      let retryable = false;
      if (dataSources.length > 0) {
        // We had data but AI analysis returned nothing parseable — retry: this
        // is usually a transient LLM/parse hiccup (incl. OpenRouter rate/credit).
        failureReason = `AI analysis returned empty or unparseable results despite having data (${dataSources.join(', ')}). Transient; retrying.`;
        retryable = true;
      } else if (scrapeFailureReason === 'spa') {
        failureReason = `Website (${websiteToAnalyze}) is JavaScript-rendered (SPA) and can't be read without a browser. No LinkedIn fallback available.`;
      } else if (scrapeFailureReason === 'error_page') {
        failureReason = `Website (${websiteToAnalyze}) is unreachable or a parked/error page. No LinkedIn fallback available.`;
      } else if (websiteScrapingAttempted && websiteScrapingFailed && scraperInfraUnavailable) {
        // Systemic: our scraper (crawl4ai) was down, so we never really tried.
        // Distinct wording so the processor parks WITHOUT burning retry budget.
        failureReason = `Scraper infrastructure temporarily unavailable while analyzing ${websiteToAnalyze}. Data service unavailable; will retry.`;
        retryable = true;
      } else if (websiteScrapingAttempted && websiteScrapingFailed && canFetchLinkedIn) {
        failureReason = `Company data could not be fetched this attempt — ${websiteToAnalyze} did not respond and LinkedIn returned no data. Transient fetch failure; retrying.`;
        retryable = true;
      } else if (websiteScrapingAttempted && websiteScrapingFailed) {
        failureReason = `Company data could not be fetched this attempt — ${websiteToAnalyze} did not respond. Transient fetch failure; retrying.`;
        retryable = true;
      } else if (!websiteToAnalyze && !canFetchLinkedIn) {
        failureReason = 'No website or LinkedIn URL available for analysis.';
      } else if (linkedinProviderUnavailable) {
        // LinkedIn was the only source and the PROVIDER failed us (expired
        // Unipile subscription, revoked account, transport error). Worded to
        // classify as transient so the contact is retried rather than being
        // terminally binned as no-source-data — a billing lapse must not
        // permanently write off otherwise-good leads.
        failureReason = 'LinkedIn data provider is unavailable (check the Unipile account/subscription); no website to fall back on. Transient; retrying.';
      } else {
        failureReason = 'No data could be retrieved from any source for analysis.';
      }

      console.log(`No analysis results to save: ${failureReason}`);

      // Honest flagging: when the site is confidently UNREADABLE (SPA shell or
      // error/parked page) and there's no LinkedIn fallback, mark the lead 'failed'
      // and strip any stale/hallucinated analysis so the UI doesn't show fake data.
      if ((scrapeFailureReason === 'spa' || scrapeFailureReason === 'error_page') && dataSources.length === 0) {
        const cleaned = stripAiAnalysisFields((contact.enrichment_data as Record<string, unknown>) || {});
        cleaned.analysis_error = failureReason;
        cleaned.analysis_error_reason = scrapeFailureReason;
        const { error: flagErr } = await supabase
          .from('crm_contacts')
          .update({
            enrichment_data: cleaned,
            ai_analysis_status: 'failed',
            ai_analyzed_at: new Date().toISOString(),
          })
          .eq('id', contactId);
        if (flagErr) console.error('Failed to flag unreadable-site contact:', flagErr);
        else console.log(`Flagged contact ${contactId} as failed (${scrapeFailureReason}) and cleared stale analysis`);
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: failureReason,
          reason: scrapeFailureReason,
          retryable,
          // Mark as "skipped" only if contact truly had no data sources at all
          skipped: !websiteScrapingAttempted && !canFetchLinkedIn,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const existingEnrichmentData = (contact.enrichment_data as Record<string, unknown>) || {};
    const updatedEnrichmentData = {
      ...existingEnrichmentData,
      ...analysisResult,
      analyzed_at: new Date().toISOString(),
      // What this run measured against. Read back by the skip check above so a
      // reused analysis can never be one scoped to a different product/ICP set.
      analysis_scope: wantedScope,
    };

    console.log('Saving enrichment data with keys:', Object.keys(updatedEnrichmentData));

    // Persist only provider-verified company facts in flat columns. AI output
    // (including estimated_company_size) must never become filterable truth.
    const verifiedFirmographicPatch: Record<string, unknown> = {};
    if (resolvedFirmographics) {
      if (resolvedFirmographics.employee_count && resolvedFirmographics.employee_count > 0) {
        verifiedFirmographicPatch.company_employee_count = resolvedFirmographics.employee_count;
      }
      if (resolvedFirmographics.revenue_range) {
        verifiedFirmographicPatch.company_revenue_range = resolvedFirmographics.revenue_range;
      }
      if (resolvedFirmographics.industry?.length) {
        verifiedFirmographicPatch.company_industry = resolvedFirmographics.industry.join(', ');
      }
      verifiedFirmographicPatch.firmographics_checked_at = new Date().toISOString();
      verifiedFirmographicPatch.firmographics_source = resolvedFirmographics.source;
    } else if (firmographicsChecked) {
      verifiedFirmographicPatch.firmographics_checked_at = new Date().toISOString();
      verifiedFirmographicPatch.firmographics_source = null;
    }

    const { error: updateError } = await supabase
      .from('crm_contacts')
      .update({
        enrichment_data: updatedEnrichmentData,
        enriched_at: new Date().toISOString(),
        ai_analysis_status: 'analyzed',
        ai_analyzed_at: new Date().toISOString(),
        ...verifiedFirmographicPatch,
      })
      .eq('id', contactId);

    if (updateError) {
      console.error('Failed to update contact:', updateError);
      throw new Error(`Failed to save analysis: ${updateError.message}`);
    }

    // The company row is canonical across contacts. Fill gaps only: a contact
    // analysis must not overwrite firmographics already established there.
    if (contact.company_id && resolvedFirmographics) {
      const { data: companyRow, error: companyReadError } = await supabase
        .from('crm_companies')
        .select('employee_count, industry')
        .eq('id', contact.company_id)
        .eq('organization_id', contact.organization_id)
        .maybeSingle();
      if (companyReadError) {
        console.warn('Could not read linked CRM company for firmographic sync:', companyReadError);
      } else if (companyRow) {
        const companyPatch: Record<string, unknown> = {};
        if (!companyRow.employee_count && resolvedFirmographics.employee_count) {
          companyPatch.employee_count = resolvedFirmographics.employee_count;
        }
        if (!companyRow.industry && resolvedFirmographics.industry?.length) {
          companyPatch.industry = resolvedFirmographics.industry.join(', ');
        }
        if (Object.keys(companyPatch).length > 0) {
          const { error: companyUpdateError } = await supabase
            .from('crm_companies')
            .update(companyPatch)
            .eq('id', contact.company_id)
            .eq('organization_id', contact.organization_id);
          if (companyUpdateError) console.warn('Could not sync verified CRM company firmographics:', companyUpdateError);
        }
      }
    }

    // Upsert per-product ICP score if a product was specified
    if (productId && analysisResult.icp_score !== undefined) {
      // Resolve decision-maker score: AI result takes priority, rule-based as fallback
      let dmScore: number | null = analysisResult.decision_maker_score ?? null;
      let dmReasoning: string | null = analysisResult.decision_maker_reasoning ?? null;
      let dmSource: string | null = dmScore !== null ? 'ai' : null;

      // If AI didn't produce a DM score, compute rule-based fallback
      if (dmScore === null && hasPersonData) {
        const personInput = {
          jobTitle: contact.job_title || null,
          seniority: enrichmentData.seniority || null,
          department: enrichmentData.department || null,
        };
        const ruleResult = hasDmCriteria
          ? computeDecisionMakerScore(personInput, {
              targetSeniorities: [...allTargetSeniorities],
              targetDepartments: [...allTargetDepartments],
              targetTitleKeywords: [...allTargetTitleKeywords],
            })
          : computeGenericDecisionMakerScore(personInput);
        if (ruleResult) {
          dmScore = ruleResult.score;
          dmReasoning = ruleResult.reasoning;
          dmSource = 'rule';
          console.log(`Rule-based DM score for contact ${contactId}: ${dmScore} (${dmReasoning})`);
        }
      }

      const { error: scoreError } = await supabase
        .from('contact_product_scores')
        .upsert({
          contact_id: contactId,
          product_id: productId,
          organization_id: contact.organization_id,
          icp_score: analysisResult.icp_score,
          icp_score_reasoning: analysisResult.icp_score_reasoning || null,
          primary_need: analysisResult.primary_need || null,
          primary_need_reasoning: analysisResult.primary_need_reasoning || null,
          selected_outcome: analysisResult.selected_outcome || null,
          decision_maker_score: dmScore,
          decision_maker_reasoning: dmReasoning,
          decision_maker_source: dmSource,
          analyzed_at: new Date().toISOString(),
          model: llmModel,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'contact_id,product_id',
        });

      if (scoreError) {
        console.error('Failed to upsert contact product score:', scoreError);
        // Non-fatal: enrichment_data was already saved
      } else {
        console.log(`Product score saved for contact ${contactId}, product ${productId}${dmScore !== null ? `, DM score: ${dmScore} (${dmSource})` : ''}`);
      }
    }

    console.log('Analysis saved successfully for contact', contactId);

    return new Response(
      JSON.stringify({
        success: true,
        contactId,
        analysis: analysisResult,
        sources: {
          website: !!websiteToAnalyze,
          linkedin_posts: linkedinPosts.length > 0,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error analyzing company:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
