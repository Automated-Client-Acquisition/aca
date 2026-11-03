/**
 * Reply Classification & Follow-Up Rule Types
 *
 * Shared types for the AI-powered reply classification and
 * automated follow-up rule systems.
 */

export type LeadIntent =
  | "interested"
  | "not_interested"
  | "out_of_office"
  | "auto_reply"
  | "meeting_booked"
  | "do_not_contact"
  | "neutral"
  | "unsubscribe";

export const LEAD_INTENT_LABELS: Record<LeadIntent, string> = {
  interested: "Interested",
  not_interested: "Not Interested",
  out_of_office: "Out of Office",
  auto_reply: "Auto Reply",
  meeting_booked: "Meeting Booked",
  do_not_contact: "Do Not Contact",
  neutral: "Neutral",
  unsubscribe: "Unsubscribe",
};

export interface ClassificationResult {
  intent: LeadIntent;
  confidence: number; // 0.0 - 1.0
  reasoning: string;
  needs_human_review: boolean;
  classified_at: string;
}

export type FollowupTriggerType = "intent_match" | "no_reply_timeout" | "lead_magnet_delivery";

export interface IntentMatchConfig {
  intents: LeadIntent[];
  confidence_min: number; // 0.0 - 1.0
}

export interface NoReplyTimeoutConfig {
  timeout_days: number;
}

export type LeadMagnetDeliveryConfig = Record<string, never>;

export interface FollowupRule {
  id: string;
  sequence_id: string | null;
  campaign_id: string | null;
  lead_magnet_campaign_id: string | null;
  organization_id: string;
  name: string;
  trigger_type: FollowupTriggerType;
  trigger_config: IntentMatchConfig | NoReplyTimeoutConfig | LeadMagnetDeliveryConfig;
  target_sequence_id: string;
  delay_hours: number;
  is_active: boolean;
  total_triggered: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  target_sequence_name?: string;
}
