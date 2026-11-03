/**
 * Deal Momentum Calculator (Node.js port)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface MomentumResult {
  score: number;
  trend: 'rising' | 'stable' | 'falling' | 'cold';
}

interface MessageRow {
  id: string;
  sender_type: string;
  created_at: string;
  metadata?: Record<string, any> | null;
}

const INTENT_SCORES: Record<string, number> = {
  interested: 1, meeting_booked: 1, neutral: 0.3,
  not_interested: -0.5, do_not_contact: -1,
  out_of_office: 0, unsubscribe: -0.8, auto_reply: 0,
};

export async function computeMomentum(
  supabase: SupabaseClient,
  conversationId: string,
  _organizationId: string,
): Promise<MomentumResult> {
  const { data: rawMessages } = await supabase
    .from('crm_messages')
    .select('id, sender_type, created_at, metadata')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(20);

  const messages: MessageRow[] = rawMessages || [];

  if (messages.length === 0) {
    return { score: 0, trend: 'cold' };
  }

  const replySpeedTrend = computeReplySpeedTrend(messages);
  const intentTrajectory = computeIntentTrajectory(messages);
  const engagementCadence = computeEngagementCadence(messages);
  const recency = computeRecency(messages);

  const rawScore =
    (replySpeedTrend * 0.5 + 0.5) * 25 +
    (intentTrajectory * 0.5 + 0.5) * 25 +
    engagementCadence * 25 +
    recency * 25;

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const trend = await determineTrend(supabase, conversationId, score, messages);

  // Store current score
  const { data: conversation } = await supabase
    .from('crm_conversations')
    .select('metadata')
    .eq('id', conversationId)
    .single();

  await supabase
    .from('crm_conversations')
    .update({
      metadata: {
        ...((conversation?.metadata as Record<string, any>) || {}),
        momentum_score: score,
        momentum_updated_at: new Date().toISOString(),
      },
    })
    .eq('id', conversationId);

  return { score, trend };
}

function computeReplySpeedTrend(messages: MessageRow[]): number {
  const replyTimes: number[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].sender_type === 'contact' && messages[i + 1].sender_type === 'user') {
      const hours = (new Date(messages[i + 1].created_at).getTime() - new Date(messages[i].created_at).getTime()) / 3600000;
      if (hours > 0) replyTimes.push(hours);
    }
  }
  if (replyTimes.length < 3) return 0;
  const mid = Math.floor(replyTimes.length / 2);
  const avgFirst = avg(replyTimes.slice(0, mid));
  const avgSecond = avg(replyTimes.slice(mid));
  if (avgFirst === 0) return 0;
  return Math.max(-1, Math.min(1, (avgFirst - avgSecond) / avgFirst));
}

function computeIntentTrajectory(messages: MessageRow[]): number {
  const values: number[] = [];
  for (const msg of messages) {
    const intent = (msg.metadata as any)?.classification?.intent as string | undefined;
    if (intent && INTENT_SCORES[intent] !== undefined) values.push(INTENT_SCORES[intent]);
  }
  if (values.length < 2) return 0;
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return Math.max(-1, Math.min(1, (n * sumXY - sumX * sumY) / denom));
}

function computeEngagementCadence(messages: MessageRow[]): number {
  if (messages.length === 0) return 0;
  const days = (Date.now() - new Date(messages[messages.length - 1].created_at).getTime()) / 86400000;
  if (days <= 7) return 1.0;
  if (days <= 14) return 0.7;
  if (days <= 30) return 0.3;
  return 0;
}

function computeRecency(messages: MessageRow[]): number {
  if (messages.length === 0) return 0;
  const hours = (Date.now() - new Date(messages[messages.length - 1].created_at).getTime()) / 3600000;
  if (hours < 4) return 1.0;
  if (hours < 12) return 0.8;
  if (hours < 24) return 0.6;
  if (hours < 48) return 0.4;
  if (hours < 168) return 0.2;
  return 0;
}

async function determineTrend(
  supabase: SupabaseClient,
  conversationId: string,
  currentScore: number,
  messages: MessageRow[],
): Promise<'rising' | 'stable' | 'falling' | 'cold'> {
  if (messages.length > 0) {
    const days = (Date.now() - new Date(messages[messages.length - 1].created_at).getTime()) / 86400000;
    if (days > 7) return 'cold';
  }
  const { data: conversation } = await supabase
    .from('crm_conversations')
    .select('metadata')
    .eq('id', conversationId)
    .single();
  const previousScore = (conversation?.metadata as any)?.momentum_score;
  if (previousScore == null || typeof previousScore !== 'number') return 'stable';
  const delta = currentScore - previousScore;
  if (delta > 10) return 'rising';
  if (delta < -10) return 'falling';
  return 'stable';
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
