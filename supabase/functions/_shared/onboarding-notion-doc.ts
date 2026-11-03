/**
 * Personalized "onboarding plan" Notion doc for trial orgs.
 *
 * One page per organization, created on the first trial drip stage that
 * fires and updated (checklist + a running "Updates" log) on every
 * subsequent stage. Lives in ACA's own Notion workspace (env-var credential,
 * same pattern as autoblog-orchestrator's NOTION_API_KEY) - NOT the
 * customer-facing email_tool_connections / generate-notion-preview system,
 * which writes into each ACA customer's own connected Notion for THEIR
 * prospects.
 *
 * Every export here is best-effort: a Notion failure (missing credentials,
 * API error, etc.) is logged and swallowed so it can never break the
 * onboarding email send itself.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@^2.39.0";
import { compileBlock } from "./notion-block-compiler.ts";
import type { NotionBlockDef } from "./notion-block-types.ts";
import { APP_URL } from "./site-config.ts";

const NOTION_VERSION = "2022-06-28";

// Minimal shape of the fields we need off onboarding-drip-tick's DripCtx -
// kept local (not imported) so this shared module has no dependency on the
// function that calls it.
export interface OnboardingChecklistCtx {
  icp: { name: string } | null;
  audit: { overall: number | null } | null;
  sequence: { name: string | null } | null;
  blueprint: { themes: unknown[] } | null;
  agent: { name: string | null } | null;
  knowledge: { content: string | null } | null;
  strategy: { content: string | null } | null;
  hasLeads: boolean;
  hasUnipile: boolean;
  hasOpenRouter: boolean;
}

interface ChecklistItem {
  key: string;
  label: string;
  path: string;
  /** One concrete sentence: what to click and why it matters. Shown as an
   * indented line under the checklist item so instructions are clear without
   * needing a video (video embeds are supported too - see EmbedBlock - once
   * there's real footage to link). */
  how: string;
  done: (ctx: OnboardingChecklistCtx) => boolean;
}

const CHECKLIST: ChecklistItem[] = [
  { key: "hasUnipile", label: "Connect your LinkedIn account", path: "/senders", done: (c) => c.hasUnipile,
    how: "Open Senders and click \"Connect account\" - without this, campaigns can't send or receive on your behalf." },
  { key: "hasOpenRouter", label: "Connect your AI key", path: "/settings?tab=integrations", done: (c) => c.hasOpenRouter,
    how: "Open Settings > Integrations and add an OpenRouter API key - this powers every AI-written message and audit." },
  { key: "icp", label: "Build your ideal customer profile", path: "/assets", done: (c) => c.icp != null,
    how: "Open Assets > ICPs to review or refine the buyer profile ACA already built for you from your website." },
  { key: "audit", label: "Run your LinkedIn audit", path: "/library/audits", done: (c) => c.audit?.overall != null,
    how: "Open your audit to see your score and grab the paste-ready headline and About section rewrites." },
  { key: "hasLeads", label: "Import your first leads", path: "/leads/lists", done: (c) => c.hasLeads,
    how: "Open Lead Lists and paste a Sales Navigator URL or CSV - nothing sends until real people are in the system." },
  { key: "sequence", label: "Set up your outbound sequence", path: "/sequences", done: (c) => c.sequence != null,
    how: "Open Sequences to review the outreach steps already written for you and turn it on when ready." },
  { key: "blueprint", label: "Build your content plan", path: "/blueprints", done: (c) => c.blueprint != null,
    how: "Open Assets > Blueprints to see the post angles written for your ICP - queue them into Generate." },
  { key: "agent", label: "Train your AI agent", path: "/assets", done: (c) => c.agent != null,
    how: "Open Assets to check your agent's tone and let it start handling replies in your inbox." },
  { key: "knowledge", label: "Add a knowledge document", path: "/assets", done: (c) => c.knowledge != null,
    how: "Open Assets > Knowledge and upload anything (a deck, FAQ, docs) your agent should draw on when it writes." },
  { key: "strategy", label: "Add a strategy document", path: "/assets", done: (c) => c.strategy != null,
    how: "Open Assets > Strategies to see the plan ACA generated for how you'll actually win this ICP." },
];

function creds(): { token: string; databaseId: string } | null {
  // Reuses the same internal integration as autoblog-orchestrator
  // (NOTION_API_KEY) - only the target database differs.
  const token = Deno.env.get("NOTION_API_KEY");
  const databaseId = Deno.env.get("NOTION_ONBOARDING_DB_ID");
  if (!token || !databaseId) return null;
  return { token, databaseId };
}

async function notionFetch(token: string, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`https://api.notion.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(`Notion API ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function appUrl(): string {
  return APP_URL;
}

interface OnboardingDocRow {
  organization_id: string;
  notion_page_id: string;
  notion_url: string;
  checklist_block_ids: Record<string, string>;
}

/**
 * Creates the org's onboarding doc if it doesn't exist yet. Returns the
 * tracked row (existing or newly created), or null if Notion isn't
 * configured or the create failed.
 */
export async function ensureOnboardingDoc(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  organizationId: string,
  orgName: string,
  ctx: OnboardingChecklistCtx,
): Promise<OnboardingDocRow | null> {
  const { data: existing } = await supabase
    .from("organization_onboarding_docs")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (existing) return existing as OnboardingDocRow;

  const notion = creds();
  if (!notion) return null;

  try {
    const base = appUrl();
    const headerBlocks: NotionBlockDef[] = [
      {
        type: "callout",
        emoji: "🚀",
        text: [{ content: `Your ACA setup plan. This page updates itself as you go — check back any time.` }],
      },
      { type: "heading_2", text: [{ content: "Setup checklist" }] },
    ];
    const createPayload = {
      parent: { database_id: notion.databaseId },
      properties: {
        title: { title: [{ text: { content: `${orgName} — ACA Setup Plan` } }] },
        "Organization ID": { rich_text: [{ text: { content: organizationId } }] },
      },
      children: headerBlocks.map(compileBlock),
    };
    const created = await notionFetch(notion.token, "/v1/pages", {
      method: "POST",
      body: JSON.stringify(createPayload),
    });
    const pageId = created.id as string;
    const notionUrl = (created.public_url || created.url) as string;

    // Append the checklist as to_do blocks in a second call so the response
    // gives us each item's block id (page-creation responses don't).
    const checklistBlocks: NotionBlockDef[] = CHECKLIST.map((item) => ({
      type: "to_do",
      checked: item.done(ctx),
      text: [{ content: item.label, link: `${base}${item.path}` }],
      children: [{ type: "paragraph", text: [{ content: item.how, color: "gray" }] }],
    }));
    const appended = await notionFetch(notion.token, `/v1/blocks/${pageId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: checklistBlocks.map(compileBlock) }),
    });
    const results = (appended.results as Array<{ id: string }>) || [];
    const checklistBlockIds: Record<string, string> = {};
    CHECKLIST.forEach((item, i) => {
      if (results[i]) checklistBlockIds[item.key] = results[i].id;
    });

    // "Updates" section heading, so per-stage narrative content has somewhere
    // consistent to land below the checklist.
    await notionFetch(notion.token, `/v1/blocks/${pageId}/children`, {
      method: "PATCH",
      body: JSON.stringify({
        children: [compileBlock({ type: "divider" }), compileBlock({ type: "heading_2", text: [{ content: "Updates" }] })],
      }),
    });

    const row: OnboardingDocRow = {
      organization_id: organizationId,
      notion_page_id: pageId,
      notion_url: notionUrl,
      checklist_block_ids: checklistBlockIds,
    };
    await supabase.from("organization_onboarding_docs").insert(row);
    return row;
  } catch (e) {
    console.warn("[onboarding-notion-doc] create failed:", e);
    return null;
  }
}

/**
 * Refreshes checklist checkmarks against the current ctx and appends one
 * narrative update block for this stage. Never throws.
 */
export async function syncOnboardingDoc(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  doc: OnboardingDocRow,
  ctx: OnboardingChecklistCtx,
  updateBlocks: NotionBlockDef[],
): Promise<void> {
  const notion = creds();
  if (!notion) return;

  try {
    await Promise.all(
      CHECKLIST.map(async (item) => {
        const blockId = doc.checklist_block_ids[item.key];
        if (!blockId) return;
        await notionFetch(notion.token, `/v1/blocks/${blockId}`, {
          method: "PATCH",
          body: JSON.stringify({ to_do: { checked: item.done(ctx) } }),
        }).catch((e) => console.warn(`[onboarding-notion-doc] checklist item ${item.key} sync failed:`, e));
      }),
    );

    if (updateBlocks.length > 0) {
      await notionFetch(notion.token, `/v1/blocks/${doc.notion_page_id}/children`, {
        method: "PATCH",
        body: JSON.stringify({ children: updateBlocks.map(compileBlock) }),
      });
    }

    await supabase
      .from("organization_onboarding_docs")
      .update({ updated_at: new Date().toISOString() })
      .eq("organization_id", doc.organization_id);
  } catch (e) {
    console.warn("[onboarding-notion-doc] sync failed:", e);
  }
}
