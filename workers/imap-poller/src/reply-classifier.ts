/**
 * Reply Classifier Module (Node.js port)
 *
 * AI-powered classification of inbound email replies.
 */

import { detectAutoReply } from './reply-processing.js';
import { DEFAULT_FAST_TEXT_MODEL } from './default-models.js';

// ============================================================================
// Types
// ============================================================================

export type LeadIntent =
  | 'interested'
  | 'not_interested'
  | 'out_of_office'
  | 'auto_reply'
  | 'meeting_booked'
  | 'do_not_contact'
  | 'neutral'
  | 'unsubscribe';

export interface ClassificationInput {
  from_email: string;
  subject: string;
  body_text: string;
  original_outbound_subject?: string;
  thread_context?: string;
}

export interface ClassificationResult {
  intent: LeadIntent;
  confidence: number;
  reasoning: string;
  needs_human_review: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CLASSIFIER_MODEL = DEFAULT_FAST_TEXT_MODEL;
const CLASSIFIER_TIMEOUT_MS = 12_000;

// Unsubscribe detection is handled by the LLM only.
// Regex matching caused false positives from newsletter footers/quoted HTML.

const OOO_PATTERNS = [
  /out of (?:the )?office/i, /out-of-office/i,
  /on (?:vacation|leave|holiday|PTO)/i,
  /i(?:'m| am) (?:currently )?(?:away|out|off)/i,
  /will be (?:back|returning) (?:on|in)/i,
  /away from (?:my )?(?:email|desk|computer)/i,
  /limited access to email/i, /currently unavailable/i,
];

// Only truly unambiguous interest signals — the LLM handles typos/creative text.
// These are a fast-path safety net, not the primary classifier.
const INTERESTED_PATTERNS = [
  /\bi'?m\s+int(?:e)?rested\b/i,                    // "I'm interested", "im intrested"
  /\blet'?s\s+(?:chat|talk|connect|meet|do it)\b/i,  // "let's chat", "lets talk"
  /\bsounds?\s+(?:good|great|awesome|perfect)\b/i,   // "sounds good", "sound great"
  /\bbook\s+(?:a\s+)?(?:time|slot|meeting|call|demo)\b/i,  // "book a call"
  /\byes\s*[,!.]?\s*(?:please|let'?s|that\s+works|i'?d\s+love)\b/i,  // "yes please", "yes, let's"
  /\bwhen\s+(?:are\s+you|can\s+(?:we|you))\b.*\b(?:free|available|meet)\b/i, // "when are you free"
  /\bsend\s+(?:me|over)\b.*\b(?:info|details|pricing)\b/i,  // "send me info"
  /\bi'?d\s+love\s+to\b/i,                           // "I'd love to"
  /\blooking\s+forward\b/i,                           // "looking forward to it"
];

// Scheduling/meeting confirmation patterns — these indicate a specific time has been
// proposed or confirmed. Classified as "meeting_booked" with high confidence.
const MEETING_BOOKED_PATTERNS = [
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?\s*(?:works?|is\s+(?:good|great|fine|perfect))\b/i,  // "Monday 3PM works", "Tuesday at 2pm is good"
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)\s+(?:works?|is\s+(?:good|great|fine|perfect)|sounds?\s+(?:good|great|perfect))\b/i,  // "3pm works", "2:30 PM sounds good"
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?\s*(?:CET|CEST|EST|PST|CST|MST|GMT|UTC|ET|PT|CT|MT|IST|BST|AEST)\b/i,  // "Monday 3PM CET"
  /\b(?:that|this)\s+(?:time|slot)\s+(?:works?|is\s+(?:good|great|fine|perfect))\b/i,  // "that time works", "this slot is perfect"
  /\b(?:confirm|confirmed|confirming)\s+(?:the\s+)?(?:meeting|call|appointment|slot|time|demo)\b/i,  // "confirming the meeting"
  /\b(?:see|talk\s+to)\s+you\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|then|there)\b/i,  // "see you Monday", "talk to you then"
  /\b(?:lock|locked)\s+(?:it\s+)?in\b/i,             // "lock it in", "locked in"
  /\b(?:i(?:'m|\s+am)\s+)?(?:available|free)\s+(?:at|on)\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?)?\d{1,2}/i,  // "I'm available at 3", "free on Monday at 2"
  /\bcan\s+(?:we\s+)?do\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,  // "can we do Monday", "can do 3pm"
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?\s+(?:my\s+time|your\s+time|(?:paris|london|new\s+york|la|sf)\s+time)\b/i,  // "3PM Paris time", "2pm my time"
];

const SYSTEM_PROMPT = `You classify email replies from sales outreach sequences.
Given the reply email and optionally the original outbound subject, classify the intent.

Categories:
- interested: Asks questions, requests info/demo/call, positive engagement, wants to learn more
- meeting_booked: Confirms meeting/call time, accepts calendar invite, agrees to schedule
- not_interested: Declines, says not relevant, asks to stop but politely, timing is wrong
- out_of_office: Away/vacation/leave notices (temporary)
- auto_reply: Automated responses, ticketing systems, delivery receipts
- do_not_contact: Hostile, threatens legal action, demands removal, aggressive tone
- unsubscribe: The lead themselves is explicitly asking to be removed from YOUR outreach or mailing list
- neutral: Unclear intent, simple acknowledgments, forwarding notices, asks who you are

CRITICAL: The word "unsubscribe" often appears in email footers, forwarded newsletters, or quoted HTML (e.g. "unsubscribe from this mailing list"). This does NOT mean the lead wants to unsubscribe from your outreach. Only classify as "unsubscribe" when the lead's own message clearly requests removal. Ignore footer/boilerplate text.

If conversation thread context is provided, use it to understand the reply's intent relative to the ongoing discussion. For example, a short reply like "sounds good" after discussing a meeting time is "meeting_booked", not just "interested".

IMPORTANT: Return ONLY valid JSON. No markdown, no code blocks.
Return JSON: { "intent": "...", "confidence": 0.0-1.0, "reasoning": "1 sentence" }`;

// ============================================================================
// Main Classifier
// ============================================================================

export async function classifyReply(
  input: ClassificationInput,
  openRouterApiKey: string,
  model?: string,
): Promise<ClassificationResult> {
  const fullText = `${input.subject} ${input.body_text}`;

  // OOO checked BEFORE auto-reply: OOO is more specific and actionable.
  // Many OOO emails also match auto-reply patterns (e.g. "Automatic reply"
  // in subject + "out of the office" in body), so OOO must win.
  for (const pattern of OOO_PATTERNS) {
    if (pattern.test(fullText)) {
      return { intent: 'out_of_office', confidence: 0.95, reasoning: 'Matched out-of-office keyword pattern', needs_human_review: false };
    }
  }

  if (detectAutoReply(input.subject, input.body_text)) {
    return { intent: 'auto_reply', confidence: 1.0, reasoning: 'Matched auto-reply pattern', needs_human_review: false };
  }

  // Meeting booked / scheduling confirmation
  for (const pattern of MEETING_BOOKED_PATTERNS) {
    if (pattern.test(fullText)) {
      return { intent: 'meeting_booked', confidence: 0.90, reasoning: 'Matched scheduling confirmation pattern', needs_human_review: false };
    }
  }

  for (const pattern of INTERESTED_PATTERNS) {
    if (pattern.test(fullText)) {
      return { intent: 'interested', confidence: 0.85, reasoning: 'Matched interest/booking keyword pattern', needs_human_review: false };
    }
  }

  const result = await classifyWithLLM(input, openRouterApiKey, model);
  // An org model OpenRouter has dropped (404) or doesn't recognise (400) fails
  // every reply, so opt-outs go undetected. Classify with ACA's default instead.
  if (model && model !== DEFAULT_CLASSIFIER_MODEL && /^Classification failed: OpenRouter error (400|404)\b/.test(result.reasoning)) {
    console.warn(`[Reply Classifier] Org model ${model} unavailable, using ${DEFAULT_CLASSIFIER_MODEL}`);
    return classifyWithLLM(input, openRouterApiKey, DEFAULT_CLASSIFIER_MODEL);
  }
  return result;
}

// ============================================================================
// LLM Classification
// ============================================================================

async function classifyWithLLM(
  input: ClassificationInput,
  openRouterApiKey: string,
  model?: string,
): Promise<ClassificationResult> {
  const threadBlock = input.thread_context
    ? `\nRecent conversation context (for understanding intent in context):\n${input.thread_context}\n`
    : '';

  const userPrompt = `Reply email:
From: ${input.from_email}
Subject: ${input.subject || '(no subject)'}
Body:
${input.body_text.slice(0, 1500)}
${threadBlock}
${input.original_outbound_subject ? `Original outbound subject: ${input.original_outbound_subject}` : ''}

Classify this reply.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || DEFAULT_CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 200,
        // A reasoning model (e.g. qwen/qwen3.7-flash) otherwise spends all 200
        // tokens thinking and returns nothing. A label needs no thinking pass;
        // OpenRouter ignores this for models without one.
        reasoning: { enabled: false },
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) throw new Error('Empty response from LLM');

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error('[Reply Classifier] Failed to parse LLM JSON response:', content.slice(0, 200));
      return {
        intent: 'neutral',
        confidence: 0.3,
        reasoning: 'Failed to parse classification response',
        needs_human_review: true,
      };
    }

    const validIntents: LeadIntent[] = [
      'interested', 'not_interested', 'out_of_office', 'auto_reply',
      'meeting_booked', 'do_not_contact', 'neutral', 'unsubscribe',
    ];

    if (!validIntents.includes(parsed.intent)) {
      console.warn(`[Reply Classifier] LLM returned invalid intent "${parsed.intent}", falling back to "neutral"`);
    }
    const intent: LeadIntent = validIntents.includes(parsed.intent) ? parsed.intent : 'neutral';
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));

    return {
      intent,
      confidence,
      reasoning: parsed.reasoning || 'No reasoning provided',
      needs_human_review: confidence < 0.6,
    };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.error('[Reply Classifier] Timeout after', CLASSIFIER_TIMEOUT_MS, 'ms');
      return { intent: 'neutral', confidence: 0.3, reasoning: 'Classification timed out', needs_human_review: true };
    }
    console.error('[Reply Classifier] Error:', error);
    return {
      intent: 'neutral', confidence: 0.3,
      reasoning: `Classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      needs_human_review: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
