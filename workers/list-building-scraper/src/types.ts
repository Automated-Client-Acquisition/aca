/**
 * Local copy of the shared types from
 * supabase/functions/_shared/list-building/types.ts — kept in sync by hand
 * because this worker is a separate Node package and cannot import Deno code.
 */

export interface DiscoveredCompany {
  company_name: string;
  domain: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  employee_signal?: string | null;
  employee_count_estimate?: number | null;
  source: 'google_maps' | 'google_search' | 'directory' | 'linkedin' | 'whois' | 'common_crawl';
  raw_html_snippet?: string | null;
}

export interface DMCandidate {
  first_name: string;
  last_name?: string | null;
  middle_name?: string | null;
  title?: string | null;
  seniority_score?: number | null;
  linkedin_url?: string | null;
  source_page?: string | null;
  reasoning?: string;
  confidence?: number;
}

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface CompanyScraperQuery {
  niche: string;
  geo: string;
  sources: string[];
  limit: number;
}
