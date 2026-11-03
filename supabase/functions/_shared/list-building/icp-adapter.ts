/**
 * ICP adapter for the List Building Engine.
 *
 * Delegates to `scoreCompanyForListBuilding` in _shared/icp-scorer.ts which
 * returns a real per-dimension breakdown (industry /25, size /20, geo /15,
 * seniority /20, type /20) from a single structured LLM call. No more
 * proportional-split approximation.
 */

import {
  scoreCompanyForListBuilding,
  type ICPDefinition,
} from '../icp-scorer.ts';
import type {
  DiscoveredCompany,
  DMCandidate,
  EnrichedLeadOutput,
  FitLabel,
  IcpScoreBreakdown,
} from './types.ts';

export interface ScoreCompanyDmInput {
  company: DiscoveredCompany;
  dm: DMCandidate;
  icp: ICPDefinition;
  openRouterApiKey: string;
  referer?: string;
}

export function mapScoreToFitLabel(score: number): FitLabel {
  if (score >= 85) return 'Strong';
  if (score >= 65) return 'Good';
  if (score >= 40) return 'Weak';
  return 'Disqualify';
}

/**
 * Score a (company, DM) pair against an ICP definition.
 * Returns a partial EnrichedLeadOutput — the caller fills in
 * verified_email, email_status.
 */
export async function scoreCompanyDmAgainstIcp(
  input: ScoreCompanyDmInput,
): Promise<Pick<EnrichedLeadOutput, 'icp_score' | 'fit_label' | 'score_breakdown' | 'reasoning'>> {
  const { company, dm, icp, openRouterApiKey, referer } = input;

  const breakdown = await scoreCompanyForListBuilding(
    {
      company: {
        company_name: company.company_name,
        domain: company.domain,
        website_url: company.website_url,
        linkedin_url: company.linkedin_url,
        city: company.city,
        state: company.state,
        country: company.country,
        employee_signal: company.employee_signal,
        employee_count_estimate: company.employee_count_estimate,
        raw_html_snippet: company.raw_html_snippet,
      },
      dm: {
        first_name: dm.first_name,
        last_name: dm.last_name,
        title: dm.title,
        linkedin_url: dm.linkedin_url ?? null,
      },
      icpDefinition: icp,
    },
    openRouterApiKey,
    referer,
  );

  const scoreBreakdown: IcpScoreBreakdown = {
    industry: breakdown.industry,
    size: breakdown.size,
    geo: breakdown.geo,
    seniority: breakdown.seniority,
    type: breakdown.type,
  };

  const total = Math.max(
    0,
    Math.min(
      100,
      scoreBreakdown.industry +
        scoreBreakdown.size +
        scoreBreakdown.geo +
        scoreBreakdown.seniority +
        scoreBreakdown.type,
    ),
  );

  return {
    icp_score: total,
    fit_label: mapScoreToFitLabel(total),
    score_breakdown: scoreBreakdown,
    reasoning: breakdown.reasoning,
  };
}
