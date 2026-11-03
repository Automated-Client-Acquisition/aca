import type {
  EmailSequenceStep,
  EmailSequenceSettings,
  StepType,
  ABVariantDraft,
} from "@/types/email";

// ============================================================================
// Delay Presets
// ============================================================================

export const DELAY_PRESETS = [
  { label: "1 hour", hours: 1 },
  { label: "4 hours", hours: 4 },
  { label: "12 hours", hours: 12 },
  { label: "1 day", hours: 24 },
  { label: "2 days", hours: 48 },
  { label: "3 days", hours: 72 },
  { label: "5 days", hours: 120 },
  { label: "7 days", hours: 168 },
] as const;

// ============================================================================
// Step Type Labels & Icons
// ============================================================================

export const STEP_TYPE_CONFIG: Record<
  StepType,
  { label: string; iconName: string; description: string }
> = {
  email: {
    label: "Email",
    iconName: "Mail",
    description: "Send an email to the lead",
  },
  delay: {
    label: "Delay",
    iconName: "Clock",
    description: "Wait before the next step",
  },
  condition: {
    label: "Condition",
    iconName: "GitBranch",
    description: "Branch based on lead behavior",
  },
  ab_test: {
    label: "A/B Test",
    iconName: "Split",
    description: "Split test email variants",
  },
};

// ============================================================================
// Default Factories
// ============================================================================

export function getDefaultEmailStep(order: number): EmailSequenceStep {
  return {
    order,
    type: "email",
    subject: "",
    body: "",
  };
}

export function getDefaultDelayStep(
  order: number,
  hours: number = 24,
): EmailSequenceStep {
  return {
    order,
    type: "delay",
    delay_hours: hours,
  };
}

export function getDefaultConditionStep(order: number): EmailSequenceStep {
  return {
    order,
    type: "condition",
    condition_type: "replied",
    condition_timeout_hours: 48,
  };
}

export const CONDITION_TIMEOUT_PRESETS = [
  { label: "12 hours", hours: 12 },
  { label: "24 hours", hours: 24 },
  { label: "48 hours", hours: 48 },
  { label: "3 days", hours: 72 },
  { label: "5 days", hours: 120 },
  { label: "7 days", hours: 168 },
] as const;

export function getDefaultABTestStep(order: number): EmailSequenceStep {
  return {
    order,
    type: "ab_test",
    variants: [
      {
        id: crypto.randomUUID(),
        variant_label: "A",
        subject: "",
        body: "",
        split_percentage: 50,
      },
      {
        id: crypto.randomUUID(),
        variant_label: "B",
        subject: "",
        body: "",
        split_percentage: 50,
      },
    ],
  };
}

/** Start an experiment without changing the original email or its position. */
export function convertEmailStepToABTest(
  step: EmailSequenceStep,
): EmailSequenceStep {
  if (step.type !== "email") return step;
  const { subject, body, body_format, ...rest } = step;
  return {
    ...rest,
    type: "ab_test",
    variants: ["A", "B"].map((variant_label) => ({
      id: crypto.randomUUID(),
      variant_label,
      subject: subject || "",
      body: body || "",
      ...(body_format ? { body_format } : {}),
      split_percentage: 50,
    })),
  };
}

export function redistributeABVariantSplit(
  variants: ABVariantDraft[],
  targetIndex: number,
  requestedPercentage: number,
): ABVariantDraft[] {
  if (targetIndex < 0 || targetIndex >= variants.length || variants.length < 2)
    return variants;
  const percentage = Number.isFinite(requestedPercentage)
    ? Math.max(0, Math.min(100, Math.round(requestedPercentage)))
    : 0;
  const updated = variants.map((variant) => ({ ...variant }));
  updated[targetIndex].split_percentage = percentage;
  const others = variants
    .map((variant, index) => ({
      index,
      weight: Number.isFinite(Number(variant.split_percentage))
        ? Math.max(0, Number(variant.split_percentage))
        : 0,
    }))
    .filter(({ index }) => index !== targetIndex);
  const totalWeight = others.reduce((sum, { weight }) => sum + weight, 0);
  const remaining = 100 - percentage;
  let assigned = 0;
  others.forEach(({ index, weight }, position) => {
    const share =
      position === others.length - 1
        ? remaining - assigned
        : Math.min(
            remaining - assigned,
            Math.round(
              remaining *
                (totalWeight > 0 ? weight / totalWeight : 1 / others.length),
            ),
          );
    updated[index].split_percentage = share;
    assigned += share;
  });
  return updated;
}

export function getDefaultSettings(): EmailSequenceSettings {
  return {
    mailbox_ids: [],
    stop_on_reply: true,
    stop_on_auto_reply: true,
    stop_company_on_reply: false,
    open_tracking: false,
    click_tracking: true,
    custom_tracking_domain: null,
    tracking_domain_id: null,
    daily_limit: 30,
    max_new_leads_per_day: null,
    min_time_gap_minutes: 9,
    random_additional_minutes: 5,
    prioritize_new_leads: false,
    send_window: { start: "08:00", end: "18:00" },
    timezone: "America/New_York",
    skip_weekends: true,
    provider_matching: false,
    esp_routing_rules: [],
    auto_optimize_ab: false,
    ab_winning_metric: "reply_rate",
    ab_sample_size: 100,
    ai_filter_unlikely_reply: "send",
    ai_filter_hostile: "send",
    first_email_text_only: false,
    sisr_enabled: false,
    hypersend_mode: false,
    limit_per_company_domain: null,
    unsubscribe_header: true,
    unsubscribe_link_footer: true,
    unsubscribe_footer_text: null,
    allow_risky_emails: false,
    cc: [],
    bcc: [],
    owner_id: null,
    tags: [],
    variable_defaults: {},
    product_id: null,
  };
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  stepIndex?: number;
  field: string;
  message: string;
}

/**
 * A WYSIWYG-authored empty body still serializes to something like
 * "<p></p>" or "<p><br></p>" — truthy after .trim(), so a plain
 * `!body?.trim()` check would wrongly treat it as filled in. Strip tags
 * before checking for real content.
 */
export function isEmailBodyEmpty(body: string | undefined): boolean {
  if (!body) return true;
  return !body.replace(/<[^>]*>/g, "").trim();
}

export function validateSequenceSteps(
  steps: EmailSequenceStep[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (steps.length === 0) {
    errors.push({
      field: "steps",
      message: "Sequence must have at least one step",
    });
    return errors;
  }

  let hasPreviousEmail = false;
  steps.forEach((step, index) => {
    if (step.type === "email") {
      if (!step.subject?.trim() && !hasPreviousEmail) {
        errors.push({
          stepIndex: index,
          field: "subject",
          message: `Step ${index + 1}: Subject line is required`,
        });
      }
      if (isEmailBodyEmpty(step.body)) {
        errors.push({
          stepIndex: index,
          field: "body",
          message: `Step ${index + 1}: Email body is required`,
        });
      }
    }

    if (step.type === "delay") {
      if (!step.delay_hours || step.delay_hours < 1) {
        errors.push({
          stepIndex: index,
          field: "delay_hours",
          message: `Step ${index + 1}: Delay must be at least 1 hour`,
        });
      }
    }

    if (step.type === "ab_test") {
      if (!step.variants || step.variants.length < 2) {
        errors.push({
          stepIndex: index,
          field: "variants",
          message: `Step ${index + 1}: A/B test needs at least 2 variants`,
        });
      } else {
        const totalSplit = step.variants.reduce(
          (sum, v) => sum + (Number(v.split_percentage) || 0),
          0,
        );
        if (totalSplit !== 100) {
          errors.push({
            stepIndex: index,
            field: "variants",
            message: `Step ${index + 1}: Variant splits must total 100% (currently ${totalSplit}%)`,
          });
        }
        step.variants.forEach((v, vi) => {
          if (!v.subject?.trim() && !hasPreviousEmail) {
            errors.push({
              stepIndex: index,
              field: `variant_${vi}_subject`,
              message: `Step ${index + 1}, Variant ${v.variant_label}: Subject is required`,
            });
          }
          if (isEmailBodyEmpty(v.body)) {
            errors.push({
              stepIndex: index,
              field: `variant_${vi}_body`,
              message: `Step ${index + 1}, Variant ${v.variant_label}: Body is required`,
            });
          }
        });
      }
    }
    if (step.type === "email" || step.type === "ab_test")
      hasPreviousEmail = true;
  });

  return errors;
}

export function validateSettings(
  settings: EmailSequenceSettings,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Auto mode derives the pool every cycle, so a frozen mailbox_ids list is
  // neither used nor required — demanding one forced users to pin a token
  // mailbox just to pass validation.
  const isAutoPool = settings.mailbox_selection?.mode === "auto";

  if (!isAutoPool && settings.mailbox_ids.length === 0) {
    errors.push({
      field: "mailbox_ids",
      message: "At least one mailbox must be selected",
    });
  }

  // null = deliberately uncapped ("Max"); only a real number can be too small.
  if (settings.daily_limit !== null && settings.daily_limit < 1) {
    errors.push({
      field: "daily_limit",
      message: "Daily limit must be at least 1",
    });
  }

  if (settings.min_time_gap_minutes < 1) {
    errors.push({
      field: "min_time_gap_minutes",
      message: "Minimum gap must be at least 1 minute",
    });
  }

  if (!settings.tracking_domain_id) {
    errors.push({
      field: "tracking_domain_id",
      message:
        "A tracking domain is required. Add one in Settings → Tracking & imports.",
    });
  }

  return errors;
}

// ============================================================================
// Helpers
// ============================================================================

export function formatDelayHours(hours: number): string {
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours === 0) {
    return `${days}d`;
  }
  return `${days}d ${remainingHours}h`;
}

export function reorderSteps(
  steps: EmailSequenceStep[],
  fromIndex: number,
  toIndex: number,
): EmailSequenceStep[] {
  if (
    fromIndex < 0 ||
    fromIndex >= steps.length ||
    toIndex < 0 ||
    toIndex >= steps.length
  ) {
    return steps;
  }
  const result = [...steps];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result.map((step, index) => ({ ...step, order: index }));
}

/** Keep the same selected touchpoint when another step crosses its position. */
export function selectedStepIndexAfterMove(
  selectedIndex: number | null,
  fromIndex: number,
  toIndex: number,
): number | null {
  if (selectedIndex === null) return null;
  if (selectedIndex === fromIndex) return toIndex;
  if (fromIndex < selectedIndex && selectedIndex <= toIndex)
    return selectedIndex - 1;
  if (toIndex <= selectedIndex && selectedIndex < fromIndex)
    return selectedIndex + 1;
  return selectedIndex;
}

export const EMAIL_VARIABLES = [
  { label: "First Name", variable: "{{first_name}}" },
  { label: "Last Name", variable: "{{last_name}}" },
  { label: "Full Name", variable: "{{full_name}}" },
  { label: "Email", variable: "{{email}}" },
  { label: "Company", variable: "{{company}}" },
  { label: "Job Title", variable: "{{job_title}}" },
  { label: "City", variable: "{{city}}" },
  { label: "Industry", variable: "{{industry}}" },
  { label: "Website", variable: "{{website}}" },
  { label: "LinkedIn Bio", variable: "{{linkedin_bio}}" },
  { label: "Home Page Text", variable: "{{home_page_text}}" },
] as const;

export const EMAIL_MAILBOX_VARIABLES = [
  { label: "Sender First Name", variable: "{{sender_first_name}}" },
  { label: "Sender Last Name", variable: "{{sender_last_name}}" },
  { label: "Sender Name", variable: "{{sender_name}}" },
  { label: "Signature", variable: "{{signature}}" },
] as const;

export const EMAIL_COMPLIANCE_VARIABLES = [
  { label: "Unsubscribe Link", variable: "{{unsubscribe_link}}" },
] as const;

export const EMAIL_DELIVERABLE_VARIABLES = [
  { label: "Notion Preview URL", variable: "{{notion_preview_url}}" },
] as const;

export const EMAIL_AI_VARIABLES = [
  { label: "Primary Need", variable: "{{ai_primary_need}}" },
  { label: "Need Reasoning", variable: "{{ai_primary_need_reason}}" },
  { label: "Company Niche", variable: "{{ai_company_niche}}" },
  { label: "Company Offering", variable: "{{ai_company_offering}}" },
  { label: "Company Target", variable: "{{ai_company_target}}" },
  { label: "Company Tagline", variable: "{{ai_company_tagline}}" },
  { label: "Best Hook", variable: "{{ai_best_hook}}" },
  { label: "LinkedIn Topic", variable: "{{ai_linkedin_topic_1}}" },
  { label: "Priority", variable: "{{ai_priority_1}}" },
  { label: "Growth Signal", variable: "{{ai_growth_signal_1}}" },
  { label: "Latest Funding", variable: "{{ai_latest_funding}}" },
  { label: "Funding Amount", variable: "{{ai_funding_amount}}" },
] as const;

// Buying-signal variables from crm_contacts.discovery_metadata. Keys and labels
// are kept in sync with SIGNAL_MESSAGE_VARIABLES in @/lib/message-variables —
// that file carries the discovery_metadata key each token reads.
export const EMAIL_SIGNAL_VARIABLES = [
  { label: "Signal Type", variable: "{{ai_signal_type}}" },
  { label: "Signal Date", variable: "{{ai_signal_date}}" },
  { label: "Signal Detail", variable: "{{ai_signal_detail}}" },
  { label: "Signal Context", variable: "{{ai_signal_context}}" },
  { label: "Signal Source URL", variable: "{{ai_signal_source_url}}" },
  { label: "Signal Amount", variable: "{{ai_signal_amount}}" },
  { label: "Investors", variable: "{{ai_signal_investors}}" },
  { label: "Signal Person", variable: "{{ai_signal_person}}" },
  { label: "New Role", variable: "{{ai_signal_new_role}}" },
  {
    label: "Signal Company Website",
    variable: "{{ai_signal_company_website}}",
  },
  {
    label: "Signal Company LinkedIn",
    variable: "{{ai_signal_company_linkedin}}",
  },
  {
    label: "Signal Company Industry",
    variable: "{{ai_signal_company_industry}}",
  },
  { label: "Signal Company Size", variable: "{{ai_signal_company_size}}" },
  { label: "Signal Company Revenue", variable: "{{ai_signal_revenue}}" },
] as const;

export const EMAIL_GENERATED_VARIABLES = [
  { label: "Email 1 Subject", variable: "{{email_subject_1}}" },
  { label: "Email 1 Body", variable: "{{email_body_1}}" },
  { label: "Email 2 Subject", variable: "{{email_subject_2}}" },
  { label: "Email 2 Body", variable: "{{email_body_2}}" },
  { label: "Email 3 Subject", variable: "{{email_subject_3}}" },
  { label: "Email 3 Body", variable: "{{email_body_3}}" },
  { label: "Email 4 Subject", variable: "{{email_subject_4}}" },
  { label: "Email 4 Body", variable: "{{email_body_4}}" },
  { label: "Email 5 Subject", variable: "{{email_subject_5}}" },
  { label: "Email 5 Body", variable: "{{email_body_5}}" },
] as const;
