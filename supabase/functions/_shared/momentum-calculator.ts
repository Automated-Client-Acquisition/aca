/**
 * Deal Momentum Calculator Module (shared)
 *
 * Computes a 0-100 momentum score based on conversation dynamics:
 * reply speed trends, intent trajectory, engagement cadence, and recency.
 *
 * Used by:
 *   - email-imap-poller (update momentum on new inbound)
 *   - crm-conversation hooks (real-time momentum display)
 *   - campaign-processor (prioritize hot leads)
 */

import type { LeadIntent } from './reply-classifier.ts';

// ============================================================================
// Types
// ============================================================================

export interface MomentumResult {
  score: number; // 0-100
  trend: 'rising' | 'stable' | 'falling' | 'cold';
  factors: {
    replySpeedTrend: number;    // -1 to 1
    intentTrajectory: number;    // -1 to 1
    engagementCadence: number;   // 0 to 1
    recency: number;             // 0 to 1
  };
}

interface MessageRow {
  id: string;
  sender_type: string;
  created_at: string;
  metadata?: Record<string, any> | null;
}

// ============================================================================
// Intent Score Map
// ============================================================================

const INTENT_SCORES: Record<string, number> = {
  interested: 1,
  meeting_booked: 1,
  neutral: 0.3,
  not_interested: -0.5,
  do_not_contact: -1,
  out_of_office: 0,
  unsubscribe: -0.8,
  auto_reply: 0,
};

// ============================================================================
// Main Export
// ============================================================================

/**
 * Compute the momentum score for a conversation.
 *
 * Factors (each weighted 25%):
 *   - Reply Speed Trend: Are reply times getting faster or slower?
 *   - Intent Trajectory: Are classified intents trending positive or negative?
 *   - Engagement Cadence: How regular and recent is the messaging pattern?
 *   - Recency: How recently did the last message arrive?
 */
export async function computeMomentum(
  supabase: any,
  conversationId: string,
  organizationId: string,
): Promise<MomentumResult> {
  // Fetch last 20 messages ordered by created_at ascending
  const { data: rawMessages } = await supabase
    .from('crm_messages')
    .select('id, sender_type, created_at, metadata')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(20);

  const messages: MessageRow[] = rawMessages || [];

  if (messages.length === 0) {
    return {
      score: 0,
      trend: 'cold',
      factors: { replySpeedTrend: 0, intentTrajectory: 0, engagementCadence: 0, recency: 0 },
    };
  }

  // Compute each factor
  const replySpeedTrend = computeReplySpeedTrend(messages);
  const intentTrajectory = computeIntentTrajectory(messages);
  const engagementCadence = computeEngagementCadence(messages);
  const recency = computeRecency(messages);

  // Composite score: each factor contributes 25 points
  // replySpeedTrend is -1 to 1 → normalize to 0-1 range: (value * 0.5 + 0.5) * 25
  // intentTrajectory is -1 to 1 → (value * 0.5 + 0.5) * 25
  // engagementCadence is 0 to 1 → value * 25
  // recency is 0 to 1 → value * 25
  const rawScore =
    (replySpeedTrend * 0.5 + 0.5) * 25 +
    (intentTrajectory * 0.5 + 0.5) * 25 +
    engagementCadence * 25 +
    recency * 25;

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Determine trend by comparing to stored previous score
  const trend = await determineTrend(supabase, conversationId, score, messages);

  // Store current score in conversation metadata for next comparison
  await storeCurrentScore(supabase, conversationId, score);

  return {
    score,
    trend,
    factors: { replySpeedTrend, intentTrajectory, engagementCadence, recency },
  };
}

// ============================================================================
// Factor Computations
// ============================================================================

/**
 * Reply Speed Trend (-1 to 1).
 * For each inbound→outbound pair, compute reply time.
 * Compare recent speeds to earlier speeds.
 */
function computeReplySpeedTrend(messages: MessageRow[]): number {
  const replyTimes: number[] = [];

  for (let i = 0; i < messages.length - 1; i++) {
    const current = messages[i];
    const next = messages[i + 1];

    // Look for inbound (contact) → outbound (user) pairs
    if (current.sender_type === 'contact' && next.sender_type === 'user') {
      const inboundTime = new Date(current.created_at).getTime();
      const outboundTime = new Date(next.created_at).getTime();
      const replyHours = (outboundTime - inboundTime) / (1000 * 60 * 60);

      if (replyHours > 0) {
        replyTimes.push(replyHours);
      }
    }
  }

  if (replyTimes.length < 3) return 0;

  // Split into first half and second half
  const midpoint = Math.floor(replyTimes.length / 2);
  const firstHalf = replyTimes.slice(0, midpoint);
  const secondHalf = replyTimes.slice(midpoint);

  const avgFirst = average(firstHalf);
  const avgSecond = average(secondHalf);

  if (avgFirst === 0) return 0;

  // Getting faster = positive (second half reply times are shorter)
  // Normalize: percentage change, clamped to -1..1
  const change = (avgFirst - avgSecond) / avgFirst;
  return Math.max(-1, Math.min(1, change));
}

/**
 * Intent Trajectory (-1 to 1).
 * Look at classification intents over time and compute the slope.
 */
function computeIntentTrajectory(messages: MessageRow[]): number {
  const intentValues: number[] = [];

  for (const msg of messages) {
    const intent = msg.metadata?.classification?.intent as LeadIntent | undefined;
    if (intent && INTENT_SCORES[intent] !== undefined) {
      intentValues.push(INTENT_SCORES[intent]);
    }
  }

  if (intentValues.length < 2) return 0;

  // Simple linear slope via least squares
  const n = intentValues.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += intentValues[i];
    sumXY += i * intentValues[i];
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  const slope = (n * sumXY - sumX * sumY) / denominator;

  // Clamp to -1..1
  return Math.max(-1, Math.min(1, slope));
}

/**
 * Engagement Cadence (0 to 1).
 * Based on how recently the conversation has been active.
 */
function computeEngagementCadence(messages: MessageRow[]): number {
  if (messages.length === 0) return 0;

  const lastMessageTime = new Date(messages[messages.length - 1].created_at).getTime();
  const now = Date.now();
  const daysSinceLast = (now - lastMessageTime) / (1000 * 60 * 60 * 24);

  if (daysSinceLast <= 7) return 1.0;
  if (daysSinceLast <= 14) return 0.7;
  if (daysSinceLast <= 30) return 0.3;
  return 0;
}

/**
 * Recency (0 to 1).
 * Hours since the last message.
 */
function computeRecency(messages: MessageRow[]): number {
  if (messages.length === 0) return 0;

  const lastMessageTime = new Date(messages[messages.length - 1].created_at).getTime();
  const hoursSince = (Date.now() - lastMessageTime) / (1000 * 60 * 60);

  if (hoursSince < 4) return 1.0;
  if (hoursSince < 12) return 0.8;
  if (hoursSince < 24) return 0.6;
  if (hoursSince < 48) return 0.4;
  if (hoursSince < 168) return 0.2; // 7 days
  return 0;
}

// ============================================================================
// Trend Determination
// ============================================================================

/**
 * Determine the momentum trend by comparing to the previous stored score.
 */
async function determineTrend(
  supabase: any,
  conversationId: string,
  currentScore: number,
  messages: MessageRow[],
): Promise<'rising' | 'stable' | 'falling' | 'cold'> {
  // Check if no messages in 7+ days
  if (messages.length > 0) {
    const lastMessageTime = new Date(messages[messages.length - 1].created_at).getTime();
    const daysSinceLast = (Date.now() - lastMessageTime) / (1000 * 60 * 60 * 24);
    if (daysSinceLast > 7) return 'cold';
  }

  // Fetch previous score from conversation metadata
  const { data: conversation } = await supabase
    .from('crm_conversations')
    .select('metadata')
    .eq('id', conversationId)
    .single();

  const previousScore = conversation?.metadata?.momentum_score;

  if (previousScore == null || typeof previousScore !== 'number') {
    // No previous score — treat as stable for the first calculation
    return 'stable';
  }

  const delta = currentScore - previousScore;

  if (delta > 10) return 'rising';
  if (delta < -10) return 'falling';
  return 'stable';
}

/**
 * Store the current momentum score in conversation metadata.
 */
async function storeCurrentScore(
  supabase: any,
  conversationId: string,
  score: number,
): Promise<void> {
  // Fetch current metadata to merge
  const { data: conversation } = await supabase
    .from('crm_conversations')
    .select('metadata')
    .eq('id', conversationId)
    .single();

  const existingMetadata = conversation?.metadata || {};

  const { error } = await supabase
    .from('crm_conversations')
    .update({
      metadata: {
        ...existingMetadata,
        momentum_score: score,
        momentum_updated_at: new Date().toISOString(),
      },
    })
    .eq('id', conversationId);

  if (error) {
    console.error('[Momentum] Failed to store score:', error.message);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}
