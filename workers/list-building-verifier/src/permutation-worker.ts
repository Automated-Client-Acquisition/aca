/**
 * Pattern stage worker: claims stage='pattern' items, generates the full
 * 33-pattern permutation table (Tier 1 → Tier 3), and enqueues stage='smtp'
 * items with the candidate emails as payload.
 *
 * The permutation table is ported inline from the List Building spec — we
 * intentionally don't share code with the Deno permutation-generator.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PatternPayload {
  company_id: string;
  domain: string;
  first_name: string;
  last_name: string;
  // Optional known-good pattern seed from lb_pattern_cache.
  hint_pattern?: string | null;
}

export interface SmtpPayload {
  company_id: string;
  domain: string;
  email: string;
  pattern: string;
  first_name: string;
  last_name: string;
  tier: 1 | 2 | 3;
}

// The 33 patterns, ordered by tier. {f}=first, {l}=last, {fi}=first initial, {li}=last initial.
const PATTERNS: { tier: 1 | 2 | 3; name: string; fn: (f: string, l: string) => string }[] = [
  // Tier 1 — the big 8.
  { tier: 1, name: 'first.last',        fn: (f, l) => `${f}.${l}` },
  { tier: 1, name: 'first',             fn: (f)    => f },
  { tier: 1, name: 'flast',             fn: (f, l) => `${f[0] ?? ''}${l}` },
  { tier: 1, name: 'firstl',            fn: (f, l) => `${f}${l[0] ?? ''}` },
  { tier: 1, name: 'first_last',        fn: (f, l) => `${f}_${l}` },
  { tier: 1, name: 'firstlast',         fn: (f, l) => `${f}${l}` },
  { tier: 1, name: 'last.first',        fn: (f, l) => `${l}.${f}` },
  { tier: 1, name: 'last',              fn: (_, l) => l },
  // Tier 2 — initials and hyphens.
  { tier: 2, name: 'f.last',            fn: (f, l) => `${f[0] ?? ''}.${l}` },
  { tier: 2, name: 'first.l',           fn: (f, l) => `${f}.${l[0] ?? ''}` },
  { tier: 2, name: 'fl',                fn: (f, l) => `${f[0] ?? ''}${l[0] ?? ''}` },
  { tier: 2, name: 'f_last',            fn: (f, l) => `${f[0] ?? ''}_${l}` },
  { tier: 2, name: 'first-last',        fn: (f, l) => `${f}-${l}` },
  { tier: 2, name: 'last.f',            fn: (f, l) => `${l}.${f[0] ?? ''}` },
  { tier: 2, name: 'lastf',             fn: (f, l) => `${l}${f[0] ?? ''}` },
  { tier: 2, name: 'lfirst',            fn: (f, l) => `${l[0] ?? ''}${f}` },
  { tier: 2, name: 'l.first',           fn: (f, l) => `${l[0] ?? ''}.${f}` },
  { tier: 2, name: 'first-l',           fn: (f, l) => `${f}-${l[0] ?? ''}` },
  { tier: 2, name: 'f-last',            fn: (f, l) => `${f[0] ?? ''}-${l}` },
  { tier: 2, name: 'last_first',        fn: (f, l) => `${l}_${f}` },
  { tier: 2, name: 'firstlast1',        fn: (f, l) => `${f}${l}1` },
  { tier: 2, name: 'first.lastname',    fn: (f, l) => `${f}.${l}` },
  // Tier 3 — rare / role-based fallbacks (still per-person structured).
  { tier: 3, name: 'first1',            fn: (f)    => `${f}1` },
  { tier: 3, name: 'last1',             fn: (_, l) => `${l}1` },
  { tier: 3, name: 'f.l',               fn: (f, l) => `${f[0] ?? ''}.${l[0] ?? ''}` },
  { tier: 3, name: 'first_l',           fn: (f, l) => `${f}_${l[0] ?? ''}` },
  { tier: 3, name: 'l_first',           fn: (f, l) => `${l[0] ?? ''}_${f}` },
  { tier: 3, name: 'last-first',        fn: (f, l) => `${l}-${f}` },
  { tier: 3, name: 'first.last.name',   fn: (f, l) => `${f}.${l}.name` },
  { tier: 3, name: 'firstname',         fn: (f)    => f },
  { tier: 3, name: 'lastname',          fn: (_, l) => l },
  { tier: 3, name: 'flastname',         fn: (f, l) => `${f[0] ?? ''}${l}` },
  { tier: 3, name: 'firstnamel',        fn: (f, l) => `${f}${l[0] ?? ''}` },
];

function normalize(s: string): string {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

export function generatePermutations(payload: PatternPayload): SmtpPayload[] {
  const f = normalize(payload.first_name);
  const l = normalize(payload.last_name);
  if (!f || !l) return [];
  const seen = new Set<string>();
  const out: SmtpPayload[] = [];

  const pushOne = (tier: 1 | 2 | 3, patternName: string, local: string) => {
    if (!local) return;
    const email = `${local}@${payload.domain}`;
    if (seen.has(email)) return;
    seen.add(email);
    out.push({
      company_id: payload.company_id,
      domain: payload.domain,
      email,
      pattern: patternName,
      first_name: payload.first_name,
      last_name: payload.last_name,
      tier,
    });
  };

  // If we have a cache hint, try that first at tier 1 so the SMTP worker hits it before the fanout.
  if (payload.hint_pattern) {
    const hint = PATTERNS.find((p) => p.name === payload.hint_pattern);
    if (hint) pushOne(1, hint.name, hint.fn(f, l));
  }

  for (const p of PATTERNS) pushOne(p.tier, p.name, p.fn(f, l));
  return out;
}

export async function runPatternBatch(
  supabase: SupabaseClient,
  edgeFnUrl: string,
  serviceKey: string,
  items: Array<{ id: number; job_id: string; payload: PatternPayload }>,
): Promise<void> {
  const byJob = new Map<string, SmtpPayload[]>();
  for (const item of items) {
    const perms = generatePermutations(item.payload);
    const existing = byJob.get(item.job_id) ?? [];
    existing.push(...perms);
    byJob.set(item.job_id, existing);
  }

  for (const [job_id, payloads] of byJob) {
    if (payloads.length === 0) continue;
    const res = await fetch(`${edgeFnUrl}/list-building-enqueue-next`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ job_id, stage: 'smtp', payloads }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`enqueue smtp failed: ${res.status} ${text}`);
    }
  }
}
