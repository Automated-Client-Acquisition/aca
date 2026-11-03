import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { VariablePickerDropdown } from "./VariablePickerDropdown";
import {
  Mail,
  Clock,
  GitBranch,
  Split,
  CheckCircle2,
  Circle,
  Send,
  Eye,
  MousePointerClick,
  MessageSquare,
  AlertTriangle,
  ShieldAlert,
  Pencil,
  History,
  ChevronDown,
  ChevronRight,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useABVariants } from "@/hooks/useEmailABTests";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";
import type {
  EmailSequenceStep,
  EmailSequenceEnrollment,
  EmailSendLogEntry,
  EmailABVariant,
  SendLogStatus,
} from "@/types/email";

interface EnrollmentDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrollment: EmailSequenceEnrollment | null;
  steps: EmailSequenceStep[];
  sequenceId: string;
  onStepChange?: (index: number, step: EmailSequenceStep) => void;
  mailboxIds?: string[];
}

const STEP_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  delay: Clock,
  condition: GitBranch,
  ab_test: Split,
};

const SEND_STATUS_CONFIG: Partial<
  Record<SendLogStatus, { label: string; color: string; icon: typeof Send }>
> = {
  queued: { label: "Queued", color: "text-gray-500", icon: Circle },
  sending: { label: "Sending", color: "text-blue-500", icon: Send },
  sent: { label: "Sent", color: "text-blue-600", icon: Send },
  delivered: {
    label: "Delivered",
    color: "text-green-600",
    icon: CheckCircle2,
  },
  opened: { label: "Opened", color: "text-emerald-600", icon: Eye },
  clicked: {
    label: "Clicked",
    color: "text-purple-600",
    icon: MousePointerClick,
  },
  replied: { label: "Replied", color: "text-purple-700", icon: MessageSquare },
  bounced: { label: "Bounced", color: "text-red-600", icon: AlertTriangle },
  spam: { label: "Spam", color: "text-red-700", icon: ShieldAlert },
  filtered: { label: "Filtered", color: "text-amber-600", icon: ShieldAlert },
};

function buildVariableMap(
  contact: Record<string, any> | null,
  enrollmentCustomData?: Record<string, string>,
  customFieldDefaults?: Record<string, string>
): Record<string, string> {
  if (!contact) {
    const map = { ...(enrollmentCustomData || {}) };
    if (customFieldDefaults) {
      for (const [key, value] of Object.entries(customFieldDefaults)) {
        if (!(`custom_${key}` in map)) map[`custom_${key}`] = value;
      }
    }
    return map;
  }
  const enrichment = contact.enrichment_data || {};
  const map: Record<string, string> = {
    first_name: contact.first_name || "",
    last_name: contact.last_name || "",
    full_name: contact.display_name || "",
    email: contact.primary_email || "",
    company: contact.company || "",
    job_title: contact.job_title || "",
    city: contact.city || "",
    industry: enrichment.industry || contact.industry || "",
    website: contact.company_website || "",
    notion_preview_url: contact.notion_preview_url || "",
    ai_primary_need: enrichment.primary_need || "",
    ai_primary_need_reason: enrichment.primary_need_reasoning || "",
    ai_primary_need_evidence: enrichment.primary_need_evidence || "",
    ai_primary_need_confidence: enrichment.primary_need_confidence || "",
    ai_cold_email_angle: enrichment.cold_email_angle || "",
    ai_company_niche: enrichment.company_niche || "",
    ai_company_offering: enrichment.company_offering || "",
    ai_company_target: enrichment.company_target || "",
    ai_company_tagline: enrichment.company_tagline || "",
    ai_best_hook: enrichment.best_post_hook || "",
    ai_linkedin_topic_1: enrichment.linkedin_topics?.[0] || "",
    ai_priority_1: enrichment.company_priorities?.[0] || "",
    ai_growth_signal_1: enrichment.growth_signals?.[0]?.signal || "",
    ai_latest_funding: enrichment.latest_funding_round || "",
    ai_funding_amount: enrichment.funding_amount || "",
  };

  // Custom fields with custom_ prefix
  const customFields = contact.custom_fields || {};
  for (const [key, value] of Object.entries(customFields)) {
    if (value != null && value !== "") {
      map[`custom_${key}`] = String(value);
    }
  }

  // Org-level placeholder defaults (Settings > Custom Fields) for any
  // custom_<key> the contact has no value for — mirrors the send-time
  // fallback in email-sequence-processor / campaign-processor.
  if (customFieldDefaults) {
    for (const [key, value] of Object.entries(customFieldDefaults)) {
      const varName = `custom_${key}`;
      if (!(varName in map)) map[varName] = value;
    }
  }

  // Overlay per-enrollment custom_data (AI-generated content for shared template sequences)
  if (enrollmentCustomData) {
    for (const [key, value] of Object.entries(enrollmentCustomData)) {
      if (value !== undefined && value !== null) {
        map[key] = value;
        // Map custom_email_N_subject → email_subject_N and custom_email_N_body → email_body_N
        // so both {{custom_email_1_subject}} and {{email_subject_1}} resolve from the same data
        const m = key.match(/^custom_email_(\d+)_(subject|body)$/);
        if (m) {
          map[`email_${m[2]}_${m[1]}`] = value;
        }
      }
    }
  }

  return map;
}

// Stable pseudo-random pick so the preview shows one branch and doesn't
// flicker between re-renders. Same seed (e.g. the enrollment id) → same choice,
// so each contact sees a consistent-but-plausibly-different rendering.
function seededPick<T>(options: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}

// Preview renderer: resolve {{variables}} first, then collapse flat spintax
// {a|b|c} to a single branch — mirroring the send-time order in
// email-sequence-processor so the preview reflects what actually goes out.
// Unknown variables stay visible as {{name}} to flag unmapped fields.
function resolveVariables(
  text: string,
  vars: Record<string, string>,
  seed = ""
): string {
  // Existing sequences may have been saved before EmailRichTextEditor stopped
  // persisting its atomic merge-tag spans. Resolve the token once, outside its
  // editor-only HTML attributes, so an HTML signature cannot break markup or
  // be inserted twice in this preview.
  let template = text.replace(
    /<span\b(?=[^>]*\bdata-(?:variable|spintax)-token\s*=)([^>]*)>[\s\S]*?<\/span>/gi,
    (_match, attributes: string) => {
      const token = attributes.match(
        /\bdata-(?:variable|spintax)-token\s*=\s*(["'])(.*?)\1/i
      );
      return token?.[2] || "";
    }
  );
  // Multiple passes: a variable's resolved value (e.g. {{email_body_1}}, sourced
  // from AI-generated custom_data) can itself embed another variable, most often
  // a {{sender_first_name}} the model wrote mid-sentence into the body. A single
  // replace() splices that text in without re-scanning it, so the nested token
  // would stay literal here even though it resolves fine at send time — mirrors
  // the fix for the same issue in workers/sequence-sender's substituteVariables.
  let withVars = template;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    withVars = withVars.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, varName) => {
      if (varName in vars) {
        changed = true;
        return vars[varName];
      }
      return `{{${varName}}}`;
    });
    if (!changed) break;
  }
  if (withVars.indexOf("|") === -1) return withVars;
  let group = 0;
  return withVars.replace(/\{([^{}]*\|[^{}]*)\}/g, (_match, body: string) =>
    seededPick(body.split("|"), `${seed}#${group++}`)
  );
}

type VariableResolution = {
  name: string;
  value: string;
  source: "Contact" | "AI-generated" | "Organization default" | "Sender mailbox" | "Missing";
};

function getVariableResolutions(
  text: string | undefined,
  vars: Record<string, string>,
  contact: { custom_fields?: unknown } | null,
  enrollmentCustomData?: Record<string, string>,
  customFieldDefaults?: Record<string, string>,
  mailboxSenderInfo?: {
    signature: string;
    senderName: string;
    senderFirstName: string;
    senderLastName: string;
  }
): VariableResolution[] {
  if (!text) return [];

  const variableNames = Array.from(
    new Set(Array.from(text.matchAll(/\{\{\s*(\w+)\s*\}\}/g), (match) => match[1]))
  );
  const contactCustomFields =
    contact?.custom_fields && typeof contact.custom_fields === "object" && !Array.isArray(contact.custom_fields)
      ? contact.custom_fields as Record<string, unknown>
      : {};

  return variableNames.map((name) => {
    const value = vars[name] ?? "";
    const isSenderVariable = ["signature", "sender_name", "sender_first_name", "sender_last_name"].includes(name);
    const isEnrollmentValue = !!enrollmentCustomData?.[name] ||
      (/^email_(subject|body)_\d+$/.test(name) && !!enrollmentCustomData?.[`custom_${name.replace(/^email_(subject|body)_(\d+)$/, "email_$2_$1")}`]);
    const customFieldKey = name.startsWith("custom_") ? name.slice("custom_".length) : null;
    const hasContactCustomValue = customFieldKey
      ? contactCustomFields[customFieldKey] != null && contactCustomFields[customFieldKey] !== ""
      : false;
    const hasOrgDefault = customFieldKey
      ? !!customFieldDefaults?.[customFieldKey] && !hasContactCustomValue
      : false;

    let source: VariableResolution["source"] = "Contact";
    if (!(name in vars)) source = "Missing";
    else if (isSenderVariable && !!mailboxSenderInfo) source = "Sender mailbox";
    else if (isEnrollmentValue) source = "AI-generated";
    else if (hasOrgDefault) source = "Organization default";

    return { name, value, source };
  });
}

const VARIABLE_SOURCE_STYLES: Record<VariableResolution["source"], string> = {
  Contact: "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300",
  "AI-generated": "bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300",
  "Organization default": "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300",
  "Sender mailbox": "bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300",
  Missing: "bg-destructive/10 text-destructive border-destructive/20",
};

function PersonalizationInspector({
  subject,
  body,
  vars,
  contact,
  enrollmentCustomData,
  customFieldDefaults,
  mailboxSenderInfo,
}: {
  subject?: string;
  body?: string;
  vars: Record<string, string>;
  contact: { custom_fields?: unknown } | null;
  enrollmentCustomData?: Record<string, string>;
  customFieldDefaults?: Record<string, string>;
  mailboxSenderInfo?: { signature: string; senderName: string; senderFirstName: string; senderLastName: string };
}) {
  const resolutions = useMemo(
    () => getVariableResolutions(subject + "\n" + body, vars, contact, enrollmentCustomData, customFieldDefaults, mailboxSenderInfo),
    [subject, body, vars, contact, enrollmentCustomData, customFieldDefaults, mailboxSenderInfo]
  );

  if (resolutions.length === 0) return null;

  const missingCount = resolutions.filter((resolution) => resolution.source === "Missing").length;

  return (
    <Collapsible className="pt-1">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground">
        <ChevronRight className="h-3 w-3 transition-transform [[data-state=open]_&]:rotate-90" />
        Personalization · {resolutions.length} variable{resolutions.length === 1 ? "" : "s"}
        {missingCount > 0 && <span className="text-destructive">· {missingCount} missing</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 overflow-hidden rounded-md border bg-muted/20">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-b bg-muted/40 px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Variable → value</span>
            <span>Source</span>
          </div>
          {resolutions.map((resolution) => (
            <div key={resolution.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 border-b px-2 py-1.5 last:border-b-0">
              <div className="min-w-0 text-[10px]">
                <code className="text-foreground">{`{{${resolution.name}}}`}</code>
                <span className="mx-1 text-muted-foreground">→</span>
                <span className={cn("break-words", resolution.source === "Missing" && "text-destructive")}>
                  {resolution.source === "Missing" ? "Not available" : resolution.value || "(empty)"}
                </span>
              </div>
              <Badge variant="outline" className={cn("h-4 px-1 text-[9px] font-normal", VARIABLE_SOURCE_STYLES[resolution.source])}>
                {resolution.source}
              </Badge>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function EnrollmentDetailSheet({
  open,
  onOpenChange,
  enrollment,
  steps,
  sequenceId,
  onStepChange,
  mailboxIds,
}: EnrollmentDetailSheetProps) {
  const navigate = useNavigate();
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);

  const hasABSteps = steps.some((s) => s.type === "ab_test");
  const { data: abVariants } = useABVariants(hasABSteps ? sequenceId : undefined);
  // Map: stepIndex → winning EmailABVariant (if any)
  const abWinnerByStep = useMemo(() => {
    const map = new Map<number, EmailABVariant>();
    if (!abVariants) return map;
    for (const v of abVariants) {
      if (v.is_winner) map.set(v.step_index, v);
    }
    return map;
  }, [abVariants]);

  const { data: contact } = useQuery({
    queryKey: ["enrollment-contact", enrollment?.lead_id],
    queryFn: async () => {
      if (!enrollment) return null;
      // Try crm_contacts first
      const { data, error } = await supabase
        .from("crm_contacts")
        .select(
          "id, display_name, first_name, last_name, primary_email, company, job_title, city, company_website, enrichment_data, custom_fields, notion_preview_url"
        )
        .eq("id", enrollment.lead_id)
        .maybeSingle();
      if (error) throw error;
      if (data) return data;

      // Fallback: check leads table and chase source_id → crm_contacts for rich data
      const { data: lead } = await supabase
        .from("leads")
        .select("id, first_name, last_name, email, job_title, company, source_id")
        .eq("id", enrollment.lead_id)
        .maybeSingle();
      if (!lead) return null;
      const l = lead as { id: string; first_name: string | null; last_name: string | null; email: string; job_title: string | null; company: string | null; source_id: string | null };

      // If the lead has a CRM contact source, fetch enrichment data from it
      if (l.source_id) {
        const { data: crmContact } = await supabase
          .from("crm_contacts")
          .select(
            "id, display_name, first_name, last_name, primary_email, company, job_title, city, company_website, enrichment_data, custom_fields, notion_preview_url"
          )
          .eq("id", l.source_id)
          .maybeSingle();
        if (crmContact) return crmContact;
      }

      return {
        id: l.id,
        display_name: [l.first_name, l.last_name].filter(Boolean).join(" ") || null,
        first_name: l.first_name,
        last_name: l.last_name,
        primary_email: l.email,
        company: l.company,
        job_title: l.job_title,
        city: null,
        company_website: null,
        enrichment_data: null,
        custom_fields: null,
        notion_preview_url: null,
      };
    },
    enabled: !!enrollment && open,
  });

  const { data: sendLogs, isLoading: logsLoading } = useQuery({
    queryKey: ["enrollment-send-logs", sequenceId, enrollment?.lead_id, enrollment?.updated_at],
    queryFn: async () => {
      if (!enrollment) return [];
      // Only fetch send logs from the current enrollment cycle.
      // When a lead is re-enrolled (upsert resets current_step to 0),
      // updated_at is refreshed — filter out stale logs from previous cycles.
      let query = supabase
        .from("email_send_log")
        .select("*")
        .eq("sequence_id", sequenceId)
        .eq("lead_id", enrollment.lead_id)
        .order("sequence_step", { ascending: true });

      if (enrollment.updated_at) {
        query = query.gte("created_at", enrollment.updated_at);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as EmailSendLogEntry[];
    },
    enabled: !!enrollment && open,
  });

  // Fallback mailbox for signature: check lead's global assignment when enrollment has no mailbox yet
  const { data: leadAssignedMailboxId } = useQuery({
    queryKey: ["lead-assigned-mailbox", enrollment?.lead_id],
    queryFn: async () => {
      if (!enrollment) return null;
      const { data } = await supabase
        .from("leads")
        .select("assigned_mailbox_id")
        .eq("id", enrollment.lead_id)
        .maybeSingle();
      return (data as any)?.assigned_mailbox_id || null;
    },
    enabled: !!enrollment && open && !enrollment.mailbox_id,
  });

  // Candidate mailboxes whose signature could appear on the sent email, in the
  // processor's priority order:
  //   1. enrollment.mailbox_id (sticky — already assigned after first send)
  //   2. lead.assigned_mailbox_id (global — from previous sequences)
  //   3. the sequence settings pool (the processor rotates over these)
  // For a not-yet-sent enrollment only tier 3 exists, and the processor picks
  // via health-aware rotation — not necessarily pool[0]. So we resolve the
  // signature from the first candidate that actually HAS one, rather than
  // betting on pool[0] (which may have no signature while a sibling does).
  const signatureCandidateIds = useMemo(() => {
    const ids: string[] = [];
    if (enrollment?.mailbox_id) ids.push(enrollment.mailbox_id);
    if (leadAssignedMailboxId) ids.push(leadAssignedMailboxId);
    if (mailboxIds) ids.push(...mailboxIds);
    return Array.from(new Set(ids));
  }, [enrollment?.mailbox_id, leadAssignedMailboxId, mailboxIds]);

  // Same mailbox candidates resolve the signature AND the {{sender_name}} /
  // {{sender_first_name}} / {{sender_last_name}} variables — mirrors the
  // mailboxContext built at send time in email-sequence-processor.
  const { data: mailboxSenderInfo } = useQuery({
    queryKey: ["mailbox-sender-info", signatureCandidateIds],
    queryFn: async () => {
      const empty = { signature: "", senderName: "", senderFirstName: "", senderLastName: "" };
      if (signatureCandidateIds.length === 0) return empty;
      const { data } = await supabase
        .from("email_mailboxes")
        .select("id, metadata, display_name, first_name, last_name")
        .in("id", signatureCandidateIds);
      type MailboxRow = {
        id: string;
        metadata: { signature?: string } | null;
        display_name: string | null;
        first_name: string | null;
        last_name: string | null;
      };
      const byId = new Map((data || []).map((m: MailboxRow) => [m.id, m]));
      // Honor candidate priority: first candidate with a non-empty field wins,
      // resolved independently per field (a sibling mailbox may have a
      // signature but no display name, or vice versa).
      const pick = (getter: (m: MailboxRow) => string): string => {
        for (const id of signatureCandidateIds) {
          const m = byId.get(id);
          const val = m ? getter(m) : "";
          if (val) return val;
        }
        return "";
      };
      const senderName = pick((m) => m.display_name || "");
      return {
        signature: pick((m) => m.metadata?.signature || ""),
        senderName,
        senderFirstName: pick((m) => m.first_name || "") || senderName.split(" ")[0] || "",
        senderLastName: pick((m) => m.last_name || "") || senderName.split(" ").slice(1).join(" ") || "",
      };
    },
    enabled: signatureCandidateIds.length > 0 && open,
  });

  // Previous cycle send logs (for re-enrolled contacts)
  const isReEnrolled = (enrollment?.cycle_number ?? 1) > 1;
  const { data: previousCycleLogs } = useQuery({
    queryKey: ["previous-cycle-logs", sequenceId, enrollment?.lead_id, enrollment?.updated_at],
    queryFn: async () => {
      if (!enrollment?.updated_at) return [];
      const { data, error } = await supabase
        .from("email_send_log")
        .select("id, status, sent_at, opened_at, clicked_at, replied_at, bounced_at")
        .eq("sequence_id", sequenceId)
        .eq("lead_id", enrollment.lead_id)
        .lt("created_at", enrollment.updated_at)
        .order("sequence_step", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: isReEnrolled && !!enrollment && open,
  });

  const previousCycleStats = useMemo(() => {
    if (!previousCycleLogs || previousCycleLogs.length === 0) return null;
    const sent = previousCycleLogs.filter((l: any) => l.sent_at).length;
    const opened = previousCycleLogs.filter((l: any) => l.opened_at).length;
    const clicked = previousCycleLogs.filter((l: any) => l.clicked_at).length;
    const replied = previousCycleLogs.find((l: any) => l.replied_at);
    const bounced = previousCycleLogs.filter((l: any) => l.bounced_at).length;
    const firstSent = previousCycleLogs.find((l: any) => l.sent_at)?.sent_at;
    const lastSent = [...previousCycleLogs].reverse().find((l: any) => l.sent_at)?.sent_at;
    return { sent, opened, clicked, repliedAt: replied?.replied_at, bounced, firstSent, lastSent };
  }, [previousCycleLogs]);

  const [previousCycleExpanded, setPreviousCycleExpanded] = useState(false);

  const { data: customFieldDefs } = useCustomFieldDefs();
  const customFieldDefaults = useMemo(() => {
    const defaults: Record<string, string> = {};
    for (const def of customFieldDefs || []) {
      if (def.default_value) defaults[def.field_key] = def.default_value;
    }
    return defaults;
  }, [customFieldDefs]);

  // Sequence-level fallbacks (Settings > Variable defaults). The send worker
  // applies these to any blank variable, so the preview must too.
  const { data: sequenceVariableDefaults } = useQuery({
    queryKey: ["sequence-variable-defaults", sequenceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequences")
        .select("settings")
        .eq("id", sequenceId)
        .maybeSingle();
      if (error) throw error;
      return ((data?.settings as any)?.variable_defaults || {}) as Record<string, string>;
    },
    enabled: !!sequenceId,
  });

  const variableMap = useMemo(
    () => {
      const map = buildVariableMap(contact, enrollment?.custom_data, customFieldDefaults);
      for (const [key, value] of Object.entries(sequenceVariableDefaults || {})) {
        if (value && !(map[key] ?? "").trim()) map[key] = value;
      }
      if (mailboxSenderInfo?.signature) map.signature = mailboxSenderInfo.signature;
      if (mailboxSenderInfo?.senderName) map.sender_name = mailboxSenderInfo.senderName;
      if (mailboxSenderInfo?.senderFirstName) map.sender_first_name = mailboxSenderInfo.senderFirstName;
      if (mailboxSenderInfo?.senderLastName) map.sender_last_name = mailboxSenderInfo.senderLastName;
      return map;
    },
    [contact, enrollment?.custom_data, customFieldDefaults, sequenceVariableDefaults, mailboxSenderInfo]
  );

  const logByStep = new Map(
    (sendLogs || []).map((log) => [log.sequence_step, log])
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setEditingStepIndex(null);
      setPreviousCycleExpanded(false);
    }
    onOpenChange(nextOpen);
  };

  const insertVariable = (
    stepIndex: number,
    variable: string,
    field: "subject" | "body"
  ) => {
    const step = steps[stepIndex];
    if (!step || !onStepChange) return;
    const current = step[field] || "";
    onStepChange(stepIndex, { ...step, [field]: current + variable });
  };

  if (!enrollment) return null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-lg w-full">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-base">
            {enrollment.lead_name || "Unknown Lead"}
          </SheetTitle>
          <SheetDescription>
            {enrollment.lead_email || enrollment.lead_id}
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 pb-4">
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              enrollment.status === "active"
                ? "bg-green-500/10 text-green-600 border-green-500/20"
                : enrollment.status === "replied"
                ? "bg-purple-500/10 text-purple-600 border-purple-500/20"
                : enrollment.status === "bounced"
                ? "bg-red-500/10 text-red-600 border-red-500/20"
                : "bg-gray-500/10 text-gray-500 border-gray-500/20"
            )}
          >
            {enrollment.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Step {enrollment.current_step + 1} of {steps.length}
          </span>
          {isReEnrolled && (
            <Badge variant="outline" className="text-[10px] bg-indigo-500/10 text-indigo-600 border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20">
              Cycle {enrollment.cycle_number}
            </Badge>
          )}
        </div>

        <Separator />

        <ScrollArea className="h-[calc(100vh-200px)] mt-4 pr-3">
          {/* Previous Cycle Summary */}
          {isReEnrolled && previousCycleStats && (
            <div className="mb-4">
              <button
                onClick={() => setPreviousCycleExpanded(!previousCycleExpanded)}
                className="w-full flex items-center gap-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-2.5 text-left hover:bg-indigo-100 dark:hover:bg-indigo-950/50 transition-colors"
              >
                <History className="h-4 w-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                    Previous Cycle
                    {previousCycleStats.firstSent && previousCycleStats.lastSent && (
                      <span className="font-normal text-indigo-500 dark:text-indigo-400 ml-1">
                        {format(new Date(previousCycleStats.firstSent), "MMM d")}
                        {previousCycleStats.firstSent !== previousCycleStats.lastSent && (
                          <> &ndash; {format(new Date(previousCycleStats.lastSent), "MMM d")}</>
                        )}
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-0.5">
                    {previousCycleStats.sent} sent
                    {previousCycleStats.opened > 0 && <> &middot; {previousCycleStats.opened} opened</>}
                    {previousCycleStats.clicked > 0 && <> &middot; {previousCycleStats.clicked} clicked</>}
                    {previousCycleStats.repliedAt && <> &middot; replied {format(new Date(previousCycleStats.repliedAt), "MMM d")}</>}
                    {previousCycleStats.bounced > 0 && <> &middot; {previousCycleStats.bounced} bounced</>}
                  </p>
                </div>
                {previousCycleExpanded
                  ? <ChevronDown className="h-3.5 w-3.5 text-indigo-400" />
                  : <ChevronRight className="h-3.5 w-3.5 text-indigo-400" />
                }
              </button>
              {previousCycleExpanded && previousCycleLogs && (
                <div className="mt-2 space-y-1 pl-2">
                  {previousCycleLogs.map((log: any, i: number) => (
                    <div key={log.id || i} className="flex items-center gap-2 text-[10px] text-muted-foreground py-0.5">
                      <span className="tabular-nums w-14">Step {i + 1}</span>
                      {log.sent_at && <span>Sent {format(new Date(log.sent_at), "MMM d")}</span>}
                      {log.opened_at && <span className="text-emerald-600">&middot; Opened</span>}
                      {log.clicked_at && <span className="text-purple-600">&middot; Clicked</span>}
                      {log.replied_at && <span className="text-purple-700 font-medium">&middot; Replied</span>}
                      {log.bounced_at && <span className="text-red-600">&middot; Bounced</span>}
                    </div>
                  ))}
                  {enrollment.crm_contact_id && previousCycleStats.repliedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] text-indigo-600 px-2 mt-1"
                      onClick={() => navigate(`/inbox?contact=${enrollment.crm_contact_id}`)}
                    >
                      View in Inbox
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1">
            {steps.map((step, index) => {
              const isCurrent = index === enrollment.current_step;
              const isCompleted = index < enrollment.current_step;
              const isFuture = index > enrollment.current_step;
              const StepIcon = STEP_ICONS[step.type] || Mail;
              const sendLog = logByStep.get(index);
              const statusConfig = sendLog
                ? SEND_STATUS_CONFIG[sendLog.status]
                : null;
              const StatusIcon = statusConfig?.icon;
              const isEditing = editingStepIndex === index;
              const canEdit =
                step.type === "email" && !sendLog && !!onStepChange;

              const resolvedSubject = sendLog?.subject
                ? sendLog.subject
                : step.subject
                ? resolveVariables(step.subject, variableMap, enrollment.id)
                : undefined;
              const resolvedBody = sendLog?.body
                ? sendLog.body
                : step.body
                ? resolveVariables(step.body, variableMap, `${enrollment.id}:${index}`)
                : undefined;

              return (
                <div key={index}>
                  {index > 0 && (
                    <div className="flex items-center pl-5 py-0">
                      <div
                        className={cn(
                          "w-px h-4",
                          isCompleted || isCurrent ? "bg-primary" : "bg-border"
                        )}
                      />
                    </div>
                  )}

                  <div
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      isCurrent &&
                        "border-primary bg-primary/5 ring-1 ring-primary/20",
                      isCompleted && "border-muted bg-muted/30",
                      isFuture && "border-border opacity-60"
                    )}
                  >
                    {/* Step header */}
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full",
                          isCurrent
                            ? "bg-primary text-primary-foreground"
                            : isCompleted
                            ? "bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <StepIcon className="h-3.5 w-3.5" />
                        )}
                      </div>

                      <span className="text-xs font-medium flex-1">
                        {step.type === "email" && `Step ${index + 1} — Email`}
                        {step.type === "delay" && `Wait ${step.delay_hours}h`}
                        {step.type === "condition" &&
                          `If ${step.condition_type}`}
                        {step.type === "ab_test" && `A/B Test`}
                      </span>

                      {isCurrent && (
                        <Badge
                          variant="outline"
                          className="text-[10px] h-5 bg-primary/10 text-primary border-primary/20"
                        >
                          Current
                        </Badge>
                      )}

                      {sendLog && statusConfig && StatusIcon && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] h-5 gap-1",
                            statusConfig.color,
                            sendLog.status === "replied" && enrollment.crm_contact_id && "cursor-pointer hover:opacity-80"
                          )}
                          onClick={
                            sendLog.status === "replied" && enrollment.crm_contact_id
                              ? (e) => {
                                  e.stopPropagation();
                                  navigate(`/inbox?contact=${enrollment.crm_contact_id}`);
                                }
                              : undefined
                          }
                        >
                          <StatusIcon className="h-3 w-3" />
                          {statusConfig.label}
                        </Badge>
                      )}

                      {/* Edit button for unsent email steps */}
                      {canEdit && !isEditing && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setEditingStepIndex(index)}
                        >
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      )}
                    </div>

                    {/* Email step: edit mode */}
                    {step.type === "email" && isEditing && (
                      <div className="ml-8 space-y-3 mt-2">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Subject</Label>
                            <VariablePickerDropdown
                              onInsert={(v) =>
                                insertVariable(index, v, "subject")
                              }
                              size="xs"
                            />
                          </div>
                          <Input
                            value={step.subject || ""}
                            onChange={(e) =>
                              onStepChange?.(index, {
                                ...step,
                                subject: e.target.value,
                              })
                            }
                            placeholder="Subject line..."
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Body</Label>
                            <VariablePickerDropdown
                              onInsert={(v) =>
                                insertVariable(index, v, "body")
                              }
                              size="xs"
                            />
                          </div>
                          <Textarea
                            value={step.body || ""}
                            onChange={(e) =>
                              onStepChange?.(index, {
                                ...step,
                                body: e.target.value,
                              })
                            }
                            placeholder="Email body..."
                            rows={6}
                            className="text-xs font-mono"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setEditingStepIndex(null)}
                        >
                          Done
                        </Button>
                      </div>
                    )}

                    {/* Email step: read-only preview */}
                    {step.type === "email" && !isEditing && (
                      <div className="ml-8 space-y-1.5">
                        {resolvedSubject && (
                          <p className="text-xs font-medium text-foreground">
                            {resolvedSubject}
                          </p>
                        )}
                        {resolvedBody && (
                          <div
                            className="text-xs text-muted-foreground whitespace-pre-line prose-sm prose-p:my-0"
                            dangerouslySetInnerHTML={{
                              __html: resolvedBody,
                            }}
                          />
                        )}

                        {!sendLog && (
                          <PersonalizationInspector
                            subject={step.subject}
                            body={step.body}
                            vars={variableMap}
                            contact={contact}
                            enrollmentCustomData={enrollment.custom_data}
                            customFieldDefaults={customFieldDefaults}
                            mailboxSenderInfo={mailboxSenderInfo}
                          />
                        )}

                        {sendLog && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1.5">
                            {sendLog.sent_at && (
                              <span className="text-[10px] text-muted-foreground">
                                Sent{" "}
                                {format(
                                  new Date(sendLog.sent_at),
                                  "MMM d, h:mm a"
                                )}
                              </span>
                            )}
                            {sendLog.opened_at && (
                              <span className="text-[10px] text-emerald-600">
                                Opened{" "}
                                {format(
                                  new Date(sendLog.opened_at),
                                  "MMM d, h:mm a"
                                )}
                              </span>
                            )}
                            {sendLog.clicked_at && (
                              <span className="text-[10px] text-purple-600">
                                Clicked{" "}
                                {format(
                                  new Date(sendLog.clicked_at),
                                  "MMM d, h:mm a"
                                )}
                              </span>
                            )}
                            {sendLog.replied_at && (
                              <span
                                className={cn(
                                  "text-[10px] text-purple-700",
                                  enrollment.crm_contact_id && "cursor-pointer underline hover:text-purple-900"
                                )}
                                onClick={
                                  enrollment.crm_contact_id
                                    ? (e) => {
                                        e.stopPropagation();
                                        navigate(`/inbox?contact=${enrollment.crm_contact_id}`);
                                      }
                                    : undefined
                                }
                              >
                                Replied{" "}
                                {format(
                                  new Date(sendLog.replied_at),
                                  "MMM d, h:mm a"
                                )}
                              </span>
                            )}
                            {sendLog.bounced_at && (
                              <span className="text-[10px] text-red-600">
                                Bounced{" "}
                                {format(
                                  new Date(sendLog.bounced_at),
                                  "MMM d, h:mm a"
                                )}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* A/B test — each lead receives exactly ONE variant */}
                    {step.type === "ab_test" && step.variants && (() => {
                      const winner = abWinnerByStep.get(index);
                      const assignedVariantId =
                        enrollment.variant_assignments?.[String(index)];
                      const assignedIdx = assignedVariantId
                        ? step.variants.findIndex((v) => v.id === assignedVariantId)
                        : -1;
                      // Show assigned variant, or fall back to first variant as preview
                      const displayIdx = assignedIdx >= 0 ? assignedIdx : 0;
                      const displayVariant = step.variants[displayIdx];
                      const displayLetter = String.fromCharCode(65 + displayIdx);
                      const isAssigned = assignedIdx >= 0;

                      const variantSubject = displayVariant.subject
                        ? resolveVariables(displayVariant.subject, variableMap, `${enrollment.id}:${displayVariant.id}`)
                        : "No subject";
                      const variantBody = displayVariant.body
                        ? resolveVariables(displayVariant.body, variableMap, `${enrollment.id}:${displayVariant.id}`)
                        : undefined;

                      // Find the winner's letter label for display
                      const winnerIdx = winner
                        ? step.variants.findIndex((v) => v.id === winner.id)
                        : -1;
                      const winnerLetter = winnerIdx >= 0
                        ? String.fromCharCode(65 + winnerIdx)
                        : null;

                      return (
                        <div className="ml-8 space-y-1.5">
                          {winner && winnerLetter && (
                            <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              <Trophy className="h-3 w-3" />
                              Winner: Variant {winnerLetter}
                              {winner.sent > 0 && (
                                <span className="font-normal text-muted-foreground ml-1">
                                  ({winner.sent} sent &middot; {winner.replied} replied &middot; {winner.sent > 0 ? Math.round((winner.replied / winner.sent) * 100) : 0}% reply rate)
                                </span>
                              )}
                            </div>
                          )}
                          {isAssigned ? (
                            <span className="text-[10px] text-muted-foreground">
                              Sending variant {displayLetter}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">
                              {step.variants.length} variants &mdash; one will be assigned at send time
                            </span>
                          )}
                          <p className="text-xs font-medium text-foreground">
                            {variantSubject}
                          </p>
                          {variantBody && (
                            <div
                              className="text-xs text-muted-foreground whitespace-pre-line prose-sm prose-p:my-0"
                              dangerouslySetInnerHTML={{
                                __html: variantBody,
                              }}
                            />
                          )}
                          <PersonalizationInspector
                            subject={displayVariant.subject}
                            body={displayVariant.body}
                            vars={variableMap}
                            contact={contact}
                            enrollmentCustomData={enrollment.custom_data}
                            customFieldDefaults={customFieldDefaults}
                            mailboxSenderInfo={mailboxSenderInfo}
                          />
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>

          {logsLoading && (
            <div className="space-y-2 mt-4">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
