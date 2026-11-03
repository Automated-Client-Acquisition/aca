import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, ChevronDown, ChevronRight, CircleCheck, FlaskConical, Globe, Loader2, MailSearch, Pause, PenLine, Plus, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useEmailSequences } from "@/hooks/useEmailSequences";
import { useICPs } from "@/hooks/useICPs";
import { useLeadLists } from "@/hooks/useLeadLists";
import { sortModelsForAnalysis, useOpenRouterModels } from "@/hooks/useOpenRouterModels";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { useProducts } from "@/hooks/useProducts";
import { useLeadListProcessingStatus, usePauseLeadListProcessing } from "@/hooks/useLeadListProcessing";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PromptEditor } from "@/components/campaign-builder/PromptEditor";

type EnrichmentProvider = "apollo" | "hunter" | "prospeo" | "moltsets" | "quickenrich";
type VerificationProvider = "lite" | "apify_million_verifier" | "mailtester_ninja";
type PipelineStage = "icp" | "find_email" | "verify_email" | "enroll";
type DestinationType = "none" | "list" | "linkedin_campaign";
type ApprovedDestinationType = "none" | "email_sequence" | "linkedin_campaign";
type EmailStrategy = "none" | "find_only" | "verify_only" | "find_then_verify" | "verify_then_recover";
type PreviewVariableResolution = {
  name: string;
  value: string;
  source: "Contact" | "Company analysis" | "Buying signal" | "Product context" | "Workflow context" | "Sender" | "Missing";
};
type EmailPreview = {
  contact: string;
  resolvedPrompt: string;
  variableResolutions: PreviewVariableResolution[];
  emails: Array<{ subject: string; body: string }>;
};

type Policy = {
  id: string;
  enabled: boolean;
  analyze_icp: boolean;
  icp_product_id: string | null;
  icp_ids: string[];
  min_icp_score: number | null;
  icp_llm_provider: string | null;
  icp_llm_model: string | null;
  analyze_when: "always" | "if_stale";
  analysis_freshness_days: number;
  find_email: boolean;
  find_replacement_email_on_invalid: boolean;
  email_provider: string | null;
  email_provider_chain: EnrichmentProvider[] | null;
  verify_email: boolean;
  verification_provider: VerificationProvider;
  verification_provider_chain: VerificationProvider[] | null;
  verify_when: "always" | "if_stale";
  verify_freshness_days: number;
  require_valid_email: boolean;
  no_email_list_id: string | null;
  unverified_email_list_id: string | null;
  low_icp_destination_type: DestinationType;
  low_icp_destination_id: string | null;
  no_email_destination_type: DestinationType;
  no_email_destination_id: string | null;
  no_source_data_destination_type: DestinationType;
  no_source_data_destination_id: string | null;
  unverified_email_destination_type: DestinationType;
  unverified_email_destination_id: string | null;
  approved_destination_type: ApprovedDestinationType;
  approved_destination_id: string | null;
  stage_order: PipelineStage[] | null;
  sequence_id: string | null;
  write_message: boolean;
  message_prompt: string | null;
  message_llm_model: string | null;
  message_temperature: number | null;
  message_product_id: string | null;
  write_icebreaker: boolean;
  icebreaker_prompt: string | null;
  icebreaker_field_key: string | null;
  icebreaker_llm_model: string | null;
  icebreaker_temperature: number | null;
  // Looks up the contact's company_website via QuickEnrich Company Finder and
  // writes the result to crm_contacts.home_page_text (1 credit/company).
  fetch_home_page_text: boolean;
};

type QueryResult<T> = Promise<{ data: T; error: { message: string } | null }>;
interface UntypedQuery {
  select(columns: string): UntypedQuery;
  eq(column: string, value: string): UntypedQuery;
  maybeSingle(): QueryResult<Policy | null>;
  single(): QueryResult<Policy>;
  upsert(values: Record<string, unknown>, options: { onConflict: string }): UntypedQuery;
}
interface ProcessingDatabase {
  from(table: "lead_list_processing_policies"): UntypedQuery;
}

/** Must stay in sync with DEFAULT_SCORER_MODEL, the backend's fallback.
 *  Declared above EMPTY, which reads it — a `const` below its use is a
 *  temporal-dead-zone ReferenceError at module init that blanks the whole app,
 *  and the production build does not catch it. */
const DEFAULT_ICEBREAKER_MODEL = "anthropic/claude-haiku-4.5";

const EMPTY: Omit<Policy, "id"> = {
  enabled: false, analyze_icp: false, icp_product_id: null, icp_ids: [], min_icp_score: null,
  icp_llm_provider: null, icp_llm_model: null,
  analyze_when: "if_stale", analysis_freshness_days: 30,
  find_email: false, email_provider: null, email_provider_chain: [], verify_email: false,
  find_replacement_email_on_invalid: false,
  verification_provider: "lite", verification_provider_chain: ["lite"],
  verify_when: "always", verify_freshness_days: 30,
  require_valid_email: true,
  no_email_list_id: null, unverified_email_list_id: null, sequence_id: null,
  low_icp_destination_type: "none", low_icp_destination_id: null,
  no_email_destination_type: "none", no_email_destination_id: null,
  no_source_data_destination_type: "none", no_source_data_destination_id: null,
  unverified_email_destination_type: "none", unverified_email_destination_id: null,
  approved_destination_type: "none", approved_destination_id: null,
  stage_order: ["icp", "find_email", "verify_email", "enroll"],
  write_message: false, message_prompt: null, message_llm_model: null,
  message_temperature: null, message_product_id: null,
  write_icebreaker: false, icebreaker_prompt: null, icebreaker_field_key: "icebreaker",
  // Pinned, not left null: the workspace default is a reasoning model that takes
  // ~3 min per contact and blows the worker's timeout. The backend falls back to
  // this same model, so the picker never shows one thing and the run uses another.
  icebreaker_llm_model: DEFAULT_ICEBREAKER_MODEL, icebreaker_temperature: null,
  fetch_home_page_text: false,
};

/** The generator returns <div>/<br> HTML. Render it as text — the preview is for
 *  reading the copy, and interpolating model output as HTML is not worth it. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** How many contacts Preview will analyze before giving up. Each attempt is a
 *  live crawl + LLM call (~30-60s), so this trades patience for the odds that
 *  at least one company site is readable. */
const PREVIEW_ANALYSIS_ATTEMPTS = 3;

/** functions.invoke collapses every non-2xx into "Edge Function returned a
 *  non-2xx status code" and leaves `data` null, so the function's own
 *  explanation ("Insufficient enrichment data…") never reaches the user.
 *  FunctionsHttpError carries the raw Response — read the real reason off it.
 *  FunctionsFetchError (request never completed — the preview's analyze +
 *  generate calls run long enough to get dropped) puts the underlying
 *  TypeError on `context` instead, so check for a Response before reading it. */
async function readFunctionError(error: { message: string }): Promise<string> {
  const context = (error as { context?: unknown }).context;
  const isResponse =
    !!context && typeof (context as Response).json === "function";
  const payload = isResponse
    ? await (context as Response).json().catch(() => null)
    : null;
  if (payload?.error) return payload.error;
  if (!isResponse && context) {
    const cause = context instanceof Error ? context.message : String(context);
    return `${error.message}${cause ? ` (${cause})` : ""}`;
  }
  return error.message;
}

const DEFAULT_MESSAGE_PROMPT ="Write to {{first_name}} at {{company}}. Open on {{ai_primary_need}} and why it matters for a {{job_title}}. Keep every email under 80 words, no pleasantries, end with a single low-friction question.";

/** One sentence, no greeting and no CTA — it is dropped into copy the user wrote
 *  themselves, straight after "Hey {{first_name}} —". */
// Deliberately does NOT quote an example greeting: the first real run echoed the
// quoted "Hey there" back into the line, on top of the greeting the user's own
// copy already has. Describe the position instead of demonstrating it.
const DEFAULT_ICEBREAKER_PROMPT = "Write ONE sentence about {{company}} that proves I looked them up. Lead with {{ai_primary_need}} or {{ai_company_niche}}. Under 20 words. Start directly with the observation — no greeting, no name, no pitch, no question. It is inserted mid-line after an existing greeting, so it must start lowercase unless it starts with a proper noun.";

const ENRICHMENT_LABELS: Record<EnrichmentProvider, string> = { apollo: "Apollo", hunter: "Hunter", prospeo: "Prospeo", moltsets: "MoltSets", quickenrich: "QuickEnrich" };
const VERIFICATION_LABELS: Record<VerificationProvider, string> = { lite: "Lite checks", apify_million_verifier: "Million Verifier", mailtester_ninja: "MailTester Ninja" };
const LLM_PROVIDER_LABELS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", "x-ai": "xAI", meta: "Meta", "meta-llama": "Meta", mistralai: "Mistral", deepseek: "DeepSeek", qwen: "Qwen", ollama: "Ollama" };
const PREVIEW_VARIABLE_SOURCE_STYLES: Record<PreviewVariableResolution["source"], string> = {
  Contact: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  "Company analysis": "bg-violet-500/10 text-violet-700 border-violet-500/20",
  "Buying signal": "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  "Product context": "bg-amber-500/10 text-amber-700 border-amber-500/20",
  "Workflow context": "bg-slate-500/10 text-slate-700 border-slate-500/20",
  Sender: "bg-cyan-500/10 text-cyan-700 border-cyan-500/20",
  Missing: "bg-destructive/10 text-destructive border-destructive/20",
};

function ResolvedBriefInspector({ preview }: { preview: EmailPreview }) {
  const missingCount = preview.variableResolutions.filter((variable) => variable.source === "Missing").length;

  return (
    <details className="rounded-md border bg-background p-2.5">
      <summary className="cursor-pointer list-none text-xs font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5 transition-transform [[open]_&]:rotate-90" />
          See what the AI was told
          {preview.variableResolutions.length > 0 && <span className="font-normal text-muted-foreground">· {preview.variableResolutions.length} variables</span>}
          {missingCount > 0 && <span className="font-normal text-destructive">· {missingCount} missing</span>}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        {preview.variableResolutions.length > 0 && (
          <div className="overflow-hidden rounded border">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-b bg-muted/50 px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Variable → value</span><span>Source</span>
            </div>
            {preview.variableResolutions.map((variable) => (
              <div key={variable.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 border-b px-2 py-1.5 last:border-b-0">
                <span className="min-w-0 break-words text-[10px]">
                  <code className="text-foreground">{`{{${variable.name}}}`}</code>
                  <span className="mx-1 text-muted-foreground">→</span>
                  <span className={variable.source === "Missing" ? "text-destructive" : "text-muted-foreground"}>
                    {variable.source === "Missing" ? "Not available" : variable.value || "(empty)"}
                  </span>
                </span>
                <span className={`rounded border px-1 py-0.5 text-[9px] ${PREVIEW_VARIABLE_SOURCE_STYLES[variable.source]}`}>{variable.source}</span>
              </div>
            ))}
          </div>
        )}
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Resolved creative brief</p>
          <p className="whitespace-pre-wrap rounded border bg-muted/30 p-2 text-xs leading-relaxed text-muted-foreground">{preview.resolvedPrompt}</p>
        </div>
      </div>
    </details>
  );
}

function OutcomeDestination({ label, type, id, lists, campaigns, onChange }: {
  label: string; type: DestinationType; id: string | null; lists: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>; onChange: (type: DestinationType, id: string | null) => void;
}) {
  const value = type === "none" || !id ? "none" : `${type}:${id}`;
  return <div className="grid gap-2 border-l-2 border-amber-400 pl-3 sm:grid-cols-[minmax(0,1fr)_minmax(240px,0.9fr)] sm:items-center"><div><p className="text-xs font-semibold text-amber-700">IF NOT</p><Label className="text-sm">{label}</Label></div><Select value={value} onValueChange={(next) => {
    if (next === "none") onChange("none", null);
    else { const [nextType, nextId] = next.split(":"); onChange(nextType as DestinationType, nextId); }
  }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Keep in this list</SelectItem>{lists.length > 0 && <><SelectItem value="lists-heading" disabled>Move to another list</SelectItem>{lists.map((list) => <SelectItem key={list.id} value={`list:${list.id}`}>{list.name}</SelectItem>)}</>}{campaigns.length > 0 && <><SelectItem value="campaigns-heading" disabled>Send to LinkedIn campaign</SelectItem>{campaigns.map((campaign) => <SelectItem key={campaign.id} value={`linkedin_campaign:${campaign.id}`}>{campaign.name}</SelectItem>)}</>}</SelectContent></Select></div>;
}

function ApprovedDestination({ type, id, sequences, campaigns, onChange }: {
  type: ApprovedDestinationType; id: string | null; sequences: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>; onChange: (type: ApprovedDestinationType, id: string | null) => void;
}) {
  const value = type === "none" || !id ? "none" : `${type}:${id}`;
  return <Select value={value} onValueChange={(next) => {
    if (next === "none") onChange("none", null);
    else { const [nextType, nextId] = next.split(":"); onChange(nextType as ApprovedDestinationType, nextId); }
  }}><SelectTrigger><SelectValue placeholder="Choose a destination" /></SelectTrigger><SelectContent><SelectItem value="none">No automatic enrollment</SelectItem>{sequences.length > 0 && <><SelectItem value="sequences-heading" disabled>Email sequences</SelectItem>{sequences.map((sequence) => <SelectItem key={sequence.id} value={`email_sequence:${sequence.id}`}>{sequence.name}</SelectItem>)}</>}{campaigns.length > 0 && <><SelectItem value="linkedin-heading" disabled>LinkedIn campaigns</SelectItem>{campaigns.map((campaign) => <SelectItem key={campaign.id} value={`linkedin_campaign:${campaign.id}`}>{campaign.name}</SelectItem>)}</>}</SelectContent></Select>;
}

/** One row of the workflow, top of the dialog: what this list will actually do,
 *  in order, without scrolling through every control to work it out. */
function WorkflowStrip({ steps }: { steps: Array<{ label: string; on: boolean; detail?: string }> }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">This workflow</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {steps.map((step, index) => (
          <span key={step.label} className="flex items-center gap-1.5">
            {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${step.on ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground/60 line-through"}`}
              title={step.detail}
            >
              {step.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** A numbered step. Collapses to a one-line summary of what it is set to, so a
 *  configured workflow reads as a list of decisions instead of a wall of
 *  controls. The enable/disable Switch never toggles open state — clicking the
 *  header does. */
function WorkflowSection({ number, icon: Icon, title, description, summary, enabled, onEnabledChange, open, onOpenChange, children }: {
  number: number; icon: typeof Sparkles; title: string; description: string; summary?: React.ReactNode;
  enabled?: boolean; onEnabledChange?: (enabled: boolean) => void;
  open: boolean; onOpenChange: (open: boolean) => void; children?: React.ReactNode;
}) {
  const active = enabled ?? true;
  return <section className={`rounded-md border transition-colors ${active ? "border-border bg-background" : "border-border bg-muted/20"}`}>
    <div className="flex items-center gap-3 p-4">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{number}</span>
        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
        <div className="min-w-0 flex-1">
          <Label className="cursor-pointer text-base">{title}</Label>
          <p className="truncate text-sm text-muted-foreground">{(!open && active && summary) || description}</p>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {onEnabledChange && <Switch checked={active} onCheckedChange={(value) => { onEnabledChange(value); if (value) onOpenChange(true); }} aria-label={`${active ? "Disable" : "Enable"} ${title}`} />}
    </div>
    {active && open && children && <div className="space-y-4 px-4 pb-4 sm:ml-10">{children}</div>}
  </section>;
}

export function LeadListProcessingDialog({ listId, listName, open: controlledOpen, onOpenChange, isSmartList, matchingCount, onRunExisting }: {
  listId: string;
  listName: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  isSmartList?: boolean;
  matchingCount?: number;
  onRunExisting?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (nextOpen: boolean) => {
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const [form, setForm] = useState<Omit<Policy, "id">>(EMPTY);
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({});
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewStep, setPreviewStep] = useState<"analyzing" | "writing" | null>(null);
  const [previewAnalyzing, setPreviewAnalyzing] = useState<string | null>(null);
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  const { data: apiKeys = [] } = useApiKeys();
  const { data: sequences = [] } = useEmailSequences();
  const { products } = useProducts();
  const { icps } = useICPs();
  const { leadLists } = useLeadLists();
  const { data: campaigns = [] } = useCampaigns();
  const { data: openRouterModels, isLoading: isLoadingModels, hasOpenRouterKey } = useOpenRouterModels();
  const { data: ollamaModels = [], hasOllamaKey } = useOllamaModels();
  const { data: processingStatus } = useLeadListProcessingStatus(listId);
  const pauseProcessing = usePauseLeadListProcessing();
  const isParking = !!processingStatus?.isPaused && processingStatus.processing > 0;
  const isEditLocked = !!processingStatus?.hasWork && (!processingStatus.isPaused || isParking);

  const policy = useQuery({
    queryKey: ["lead-list-processing-policy", currentOrganization?.id, listId], enabled: open && !!currentOrganization?.id,
    queryFn: async () => {
      const db = supabase as unknown as ProcessingDatabase;
      const { data, error } = await db.from("lead_list_processing_policies").select("*")
        .eq("organization_id", currentOrganization!.id).eq("lead_list_id", listId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (open && !policy.isLoading) {
      const current = policy.data;
      setForm(current ? {
        ...EMPTY,
        ...current,
        email_provider_chain: current.email_provider_chain ?? (current.email_provider ? [current.email_provider as EnrichmentProvider] : []),
        verification_provider_chain: current.verification_provider_chain ?? [current.verification_provider ?? "lite"],
        no_email_destination_type: current.no_email_destination_type ?? (current.no_email_list_id ? "list" : "none"),
        no_email_destination_id: current.no_email_destination_id ?? current.no_email_list_id,
        unverified_email_destination_type: current.unverified_email_destination_type ?? (current.unverified_email_list_id ? "list" : "none"),
        unverified_email_destination_id: current.unverified_email_destination_id ?? current.unverified_email_list_id,
        approved_destination_type: current.approved_destination_type ?? (current.sequence_id ? "email_sequence" : "none"),
        approved_destination_id: current.approved_destination_id ?? current.sequence_id,
      } : { ...EMPTY, enabled: !!isSmartList });
      // Open the first step that still needs a decision and collapse the rest,
      // so opening a configured workflow reads as a summary rather than a form.
      const configured = current
        ? [current.analyze_icp, current.find_email || current.verify_email, current.approved_destination_type !== "none", current.write_message]
        : [false, false, false, false];
      const firstUnconfigured = configured.findIndex((done) => !done);
      setOpenSections(firstUnconfigured === -1 ? {} : { [firstUnconfigured + 1]: true });
      setPreview(null);
      setPreviewError(null);
    }
  }, [open, policy.data, policy.isLoading]);

  const toggleSection = (number: number) => setOpenSections((current) => ({ ...current, [number]: !current[number] }));

  const configuredEnrichmentProviders = (["apollo", "hunter", "prospeo", "moltsets"] as EnrichmentProvider[])
    .filter((provider) => apiKeys.some((key) => key.provider === provider && key.is_valid));
  const hasMailtesterKey = apiKeys.some((key) => key.provider === "mailtester_ninja" && key.is_valid);
  const recoveryLists = leadLists.filter((list) => list.id !== listId && !list.is_smart && list.status === "active");
  // Paused destinations are selectable: leads park there and start moving when it resumes.
  const withPausedLabel = <T extends { name: string; status: string }>(item: T) => ({ ...item, name: item.status === "paused" ? `${item.name} (paused)` : item.name });
  const selectableSequences = sequences.filter((sequence) => sequence.status === "active" || sequence.status === "paused").map(withPausedLabel);
  const selectableLinkedInCampaigns = campaigns.filter((campaign) => (campaign.status === "active" || campaign.status === "paused") && (campaign.campaign_type === "linkedin_only" || campaign.primary_channel === "linkedin" || !campaign.campaign_type)).map(withPausedLabel);
  // The AI writer sizes its output from the destination sequence, so every
  // {{email_subject_N}} the sequence references gets a value.
  const destinationSequence = form.approved_destination_type === "email_sequence" && form.approved_destination_id
    ? sequences.find((sequence) => sequence.id === form.approved_destination_id)
    : undefined;
  const destinationEmailSteps = (destinationSequence?.steps ?? []).filter((step) => step.type === "email").length;
  const destinationUsesGeneratedEmails = (destinationSequence?.steps ?? []).some((step) => (
    /\{\{\s*(email_(subject|body)_\d+|custom_email_\d+_(subject|body))\s*\}\}/.test(`${step.subject ?? ""} ${step.body ?? ""}`)
  ));
  const sortedModels = openRouterModels ? sortModelsForAnalysis(openRouterModels) : [];
  const llmProviders = [
    ...(hasOllamaKey ? ["ollama"] : []),
    ...new Set(sortedModels.map((model) => model.id.split("/")[0]).filter(Boolean)),
  ];
  const selectedLlmProvider = form.icp_llm_provider ?? "default";
  const providerModels = selectedLlmProvider === "default" ? []
    : selectedLlmProvider === "ollama" ? ollamaModels
      : sortedModels.filter((model) => model.id.startsWith(`${selectedLlmProvider}/`));
  const set = <K extends keyof Omit<Policy, "id">>(key: K, value: Omit<Policy, "id">[K]) => setForm((current) => ({ ...current, [key]: value }));
  const emailStrategy: EmailStrategy = !form.find_email && !form.verify_email ? "none"
    : form.find_email && !form.verify_email ? "find_only"
      : !form.find_email && form.verify_email ? "verify_only"
        : form.find_replacement_email_on_invalid ? "verify_then_recover" : "find_then_verify";
  const setEmailStrategy = (strategy: EmailStrategy) => setForm((current) => ({
    ...current,
    find_email: strategy === "find_only" || strategy === "find_then_verify" || strategy === "verify_then_recover",
    verify_email: strategy === "verify_only" || strategy === "find_then_verify" || strategy === "verify_then_recover",
    find_replacement_email_on_invalid: strategy === "verify_then_recover",
    stage_order: strategy === "verify_then_recover"
      ? ["icp", "verify_email", "find_email", "enroll"]
      : ["icp", "find_email", "verify_email", "enroll"],
  }));
  const needsEmailFinding = form.find_email;
  const needsVerification = form.verify_email;
  const updateEmailProvider = (index: number, provider: EnrichmentProvider) => set("email_provider_chain", (form.email_provider_chain ?? []).map((value, current) => current === index ? provider : value));
  const updateVerificationProvider = (index: number, provider: VerificationProvider) => set("verification_provider_chain", (form.verification_provider_chain ?? []).map((value, current) => current === index ? provider : value));

  const writesMessage = form.write_message && form.approved_destination_type === "email_sequence" && !!form.approved_destination_id;
  // The column carries a CHECK: the key becomes both a {{custom_<key>}} token and
  // a crm_custom_field_defs.field_key, so an empty or half-typed box must not save.
  const normalizedIcebreakerFieldKey = /^[a-z][a-z0-9_]{0,62}$/.test(form.icebreaker_field_key?.trim() ?? "")
    ? form.icebreaker_field_key!.trim()
    : "icebreaker";
  const modelLabel = form.message_llm_model
    ? sortedModels.find((model) => model.id === form.message_llm_model)?.name
      ?? ollamaModels.find((model) => model.id === form.message_llm_model)?.name
      ?? form.message_llm_model
    : "workspace default model";

  // Everything that would stop this workflow from working, surfaced inline and
  // up front. Previously these were thrown one at a time from the save mutation,
  // so you fixed one, hit Save, and met the next.
  const blockingIssues: string[] = [];
  if (form.find_email && !(form.email_provider_chain?.length)) blockingIssues.push("Step 2 needs at least one email provider.");
  if (form.verify_email && !(form.verification_provider_chain?.length)) blockingIssues.push("Step 2 needs at least one verification provider.");
  if (form.verification_provider_chain?.includes("mailtester_ninja") && !hasMailtesterKey) blockingIssues.push("MailTester Ninja is selected but its API key is missing or invalid — add it in Settings.");
  if (form.analyze_icp && form.icp_llm_provider && !form.icp_llm_model) blockingIssues.push("Step 1 needs a model for the selected AI provider.");
  if (writesMessage && !form.message_prompt?.trim()) blockingIssues.push("Step 4 needs a creative brief for the AI.");
  if (writesMessage && !form.analyze_icp) blockingIssues.push("Step 4 needs step 1 (Qualify contacts) turned on — the AI writer runs on the company analysis it produces.");
  if (writesMessage && destinationEmailSteps === 0) blockingIssues.push("Step 4 has nothing to write: the destination sequence has no email steps.");
  if (form.write_icebreaker && !form.icebreaker_prompt?.trim()) blockingIssues.push("Step 5 needs a brief for the icebreaker.");
  if (form.write_icebreaker && !form.analyze_icp) blockingIssues.push("Step 5 needs step 1 (Qualify contacts) turned on — the icebreaker is written from the company analysis.");

  // Preview runs the REAL generation path (generate-email-sequence, preview
  // mode) against a real analyzed contact from this list, so what you read here
  // is what the workflow will actually send — not a generic sample.
  const runPreview = useMutation({
    mutationFn: async () => {
      // Read membership through the same SECURITY DEFINER RPC the list page
      // uses. A direct lead_list_members read is gated by an RLS policy keyed to
      // get_user_organization_id() — the user's single current org — so it
      // returns zero rows for a list the page is happily rendering.
      // Filter to analyzed contacts server-side (aiAnalysisStatus) rather than
      // scanning a page client-side — a big list often has its handful of
      // analyzed contacts well past the first page.
      // ai_analysis_status='analyzed' is NOT sufficient: a contact can carry
      // that flag with no analysis payload (a failed or pre-analysis import
      // that was still stamped analyzed — ~8% of them). generate-email-sequence
      // rejects those with 400, so apply its own gate here and pick a contact
      // that can actually be written for, rather than whichever comes first.
      type PreviewContact = {
        id: string;
        display_name: string | null;
        company: string | null;
        company_website?: string | null;
        primary_linkedin_url?: string | null;
        enrichment_data?: Record<string, unknown> | null;
      };
      const isWritable = (contact: PreviewContact) => {
        const enrichment = contact.enrichment_data;
        return !!enrichment && (!!enrichment.primary_need || !!enrichment.company_niche);
      };

      const fetchContacts = async (analyzedOnly: boolean, pageSize: number) => {
        const { data: rpcResult, error } = await supabase.rpc("filter_lead_list_members", {
          p_list_id: listId,
          p_filters: analyzedOnly ? { aiAnalysisStatus: "analyzed" } : {},
          p_page: 1,
          p_page_size: pageSize,
        });
        if (error) throw new Error(`Could not read this list's contacts: ${error.message}`);
        const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
        const members = (row?.members ?? []) as Array<{ contact?: PreviewContact }>;
        return members.map((member) => member.contact).filter(Boolean) as PreviewContact[];
      };

      // A brief that opens on a buying signal must be previewed against a
      // contact that HAS one. On a signal list the two populations barely
      // overlap — the signal contacts are typically the un-analyzed ones — so
      // picking the first writable contact lands on a signal-less contact every
      // time, every {{ai_signal_*}} token renders empty, and the preview reads
      // as "signal variables are broken" when the sequence is fine.
      // filter_lead_list_members doesn't return discovery_metadata (it would
      // bloat the list page's payload), so probe it separately for just the
      // candidates we're choosing between.
      const briefUsesSignalVariables = /\{\{\s*ai_signal_\w+\s*\}\}/i.test(form.message_prompt ?? "");
      const signalCarriers = async (contacts: PreviewContact[]): Promise<Set<string>> => {
        if (!briefUsesSignalVariables || contacts.length === 0) return new Set();
        const { data, error } = await supabase
          .from("crm_contacts")
          .select("id, discovery_metadata")
          .in("id", contacts.map((contact) => contact.id));
        // Non-fatal: a preview against an arbitrary contact still beats no preview.
        if (error) return new Set();
        return new Set(
          (data ?? [])
            .filter((row) => {
              const discovery = row.discovery_metadata as Record<string, unknown> | null;
              return !!discovery && Object.keys(discovery).length > 0;
            })
            .map((row) => row.id as string),
        );
      };

      const analyzed = await fetchContacts(true, 25);
      const analyzedWithSignal = await signalCarriers(analyzed);
      // When the brief opens on a signal, a writable contact WITHOUT one is not
      // an acceptable stand-in — prefer analysing a signal contact below over
      // previewing the wrong population.
      let sample = briefUsesSignalVariables
        ? analyzed.find((contact) => isWritable(contact) && analyzedWithSignal.has(contact.id)) ?? null
        : analyzed.find(isWritable) ?? null;

      if (!sample) {
        // Nothing analyzed yet is the normal state of a fresh list: configuring
        // step 1 doesn't run it. Rather than dead-ending on "run step 1 first",
        // run step 1 here — same function, same settings the workflow would
        // use. Analysis fails on plenty of individual contacts (dead site, JS
        // wall, parked domain), so walk down the list until one sticks instead
        // of reporting the first failure as if it were the list's verdict.
        setPreviewStep("analyzing");
        const pool = (await fetchContacts(false, 50))
          .filter((contact) => contact.company_website || contact.primary_linkedin_url);
        // Same reasoning as above: when the brief opens on a signal, spend the
        // analysis attempts on contacts that actually carry one.
        const poolWithSignal = await signalCarriers(pool);
        const candidates = poolWithSignal.size > 0
          ? [...pool].sort((a, b) => Number(poolWithSignal.has(b.id)) - Number(poolWithSignal.has(a.id)))
          : pool;
        if (candidates.length === 0) {
          const anyContact = await fetchContacts(false, 1);
          throw new Error(anyContact.length > 0
            ? "No contact in this list has a company website or LinkedIn URL, so step 1 has nothing to analyze. Enrich the list first."
            : "This list has no contacts to preview with.");
        }

        const attempts = candidates.slice(0, PREVIEW_ANALYSIS_ATTEMPTS);
        let lastFailure = "";
        for (const candidate of attempts) {
          setPreviewAnalyzing(candidate.display_name ?? candidate.company ?? "a contact");
          try {
            const { data: analysis, error: analysisError } = await supabase.functions.invoke("analyze-company", {
              body: {
                contactId: candidate.id,
                ...(form.icp_llm_model ? { model: form.icp_llm_model } : {}),
                ...(form.icp_product_id ? { productId: form.icp_product_id } : {}),
                ...(form.icp_ids?.length ? { icpIds: form.icp_ids } : {}),
              },
            });
            if (analysisError) throw new Error(await readFunctionError(analysisError));
            if (!analysis?.success) throw new Error(analysis?.error || "analysis returned no result");
          } catch (failure) {
            lastFailure = failure instanceof Error ? failure.message : String(failure);
            continue;
          }

          // Read the saved analysis back through the same RPC, so the
          // writability gate runs on what actually landed on the contact —
          // analyze-company reports success even when the crawl yielded
          // nothing the writer can use.
          const reanalyzed = await fetchContacts(true, 25);
          sample = reanalyzed.find((contact) => contact.id === candidate.id && isWritable(contact)) ?? null;
          if (sample) break;
          lastFailure = "the analysis came back empty (no primary need or niche)";
        }

        if (!sample) {
          throw new Error(`Step 1 ran on ${attempts.length} contact${attempts.length === 1 ? "" : "s"} from this list and none produced a usable analysis — last reason: ${lastFailure}. Their sites are probably uncrawlable.`);
        }
      }

      setPreviewStep("writing");
      const { data, error } = await supabase.functions.invoke("generate-email-sequence", {
        body: {
          contactId: sample.id,
          emailCount: Math.min(7, Math.max(1, destinationEmailSteps)),
          config: { prompt: form.message_prompt ?? "", ...(form.message_product_id ? { productId: form.message_product_id } : {}) },
          ...(form.message_llm_model ? { model: form.message_llm_model } : {}),
          ...(form.message_temperature !== null ? { temperature: form.message_temperature } : {}),
          preview: true,
        },
      });
      if (error) throw new Error(await readFunctionError(error));
      if (!data?.success) throw new Error(data?.error || "Could not generate a preview");
      return {
        contact: `${sample.display_name ?? "this contact"}${sample.company ? ` · ${sample.company}` : ""}`,
        resolvedPrompt: String(data.resolvedPrompt ?? form.message_prompt ?? ""),
        variableResolutions: (data.variableResolutions ?? []) as PreviewVariableResolution[],
        emails: (data.emails ?? []) as Array<{ subject: string; body: string }>,
      };
    },
    onMutate: () => { setPreview(null); setPreviewError(null); setPreviewStep("writing"); setPreviewAnalyzing(null); },
    onSettled: () => { setPreviewStep(null); setPreviewAnalyzing(null); },
    onSuccess: (result) => setPreview(result),
    onError: (error: Error) => setPreviewError(error.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      if (isEditLocked) throw new Error("Pause this workflow and wait for active contacts to park before saving changes");
      // Backstop only — blockingIssues is rendered inline and disables Save.
      if (blockingIssues.length) throw new Error(blockingIssues[0]);
      const db = supabase as unknown as ProcessingDatabase;
      const { data, error } = await db.from("lead_list_processing_policies").upsert({ organization_id: currentOrganization.id, lead_list_id: listId, ...form, min_icp_score: form.analyze_icp ? form.min_icp_score : null, require_valid_email: form.verify_email ? form.require_valid_email : false, write_message: writesMessage, icebreaker_field_key: normalizedIcebreakerFieldKey, email_provider: form.email_provider_chain?.[0] ?? null, verification_provider: form.verification_provider_chain?.[0] ?? "lite", updated_at: new Date().toISOString() }, { onConflict: "lead_list_id" }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-policy", currentOrganization?.id, listId] });
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-policy-summary", currentOrganization?.id, listId] });
      if (form.enabled && isSmartList && (matchingCount ?? 0) > 0 && form.approved_destination_type !== "none" && onRunExisting) {
        toast.success("Workflow saved — " + matchingCount!.toLocaleString() + " existing contacts can run now.", {
          action: { label: "Run existing now", onClick: () => onRunExisting() },
          duration: 8000,
        });
      } else {
        toast.success(
          form.enabled
            ? "Workflow saved — new contacts run automatically. Use Start workflow to run the contacts already in this list."
            : "Workflow saved",
        );
      }
      setOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline"><Bot className="h-4 w-4 mr-2" />Enrich &amp; enroll</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" />Enrich &amp; enroll</DialogTitle><DialogDescription>Configure how contacts from {listName} are qualified, enriched, and enrolled.</DialogDescription></DialogHeader>
      {policy.isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div> : policy.isError ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">Enrich &amp; enroll is not available until its database migration has been applied.</div> : <div className="flex flex-col gap-3 py-2">
        {isEditLocked && (
          <div className="flex items-start justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <div className="flex min-w-0 gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">{isParking ? "Waiting for active contacts to park" : "Pause before changing this workflow"}</p>
                <p className="mt-1 text-sm text-amber-900/80">
                  {isParking
                    ? `${processingStatus?.processing.toLocaleString()} active contact${processingStatus?.processing === 1 ? " is" : "s are"} finishing the current provider call. Editing unlocks automatically when they stop.`
                    : "Saving new steps during a run would make contacts use different configurations. Pausing preserves every contact's current stage."}
                </p>
              </div>
            </div>
            {!processingStatus?.isPaused && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-amber-400 bg-background"
                onClick={() => pauseProcessing.mutate({ listId }, {
                  onSuccess: () => toast.success("Workflow is pausing. Editing will unlock when active contacts park."),
                  onError: (error) => toast.error(error instanceof Error ? error.message : "Could not pause workflow"),
                })}
                disabled={pauseProcessing.isPending}
              >
                {pauseProcessing.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Pause className="mr-1.5 h-4 w-4" />}
                Pause to edit
              </Button>
            )}
          </div>
        )}
        <WorkflowStrip steps={[
          { label: "Qualify", on: form.analyze_icp, detail: "Research the company and score ICP fit" },
          ...(emailStrategy === "verify_then_recover"
            ? [{ label: "Verify email", on: true, detail: "Check the existing address" }, { label: "Find email", on: true, detail: "Search when missing or invalid" }]
            : [{ label: "Find email", on: form.find_email, detail: "Search for a work email" }, { label: "Verify email", on: form.verify_email, detail: "Check deliverability" }]),
          { label: "Write emails", on: writesMessage, detail: "AI writes a sequence per contact" },
          { label: "Icebreaker", on: form.write_icebreaker, detail: `AI writes one line into {{custom_${form.icebreaker_field_key || "icebreaker"}}}` },
          { label: "Home page text", on: form.fetch_home_page_text, detail: "Look up company home page text via QuickEnrich" },
          { label: "Enroll", on: form.approved_destination_type !== "none", detail: "Send ready contacts to the destination" },
        ]} />
        <div className="flex items-center justify-between gap-4 rounded-md border border-primary/30 bg-primary/5 p-4"><div><Label htmlFor="processing-enabled" className="text-base">Run new contacts automatically</Label><p className="mt-1 text-sm text-muted-foreground">New contacts entering this list use this workflow. To run contacts already here, filter and select them, then use Actions.</p></div><Switch id="processing-enabled" checked={form.enabled} onCheckedChange={(value) => set("enabled", value)} /></div>
        <WorkflowSection number={1} icon={Sparkles} title="Qualify contacts" description="Optional: stop poor ICP matches before enrichment."
          summary={[
            products.find((product) => product.id === form.icp_product_id)?.name ?? icps.find((icp) => icp.id === form.icp_ids[0])?.name ?? "No product context",
            form.min_icp_score !== null ? `min score ${form.min_icp_score}` : "no score threshold",
            form.analyze_when === "if_stale" ? `reuse analyses under ${form.analysis_freshness_days}d old` : "re-analyze every contact",
          ].join(" · ")}
          open={!!openSections[1]} onOpenChange={() => toggleSection(1)}
          enabled={form.analyze_icp} onEnabledChange={(value) => set("analyze_icp", value)}>
          <div className="grid gap-3 sm:grid-cols-2"><Select value={form.icp_product_id || "none"} onValueChange={(value) => set("icp_product_id", value === "none" ? null : value)}><SelectTrigger><SelectValue placeholder="Product context" /></SelectTrigger><SelectContent><SelectItem value="none">No product context</SelectItem>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent></Select><Select value={form.icp_ids[0] || "none"} onValueChange={(value) => set("icp_ids", value === "none" ? [] : [value])}><SelectTrigger><SelectValue placeholder="ICP" /></SelectTrigger><SelectContent><SelectItem value="none">Use product ICPs</SelectItem>{icps.map((icp) => <SelectItem key={icp.id} value={icp.id}>{icp.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label className="text-sm">AI provider</Label><Select value={selectedLlmProvider} onValueChange={(provider) => { set("icp_llm_provider", provider === "default" ? null : provider); set("icp_llm_model", null); }}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">Workspace default</SelectItem>{llmProviders.map((provider) => <SelectItem key={provider} value={provider}>{LLM_PROVIDER_LABELS[provider] ?? provider}</SelectItem>)}</SelectContent></Select></div><div><Label className="text-sm">Model</Label><Select value={form.icp_llm_model || "none"} disabled={selectedLlmProvider === "default" || isLoadingModels} onValueChange={(model) => set("icp_llm_model", model === "none" ? null : model)}><SelectTrigger className="mt-2"><SelectValue placeholder={isLoadingModels ? "Loading models" : "Choose a model"} /></SelectTrigger><SelectContent><SelectItem value="none">Choose a model</SelectItem>{providerModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.name || model.id}</SelectItem>)}</SelectContent></Select></div></div>
          {!hasOpenRouterKey && !hasOllamaKey && <p className="text-sm text-amber-700">Connect OpenRouter or Ollama in Settings to choose an LLM provider and model.</p>}
          <div className="flex flex-wrap items-center gap-3"><Label htmlFor="min-score">Minimum score to continue</Label><Input id="min-score" type="number" min="0" max="100" className="w-20" value={form.min_icp_score ?? ""} onChange={(event) => set("min_icp_score", event.target.value === "" ? null : Number(event.target.value))} /><span className="text-sm text-muted-foreground">Blank means every contact continues.</span></div>
          <div className="border-t pt-4">
            <Label className="text-sm">When to analyze</Label>
            <Select value={form.analyze_when} onValueChange={(value) => set("analyze_when", value as "always" | "if_stale")}>
              <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="if_stale">Reuse a recent analysis (recommended)</SelectItem>
                <SelectItem value="always">Re-analyze every contact</SelectItem>
              </SelectContent>
            </Select>
            {form.analyze_when === "if_stale" && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Trust analyses from the last</span>
                <Input type="number" min={1} max={3650} className="w-20" value={form.analysis_freshness_days}
                  onChange={(event) => set("analysis_freshness_days", Math.max(1, Math.min(3650, Number(event.target.value) || 30)))} />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Reusing skips the website crawl, the LinkedIn fetch and the AI call for a contact that already has research from the same product and ICPs. Re-running a qualified list costs nothing.
            </p>
          </div>
          {form.min_icp_score !== null && <OutcomeDestination label="Contact does not meet the ICP score" type={form.low_icp_destination_type} id={form.low_icp_destination_id} lists={recoveryLists} campaigns={selectableLinkedInCampaigns} onChange={(type, id) => { set("low_icp_destination_type", type); set("low_icp_destination_id", id); }} />}
          <OutcomeDestination label="No company or LinkedIn data is available" type={form.no_source_data_destination_type} id={form.no_source_data_destination_id} lists={recoveryLists} campaigns={selectableLinkedInCampaigns} onChange={(type, id) => { set("no_source_data_destination_type", type); set("no_source_data_destination_id", id); }} />
        </WorkflowSection>
        <WorkflowSection number={2} icon={MailSearch} title="Get a usable email" description="Choose the order and the fallback behavior for this list."
          summary={emailStrategy === "none" ? "Skipped — contacts continue without an email step" : [
            { find_only: "Find only", verify_only: "Verify only", find_then_verify: "Find, then verify", verify_then_recover: "Verify, recover if invalid", none: "" }[emailStrategy],
            ...(form.find_email && form.email_provider_chain?.length ? [form.email_provider_chain.map((provider) => ENRICHMENT_LABELS[provider]).join(" → ")] : []),
            ...(form.verify_email && form.verification_provider_chain?.length ? [form.verification_provider_chain.map((provider) => VERIFICATION_LABELS[provider]).join(" → ")] : []),
          ].join(" · ")}
          open={!!openSections[2]} onOpenChange={() => toggleSection(2)}>
          <div><Label className="text-sm">Email workflow</Label><Select value={emailStrategy} onValueChange={(value) => setEmailStrategy(value as EmailStrategy)}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Skip the email step</SelectItem><SelectItem value="find_only">Find a work email only</SelectItem><SelectItem value="verify_only">Verify the current email only</SelectItem><SelectItem value="find_then_verify">Find a work email, then verify it</SelectItem><SelectItem value="verify_then_recover">Verify existing; find if missing or invalid</SelectItem></SelectContent></Select><p className="mt-2 text-sm text-muted-foreground">{emailStrategy === "verify_then_recover" ? "If no email exists, enrichment starts immediately. Existing valid emails continue; invalid emails trigger replacement enrichment." : emailStrategy === "find_then_verify" ? "Providers find an email first, then verifiers check it before the contact continues." : emailStrategy === "find_only" ? "Enrichment runs only when a work email is missing." : emailStrategy === "verify_only" ? "The current email is checked without searching for a replacement." : "Contacts continue without finding or verifying an email."}</p></div>
          {needsVerification && emailStrategy === "verify_then_recover" && <div className="border-t pt-4"><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /><div><Label>If an email exists: verify it</Label><p className="text-xs text-muted-foreground">Contacts without an email skip this check and go directly to email finding.</p></div></div>{(form.verification_provider_chain ?? []).map((provider, index) => <div key={`${provider}-${index}`} className="mb-2 flex items-center gap-2"><span className="w-9 text-xs text-muted-foreground">{index === 0 ? "Try" : "Then"}</span><Select value={provider} onValueChange={(value) => updateVerificationProvider(index, value as VerificationProvider)}><SelectTrigger className="flex-1"><SelectValue /></SelectTrigger><SelectContent>{(["lite", "apify_million_verifier", "mailtester_ninja"] as VerificationProvider[]).map((option) => <SelectItem key={option} value={option}>{VERIFICATION_LABELS[option]}</SelectItem>)}</SelectContent></Select>{index > 0 && <Button variant="ghost" size="icon" aria-label="Remove verification provider" onClick={() => set("verification_provider_chain", (form.verification_provider_chain ?? []).filter((_, current) => current !== index))}><X className="h-4 w-4" /></Button>}</div>)}{(form.verification_provider_chain?.length ?? 0) < 3 && <Button variant="outline" size="sm" onClick={() => { const next = (["lite", "apify_million_verifier", "mailtester_ninja"] as VerificationProvider[]).find((provider) => !(form.verification_provider_chain ?? []).includes(provider)); if (next) set("verification_provider_chain", [...(form.verification_provider_chain ?? []), next]); }}><Plus className="mr-1 h-4 w-4" />Add fallback verifier</Button>}</div>}
          {needsEmailFinding && <div className="border-t pt-4"><div className="mb-3 flex items-center gap-2"><MailSearch className="h-4 w-4 text-primary" /><div><Label>{emailStrategy === "verify_then_recover" ? "If missing or invalid: find a work email" : "Find a work email"}</Label><p className="text-xs text-muted-foreground">Fallback providers run in order only when the previous one finds nothing.</p></div></div>{(form.email_provider_chain ?? []).map((provider, index) => <div key={`${provider}-${index}`} className="mb-2 flex items-center gap-2"><span className="w-9 text-xs text-muted-foreground">{index === 0 ? "Try" : "Then"}</span><Select value={provider} onValueChange={(value) => updateEmailProvider(index, value as EnrichmentProvider)}><SelectTrigger className="flex-1"><SelectValue /></SelectTrigger><SelectContent>{configuredEnrichmentProviders.map((option) => <SelectItem key={option} value={option}>{ENRICHMENT_LABELS[option]}</SelectItem>)}</SelectContent></Select><Button variant="ghost" size="icon" aria-label={`Remove ${ENRICHMENT_LABELS[provider]}`} onClick={() => set("email_provider_chain", (form.email_provider_chain ?? []).filter((_, current) => current !== index))}><X className="h-4 w-4" /></Button></div>)}<Button variant="outline" size="sm" disabled={configuredEnrichmentProviders.length === 0 || (form.email_provider_chain?.length ?? 0) >= configuredEnrichmentProviders.length} onClick={() => { const next = configuredEnrichmentProviders.find((provider) => !(form.email_provider_chain ?? []).includes(provider)); if (next) set("email_provider_chain", [...(form.email_provider_chain ?? []), next]); }}><Plus className="mr-1 h-4 w-4" />Add fallback provider</Button>{configuredEnrichmentProviders.length === 0 && <p className="mt-2 text-sm text-amber-700">Connect Apollo, Hunter, Prospeo, or MoltSets in Settings before using email finding.</p>}<div className="mt-4"><OutcomeDestination label="No work email can be found" type={form.no_email_destination_type} id={form.no_email_destination_id} lists={recoveryLists} campaigns={selectableLinkedInCampaigns} onChange={(type, id) => { set("no_email_destination_type", type); set("no_email_destination_id", id); set("no_email_list_id", type === "list" ? id : null); }} /></div></div>}
          {needsVerification && emailStrategy !== "verify_then_recover" && <div className="border-t pt-4"><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /><div><Label>{emailStrategy === "find_then_verify" ? "Then: verify deliverability" : "Verify deliverability"}</Label><p className="text-xs text-muted-foreground">Fallback verifiers run in order until one returns valid.</p></div></div>{(form.verification_provider_chain ?? []).map((provider, index) => <div key={`${provider}-${index}`} className="mb-2 flex items-center gap-2"><span className="w-9 text-xs text-muted-foreground">{index === 0 ? "Try" : "Then"}</span><Select value={provider} onValueChange={(value) => updateVerificationProvider(index, value as VerificationProvider)}><SelectTrigger className="flex-1"><SelectValue /></SelectTrigger><SelectContent>{(["lite", "apify_million_verifier", "mailtester_ninja"] as VerificationProvider[]).map((option) => <SelectItem key={option} value={option}>{VERIFICATION_LABELS[option]}</SelectItem>)}</SelectContent></Select>{index > 0 && <Button variant="ghost" size="icon" aria-label="Remove verification provider" onClick={() => set("verification_provider_chain", (form.verification_provider_chain ?? []).filter((_, current) => current !== index))}><X className="h-4 w-4" /></Button>}</div>)}{(form.verification_provider_chain?.length ?? 0) < 3 && <Button variant="outline" size="sm" onClick={() => { const next = (["lite", "apify_million_verifier", "mailtester_ninja"] as VerificationProvider[]).find((provider) => !(form.verification_provider_chain ?? []).includes(provider)); if (next) set("verification_provider_chain", [...(form.verification_provider_chain ?? []), next]); }}><Plus className="mr-1 h-4 w-4" />Add fallback verifier</Button>}</div>}
          {needsVerification && (form.verification_provider_chain ?? []).includes("mailtester_ninja") && !hasMailtesterKey && <p className="text-sm text-amber-700">Connect a valid MailTester Ninja key in Settings before saving.</p>}
          {needsVerification && emailStrategy !== "verify_then_recover" && <div className="border-t pt-4"><Label className="text-sm">When to verify</Label><Select value={form.verify_when} onValueChange={(value) => set("verify_when", value as "always" | "if_stale")}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="always">Verify every email</SelectItem><SelectItem value="if_stale">Only verify stale emails (trust freshly-validated ones)</SelectItem></SelectContent></Select>{form.verify_when === "if_stale" && <div className="mt-2 flex items-center gap-2"><span className="text-sm text-muted-foreground">Trust emails validated within</span><Input type="number" min={1} max={3650} value={form.verify_freshness_days} onChange={(event) => set("verify_freshness_days", Math.max(1, Math.min(3650, Number(event.target.value) || 30)))} className="w-20" /><span className="text-sm text-muted-foreground">days</span></div>}<p className="mt-2 text-xs text-muted-foreground">MoltSets returns a last-validated date, not a confidence score. Freshly-validated addresses are trusted and skip the verifier; stale or never-validated ones are verified before enrolling — saving verifier credits.</p></div>}
          {needsVerification && emailStrategy !== "verify_then_recover" && <div className="flex items-center gap-2 border-t pt-4"><Checkbox id="require-valid" checked={form.require_valid_email} onCheckedChange={(value) => set("require_valid_email", value === true)} /><Label htmlFor="require-valid">Only deliverable emails can continue to an email sequence</Label></div>}
          {needsVerification && emailStrategy !== "verify_then_recover" && form.require_valid_email && <OutcomeDestination label="No deliverable email remains" type={form.unverified_email_destination_type} id={form.unverified_email_destination_id} lists={recoveryLists} campaigns={selectableLinkedInCampaigns} onChange={(type, id) => { set("unverified_email_destination_type", type); set("unverified_email_destination_id", id); set("unverified_email_list_id", type === "list" ? id : null); }} />}
        </WorkflowSection>
        <WorkflowSection number={3} icon={Send} title="Choose the ready-contact destination" description="This runs as soon as a contact passes the enabled checks."
          summary={form.approved_destination_type === "none" || !form.approved_destination_id
            ? "No automatic enrollment"
            : form.approved_destination_type === "email_sequence"
              ? `Email sequence: ${destinationSequence?.name ?? "selected sequence"}${destinationEmailSteps ? ` (${destinationEmailSteps} email${destinationEmailSteps === 1 ? "" : "s"})` : ""}`
              : `LinkedIn campaign: ${campaigns.find((campaign) => campaign.id === form.approved_destination_id)?.name ?? "selected campaign"}`}
          open={!!openSections[3]} onOpenChange={() => toggleSection(3)}>
          <ApprovedDestination type={form.approved_destination_type} id={form.approved_destination_id} sequences={selectableSequences} campaigns={selectableLinkedInCampaigns} onChange={(type, id) => { set("approved_destination_type", type); set("approved_destination_id", id); set("sequence_id", type === "email_sequence" ? id : null); }} />
          <p className="flex items-center gap-1 text-xs text-muted-foreground"><CircleCheck className="h-3.5 w-3.5 text-emerald-600" />Choose an email sequence or a LinkedIn campaign. Each contact is sent as soon as it is ready.</p>
        </WorkflowSection>
        <WorkflowSection number={4} icon={PenLine} title="Write the emails with AI"
          description={form.approved_destination_type === "email_sequence" && form.approved_destination_id
            ? "Each contact gets its own sequence, written just before it is enrolled."
            : "Pick an email sequence in step 3 to turn this on."}
          summary={writesMessage ? `${destinationEmailSteps} email${destinationEmailSteps === 1 ? "" : "s"} per contact · ${modelLabel}${form.message_product_id ? ` · ${products.find((product) => product.id === form.message_product_id)?.name}` : ""}` : undefined}
          open={!!openSections[4]} onOpenChange={() => toggleSection(4)}
          enabled={form.write_message && form.approved_destination_type === "email_sequence"}
          onEnabledChange={form.approved_destination_type === "email_sequence" && form.approved_destination_id
            ? (value) => setForm((current) => ({ ...current, write_message: value, message_prompt: value ? current.message_prompt ?? DEFAULT_MESSAGE_PROMPT : current.message_prompt }))
            : undefined}>
          <div className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
            {destinationEmailSteps > 0
              ? <>“{destinationSequence?.name}” has {destinationEmailSteps} email step{destinationEmailSteps === 1 ? "" : "s"}, so the AI writes {destinationEmailSteps}. Reference them in the sequence as <code className="rounded bg-background px-1">{"{{email_subject_1}}"}</code> / <code className="rounded bg-background px-1">{"{{email_body_1}}"}</code> through <code className="rounded bg-background px-1">{`{{email_body_${destinationEmailSteps}}}`}</code>.</>
              : <>“{destinationSequence?.name}” has no email steps yet. Add at least one before enabling AI writing.</>}
          </div>
          {destinationEmailSteps > 0 && !destinationUsesGeneratedEmails && (
            <p className="text-sm text-amber-700">None of this sequence’s steps use <code>{"{{email_subject_N}}"}</code> or <code>{"{{email_body_N}}"}</code>, so the generated emails would be stored but never sent. Edit the sequence steps to use those variables.</p>
          )}
          <div>
            <Label className="text-sm">Product context</Label>
            <Select value={form.message_product_id || "none"} onValueChange={(value) => set("message_product_id", value === "none" ? null : value)}>
              <SelectTrigger className="mt-2"><SelectValue placeholder="No product context" /></SelectTrigger>
              <SelectContent><SelectItem value="none">No product context</SelectItem>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent>
            </Select>
            <p className="mt-1.5 text-xs text-muted-foreground">Injects what you sell — benefits, pain points, proven hooks — into the brief.</p>
          </div>
          <PromptEditor
            label="Creative brief"
            messageType="emailSequence"
            emailCount={destinationEmailSteps || undefined}
            showTest={false}
            infoText={`One brief, ${destinationEmailSteps || "N"} emails per contact — the AI decides the angle of each. Use {{variables}} for the details.`}
            value={form.message_prompt ?? ""}
            onChange={(value) => set("message_prompt", value)}
            llmModel={form.message_llm_model ?? undefined}
            onModelChange={(model) => set("message_llm_model", model)}
            llmTemperature={form.message_temperature ?? undefined}
            onTemperatureChange={(temperature) => set("message_temperature", temperature)}
          />
          {/* Preview runs the real generator against a real contact from this
              list, so it shows every email the sequence will send — not one
              generic sample. Nothing is saved. */}
          <div className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Label className="text-sm">Preview on a real contact</Label>
                <p className="text-xs text-muted-foreground">Writes all {destinationEmailSteps || "the"} emails for someone in this list. If nobody has been analyzed yet, step 1 runs on one contact first. Nothing is saved or sent.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => runPreview.mutate()} disabled={!form.message_prompt?.trim() || destinationEmailSteps === 0 || runPreview.isPending}>
                {runPreview.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-1.5 h-4 w-4" />}
                {runPreview.isPending ? (previewStep === "analyzing" ? "Analyzing…" : "Writing…") : "Preview"}
              </Button>
            </div>
            {previewStep === "analyzing" && <p className="mt-2 text-xs text-muted-foreground">Nobody in this list is analyzed yet — running step 1 on {previewAnalyzing ?? "a contact"} first. If it can't be analyzed, the next contact is tried. This takes a minute.</p>}
            {previewError && <p className="mt-2 text-sm text-amber-700">{previewError}</p>}
            {preview && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">Written for {preview.contact}</p>
                <ResolvedBriefInspector preview={preview} />
                {preview.emails.map((email, index) => (
                  <div key={index} className="rounded-md bg-muted/50 p-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Email {index + 1}</p>
                    <p className="mt-1 text-sm font-medium">{email.subject}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{htmlToPlainText(email.body)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          {!form.analyze_icp && (
            <p className="text-sm text-amber-700">Turn on “Qualify contacts” above — the AI writer needs the company analysis it produces ({"{{ai_primary_need}}"} and friends). Without it, every contact is rejected.</p>
          )}
        </WorkflowSection>
        <WorkflowSection number={5} icon={Sparkles} title="Write an icebreaker with AI"
          description="One line stored on the contact, for copy you write yourself."
          summary={form.write_icebreaker ? `{{custom_${form.icebreaker_field_key || "icebreaker"}}}` : undefined}
          open={!!openSections[5]} onOpenChange={() => toggleSection(5)}
          enabled={form.write_icebreaker}
          onEnabledChange={(value) => setForm((current) => ({
            ...current,
            write_icebreaker: value,
            icebreaker_prompt: value ? current.icebreaker_prompt ?? DEFAULT_ICEBREAKER_PROMPT : current.icebreaker_prompt,
            // A policy saved before this step existed has a null model; without
            // this the picker would show the slow workspace default while the
            // worker quietly ran the fast one.
            icebreaker_llm_model: value ? current.icebreaker_llm_model ?? DEFAULT_ICEBREAKER_MODEL : current.icebreaker_llm_model,
          }))}>
          <div className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
            Each contact gets one AI-written line, saved on the contact itself. Use it anywhere — email steps, LinkedIn messages — as <code className="rounded bg-background px-1">{`{{custom_${form.icebreaker_field_key || "icebreaker"}}}`}</code>:
            <span className="mt-1.5 block font-mono text-[11px] text-foreground">Hey {"{{first_name}}"} — {`{{custom_${form.icebreaker_field_key || "icebreaker"}}}`}</span>
          </div>
          {/* The contrast with step 4 is the whole point of this step existing:
              {{email_body_N}} makes a sequence enrollable ONLY by lead processing,
              a custom field leaves every enrollment path working. */}
          <p className="text-xs text-muted-foreground">
            Unlike step 4, this leaves the sequence normally enrollable from anywhere — auto-enroll, bulk enroll and the API all keep working, and a contact with no icebreaker just sends the rest of the email.
          </p>
          <div>
            <Label className="text-sm">Custom field</Label>
            <Input className="mt-2" value={form.icebreaker_field_key ?? ""} placeholder="icebreaker"
              onChange={(event) => set("icebreaker_field_key", event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
            <p className="mt-1.5 text-xs text-muted-foreground">Created on first run if it doesn’t exist. Set a fallback for contacts without one in Settings › Custom Fields.</p>
          </div>
          <PromptEditor
            label="Icebreaker brief"
            messageType="email"
            showTest={false}
            infoText="Ask for ONE sentence with no greeting and no CTA — it lands inside copy you wrote. Only the first sentence is kept, whatever the model returns. Use {{variables}} for the details."
            value={form.icebreaker_prompt ?? ""}
            onChange={(value) => set("icebreaker_prompt", value)}
            llmModel={form.icebreaker_llm_model ?? undefined}
            onModelChange={(model) => set("icebreaker_llm_model", model)}
            llmTemperature={form.icebreaker_temperature ?? undefined}
            onTemperatureChange={(temperature) => set("icebreaker_temperature", temperature)}
          />
          {!form.analyze_icp && (
            <p className="text-sm text-amber-700">Turn on “Qualify contacts” above — the icebreaker is written from the company analysis it produces.</p>
          )}
        </WorkflowSection>
        <WorkflowSection number={6} icon={Globe} title="Fetch home page text"
          description="Look up each contact's company home page copy via QuickEnrich."
          summary={form.fetch_home_page_text ? "{{home_page_text}}" : undefined}
          open={!!openSections[6]} onOpenChange={() => toggleSection(6)}
          enabled={form.fetch_home_page_text}
          onEnabledChange={(value) => set("fetch_home_page_text", value)}>
          <div className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
            Costs 1 QuickEnrich credit per company looked up. Stored on the contact as a standard field — usable anywhere as <code className="rounded bg-background px-1">{"{{home_page_text}}"}</code>. Skipped for contacts without a company website. Requires QuickEnrich configured in Settings › API Keys.
          </div>
        </WorkflowSection>
        {blockingIssues.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
            <p className="text-sm font-semibold">Fix before saving</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-amber-900/90">
              {blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        )}
      </div>}
      <DialogFooter><Button variant="cta" onClick={() => save.mutate()} disabled={policy.isError || save.isPending || isEditLocked || blockingIssues.length > 0}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save workflow<ChevronRight className="h-4 w-4 ml-1" /></Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
