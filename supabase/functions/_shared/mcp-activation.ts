import { PUBLIC_SITE_URL } from "./site-config.ts";
/**
 * Activation guidance for the directory-facing MCP (mcp-v1).
 *
 * Pure functions only: mcp-v1 gathers workspace counts, this module turns them
 * into a stage and at most three next steps. Guidance must stay honest:
 * - never suggest inventing prospects; contacts come from the user or ACA's
 *   own list-building in the app,
 * - state a plan limit only when a recommended step hits it, as a plain fact.
 *   Never include pricing links or upgrade prompts: app directories (OpenAI)
 *   reject subscription upsells inside tool results.
 */

export const APP_URL = PUBLIC_SITE_URL;

export type PlanFeature = "linkedin_campaigns" | "email_campaigns" | "lead_magnets";

// Mirrors PLAN_FEATURES in featureAccess.ts for the features MCP can draft.
const PAID_TIERS = new Set(["pro", "enterprise"]);

export function hasPlanFeature(
  planTier: string | null | undefined,
  limits: unknown,
  feature: PlanFeature,
): boolean {
  const override = (limits as { features?: Record<string, unknown> } | null)
    ?.features?.[feature];
  if (typeof override === "boolean") return override;
  return PAID_TIERS.has(planTier || "free");
}

/** Counts are null when ACA could not read them; null never triggers a step. */
export type ActivationCounts = {
  icps: number | null;
  products: number | null;
  contacts: number | null;
  lead_lists: number | null;
  campaigns: number | null;
  active_campaigns: number | null;
  sender_accounts: number | null;
  mailboxes: number | null;
};

export type ActivationInput = {
  workspaceName: string;
  planTier: string | null;
  limits: unknown;
  counts: ActivationCounts;
};

export type NextStep = {
  id: string;
  title: string;
  why: string;
  tools?: string[];
  app_url?: string;
  not_in_current_plan?: boolean;
};

export type Stage = "new" | "setting_up" | "ready_to_launch" | "live";

const MAX_STEPS = 3;
const zero = (n: number | null) => n === 0;
const some = (n: number | null) => typeof n === "number" && n > 0;

export function activationStage(c: ActivationCounts): Stage {
  if (some(c.active_campaigns)) return "live";
  const hasSender = some(c.sender_accounts) || some(c.mailboxes);
  if (some(c.campaigns) || (some(c.lead_lists) && hasSender)) {
    return "ready_to_launch";
  }
  if (some(c.contacts) || some(c.lead_lists) || some(c.icps) || some(c.products)) {
    return "setting_up";
  }
  return "new";
}

export function activationSteps(input: ActivationInput): NextStep[] {
  const c = input.counts;
  const steps: NextStep[] = [];
  const linkedinAllowed = hasPlanFeature(
    input.planTier,
    input.limits,
    "linkedin_campaigns",
  );

  if (some(c.active_campaigns)) {
    steps.push({
      id: "review_replies",
      title: "Review new replies",
      why: "Campaigns are live. Replies are where meetings come from.",
      tools: ["search_conversations", "get_conversation"],
    });
    steps.push({
      id: "check_campaign_results",
      title: "Check campaign results",
      why: "See how many leads were contacted and replied, as stored by ACA.",
      tools: ["list_campaigns", "get_campaign_metrics"],
    });
    return steps;
  }

  if (zero(c.icps) && zero(c.products)) {
    steps.push({
      id: "define_offer_and_icp",
      title: "Describe your offer and ideal customer",
      why: "ACA scores leads and writes outreach against your offer and ICP.",
      app_url: `${APP_URL}/onboarding`,
    });
  }
  if (zero(c.contacts)) {
    steps.push({
      id: "add_prospects",
      title: "Add the people you want to reach",
      why:
        "Import prospects the user already has, or build a list from ACA's lead sources in the app. Never invent contact details.",
      tools: ["bulk_create_contacts", "create_contact"],
      app_url: `${APP_URL}/list-building`,
    });
  } else if (zero(c.lead_lists)) {
    steps.push({
      id: "create_lead_list",
      title: "Group your contacts into a lead list",
      why: "Campaigns run against a lead list.",
      tools: ["create_lead_list", "add_contacts_to_list"],
    });
  }
  if (zero(c.sender_accounts) && zero(c.mailboxes)) {
    steps.push({
      id: "connect_sender",
      title: "Connect a LinkedIn account or mailbox",
      why: "ACA sends from your own accounts. Connecting happens in the app for security.",
      app_url: `${APP_URL}/accounts`,
    });
  }
  if (zero(c.campaigns) && some(c.lead_lists)) {
    steps.push({
      id: "draft_campaign",
      title: "Draft your first LinkedIn campaign",
      why: "Drafts never send. Review steps and activate in ACA when ready.",
      tools: ["list_lead_lists", "create_linkedin_campaign_draft"],
      ...(linkedinAllowed ? {} : { not_in_current_plan: true }),
    });
  }
  if (some(c.campaigns) && !some(c.active_campaigns)) {
    steps.push({
      id: "activate_campaign",
      title: "Review and activate a campaign",
      why: "Your campaigns are drafts. Activation is a deliberate step in ACA.",
      tools: ["list_campaigns", "get_campaign"],
      app_url: `${APP_URL}/outreach`,
      ...(linkedinAllowed ? {} : { not_in_current_plan: true }),
    });
  }
  return steps.slice(0, MAX_STEPS);
}

const STAGE_SUMMARY: Record<Stage, string> = {
  new: "New workspace: nothing is set up yet.",
  setting_up: "Setup in progress: some building blocks exist, nothing is ready to send.",
  ready_to_launch: "Ready to launch: prospects and a sender or campaign draft are in place.",
  live: "Live: at least one campaign is active.",
};

export function buildActivation(input: ActivationInput) {
  const stage = activationStage(input.counts);
  const next_steps = activationSteps(input);
  const tier = input.planTier || "free";
  const planLimited = next_steps.some((step) => step.not_in_current_plan);
  return {
    workspace: input.workspaceName,
    stage,
    summary: STAGE_SUMMARY[stage],
    counts: input.counts,
    plan: {
      tier,
      ...(planLimited
        ? {
          limitation:
            "Activating campaigns is not included in this workspace's current plan. Drafts can still be created and reviewed.",
        }
        : {}),
    },
    next_steps,
    guidance:
      "Offer the first next step to the user. Ask before creating anything. Use only data the user provides or ACA returns.",
  };
}

/** Attached to draft results when the workspace plan cannot activate them. */
export function draftPlanNote(
  planTier: string | null,
  limits: unknown,
  feature: PlanFeature,
) {
  if (hasPlanFeature(planTier, limits, feature)) return undefined;
  return {
    plan: planTier || "free",
    message:
      "Draft saved. Activating it is not included in this workspace's current plan; the draft stays available in ACA.",
  };
}
