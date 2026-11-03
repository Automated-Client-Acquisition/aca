import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { DEFAULT_FAST_TEXT_MODEL } from '../_shared/default-models.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// BOOK-A-CALL CAMPAIGN TEMPLATE
// LinkedIn warm-up → AI analysis → connection → messages → email fallback
// Includes Notion playbook generation for value delivery
// ============================================================================

function generateNodeId(): string {
  return `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

interface SeedOptions {
  organizationId: string;
  name?: string;
  description?: string;
  // These are optional — user can set them in UI after creation
  leadListId?: string;
  senderAccountIds?: string[];
  senderAccounts?: Record<string, string[]>;
  icpProductId?: string;
  minIcpScore?: number;
  // Notion config — required for playbook generation
  notionConnectionId?: string;
  notionDatabaseId?: string;
  notionBlueprintIds?: string[];
  notionProductId?: string;
}

function buildCampaign(opts: SeedOptions) {
  // Generate all node IDs upfront so edges can reference them
  const ids = {
    start: 'start',
    viewProfile: generateNodeId(),
    delay1: generateNodeId(),
    warmup: generateNodeId(),
    delay2: generateNodeId(),
    analyzeContact: generateNodeId(),
    conditionAnalyzed: generateNodeId(),
    endNotAnalyzed: generateNodeId(),
    createNotionPage: generateNodeId(),
    findEmail: generateNodeId(),
    connectionRequest: generateNodeId(),
    delay3: generateNodeId(),
    conditionConnection: generateNodeId(),
    // LinkedIn branch (accepted)
    msg1: generateNodeId(),
    delay4: generateNodeId(),
    conditionReply1: generateNodeId(),
    msg2: generateNodeId(),
    delay5: generateNodeId(),
    conditionReply2: generateNodeId(),
    msg3: generateNodeId(),
    delay6: generateNodeId(),
    conditionReply3: generateNodeId(),
    // Email fallback branch
    switchChannel: generateNodeId(),
    email1: generateNodeId(),
    delay7: generateNodeId(),
    conditionReply4: generateNodeId(),
    email2: generateNodeId(),
    delay8: generateNodeId(),
    conditionReply5: generateNodeId(),
    email3: generateNodeId(),
    // Ends
    endReply: generateNodeId(),
    endFinal: generateNodeId(),
  };

  // Layout: Y increases downward, X shifts for branches
  const centerX = 250;
  const leftX = 0;
  const rightX = 500;
  let y = 0;
  const stepY = 150;

  const nodes = [
    // ── Phase 1: Warm-up & Intel ──
    {
      id: ids.start,
      type: 'start',
      position: { x: centerX, y: y },
      data: {},
    },
    {
      id: ids.viewProfile,
      type: 'viewProfile',
      position: { x: centerX, y: y += stepY },
      data: {},
    },
    {
      id: ids.delay1,
      type: 'delay',
      position: { x: centerX, y: y += stepY },
      data: { days: 1, hours: 0, customLabel: 'Wait 1 day' },
    },
    {
      id: ids.warmup,
      type: 'warmupEngagement',
      position: { x: centerX, y: y += stepY },
      data: {
        engagementType: 'reaction',
        reactionType: 'like',
        commentTemplates: [],
        postCount: 2,
        preferHighEngagement: true,
        cooldownDays: 7,
      },
    },
    {
      id: ids.delay2,
      type: 'delay',
      position: { x: centerX, y: y += stepY },
      data: { days: 1, hours: 0, customLabel: 'Wait 1 day' },
    },
    {
      id: ids.analyzeContact,
      type: 'analyzeContact',
      position: { x: centerX, y: y += stepY },
      data: {
        skipIfAlreadyEnriched: true,
        continueOnFailure: true,
        model: DEFAULT_FAST_TEXT_MODEL,
        productId: opts.icpProductId || undefined,
      },
    },
    {
      id: ids.conditionAnalyzed,
      type: 'conditionAnalyzed',
      position: { x: centerX, y: y += stepY },
      data: {},
    },
    {
      id: ids.endNotAnalyzed,
      type: 'end',
      position: { x: leftX, y: y },
      data: { customLabel: 'Skip (not analyzed)' },
    },

    // ── Notion Playbook + Find Email ──
    {
      id: ids.createNotionPage,
      type: 'createNotionPage',
      position: { x: centerX, y: y += stepY },
      data: {
        connectionId: opts.notionConnectionId || undefined,
        databaseId: opts.notionDatabaseId || undefined,
        blueprintIds: opts.notionBlueprintIds || ['strategic-growth'],
        productId: opts.notionProductId || opts.icpProductId || undefined,
        icpThreshold: 0,
        continueOnFailure: true,
        customLabel: 'Generate Playbook',
      },
    },
    {
      id: ids.findEmail,
      type: 'findEmail',
      position: { x: centerX, y: y += stepY },
      data: {
        provider: 'auto',
        skipIfHasEmail: true,
        acceptCatchAll: false,
        validateEmail: true,
        continueOnFailure: true,
      },
    },

    // ── Phase 2: Connection ──
    {
      id: ids.connectionRequest,
      type: 'connectionRequest',
      position: { x: centerX, y: y += stepY },
      data: {
        message: '',
        messageVariations: [],
        withdrawAfterDays: 14,
        messageMode: 'prompt',
        prompt: `Write a short, personalized LinkedIn connection note to {{firstName}} who is {{jobTitle}} at {{company}}.

Reference this insight from their profile analysis: {{ai_analysis_insight}}.

Rules:
- No selling, no pitch, no mention of calls
- Show genuine curiosity about their work
- Max 200 characters
- Conversational tone, like you'd message a peer`,
        promptVariations: [],
      },
    },
    {
      id: ids.delay3,
      type: 'delay',
      position: { x: centerX, y: y += stepY },
      data: { days: 3, hours: 0, customLabel: 'Wait 3 days for accept' },
    },
    {
      id: ids.conditionConnection,
      type: 'conditionConnection',
      position: { x: centerX, y: y += stepY },
      data: {},
    },

    // ── Phase 3: LinkedIn Messages (accepted branch) ──
    {
      id: ids.msg1,
      type: 'message',
      position: { x: centerX, y: y += stepY },
      data: {
        message: '',
        messageVariations: [],
        messageMode: 'prompt',
        prompt: `Write a LinkedIn message to {{firstName}} ({{jobTitle}} at {{company}}) right after they accepted your connection.

Context from their profile: {{ai_analysis_insight}}

Your goal:
1. Thank them for connecting (briefly, not formally)
2. Reference something specific about their role or company
3. Mention you put together a personalized resource on {{pain_point}} and share it
4. End with a genuine question — NOT a call CTA yet

Include this link naturally in the message: {{notion_preview_url}}

Rules:
- 3-4 sentences max
- Sound like a real person, not a sales rep
- The Notion link should feel like you're sharing something helpful, not pitching`,
        promptVariations: [],
        customLabel: 'Value + Playbook',
      },
    },
    {
      id: ids.delay4,
      type: 'delay',
      position: { x: centerX, y: y += stepY },
      data: { days: 3, hours: 0 },
    },
    {
      id: ids.conditionReply1,
      type: 'conditionReplyReceived',
      position: { x: centerX, y: y += stepY },
      data: { withinDays: 7 },
    },
    // replied → end
    {
      id: ids.endReply,
      type: 'end',
      position: { x: rightX, y: y },
      data: { customLabel: 'Reply received → Inbox' },
    },

    {
      id: ids.msg2,
      type: 'message',
      position: { x: centerX, y: y += stepY },
      data: {
        message: '',
        messageVariations: [],
        messageMode: 'prompt',
        prompt: `Write a follow-up LinkedIn message to {{firstName}} at {{company}}.

You previously sent them a personalized playbook about {{pain_point}} (Notion link). They haven't replied yet.

Your goal:
1. Don't re-send the link — they already have it
2. Add ONE concrete insight about their {{industry}} that connects to what {{company}} does
3. Bridge to a call: say you'd love to walk them through how this applies to their situation
4. Ask if they'd be open to a 15-min call this week or next

Rules:
- Casual, peer-to-peer tone
- 3-4 sentences max
- Make the call feel like a conversation, not a sales meeting
- The call is about THEM getting value, not you pitching`,
        promptVariations: [],
        customLabel: 'Bridge to Call',
      },
    },
    {
      id: ids.delay5,
      type: 'delay',
      position: { x: centerX, y: y += stepY },
      data: { days: 4, hours: 0 },
    },
    {
      id: ids.conditionReply2,
      type: 'conditionReplyReceived',
      position: { x: centerX, y: y += stepY },
      data: { withinDays: 7 },
    },

    {
      id: ids.msg3,
      type: 'message',
      position: { x: centerX, y: y += stepY },
      data: {
        message: '',
        messageVariations: [],
        messageMode: 'prompt',
        prompt: `Write a final LinkedIn message to {{firstName}}.

You've sent 2 messages already — a playbook and a call invite. No reply.

Rules:
- 2 sentences MAXIMUM
- Say you don't want to be that person who keeps following up
- Ask one simple yes/no question: would a quick 15-min call make sense, or should you leave it?
- Zero pressure. Make it easy to say no
- If they say no, that's fine — close gracefully`,
        promptVariations: [],
        customLabel: 'Final Ask',
      },
    },
    {
      id: ids.delay6,
      type: 'delay',
      position: { x: centerX, y: y += stepY },
      data: { days: 3, hours: 0 },
    },
    {
      id: ids.conditionReply3,
      type: 'conditionReplyReceived',
      position: { x: centerX, y: y += stepY },
      data: { withinDays: 7 },
    },

    // ── Phase 4: Email Fallback ──
    {
      id: ids.switchChannel,
      type: 'switchChannel',
      position: { x: centerX, y: y += stepY },
      data: { targetChannel: 'email', customLabel: 'Switch to Email' },
    },
    {
      id: ids.email1,
      type: 'email',
      position: { x: centerX, y: y += stepY },
      data: {
        subject: '',
        subjectVariations: [],
        body: '',
        bodyVariations: [],
        trackOpens: true,
        trackClicks: true,
        messageMode: 'prompt',
        prompt: `Write a cold email to {{firstName}} ({{jobTitle}} at {{company}}).

Context: You tried connecting on LinkedIn but they haven't responded. You have deep insight about them: {{ai_analysis_insight}}.

Your goal:
1. Mention you reached out on LinkedIn (briefly, one clause — not apologetic)
2. Reference their specific situation using the analysis insight
3. Share the Notion playbook as a value-add: {{notion_preview_url}}
4. Close by suggesting a 15-min call to discuss how this applies to {{company}}

Rules:
- 4-5 sentences max for the body
- Professional but warm — not corporate, not overly casual
- The playbook link should feel like a gift, not bait
- Subject line should be separate (the system handles it)`,
        promptVariations: [],
        customLabel: 'Email 1: Playbook + Call CTA',
      },
    },
    {
      id: ids.delay7,
      type: 'delay',
      position: { x: centerX, y: y += stepY },
      data: { days: 3, hours: 0 },
    },
    {
      id: ids.conditionReply4,
      type: 'conditionReplyReceived',
      position: { x: centerX, y: y += stepY },
      data: { withinDays: 7 },
    },

    {
      id: ids.email2,
      type: 'email',
      position: { x: centerX, y: y += stepY },
      data: {
        subject: '',
        subjectVariations: [],
        body: '',
        bodyVariations: [],
        trackOpens: true,
        trackClicks: true,
        messageMode: 'prompt',
        prompt: `Write a follow-up email to {{firstName}} at {{company}}.

This is a reply to your first email (the system threads it automatically). They haven't responded yet.

Your goal:
1. Keep it SHORT — 2-3 sentences max
2. Add one proof point: a result, a stat, or a relevant example in {{industry}}
3. Reframe the call: "I'll share exactly how this worked for [similar company] — 15 min, no pitch"
4. Make the call about THEM getting value, not you selling

Rules:
- Don't re-share the Notion link — they already have it
- Don't apologize for following up
- Sound confident, not needy
- Subject is handled by threading (Re:)`,
        promptVariations: [],
        customLabel: 'Email 2: Proof + Reask',
      },
    },
    {
      id: ids.delay8,
      type: 'delay',
      position: { x: centerX, y: y += stepY },
      data: { days: 4, hours: 0 },
    },
    {
      id: ids.conditionReply5,
      type: 'conditionReplyReceived',
      position: { x: centerX, y: y += stepY },
      data: { withinDays: 7 },
    },

    {
      id: ids.email3,
      type: 'email',
      position: { x: centerX, y: y += stepY },
      data: {
        subject: '',
        subjectVariations: [],
        body: '',
        bodyVariations: [],
        trackOpens: true,
        trackClicks: true,
        messageMode: 'prompt',
        prompt: `Write a breakup email to {{firstName}}.

This is your last email. They haven't replied to 2 previous emails.

Rules:
- 2-3 sentences MAXIMUM
- Say you'll assume it's not a fit unless you hear back
- End with a binary CTA: "If anything changes, I'm here. If you want the 15 min, just reply GO."
- One-word reply lowers friction to near zero
- No guilt, no pressure, no passive aggression
- Subject is handled by threading (Re:)`,
        promptVariations: [],
        customLabel: 'Email 3: Breakup',
      },
    },
    {
      id: ids.endFinal,
      type: 'end',
      position: { x: centerX, y: y += stepY },
      data: { customLabel: 'Campaign complete' },
    },
  ];

  // ── Edges ──
  const edge = (source: string, target: string, handle = 'default') => ({
    id: `edge-${source}-${target}-${handle}`,
    source,
    target,
    sourceHandle: handle,
    type: 'sequenceEdge',
  });

  const edges = [
    // Phase 1: Warm-up
    edge(ids.start, ids.viewProfile),
    edge(ids.viewProfile, ids.delay1),
    edge(ids.delay1, ids.warmup),
    edge(ids.warmup, ids.delay2),
    edge(ids.delay2, ids.analyzeContact),
    edge(ids.analyzeContact, ids.conditionAnalyzed),
    // Analyzed? → yes continues, no → end
    edge(ids.conditionAnalyzed, ids.createNotionPage, 'analyzed'),
    edge(ids.conditionAnalyzed, ids.endNotAnalyzed, 'notAnalyzed'),
    // Notion page → find email → connection request
    edge(ids.createNotionPage, ids.findEmail),
    edge(ids.findEmail, ids.connectionRequest),
    edge(ids.connectionRequest, ids.delay3),
    edge(ids.delay3, ids.conditionConnection),

    // Connection accepted → LinkedIn messages
    edge(ids.conditionConnection, ids.msg1, 'accepted'),
    edge(ids.msg1, ids.delay4),
    edge(ids.delay4, ids.conditionReply1),
    edge(ids.conditionReply1, ids.endReply, 'replied'),
    edge(ids.conditionReply1, ids.msg2, 'noReply'),
    edge(ids.msg2, ids.delay5),
    edge(ids.delay5, ids.conditionReply2),
    edge(ids.conditionReply2, ids.endReply, 'replied'),
    edge(ids.conditionReply2, ids.msg3, 'noReply'),
    edge(ids.msg3, ids.delay6),
    edge(ids.delay6, ids.conditionReply3),
    edge(ids.conditionReply3, ids.endReply, 'replied'),
    // No reply after msg3 → email fallback
    edge(ids.conditionReply3, ids.switchChannel, 'noReply'),

    // Connection not accepted → email fallback
    edge(ids.conditionConnection, ids.switchChannel, 'notAccepted'),

    // Email fallback
    edge(ids.switchChannel, ids.email1),
    edge(ids.email1, ids.delay7),
    edge(ids.delay7, ids.conditionReply4),
    edge(ids.conditionReply4, ids.endReply, 'replied'),
    edge(ids.conditionReply4, ids.email2, 'noReply'),
    edge(ids.email2, ids.delay8),
    edge(ids.delay8, ids.conditionReply5),
    edge(ids.conditionReply5, ids.endReply, 'replied'),
    edge(ids.conditionReply5, ids.email3, 'noReply'),
    edge(ids.email3, ids.endFinal),
  ];

  // ── Campaign payload ──
  return {
    organization_id: opts.organizationId,
    name: opts.name || 'Book a Call — LinkedIn + Email',
    description: opts.description || 'Multi-channel outreach: profile visit → warmup → AI analysis → Notion playbook → LinkedIn messages → email fallback. Goal: book a 15-min call.',
    status: 'draft',
    lead_list_id: opts.leadListId || null,
    exclusion_list_ids: [],
    exclude_other_campaigns: true,
    exclude_same_sender: true,
    sender_account_ids: opts.senderAccountIds || [],
    sender_accounts: opts.senderAccounts || {},
    sequence_nodes: nodes,
    sequence_edges: edges,
    stop_on_reply: true,
    campaign_settings: {
      stop_on_auto_reply: false,
      stop_company_on_reply: false,
      ai_filter_unlikely_reply: 'send',
      ai_filter_hostile: 'skip',
    },
    autopilot_config: {
      enabled: true,
      rules: [
        {
          intent: 'positive',
          action: 'draft_for_approval',
          confidence_threshold: 0.7,
        },
        {
          intent: 'ooo',
          action: 'auto_followup_after_return',
          confidence_threshold: 0.8,
        },
        {
          intent: 'not_interested',
          action: 'auto_reply',
          message_template: 'Thanks for letting me know, {{firstName}}. No worries at all — I appreciate the honesty. If anything changes down the road, feel free to reach out.',
          confidence_threshold: 0.8,
        },
      ],
      require_approval: true,
      max_auto_replies: 3,
      conversation_goal: 'Book a 15-minute discovery call',
      system_instructions: 'You are helping a professional book introductory calls. Be warm, concise, and never pushy. If someone shows interest, suggest a specific time or share a calendly link. If they decline, close gracefully.',
      use_knowledge_base: false,
      knowledge_document_ids: [],
      use_tone_profile: true,
      max_conversation_turns: 5,
    },
    icp_product_id: opts.icpProductId || null,
    min_icp_score: opts.minIcpScore ?? null,
    campaign_type: 'multi_channel',
    primary_channel: 'linkedin',
    channel_fallback_enabled: true,
    fallback_order: ['linkedin', 'email'],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();

    if (!body.organizationId) {
      return new Response(
        JSON.stringify({ error: 'organizationId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, body.organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    const campaignData = buildCampaign({
      organizationId: body.organizationId,
      name: body.name,
      description: body.description,
      leadListId: body.leadListId,
      senderAccountIds: body.senderAccountIds,
      senderAccounts: body.senderAccounts,
      icpProductId: body.icpProductId,
      minIcpScore: body.minIcpScore,
      notionConnectionId: body.notionConnectionId,
      notionDatabaseId: body.notionDatabaseId,
      notionBlueprintIds: body.notionBlueprintIds,
      notionProductId: body.notionProductId,
    });

    const { data, error } = await supabase
      .from('linkedin_campaigns')
      .insert(campaignData)
      .select('id, name, status')
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        campaign: data,
        message: `Campaign "${data.name}" created as draft. Open it in the campaign builder to assign a lead list, sender accounts, and Notion connection, then launch.`,
        nodeCount: campaignData.sequence_nodes.length,
        edgeCount: campaignData.sequence_edges.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
