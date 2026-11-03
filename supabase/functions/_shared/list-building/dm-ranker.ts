/**
 * Decision-Maker ranker for the List Building Engine.
 *
 * Pure function. Uses the existing rule-based primitives:
 *  - classifySdrTier()     -> Tier 0 / 1 / 2
 *  - computeGenericDecisionMakerScore() -> 0..100
 *
 * NO LLM call. NO database. The orchestrator is responsible for persisting
 * whichever candidate we return.
 */

import type { DMCandidate } from './types.ts';
import { classifySdrTier, type SdrTier } from '../sdr-title-classifier.ts';
import { computeGenericDecisionMakerScore } from '../decision-maker-scoring.ts';

export interface RankedDmCandidate {
  candidate: DMCandidate;
  tier: SdrTier;
  score: number;
}

export interface RankDecisionMakersResult {
  best: DMCandidate | null;
  ranked: RankedDmCandidate[];
}

/**
 * Rank DM candidates by: tier (1 > 2 > 0), then rule-based seniority score.
 * Returns the ranked list and the best candidate (or null if list empty).
 *
 * Fallback behavior: if NO candidate has tier >= 1 (i.e. all are Tier 0 rejects
 * or no tier signal), we still return the highest rule-based score - the spec
 * says "fall back to highest rule-based score" rather than return nothing.
 */
export function rankDecisionMakers(
  candidates: DMCandidate[],
): RankDecisionMakersResult {
  if (!candidates || candidates.length === 0) {
    return { best: null, ranked: [] };
  }

  const ranked: RankedDmCandidate[] = candidates.map((c) => {
    const tierResult = classifySdrTier(c.title ?? null);
    const dmResult = computeGenericDecisionMakerScore({
      jobTitle: c.title ?? null,
      seniority: null,
      department: null,
    });
    return {
      candidate: c,
      tier: tierResult.tier,
      score: dmResult?.score ?? 0,
    };
  });

  // Sort: tier 1 wins, then tier 2, then tier 0; within tier, score DESC.
  const tierPriority: Record<SdrTier, number> = { 1: 0, 2: 1, 0: 2 };
  ranked.sort((a, b) => {
    const tp = tierPriority[a.tier] - tierPriority[b.tier];
    if (tp !== 0) return tp;
    return b.score - a.score;
  });

  // Prefer a tier >= 1 candidate. If none, fall back to the highest-scored one.
  const tierHit = ranked.find((r) => r.tier === 1) ?? ranked.find((r) => r.tier === 2);
  const best = tierHit
    ? tierHit.candidate
    : ranked[0]?.candidate ?? null;

  return { best, ranked };
}
