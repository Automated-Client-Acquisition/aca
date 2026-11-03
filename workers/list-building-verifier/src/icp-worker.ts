/**
 * ICP stage worker: claims stage='icp' items, calls OpenRouter with a
 * structured scoring prompt, and writes lb_enriched_leads rows.
 *
 * We re-implement the prompt shape here in Node rather than importing from
 * the Deno icp-scorer — the structured scorer (Stream E) may change the
 * Deno side, so the patch at the bottom of this worktree's summary covers
 * keeping these in sync.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface IcpPayload {
  job_id: string;
  company_id: string;
  contact_id: string;
  verified_email: string;
  first_name: string;
  last_name: string;
  title: string | null;
  company_name: string;
  company_industry: string | null;
  company_size: string | null;
  country: string | null;
  icp_definition: {
    id: string;
    name: string;
    description: string | null;
    criteria: Record<string, unknown>;
  };
}

export interface IcpResult {
  fit_label: 'Strong' | 'Good' | 'Weak' | 'Disqualify';
  score: number;
  reasoning: string;
  breakdown: Record<string, unknown>;
}

// claude-3.5-sonnet was retired by OpenRouter (returns 404 "No endpoints found")
// — claude-haiku-4.5 is the cheap, fast successor for short-form scoring tasks
// like ICP fit reasoning. Switch to claude-sonnet-4.6 if richer reasoning is
// needed at higher cost.
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

export async function scoreIcp(
  openRouterKey: string,
  payload: IcpPayload,
  model = DEFAULT_MODEL,
): Promise<IcpResult> {
  const system = `You are an ICP (Ideal Customer Profile) scorer. Given a contact and company,
score how well they match the provided ICP. Respond ONLY with minified JSON matching:
{"fit_label":"Strong|Good|Weak|Disqualify","score":0-100,"reasoning":"short","breakdown":{}}`;

  const user = JSON.stringify({
    contact: {
      name: `${payload.first_name} ${payload.last_name}`.trim(),
      title: payload.title,
      email: payload.verified_email,
    },
    company: {
      name: payload.company_name,
      industry: payload.company_industry,
      size: payload.company_size,
      country: payload.country,
    },
    icp: payload.icp_definition,
  });

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${openRouterKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
    }),
  });
  if (!res.ok) {
    throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  }
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? '{}';
  let parsed: Partial<IcpResult>;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  return {
    fit_label: (parsed.fit_label as IcpResult['fit_label']) ?? 'Weak',
    score: typeof parsed.score === 'number' ? parsed.score : 0,
    reasoning: parsed.reasoning ?? '',
    breakdown: (parsed.breakdown as Record<string, unknown>) ?? {},
  };
}

export async function writeEnrichedLead(
  supabase: SupabaseClient,
  payload: IcpPayload,
  result: IcpResult,
): Promise<void> {
  const { error } = await supabase.from('lb_enriched_leads').insert({
    job_id: payload.job_id,
    company_id: payload.company_id,
    contact_id: payload.contact_id,
    verified_email: payload.verified_email,
    email_status: 'verified',
    icp_score: result.score,
    fit_label: result.fit_label,
    score_breakdown: result.breakdown,
    claude_reasoning: result.reasoning,
  });
  if (error) throw error;
}
