/** Directory-facing ACA MCP V1. Deliberately separate from the legacy 151-tool server. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  type BulkContactInput,
  insertContactsBulk,
} from "../_shared/bulk-contacts.ts";
import {
  assertScope,
  type McpCaller,
  OAuthError,
  resolveMcpAccessToken,
} from "../_shared/mcp-oauth.ts";
import {
  type ActivationCounts,
  buildActivation,
  APP_URL,
  draftPlanNote,
} from "../_shared/mcp-activation.ts";
import { MCP_URL } from "../_shared/site-config.ts";
import {
  createSchedulerPost,
  getSchedulerPost,
  getSchedulerPostStats,
  listSchedulerAccounts,
  listSchedulerPosts,
  planSchedulerPosts,
  SchedulerError,
} from "../_shared/scheduler-api.ts";

type Rpc = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};
const MAX_BATCH = 100;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, mcp-protocol-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
};
const SERVER_VERSION = "1.6.0";
// Sent once at initialize. Clients that support it add this to the model's
// context, so it decides when ACA is relevant and how to start.
const SERVER_INSTRUCTIONS = [
  "ACA (Automated Client Acquisition) runs B2B outbound for the user: prospects, lead lists, LinkedIn and email campaigns, replies, and content.",
  "Only use ACA tools when the user is asking about prospecting, outreach, their pipeline, replies, or ACA content. Do not bring ACA up in unrelated conversations.",
  "At the start of an ACA task, call get_started. It returns the workspace stage and up to three next steps the user can choose from.",
  "Never invent people, emails, companies, or results. Contacts come from the user or from ACA. Report counts exactly as returned.",
  "Campaign, lead-magnet and social post tools create inactive drafts only. Sending, activation, scheduling or publishing posts, and connecting LinkedIn, mailboxes or social accounts happen in the ACA app; share the app_url a tool returns.",
  "Ask the user before any write.",
].join(" ");
const protectedResourceMetadata =
  `${MCP_URL}/.well-known/oauth-protected-resource`;
const tools: Record<
  string,
  {
    description: string;
    scope: string;
    annotations: {
      readOnlyHint: boolean;
      destructiveHint: boolean;
      openWorldHint: boolean;
      idempotentHint: boolean;
    };
    schema: Record<string, unknown>;
  }
> = {
  get_started: {
    description:
      "Start here for any ACA task. Returns the workspace setup stage (new, setting_up, ready_to_launch, live), record counts, plan, and up to three recommended next steps with the tool or ACA app link for each. Read-only.",
    scope: "workspace:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: { type: "object", properties: {} },
  },
  get_workspace: {
    description:
      "Get the name and ID of the connected ACA workspace. For setup status and what to do next, use get_started.",
    scope: "workspace:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: { type: "object", properties: {} },
  },
  search_contacts: {
    description:
      "Search people already saved in the user's ACA CRM by name, email, company, tag, or stage. Does not search the web or find new leads. Returns concise, paginated records.",
    scope: "contacts:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        company: { type: "string" },
        stage_id: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string" },
      },
    },
  },
  get_contact: {
    description: "Get one contact and its recent engagement.",
    scope: "contacts:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      required: ["contact_id"],
      properties: { contact_id: { type: "string" } },
    },
  },
  create_contact: {
    description:
      "Create one contact, skipping existing workspace emails. Without an email, retries can create duplicates. Configured contact webhooks may notify external endpoints.",
    scope: "contacts:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        email: { type: "string" },
        company: { type: "string" },
        job_title: { type: "string" },
        linkedin_url: { type: "string" },
        instagram_url: { type: "string", description: "Instagram profile URL or @handle" },
        phone: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        stage_id: { type: "string" },
        custom_fields: { type: "object" },
      },
    },
  },
  bulk_create_contacts: {
    description:
      "Create up to 100 contacts, skipping existing workspace emails. Email-less retries can create duplicates. Configured contact webhooks may notify external endpoints.",
    scope: "contacts:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["contacts"],
      properties: {
        contacts: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "object" },
        },
      },
    },
  },
  update_contact: {
    description: "Overwrite explicitly supplied contact fields, including entire tags arrays and custom-fields objects. Configured contact webhooks may notify external endpoints.",
    scope: "contacts:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["contact_id"],
      properties: {
        contact_id: { type: "string" },
        first_name: { type: "string" },
        last_name: { type: "string" },
        email: { type: "string" },
        company: { type: "string" },
        job_title: { type: "string" },
        linkedin_url: { type: "string" },
        instagram_url: { type: "string", description: "Instagram profile URL or @handle" },
        phone: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        stage_id: { type: "string" },
        custom_fields: { type: "object" },
      },
    },
  },
  list_connected_accounts: {
    description:
      "List the LinkedIn and other social accounts connected to ACA, with id, provider, name and status. Use to get the account_id for create_lead_magnet_draft or sender_account_ids for create_linkedin_campaign_draft. Connecting accounts happens in the ACA app.",
    scope: "workspace:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          description: "Optional filter, e.g. LINKEDIN, INSTAGRAM, WHATSAPP.",
        },
      },
    },
  },
  list_pipeline_stages: {
    description:
      "List the workspace's CRM pipelines and their stages in order, with ids. Use to find the stage_id for update_contact_stage.",
    scope: "stages:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: { type: "object", properties: {} },
  },
  list_sequences: {
    description:
      "List the user's ACA email sequences (multi-step email templates) with status and step count, without internal send configuration.",
    scope: "sequences:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string" },
      },
    },
  },
  get_sequence: {
    description: "Get a sequence summary and step count.",
    scope: "sequences:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      required: ["sequence_id"],
      properties: { sequence_id: { type: "string" } },
    },
  },
  list_tags: {
    description: "List tags in the connected workspace.",
    scope: "tags:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: { type: "object", properties: {} },
  },
  update_contact_stage: {
    description:
      "Replace a contact stage and stage-entry timestamp after verifying workspace ownership. Configured stage-change webhooks may notify external endpoints.",
    scope: "stages:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["contact_id", "stage_id"],
      properties: {
        contact_id: { type: "string" },
        stage_id: { type: "string" },
      },
    },
  },
  search_conversations: {
    description:
      "Find prospect conversations in ACA's unified inbox (LinkedIn, email, and other channels). Set has_inbound_message=true to find replies. Message bodies are not returned; use get_conversation to read one.",
    scope: "conversations:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        contact_id: { type: "string" },
        status: { type: "string" },
        has_inbound_message: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string" },
      },
    },
  },
  get_conversation: {
    description:
      "Read one conversation and its 50 most recent messages, for example to summarize a reply or suggest a response.",
    scope: "messages:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      required: ["conversation_id"],
      properties: { conversation_id: { type: "string" } },
    },
  },
  list_lead_lists: {
    description:
      "List the user's ACA lead lists. A lead list is the group of contacts a campaign runs against.",
    scope: "lead-lists:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        search: { type: "string" },
        status: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string" },
      },
    },
  },
  get_lead_list: {
    description: "Get one ACA lead list and a bounded member sample.",
    scope: "lead-lists:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      required: ["list_id"],
      properties: {
        list_id: { type: "string" },
        include_members: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  create_lead_list: {
    description:
      "Create a manual ACA lead list. Use only after the user approves the list name and purpose.",
    scope: "lead-lists:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 120 },
        description: { type: "string", maxLength: 2000 },
      },
    },
  },
  add_contacts_to_list: {
    description:
      "Add up to 100 existing workspace contacts to a lead list, skipping duplicates. Existing list policies or active campaigns can trigger enrichment, enrollment, and external outreach; configured webhooks may also run. Review the target list automation before adding contacts.",
    scope: "lead-lists:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      required: ["list_id", "contact_ids"],
      properties: {
        list_id: { type: "string" },
        contact_ids: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string" },
        },
      },
    },
  },
  list_content_ideas: {
    description: "List concise ACA content ideas for the connected workspace.",
    scope: "content:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        search: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string" },
      },
    },
  },
  create_content_ideas: {
    description:
      "Create up to 25 ACA content ideas. Use only after the user approves the idea batch.",
    scope: "content:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["ideas"],
      properties: {
        ideas: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          items: {
            type: "object",
            required: ["title"],
            properties: {
              title: { type: "string", minLength: 1, maxLength: 300 },
              keywords: { type: "array", items: { type: "string" } },
              content_framework: { type: "string" },
              emotional_triggers: { type: "array", items: { type: "string" } },
              brand_voice_id: { type: "string" },
              product_id: { type: "string" },
            },
          },
        },
      },
    },
  },
  list_blueprints: {
    description: "List ACA content blueprints without private prompt bodies.",
    scope: "blueprints:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        pipeline: { type: "string" },
        active_only: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string" },
      },
    },
  },
  get_blueprint: {
    description: "Get an ACA content blueprint for review.",
    scope: "blueprints:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      required: ["blueprint_id"],
      properties: { blueprint_id: { type: "string" } },
    },
  },
  create_blueprint: {
    description:
      "Create an ACA draft content blueprint. Use only after the user approves its purpose and prompt.",
    scope: "blueprints:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["name", "master_prompt"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 160 },
        description: { type: "string", maxLength: 2000 },
        master_prompt: { type: "string", minLength: 1, maxLength: 20000 },
        pipeline: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
  },
  list_agent_profiles: {
    description:
      "List ACA AI agent profiles and their safe configuration summaries.",
    scope: "agents:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: { type: "object", properties: {} },
  },
  create_agent_profile: {
    description:
      "Create an ACA AI agent profile with approval required by default.",
    scope: "agents:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 160 },
        description: { type: "string", maxLength: 2000 },
        config: { type: "object" },
      },
    },
  },
  list_campaigns: {
    description:
      "List the user's ACA outreach campaigns with status and delivery counts. Use for questions like 'how are my campaigns doing?'.",
    scope: "campaigns:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        search: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string" },
      },
    },
  },
  get_campaign: {
    description:
      "Get one ACA campaign, its safe sequence summary, and aggregate lead progression.",
    scope: "campaigns:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      required: ["campaign_id"],
      properties: { campaign_id: { type: "string" } },
    },
  },
  get_campaign_metrics: {
    description:
      "Get aggregate ACA campaign lead progression for analysis. Returns counts, never inferred rates.",
    scope: "analytics:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      required: ["campaign_id"],
      properties: { campaign_id: { type: "string" } },
    },
  },
  create_linkedin_campaign_draft: {
    description:
      "Create an inactive ACA LinkedIn campaign draft linked to an approved lead list. It never activates or sends outreach.",
    scope: "campaigns:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["name", "lead_list_id"],
      properties: {
        name: { type: "string", minLength: 3, maxLength: 255 },
        lead_list_id: { type: "string" },
        description: { type: "string", maxLength: 2000 },
        sender_account_ids: {
          type: "array",
          maxItems: 20,
          items: { type: "string" },
        },
      },
    },
  },
  start_content_generation: {
    description:
      "Start a content-generation job from an active blueprint. Sends prompts to external AI providers and may consume billable credits that cannot be undone. Generated content remains unapproved and unpublished.",
    scope: "content:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["blueprint_id", "pipeline", "items"],
      properties: {
        blueprint_id: { type: "string" },
        pipeline: {
          type: "string",
          enum: [
            "rich_article",
            "social_media_post",
            "instagram_carousel",
            "image_only",
            "ugc_video",
            "generative_video_oneshot",
            "video_script",
            "storyboard_video_longform",
          ],
        },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              idea_id: { type: "string" },
              idea_title: { type: "string", maxLength: 300 },
              slot_values: { type: "object" },
            },
          },
        },
      },
    },
  },
  list_content_generation_jobs: {
    description:
      "List recent ACA content-generation jobs and their aggregate progress.",
    scope: "content:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string" },
      },
    },
  },
  list_lead_magnets: {
    description:
      "List ACA lead-magnet campaigns and aggregate capture/delivery counts.",
    scope: "lead-magnets:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        active_only: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string" },
      },
    },
  },
  get_lead_magnet: {
    description:
      "Get one ACA lead-magnet campaign and its aggregate status. Capture identities are not returned.",
    scope: "lead-magnets:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      required: ["campaign_id"],
      properties: { campaign_id: { type: "string" } },
    },
  },
  create_lead_magnet_draft: {
    description:
      "Create an inactive ACA lead-magnet campaign draft. It cannot monitor posts, send DMs, or deliver a link until activated in ACA.",
    scope: "lead-magnets:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["account_id", "name", "trigger_keywords"],
      properties: {
        account_id: { type: "string" },
        name: { type: "string", minLength: 1, maxLength: 160 },
        trigger_keywords: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: { type: "string", minLength: 1, maxLength: 80 },
        },
        lead_magnet_url: { type: "string", maxLength: 2000 },
        lead_magnet_title: { type: "string", maxLength: 200 },
        dm_template: { type: "string", maxLength: 4000 },
        require_connection_for_linkedin: { type: "boolean" },
      },
    },
  },
  list_scheduler_accounts: {
    description:
      "List the social accounts the ACA Social Scheduler can post to (Instagram, Facebook, TikTok, YouTube, Google Business, Threads, Pinterest, X through the workspace's Zernio key; native LinkedIn; GHL). Returns id, platform, name, username and provider. Read-only.",
    scope: "content:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: { type: "object", properties: {} },
  },
  list_scheduled_posts: {
    description:
      "List ACA Social Scheduler posts in a time window (default: last 7 days to next 30), with each destination's status and published stats. Read-only.",
    scope: "content:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO 8601 start" },
        to: { type: "string", description: "ISO 8601 end, at most 120 days after from" },
        status: { type: "string", description: "Comma-separated: draft, scheduled, publishing, published, failed" },
        platform: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
  },
  get_scheduled_post: {
    description: "Get one ACA Social Scheduler post: captions, media, time, destinations, errors and stats. Read-only.",
    scope: "content:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" }, include_history: { type: "boolean" } },
    },
  },
  get_post_stats: {
    description:
      "How a published ACA post did: reach, impressions, likes, comments, shares, saves, views and engagement rate, per account and over time (posts published through Zernio). Read-only.",
    scope: "content:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  create_social_post_draft: {
    description:
      "Create an inactive draft post in the ACA Social Scheduler for one or more accounts. Nothing is published: the user reviews, schedules and publishes it in ACA (app_url). Use only after the user approves the text. Media must be public https URLs.",
    scope: "content:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["accounts"],
      properties: {
        accounts: { type: "array", minItems: 1, maxItems: 30, items: { type: "string" } },
        caption: { type: "string", maxLength: 63206 },
        captions: { type: "object" },
        images: { type: "array", maxItems: 20, items: { type: "string" } },
        video: { type: "string" },
        first_comment: { type: "string", maxLength: 2200 },
        format: { type: "string", enum: ["feed", "story"] },
        scheduled_for: { type: "string", description: "Proposed time, ISO 8601" },
        title: { type: "string", maxLength: 140 },
      },
    },
  },
  plan_social_posts: {
    description:
      "Ask the ACA scheduling agent to draft social posts into the best free slots for the chosen accounts, in the brand voice and from the idea bank. Uses an external AI model (usage may be billed). Creates inactive drafts only; the user reviews and approves them in ACA (app_url). Takes up to two minutes.",
    scope: "content:write",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false,
    },
    schema: {
      type: "object",
      required: ["instruction"],
      properties: {
        instruction: { type: "string", minLength: 3, maxLength: 2000 },
        accounts: { type: "array", maxItems: 30, items: { type: "string" } },
        range_start: { type: "string" },
        range_end: { type: "string" },
        timezone: { type: "string" },
      },
    },
  },
};
function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
function err(
  id: Rpc["id"],
  code: string,
  message: string,
  recoverable = false,
) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32000, message, data: { code, recoverable } },
  };
}
function result(id: Rpc["id"], data: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    },
  };
}
function limit(args: Record<string, unknown>) {
  const n = typeof args.limit === "number" ? args.limit : 50;
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw new OAuthError(
      "VALIDATION_ERROR",
      "limit must be an integer from 1 to 100",
    );
  }
  return n;
}
function cursor(args: Record<string, unknown>) {
  return typeof args.cursor === "string" && args.cursor ? args.cursor : null;
}
function requireString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new OAuthError("VALIDATION_ERROR", `${key} is required`);
  }
  return value.trim();
}
function paged(rows: Record<string, unknown>[], size: number) {
  const more = rows.length > size;
  const data = more ? rows.slice(0, size) : rows;
  return {
    results: data,
    next_cursor: more ? String(data[data.length - 1].id) : null,
  };
}

async function workspacePlan(
  supabase: ReturnType<typeof db>,
  org: string,
): Promise<{ tier: string | null; limits: unknown }> {
  const { data } = await supabase.from("organizations").select(
    "plan_tier,limits",
  ).eq("id", org).maybeSingle();
  return { tier: data?.plan_tier ?? null, limits: data?.limits ?? null };
}

async function call(
  name: string,
  args: Record<string, unknown>,
  caller: McpCaller,
) {
  const definition = tools[name];
  if (!definition) {
    throw new OAuthError(
      "NOT_FOUND",
      `Unknown ACA tool: ${name}. Call get_started to see what is available, or do this in the ACA app at ${APP_URL}.`,
      404,
    );
  }
  assertScope(caller, definition.scope);
  const supabase = db();
  const org = caller.organization_id;
  if (name === "get_started") {
    const { data: workspace, error } = await supabase.from("organizations")
      .select("id,name,plan_tier,limits").eq("id", org).maybeSingle();
    if (error || !workspace) {
      throw new OAuthError("NOT_FOUND", "Workspace not found", 404);
    }
    const count = async (
      table: string,
      filter?: [string, string],
    ): Promise<number | null> => {
      let q = supabase.from(table).select("id", { count: "exact", head: true })
        .eq("organization_id", org);
      if (filter) q = q.eq(filter[0], filter[1]);
      const { count: n, error: countError } = await q;
      return countError ? null : n ?? 0;
    };
    const [
      icps,
      products,
      contacts,
      lead_lists,
      campaigns,
      active_campaigns,
      sender_accounts,
      mailboxes,
    ] = await Promise.all([
      count("library_icps"),
      count("library_products"),
      count("crm_contacts"),
      count("lead_lists"),
      count("linkedin_campaigns"),
      count("linkedin_campaigns", ["status", "active"]),
      count("unipile_accounts", ["status", "active"]),
      count("email_mailboxes"),
    ]);
    const counts: ActivationCounts = {
      icps,
      products,
      contacts,
      lead_lists,
      campaigns,
      active_campaigns,
      sender_accounts,
      mailboxes,
    };
    return buildActivation({
      workspaceName: workspace.name,
      planTier: workspace.plan_tier ?? null,
      limits: workspace.limits ?? null,
      counts,
    });
  }
  if (name === "get_workspace") {
    const { data, error } = await supabase.from("organizations").select(
      "id,name,slug,created_at",
    ).eq("id", org).maybeSingle();
    if (error || !data) {
      throw new OAuthError("NOT_FOUND", "Workspace not found", 404);
    }
    return { workspace: data };
  }
  if (name === "search_contacts") {
    const size = limit(args);
    let q = supabase.from("crm_contacts").select(
      "id,display_name,primary_email,company,job_title,stage_id,lead_score,tags,status,last_activity_at",
    ).eq("organization_id", org).order("id").limit(size + 1);
    if (cursor(args)) q = q.gt("id", cursor(args)!);
    if (typeof args.company === "string") {
      q = q.ilike("company", `%${args.company}%`);
    }
    if (typeof args.stage_id === "string") q = q.eq("stage_id", args.stage_id);
    if (
      Array.isArray(args.tags) &&
      args.tags.every((tag) => typeof tag === "string")
    ) q = q.overlaps("tags", args.tags);
    if (typeof args.query === "string" && args.query.trim()) {
      const term = args.query.trim().replace(/[%(),]/g, "");
      q = q.or(
        `display_name.ilike.%${term}%,primary_email.ilike.%${term}%,company.ilike.%${term}%`,
      );
    }
    const { data, error } = await q;
    if (error) {
      throw new OAuthError("UPSTREAM_ERROR", "Unable to search contacts", 502);
    }
    return paged(data || [], size);
  }
  if (name === "get_contact") {
    const id = requireString(args, "contact_id");
    const [{ data: contact }, { data: activity }] = await Promise.all([
      supabase.from("crm_contacts").select(
        "id,display_name,first_name,last_name,primary_email,company,job_title,instagram_url,stage_id,lead_score,tags,status,custom_fields,last_activity_at",
      ).eq("organization_id", org).eq("id", id).maybeSingle(),
      supabase.from("crm_activities").select("activity_type,title,created_at")
        .eq("organization_id", org).eq("contact_id", id).order("created_at", {
          ascending: false,
        }).limit(10),
    ]);
    if (!contact) throw new OAuthError("NOT_FOUND", "Contact not found", 404);
    return { contact: { ...contact, recent_engagement: activity || [] } };
  }
  if (name === "create_contact" || name === "bulk_create_contacts") {
    const raw = name === "bulk_create_contacts" ? args.contacts : [args];
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_BATCH) {
      throw new OAuthError(
        "VALIDATION_ERROR",
        `contacts must contain 1 to ${MAX_BATCH} records`,
      );
    }
    const contacts = raw.map((item) => {
      const v = item as Record<string, unknown>;
      return {
        first_name: v.first_name,
        last_name: v.last_name,
        primary_email: v.email,
        company: v.company,
        job_title: v.job_title,
        primary_linkedin_url: v.linkedin_url,
        instagram_url: v.instagram_url,
        primary_phone: v.phone,
        tags: v.tags,
        stage_id: v.stage_id,
        custom_fields: v.custom_fields,
        source: "mcp_oauth",
      } as BulkContactInput;
    });
    if (contacts.some((contact) => contact.tags !== undefined)) {
      assertScope(caller, "tags:write");
    }
    if (contacts.some((contact) => contact.stage_id !== undefined)) {
      assertScope(caller, "stages:write");
    }
    const created = await insertContactsBulk(supabase, org, contacts, {
      maxBatch: MAX_BATCH,
      defaultSource: "mcp_oauth",
    });
    return {
      created: created.created,
      updated: 0,
      skipped: created.skipped,
      failed: 0,
      contact_ids: created.contact_ids,
    };
  }
  if (name === "update_contact") {
    const id = requireString(args, "contact_id");
    const fields: Record<string, unknown> = {};
    const map: Record<string, string> = {
      first_name: "first_name",
      last_name: "last_name",
      email: "primary_email",
      company: "company",
      job_title: "job_title",
      linkedin_url: "primary_linkedin_url",
      instagram_url: "instagram_url",
      phone: "primary_phone",
      tags: "tags",
      stage_id: "stage_id",
      custom_fields: "custom_fields",
    };
    for (const [input, column] of Object.entries(map)) {
      if (args[input] !== undefined) fields[column] = args[input];
    }
    if (!Object.keys(fields).length) {
      throw new OAuthError(
        "VALIDATION_ERROR",
        "At least one mutable field is required",
      );
    }
    if (fields.tags !== undefined) assertScope(caller, "tags:write");
    if (fields.stage_id !== undefined) assertScope(caller, "stages:write");
    if (fields.stage_id) fields.stage_entered_at = new Date().toISOString();
    const { data, error } = await supabase.from("crm_contacts").update(fields)
      .eq("organization_id", org).eq("id", id).select(
        "id,display_name,primary_email,company,job_title,stage_id,tags",
      ).maybeSingle();
    if (error) {
      throw new OAuthError("UPSTREAM_ERROR", "Unable to update contact", 502);
    }
    if (!data) throw new OAuthError("NOT_FOUND", "Contact not found", 404);
    return { contact: data };
  }
  if (name === "list_connected_accounts") {
    let q = supabase.from("unipile_accounts").select(
      "id,display_name,provider,status,created_at",
    ).eq("organization_id", org).order("created_at");
    if (typeof args.provider === "string" && args.provider.trim()) {
      q = q.eq("provider", args.provider.trim().toUpperCase());
    }
    const { data, error } = await q;
    if (error) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to list connected accounts",
        502,
      );
    }
    return {
      accounts: data || [],
      app_url: `${APP_URL}/accounts`,
    };
  }
  if (name === "list_pipeline_stages") {
    const [{ data: pipelines, error }, { data: stages, error: stageError }] =
      await Promise.all([
        supabase.from("crm_pipelines").select("id,name,is_default")
          .eq("organization_id", org).order("is_default", { ascending: false }),
        supabase.from("crm_pipeline_stages").select(
          "id,pipeline_id,name,stage_order,is_won_stage,is_lost_stage",
        ).eq("organization_id", org).order("stage_order"),
      ]);
    if (error || stageError) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to list pipeline stages",
        502,
      );
    }
    return {
      pipelines: (pipelines || []).map((pipeline) => ({
        ...pipeline,
        stages: (stages || []).filter((stage) =>
          stage.pipeline_id === pipeline.id
        ),
      })),
    };
  }
  if (name === "list_sequences") {
    const size = limit(args);
    let q = supabase.from("email_sequences").select(
      "id,name,status,source_type,created_at,updated_at,steps",
    ).eq("organization_id", org).order("id").limit(size + 1);
    if (cursor(args)) q = q.gt("id", cursor(args)!);
    if (typeof args.status === "string") q = q.eq("status", args.status);
    const { data, error } = await q;
    if (error) {
      throw new OAuthError("UPSTREAM_ERROR", "Unable to list sequences", 502);
    }
    return paged(
      (data || []).map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        source_type: s.source_type,
        step_count: Array.isArray(s.steps) ? s.steps.length : 0,
        created_at: s.created_at,
        updated_at: s.updated_at,
      })),
      size,
    );
  }
  if (name === "get_sequence") {
    const id = requireString(args, "sequence_id");
    const { data } = await supabase.from("email_sequences").select(
      "id,name,status,source_type,steps,created_at,updated_at",
    ).eq("organization_id", org).eq("id", id).maybeSingle();
    if (!data) throw new OAuthError("NOT_FOUND", "Sequence not found", 404);
    return {
      sequence: {
        ...data,
        step_count: Array.isArray(data.steps) ? data.steps.length : 0,
        steps: undefined,
      },
    };
  }
  if (name === "list_tags") {
    const { data, error } = await supabase.from("crm_contacts").select("tags")
      .eq("organization_id", org).not("tags", "is", null).limit(10000);
    if (error) {
      throw new OAuthError("UPSTREAM_ERROR", "Unable to list tags", 502);
    }
    return {
      tags: [...new Set((data || []).flatMap((row) => row.tags || []))].sort(),
    };
  }
  if (name === "update_contact_stage") {
    const contactId = requireString(args, "contact_id");
    const stageId = requireString(args, "stage_id");
    const { data: stage } = await supabase.from("crm_pipeline_stages").select(
      "id",
    ).eq("organization_id", org).eq("id", stageId).maybeSingle();
    if (!stage) throw new OAuthError("NOT_FOUND", "Stage not found", 404);
    const { data } = await supabase.from("crm_contacts").update({
      stage_id: stageId,
      stage_entered_at: new Date().toISOString(),
    }).eq("organization_id", org).eq("id", contactId).select("id,stage_id")
      .maybeSingle();
    if (!data) throw new OAuthError("NOT_FOUND", "Contact not found", 404);
    return { contact: data };
  }
  if (name === "search_conversations") {
    const size = limit(args);
    let q = supabase.from("crm_conversations").select(
      "id,contact_id,channel,status,last_message_at,last_message_preview,has_inbound_message,unread_count,lead_intent",
    ).eq("organization_id", org).eq("is_system", false).order("id").limit(
      size + 1,
    );
    if (cursor(args)) q = q.gt("id", cursor(args)!);
    if (typeof args.contact_id === "string") {
      q = q.eq("contact_id", args.contact_id);
    }
    if (typeof args.status === "string") q = q.eq("status", args.status);
    if (typeof args.has_inbound_message === "boolean") {
      q = q.eq("has_inbound_message", args.has_inbound_message);
    }
    const { data, error } = await q;
    if (error) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to search conversations",
        502,
      );
    }
    return paged(data || [], size);
  }
  if (name === "get_conversation") {
    const id = requireString(args, "conversation_id");
    const { data: conversation } = await supabase.from("crm_conversations")
      .select(
        "id,contact_id,channel,status,last_message_at,last_message_preview,lead_intent,unread_count",
      ).eq("organization_id", org).eq("id", id).maybeSingle();
    if (!conversation) {
      throw new OAuthError("NOT_FOUND", "Conversation not found", 404);
    }
    const { data: messages } = await supabase.from("crm_messages").select(
      "id,direction,content,content_type,email_subject,created_at,status",
    ).eq("conversation_id", id).order("created_at", { ascending: false }).limit(
      50,
    );
    return {
      conversation: { ...conversation, messages: (messages || []).reverse() },
    };
  }
  if (name === "list_lead_lists") {
    const size = limit(args);
    let q = supabase.from("lead_lists").select(
      "id,name,description,source_type,lead_count,status,is_smart,created_at,updated_at",
    ).eq("organization_id", org).order("id").limit(size + 1);
    if (cursor(args)) q = q.gt("id", cursor(args)!);
    if (typeof args.status === "string") q = q.eq("status", args.status);
    if (typeof args.search === "string" && args.search.trim()) {
      q = q.ilike("name", `%${args.search.trim().replace(/[%_]/g, "")}%`);
    }
    const { data, error } = await q;
    if (error) {
      throw new OAuthError("UPSTREAM_ERROR", "Unable to list lead lists", 502);
    }
    return paged(data || [], size);
  }
  if (name === "get_lead_list") {
    const id = requireString(args, "list_id");
    const { data: leadList, error } = await supabase.from("lead_lists").select(
      "id,name,description,source_type,lead_count,status,is_smart,filter_criteria,created_at,updated_at",
    ).eq("organization_id", org).eq("id", id).maybeSingle();
    if (error || !leadList) {
      throw new OAuthError("NOT_FOUND", "Lead list not found", 404);
    }
    if (args.include_members === false) return { lead_list: leadList };
    const { data: members, error: memberError } = await supabase.from(
      "lead_list_members",
    ).select(
      "contact_id,added_at,email_lower",
    ).eq("list_id", id).order("added_at", { ascending: false }).limit(
      limit(args),
    );
    if (memberError) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to read lead-list members",
        502,
      );
    }
    return { lead_list: leadList, members: members || [] };
  }
  if (name === "create_lead_list") {
    const listName = requireString(args, "name");
    const { data, error } = await supabase.from("lead_lists").insert({
      organization_id: org,
      name: listName,
      description: typeof args.description === "string"
        ? args.description.trim() || null
        : null,
      source_type: "manual",
      source_config: {},
      lead_count: 0,
      status: "active",
      created_by: caller.user_id,
    }).select("id,name,description,source_type,lead_count,status,created_at")
      .maybeSingle();
    if (error || !data) {
      throw new OAuthError("UPSTREAM_ERROR", "Unable to create lead list", 502);
    }
    return { lead_list: data };
  }
  if (name === "add_contacts_to_list") {
    const listId = requireString(args, "list_id");
    const rawIds = args.contact_ids;
    if (
      !Array.isArray(rawIds) || !rawIds.length || rawIds.length > MAX_BATCH ||
      rawIds.some((id) => typeof id !== "string" || !id.trim())
    ) {
      throw new OAuthError(
        "VALIDATION_ERROR",
        `contact_ids must contain 1 to ${MAX_BATCH} IDs`,
      );
    }
    const ids = [...new Set(rawIds.map((id) => (id as string).trim()))];
    const { data: list } = await supabase.from("lead_lists").select("id").eq(
      "organization_id",
      org,
    ).eq("id", listId).maybeSingle();
    if (!list) throw new OAuthError("NOT_FOUND", "Lead list not found", 404);
    const { data: contacts, error: contactError } = await supabase.from(
      "crm_contacts",
    ).select("id,primary_email").eq("organization_id", org).in("id", ids);
    if (contactError) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to validate contacts",
        502,
      );
    }
    const valid = new Map(
      (contacts || []).map((contact) => [contact.id, contact]),
    );
    // Look up only the members that could collide with this batch. Reading the
    // whole list hits PostgREST's 1000-row cap on big lists, the dedup misses,
    // and the insert dies on the (list_id, contact_id|email_lower) unique index.
    const batchEmails = [
      ...new Set(
        [...valid.values()]
          .map((contact) =>
            typeof contact.primary_email === "string"
              ? contact.primary_email.trim().toLowerCase()
              : ""
          )
          .filter(Boolean),
      ),
    ];
    const [byId, byEmail] = await Promise.all([
      supabase.from("lead_list_members").select("contact_id").eq(
        "list_id",
        listId,
      ).in("contact_id", ids),
      batchEmails.length
        ? supabase.from("lead_list_members").select("email_lower").eq(
          "list_id",
          listId,
        ).in("email_lower", batchEmails)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (byId.error || byEmail.error) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to read lead-list members",
        502,
      );
    }
    const memberIds = new Set(
      (byId.data || []).map((member) => member.contact_id),
    );
    const emails = new Set(
      (byEmail.data || []).map((member) => member.email_lower).filter(Boolean),
    );
    const additions = ids.filter((id) => {
      const contact = valid.get(id);
      const email = typeof contact?.primary_email === "string"
        ? contact.primary_email.trim().toLowerCase()
        : null;
      if (!contact || memberIds.has(id) || (email && emails.has(email))) {
        return false;
      }
      if (email) emails.add(email);
      return true;
    }).map((contact_id) => ({ list_id: listId, contact_id }));
    if (additions.length) {
      const { error: addError } = await supabase.from("lead_list_members")
        .insert(additions);
      if (addError) {
        throw new OAuthError(
          "UPSTREAM_ERROR",
          "Unable to add contacts to lead list",
          502,
        );
      }
      const { count } = await supabase.from("lead_list_members").select("*", {
        count: "exact",
        head: true,
      }).eq("list_id", listId);
      await supabase.from("lead_lists").update({ lead_count: count || 0 }).eq(
        "organization_id",
        org,
      ).eq("id", listId);
    }
    return {
      added: additions.length,
      skipped: ids.length - additions.length,
      submitted: ids.length,
    };
  }
  if (name === "list_content_ideas") {
    const size = limit(args);
    let q = supabase.from("content_ideas").select(
      "id,title,keywords,emotional_triggers,content_framework,brand_voice_id,product_id,created_at,updated_at",
    ).eq("organization_id", org).order("id").limit(size + 1);
    if (cursor(args)) q = q.gt("id", cursor(args)!);
    if (typeof args.search === "string" && args.search.trim()) {
      q = q.ilike("title", `%${args.search.trim().replace(/[%_]/g, "")}%`);
    }
    const { data, error } = await q;
    if (error) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to list content ideas",
        502,
      );
    }
    return paged(data || [], size);
  }
  if (name === "create_content_ideas") {
    const raw = args.ideas;
    if (!Array.isArray(raw) || !raw.length || raw.length > 25) {
      throw new OAuthError(
        "VALIDATION_ERROR",
        "ideas must contain 1 to 25 items",
      );
    }
    const rows = raw.map((item) => {
      const idea = item as Record<string, unknown>;
      const title = typeof idea.title === "string" ? idea.title.trim() : "";
      if (!title) {
        throw new OAuthError("VALIDATION_ERROR", "Each idea requires a title");
      }
      return {
        organization_id: org,
        title,
        keywords: Array.isArray(idea.keywords) ? idea.keywords : null,
        emotional_triggers: Array.isArray(idea.emotional_triggers)
          ? idea.emotional_triggers
          : null,
        content_framework: typeof idea.content_framework === "string"
          ? idea.content_framework
          : null,
        brand_voice_id: typeof idea.brand_voice_id === "string"
          ? idea.brand_voice_id
          : null,
        product_id: typeof idea.product_id === "string"
          ? idea.product_id
          : null,
      };
    });
    const { data, error } = await supabase.from("content_ideas").insert(rows)
      .select("id,title,keywords,content_framework,created_at");
    if (error) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to create content ideas",
        502,
      );
    }
    return { ideas: data || [] };
  }
  if (name === "list_blueprints") {
    const size = limit(args);
    let q = supabase.from("blueprints").select(
      "id,name,description,pipeline,tags,is_active,created_at,updated_at",
    ).eq("organization_id", org).order("id").limit(size + 1);
    if (cursor(args)) q = q.gt("id", cursor(args)!);
    if (typeof args.pipeline === "string") q = q.eq("pipeline", args.pipeline);
    if (args.active_only === true) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) {
      throw new OAuthError("UPSTREAM_ERROR", "Unable to list blueprints", 502);
    }
    return paged(data || [], size);
  }
  if (name === "get_blueprint") {
    const id = requireString(args, "blueprint_id");
    const { data, error } = await supabase.from("blueprints").select(
      "id,name,description,master_prompt,image_prompt,structure,model_config,pipeline,tags,is_active,created_at,updated_at",
    ).eq("organization_id", org).eq("id", id).maybeSingle();
    if (error || !data) {
      throw new OAuthError("NOT_FOUND", "Blueprint not found", 404);
    }
    return { blueprint: data };
  }
  if (name === "create_blueprint") {
    const blueprintName = requireString(args, "name");
    const masterPrompt = requireString(args, "master_prompt");
    const { data, error } = await supabase.from("blueprints").insert({
      organization_id: org,
      created_by: caller.user_id,
      name: blueprintName,
      description: typeof args.description === "string"
        ? args.description.trim() || null
        : null,
      master_prompt: masterPrompt,
      structure: { slots: [] },
      model_config: {},
      pipeline: typeof args.pipeline === "string" ? args.pipeline : null,
      tags: Array.isArray(args.tags) ? args.tags : null,
      is_active: false,
      is_public: false,
    }).select("id,name,description,pipeline,tags,is_active,created_at")
      .maybeSingle();
    if (error || !data) {
      throw new OAuthError("UPSTREAM_ERROR", "Unable to create blueprint", 502);
    }
    return { blueprint: data };
  }
  if (name === "list_agent_profiles") {
    const { data, error } = await supabase.from("ai_agent_profiles").select(
      "id,name,description,config,is_default,created_at,updated_at",
    ).eq("organization_id", org).order("is_default", { ascending: false })
      .order("name");
    if (error) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to list agent profiles",
        502,
      );
    }
    return { agent_profiles: data || [] };
  }
  if (name === "create_agent_profile") {
    const profileName = requireString(args, "name");
    const suppliedConfig = args.config && typeof args.config === "object" &&
        !Array.isArray(args.config)
      ? args.config
      : {};
    const config = {
      enabled: true,
      require_approval: true,
      max_auto_replies: 10,
      max_conversation_turns: 10,
      ...suppliedConfig,
    };
    const { data, error } = await supabase.from("ai_agent_profiles").insert({
      organization_id: org,
      created_by: caller.user_id,
      name: profileName,
      description: typeof args.description === "string"
        ? args.description.trim() || null
        : null,
      config,
      is_default: false,
    }).select("id,name,description,config,is_default,created_at").maybeSingle();
    if (error || !data) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to create agent profile",
        502,
      );
    }
    return { agent_profile: data };
  }
  if (name === "list_campaigns") {
    const size = limit(args);
    let q = supabase.from("linkedin_campaigns").select(
      "id,name,description,status,campaign_type,primary_channel,lead_list_id,total_leads,processed_leads,contacted_leads,replied_count,connection_rate,created_at,updated_at,started_at",
    ).eq("organization_id", org).order("id").limit(size + 1);
    if (cursor(args)) q = q.gt("id", cursor(args)!);
    if (typeof args.status === "string") q = q.eq("status", args.status);
    if (typeof args.search === "string" && args.search.trim()) {
      q = q.ilike("name", `%${args.search.trim().replace(/[%_]/g, "")}%`);
    }
    const { data, error } = await q;
    if (error) {
      throw new OAuthError("UPSTREAM_ERROR", "Unable to list campaigns", 502);
    }
    return paged(data || [], size);
  }
  if (name === "get_campaign" || name === "get_campaign_metrics") {
    const id = requireString(args, "campaign_id");
    const { data: campaign, error } = await supabase.from("linkedin_campaigns")
      .select(
        "id,name,description,status,campaign_type,primary_channel,lead_list_id,total_leads,processed_leads,contacted_leads,replied_count,connection_rate,sequence_nodes,sequence_edges,stop_on_reply,created_at,updated_at,started_at",
      ).eq("organization_id", org).eq("id", id).maybeSingle();
    if (error || !campaign) {
      throw new OAuthError("NOT_FOUND", "Campaign not found", 404);
    }
    const { data: progress, error: progressError } = await supabase.from(
      "campaign_lead_progress",
    ).select("status").eq("campaign_id", id);
    if (progressError) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to read campaign progression",
        502,
      );
    }
    const progression = (progress || []).reduce(
      (summary: Record<string, number>, row) => {
        const status = typeof row.status === "string" ? row.status : "unknown";
        summary[status] = (summary[status] || 0) + 1;
        return summary;
      },
      {},
    );
    if (name === "get_campaign_metrics") {
      return {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          total_leads: campaign.total_leads,
          processed_leads: campaign.processed_leads,
          contacted_leads: campaign.contacted_leads,
          replied_count: campaign.replied_count,
          connection_rate: campaign.connection_rate,
        },
        progression,
        note:
          "Counts are reported as stored by ACA. Rates require their matching denominator and are not inferred.",
      };
    }
    return {
      campaign: {
        ...campaign,
        sequence_step_count: Array.isArray(campaign.sequence_nodes)
          ? campaign.sequence_nodes.length
          : 0,
        sequence_nodes: undefined,
        sequence_edges: undefined,
        progression,
      },
    };
  }
  if (name === "create_linkedin_campaign_draft") {
    const campaignName = requireString(args, "name");
    if (campaignName.length < 3 || campaignName.length > 255) {
      throw new OAuthError(
        "VALIDATION_ERROR",
        "name must be 3 to 255 characters",
      );
    }
    const listId = requireString(args, "lead_list_id");
    const { data: leadList } = await supabase.from("lead_lists").select("id")
      .eq("organization_id", org).eq("id", listId).maybeSingle();
    if (!leadList) {
      throw new OAuthError("NOT_FOUND", "Lead list not found", 404);
    }
    const senderIds = Array.isArray(args.sender_account_ids)
      ? args.sender_account_ids.filter((id): id is string =>
        typeof id === "string"
      )
      : [];
    const { data, error } = await supabase.from("linkedin_campaigns").insert({
      organization_id: org,
      created_by: caller.user_id,
      name: campaignName,
      description: typeof args.description === "string"
        ? args.description.trim() || null
        : null,
      status: "draft",
      campaign_type: "linkedin_only",
      primary_channel: "linkedin",
      lead_list_id: listId,
      sender_account_ids: senderIds,
      exclusion_list_ids: [],
      exclude_other_campaigns: true,
      exclude_same_sender: true,
      stop_on_reply: true,
      sequence_nodes: [{
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: {},
      }],
      sequence_edges: [],
      campaign_settings: {},
    }).select(
      "id,name,status,campaign_type,primary_channel,lead_list_id,created_at",
    )
      .maybeSingle();
    if (error || !data) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to create campaign draft",
        502,
      );
    }
    const plan = await workspacePlan(supabase, org);
    return {
      campaign: data,
      note:
        "Draft created with no outreach steps and cannot send. Add and review sequence steps in ACA before activation.",
      app_url: `${APP_URL}/campaigns/${data.id}`,
      plan_note: draftPlanNote(plan.tier, plan.limits, "linkedin_campaigns"),
    };
  }
  if (name === "start_content_generation") {
    const blueprintId = requireString(args, "blueprint_id");
    const pipeline = requireString(args, "pipeline");
    const validPipelines = new Set([
      "rich_article",
      "social_media_post",
      "instagram_carousel",
      "image_only",
      "ugc_video",
      "generative_video_oneshot",
      "video_script",
      "storyboard_video_longform",
    ]);
    if (!validPipelines.has(pipeline)) {
      throw new OAuthError("VALIDATION_ERROR", "Unsupported content pipeline");
    }
    const rawItems = args.items;
    if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 10) {
      throw new OAuthError(
        "VALIDATION_ERROR",
        "items must contain 1 to 10 items",
      );
    }
    const { data: blueprint } = await supabase.from("blueprints").select(
      "id,name,model_config,is_active",
    ).eq("organization_id", org).eq("id", blueprintId).maybeSingle();
    if (!blueprint) {
      throw new OAuthError("NOT_FOUND", "Blueprint not found", 404);
    }
    if (!blueprint.is_active) {
      throw new OAuthError(
        "VALIDATION_ERROR",
        "Activate and review the blueprint in ACA before starting generation",
      );
    }
    const items = rawItems.map((item, index) => {
      const input = item as Record<string, unknown>;
      const title =
        typeof input.idea_title === "string" && input.idea_title.trim()
          ? input.idea_title.trim()
          : `Content ${index + 1}`;
      return {
        id: `mcp_${crypto.randomUUID()}`,
        idea_id: typeof input.idea_id === "string" ? input.idea_id : null,
        idea_title: title,
        slot_values:
          input.slot_values && typeof input.slot_values === "object" &&
            !Array.isArray(input.slot_values)
            ? input.slot_values
            : {},
        library_elements: {},
        status: "pending",
        outputs: null,
      };
    });
    const { data: job, error } = await supabase.from("content_generation_jobs")
      .insert({
        organization_id: org,
        user_id: caller.user_id,
        blueprint_id: blueprintId,
        pipeline,
        status: "queued",
        items,
        configuration: {
          blueprint_name: blueprint.name,
          pipeline,
          model_config: blueprint.model_config || {},
          auto_approve_all: false,
        },
        progress: { total: items.length, completed: 0, failed: 0 },
        cost: { estimated: items.length * 0.05, current: 0 },
      }).select("id,status,pipeline,created_at").maybeSingle();
    if (error || !job) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to create content job",
        502,
      );
    }
    const { error: dispatchError } = await supabase.functions.invoke(
      "dispatch-generation-job",
      { body: { job_id: job.id } },
    );
    if (dispatchError) {
      await supabase.from("content_generation_jobs").update({
        status: "failed",
      })
        .eq("organization_id", org).eq("id", job.id);
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to dispatch content job",
        502,
      );
    }
    return {
      job: { ...job, item_count: items.length },
      note: "Generation started. Content remains unapproved and unpublished.",
    };
  }
  if (name === "list_content_generation_jobs") {
    const size = limit(args);
    let q = supabase.from("content_generation_jobs").select(
      "id,blueprint_id,pipeline,status,progress,cost,created_at,updated_at",
    ).eq("organization_id", org).order("id", { ascending: false }).limit(
      size + 1,
    );
    if (cursor(args)) q = q.lt("id", cursor(args)!);
    const { data, error } = await q;
    if (error) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to list content-generation jobs",
        502,
      );
    }
    return paged(data || [], size);
  }
  if (name === "list_lead_magnets") {
    const size = limit(args);
    let q = supabase.from("unipile_campaigns").select(
      "id,name,is_active,trigger_keywords,lead_magnet_url,lead_magnet_title,account_id,created_at,updated_at",
    ).eq("organization_id", org).order("id").limit(size + 1);
    if (cursor(args)) q = q.gt("id", cursor(args)!);
    if (args.active_only === true) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to list lead magnets",
        502,
      );
    }
    const campaigns = data || [];
    const ids = campaigns.map((campaign) => campaign.id);
    const { data: leads, error: leadError } = ids.length
      ? await supabase.from("unipile_leads").select("campaign_id,status")
        .in("campaign_id", ids)
      : { data: [], error: null };
    if (leadError) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to read lead-magnet metrics",
        502,
      );
    }
    const stats = new Map<string, { captures: number; delivered: number }>();
    for (const lead of leads || []) {
      const metric = stats.get(lead.campaign_id) ||
        { captures: 0, delivered: 0 };
      metric.captures++;
      if (lead.status === "dm_sent") metric.delivered++;
      stats.set(lead.campaign_id, metric);
    }
    return paged(
      campaigns.map((campaign) => ({
        ...campaign,
        stats: stats.get(campaign.id) || { captures: 0, delivered: 0 },
      })),
      size,
    );
  }
  if (name === "get_lead_magnet") {
    const id = requireString(args, "campaign_id");
    const { data: campaign, error } = await supabase.from("unipile_campaigns")
      .select(
        "id,name,is_active,trigger_keywords,dm_template,lead_magnet_url,lead_magnet_title,require_connection_for_linkedin,comment_link_mode,account_id,created_at,updated_at",
      ).eq("organization_id", org).eq("id", id).maybeSingle();
    if (error || !campaign) {
      throw new OAuthError("NOT_FOUND", "Lead-magnet campaign not found", 404);
    }
    const { data: leads, error: leadError } = await supabase.from(
      "unipile_leads",
    )
      .select("status", { count: "exact" }).eq("campaign_id", id);
    if (leadError) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to read lead-magnet metrics",
        502,
      );
    }
    return {
      lead_magnet: campaign,
      stats: {
        captures: leads?.length || 0,
        delivered: (leads || []).filter((lead) => lead.status === "dm_sent")
          .length,
      },
    };
  }
  if (name === "create_lead_magnet_draft") {
    const accountId = requireString(args, "account_id");
    const magnetName = requireString(args, "name");
    const rawKeywords = args.trigger_keywords;
    if (
      !Array.isArray(rawKeywords) || !rawKeywords.length ||
      rawKeywords.some((keyword) =>
        typeof keyword !== "string" || !keyword.trim()
      )
    ) {
      throw new OAuthError(
        "VALIDATION_ERROR",
        "trigger_keywords must contain at least one non-empty keyword",
      );
    }
    const keywords = [
      ...new Set(
        rawKeywords.map((keyword) => (keyword as string).trim().toLowerCase()),
      ),
    ];
    const { data: account } = await supabase.from("unipile_accounts").select(
      "id",
    ).eq("organization_id", org).eq("id", accountId).maybeSingle();
    if (!account) {
      throw new OAuthError("NOT_FOUND", "Connected ACA account not found", 404);
    }
    const { data, error } = await supabase.from("unipile_campaigns").insert({
      organization_id: org,
      account_id: accountId,
      name: magnetName,
      trigger_keywords: keywords,
      dm_template: typeof args.dm_template === "string" ? args.dm_template : "",
      lead_magnet_url: typeof args.lead_magnet_url === "string"
        ? args.lead_magnet_url
        : null,
      lead_magnet_title: typeof args.lead_magnet_title === "string"
        ? args.lead_magnet_title
        : null,
      require_connection_for_linkedin:
        args.require_connection_for_linkedin !== false,
      comment_link_mode: "gated",
      dm_delay_seconds: 30,
      max_dms_per_hour: 10,
      max_dms_per_day: 50,
      user_cooldown_hours: 24,
      auto_accept_connections: true,
      is_active: false,
      ai_chatbot_enabled: false,
      auto_add_posts: false,
    }).select(
      "id,name,is_active,trigger_keywords,lead_magnet_url,lead_magnet_title,created_at",
    ).maybeSingle();
    if (error || !data) {
      throw new OAuthError(
        "UPSTREAM_ERROR",
        "Unable to create lead-magnet draft",
        502,
      );
    }
    const plan = await workspacePlan(supabase, org);
    return {
      lead_magnet: data,
      note:
        "Draft created inactive. Review the trigger, message, connected account, and delivery link in ACA before explicitly activating it.",
      app_url: `${APP_URL}/lead-magnets`,
      plan_note: draftPlanNote(plan.tier, plan.limits, "lead_magnets"),
    };
  }
  const scheduled = await schedulerTool(name, args, org);
  if (scheduled !== undefined) return scheduled;
  throw new OAuthError("NOT_FOUND", `Tool not implemented: ${name}`, 404);
}

/** Social Scheduler tools: reads and inactive drafts only (publishing stays in the app). */
async function schedulerTool(
  name: string,
  args: Record<string, unknown>,
  org: string,
): Promise<unknown> {
  const supabase = db();
  const app_url = `${APP_URL}/scheduler`;
  try {
    if (name === "list_scheduler_accounts") {
      return { ...(await listSchedulerAccounts(supabase, org)), app_url };
    }
    if (name === "list_scheduled_posts") {
      return { ...(await listSchedulerPosts(supabase, org, args)), app_url };
    }
    if (name === "get_scheduled_post") {
      return {
        post: await getSchedulerPost(supabase, org, args.id, {
          history: args.include_history === true,
        }),
        app_url,
      };
    }
    if (name === "get_post_stats") {
      return { ...(await getSchedulerPostStats(supabase, org, args.id)), app_url };
    }
    if (name === "create_social_post_draft") {
      const { post, issues, notes } = await createSchedulerPost(supabase, org, {
        ...args,
        status: "draft",
        publish_now: false,
      });
      return {
        post,
        issues,
        notes,
        note:
          "Saved as an inactive draft. Nothing is published until the user schedules it in ACA.",
        app_url,
      };
    }
    if (name === "plan_social_posts") {
      return {
        ...(await planSchedulerPosts(supabase, org, args)),
        next_step:
          "These are inactive drafts. The user reviews them, adds visuals where a platform needs one, and approves them in ACA.",
        app_url,
      };
    }
    return undefined;
  } catch (error) {
    if (!(error instanceof SchedulerError)) throw error;
    const code = error.status === 404
      ? "NOT_FOUND"
      : error.status === 409
      ? "CONFLICT"
      : error.status >= 500
      ? "UPSTREAM_ERROR"
      : "VALIDATION_ERROR";
    throw new OAuthError(code, error.message, error.status >= 500 ? 502 : error.status);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  }
  const requestId = crypto.randomUUID();
  try {
    const token = (req.headers.get("authorization") || "").replace(
      /^Bearer\s+/i,
      "",
    ).trim();
    // GET must challenge for auth the same as POST: clients probe with GET
    // to decide whether to run OAuth discovery at all, so an unauthenticated
    // 200 here makes them conclude no auth is required and skip it entirely.
    const caller = await resolveMcpAccessToken(db(), token, { trackLastUsed: false });
    if (req.method === "GET") {
      return new Response(
        JSON.stringify({ status: "ok", service: "aca-mcp-v1" }),
        { headers: { ...headers, "x-request-id": requestId } },
      );
    }
    const rpc = await req.json() as Rpc;
    if (rpc.method === "initialize") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "aca", version: SERVER_VERSION },
            instructions: SERVER_INSTRUCTIONS,
          },
        }),
        { headers: { ...headers, "x-request-id": requestId } },
      );
    }
    if (rpc.method === "tools/list") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          result: {
            tools: Object.entries(tools).map(([name, tool]) => ({
              name,
              description: tool.description,
              inputSchema: tool.schema,
              annotations: tool.annotations,
            })),
          },
        }),
        { headers: { ...headers, "x-request-id": requestId } },
      );
    }
    if (rpc.method !== "tools/call") {
      return new Response(
        JSON.stringify(
          err(rpc.id, "VALIDATION_ERROR", "Unsupported MCP method"),
        ),
        { headers: { ...headers, "x-request-id": requestId } },
      );
    }
    const name = requireString(rpc.params || {}, "name");
    const args = (rpc.params?.arguments || {}) as Record<string, unknown>;
    return new Response(
      JSON.stringify(result(rpc.id, await call(name, args, caller))),
      { headers: { ...headers, "x-request-id": requestId } },
    );
  } catch (error) {
    const e = error instanceof OAuthError ? error : new OAuthError(
      "UPSTREAM_ERROR",
      "ACA could not complete this request",
      502,
    );
    const responseHeaders: Record<string, string> = {
      ...headers,
      "x-request-id": requestId,
    };
    if (e.code === "INSUFFICIENT_SCOPE") {
      e.message +=
        ". Reconnect ACA in this app's connector settings and approve that permission.";
    }
    if (e.code === "AUTH_REQUIRED") {
      responseHeaders["WWW-Authenticate"] =
        `Bearer resource_metadata="${protectedResourceMetadata}"`;
    }
    return new Response(
      JSON.stringify(err(null, e.code, e.message, e.code === "UPSTREAM_ERROR")),
      {
        status: e.status >= 500 ? 502 : e.status === 401 ? 401 : 200,
        headers: responseHeaders,
      },
    );
  }
});
