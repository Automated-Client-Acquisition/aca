import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useStartCompanyAnalysis } from "@/hooks/useCompanyAnalysisJobs";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";
import { DEFAULT_LLM_MODEL } from "@/lib/llm-models";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import {
  UserPlus,
  MessageSquare,
  Mail,
  Clock,
  GitBranch,
  Send,
  Eye,
  Heart,
  UserCheck,
  Zap,
  MessageCircle,
  CheckCircle2,
  Circle,
  ExternalLink,
  Inbox,
  XCircle,
  AlertCircle,
  Search,
  CalendarClock,
  FileText,
  Sparkles,
  ArrowRight,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import type { CampaignLeadProgress, ProgressStatus, CampaignActionLog } from "@/hooks/useCampaignProgress";
import { NODE_TYPE_CONFIGS, getOrderedExecutionPath, isFilteredOut } from "@/lib/sequence-utils";
import type { SequenceNodeType } from "@/lib/sequence-utils";

interface CampaignLeadDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: CampaignLeadProgress | null;
  campaignId: string;
  sequenceNodes: any[];
  sequenceEdges?: any[];
}

const STATUS_CONFIG: Record<ProgressStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-gray-500/10 text-gray-500 border-gray-500/20" },
  in_progress: { label: "In Progress", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  waiting: { label: "Waiting", color: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  completed: { label: "Completed", color: "bg-green-500/10 text-green-600 border-green-500/20" },
  failed: { label: "Failed", color: "bg-red-500/10 text-red-600 border-red-500/20" },
  replied: { label: "Replied", color: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
  skipped: { label: "Skipped", color: "bg-slate-500/10 text-slate-500 border-slate-500/20" },
  handed_off: { label: "Handed Off", color: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20" },
  pending_review: { label: "Awaiting Review", color: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
  sender_disconnected: { label: "Sender Disconnected", color: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
};

const NODE_ICONS: Record<string, typeof Mail> = {
  connectionRequest: UserPlus,
  message: MessageSquare,
  inmail: Mail,
  email: Mail,
  delay: Clock,
  conditionConnection: GitBranch,
  conditionReplyReceived: GitBranch,
  conditionChannelAvailable: GitBranch,
  routeByChannel: GitBranch,
  conditionEmailOpened: Eye,
  conditionEmailClicked: Eye,
  switchChannel: Zap,
  whatsappMessage: MessageCircle,
  instagramDm: MessageCircle,
  telegramMessage: Send,
  viewProfile: Eye,
  follow: UserCheck,
  likePost: Heart,
  warmupEngagement: Heart,
  sendToSmartlead: Send,
  sendToInstantly: Send,
  sendToLeadConnector: Send,
  sendToZapMail: Send,
  scheduleMeeting: CalendarClock,
  findEmail: Search,
  createNotionPage: FileText,
  analyzeContact: Sparkles,
};

function getNodeColor(nodeType: string): string {
  switch (nodeType) {
    case "connectionRequest":
      return "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400";
    case "message":
    case "inmail":
      return "bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400";
    case "email":
      return "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400";
    case "delay":
      return "bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-400";
    case "conditionConnection":
    case "conditionReplyReceived":
    case "conditionChannelAvailable":
    case "routeByChannel":
    case "conditionEmailOpened":
    case "conditionEmailClicked":
      return "bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400";
    case "viewProfile":
      return "bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400";
    case "follow":
    case "warmupEngagement":
    case "likePost":
      return "bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400";
    case "whatsappMessage":
      return "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400";
    case "instagramDm":
      return "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400";
    case "telegramMessage":
      return "bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400";
    case "switchChannel":
      return "bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400";
    case "analyzeContact":
    case "sendToSmartlead":
    case "sendToInstantly":
    case "sendToLeadConnector":
    case "sendToZapMail":
    case "scheduleMeeting":
    case "findEmail":
    case "createNotionPage":
      return "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400";
  }
}

function getHandleLabel(handle: string): string {
  switch (handle) {
    case "notAccepted": return "Not Accepted";
    case "noReply": return "No Reply";
    case "notAvailable": return "Not Available";
    case "hasWhatsapp": return "Has WhatsApp";
    case "noWhatsapp": return "No WhatsApp";
    case "notOpened": return "Not Opened";
    case "notClicked": return "Not Clicked";
    case "notEnriched": return "Not Enriched";
    case "notAnalyzed": return "Not Analyzed";
    case "clean": return "Valid Email";
    case "risky": return "Risky Email";
    case "failed": return "Invalid Email";
    case "pass": return "Meets Threshold";
    case "fail": return "Below Threshold";
    case "linkedin": return "LinkedIn";
    case "whatsapp": return "WhatsApp";
    case "none": return "No channel";
    default: return handle.charAt(0).toUpperCase() + handle.slice(1);
  }
}

function getConditionResult(actionLog: CampaignActionLog | undefined): string | null {
  if (!actionLog?.error_message) return null;
  const match = actionLog.error_message.match(/^condition_result=(.+)$/);
  return match ? match[1] : null;
}

const POSITIVE_HANDLES = new Set([
  "accepted", "replied", "open", "available", "opened", "clicked",
  "hasWhatsapp", "enriched", "analyzed", "clean", "pass",
  // Route by Channel picked a channel
  "linkedin", "email", "instagram", "whatsapp", "telegram",
]);

function buildVariableMap(
  contact: Record<string, any> | null,
  generatedData?: Record<string, string> | null,
  customFieldDefaults?: Record<string, string>
): Record<string, string> {
  if (!contact) {
    const map: Record<string, string> = {};
    if (customFieldDefaults) {
      for (const [key, value] of Object.entries(customFieldDefaults)) {
        map[`custom_${key}`] = value;
      }
    }
    return map;
  }
  const enrichment = contact.enrichment_data || {};
  const map: Record<string, string> = {
    first_name: contact.first_name || "",
    last_name: contact.last_name || "",
    full_name:
      [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
      contact.display_name || "",
    email: contact.primary_email || "",
    company: contact.company || "",
    job_title: contact.job_title || "",
    headline: enrichment.headline || "",
    location: contact.city || "",
    industry: enrichment.industry || "",
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
  // fallback in campaign-processor / workflow-utils.
  if (customFieldDefaults) {
    for (const [key, value] of Object.entries(customFieldDefaults)) {
      const varName = `custom_${key}`;
      if (!(varName in map)) map[varName] = value;
    }
  }

  // Overlay generated email data from generateEmails node (campaign_lead_progress.generated_data)
  if (generatedData) {
    for (const [key, value] of Object.entries(generatedData)) {
      if (value) map[key] = value;
    }
  }

  return map;
}

function resolveVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (_match, varName: string) => {
    const lower = varName.toLowerCase();
    const snake = lower.replace(/([A-Z])/g, "_$1").toLowerCase();
    if (varName in vars && vars[varName]) return vars[varName];
    if (lower in vars && vars[lower]) return vars[lower];
    if (snake in vars && vars[snake]) return vars[snake];
    return `{{${varName}}}`;
  });
}

function getMessageFromNode(node: any): { message?: string; subject?: string; isAI?: boolean } {
  const data = node.data || {};
  const type = node.type as string;

  if (data.messageMode === "prompt") {
    return { message: data.prompt, isAI: true };
  }

  if (type === "inmail") {
    return { subject: data.subject, message: data.message };
  }

  if (type === "email") {
    return { subject: data.subject || data.emailSubject, message: data.body || data.emailBody };
  }

  if (["sendToSmartlead", "sendToInstantly", "sendToLeadConnector", "sendToZapMail"].includes(type)) {
    if (data.messageMode === "prompt") {
      return { message: data.prompt, isAI: true };
    }
    return { subject: data.emailSubject, message: data.emailBody };
  }

  if (data.message) {
    return { message: data.message };
  }

  return {};
}

function getDelayLabel(node: any): string {
  const data = node.data || {};
  const parts: string[] = [];
  if (data.days) parts.push(`${data.days}d`);
  if (data.hours) parts.push(`${data.hours}h`);
  if (data.minutes) parts.push(`${data.minutes}m`);
  return parts.length > 0 ? parts.join(" ") : "1d";
}

export function CampaignLeadDetailSheet({
  open,
  onOpenChange,
  lead,
  campaignId,
  sequenceNodes,
  sequenceEdges,
}: CampaignLeadDetailSheetProps) {
  const navigate = useNavigate();

  const { data: contact } = useQuery({
    queryKey: ["campaign-lead-contact", lead?.contact_id],
    queryFn: async () => {
      if (!lead?.contact_id) return null;
      const { data, error } = await supabase
        .from("crm_contacts")
        .select(
          "id, display_name, first_name, last_name, primary_email, company, job_title, city, company_website, enrichment_data, custom_fields, notion_preview_url, primary_linkedin_url, avatar_url"
        )
        .eq("id", lead.contact_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!lead?.contact_id && open,
  });

  // Fetch the campaign's ICP product ID so the re-analyze button uses the same
  // product the campaign processor would use. Falls back to undefined (writes
  // to enrichment_data only) when the campaign has no product attached.
  const { data: campaignMeta } = useQuery({
    queryKey: ["campaign-icp-product", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("linkedin_campaigns")
        .select("icp_product_id, sender_accounts, sender_account_ids")
        .eq("id", campaignId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!campaignId && open,
  });

  const startAnalysis = useStartCompanyAnalysis();
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  const handleRerunAnalysis = async () => {
    if (!lead?.contact_id) return;
    setIsReanalyzing(true);
    try {
      // Pick a LinkedIn sender from the campaign for post scraping. First
      // preference: explicit per-channel account list. Fall back to the legacy
      // sender_account_ids array. The worker tolerates undefined.
      const senderAccounts = (campaignMeta?.sender_accounts as Record<string, string[]> | null) || null;
      const linkedinIds = senderAccounts?.linkedin || [];
      const legacyIds = (campaignMeta?.sender_account_ids as string[] | null) || [];
      const unipileAccountId = linkedinIds[0] || legacyIds[0] || undefined;

      await startAnalysis.mutateAsync({
        contactIds: [lead.contact_id],
        model: DEFAULT_LLM_MODEL,
        unipileAccountId,
        productId: campaignMeta?.icp_product_id || undefined,
        includeAlreadyAnalyzed: true,
      });
      toast.success("Re-running analysis for this contact", {
        description: "The updated ICP score and personalization data will appear shortly.",
      });
    } catch (err) {
      toast.error(
        `Failed to re-run analysis: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsReanalyzing(false);
    }
  };

  const { data: leadActionLogs = [] } = useQuery({
    queryKey: ["campaign-lead-action-logs", campaignId, lead?.contact_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_action_log")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("contact_id", lead!.contact_id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as CampaignActionLog[];
    },
    enabled: !!lead?.contact_id && open,
  });

  const logByNodeId = useMemo(() => {
    const map = new Map<string, typeof leadActionLogs[0]>();
    for (const log of leadActionLogs) {
      map.set(log.node_id, log);
    }
    return map;
  }, [leadActionLogs]);

  const { data: customFieldDefs } = useCustomFieldDefs();
  const customFieldDefaults = useMemo(() => {
    const defaults: Record<string, string> = {};
    for (const def of customFieldDefs || []) {
      if (def.default_value) defaults[def.field_key] = def.default_value;
    }
    return defaults;
  }, [customFieldDefs]);

  const variableMap = useMemo(
    () => buildVariableMap(contact, lead?.generated_data, customFieldDefaults),
    [contact, lead?.generated_data, customFieldDefaults]
  );

  const orderedNodes = useMemo(() => {
    if (!sequenceEdges || sequenceEdges.length === 0) {
      return (sequenceNodes || []).filter(
        (n: any) => n.type !== "start" && n.type !== "end"
      );
    }
    const logNodeIds = new Set<string>();
    for (const log of leadActionLogs) {
      logNodeIds.add(log.node_id);
    }
    return getOrderedExecutionPath(
      sequenceNodes || [],
      sequenceEdges,
      { actionLogNodeIds: logNodeIds, currentNodeId: lead?.current_node_id }
    );
  }, [sequenceNodes, sequenceEdges, leadActionLogs, lead?.current_node_id]);

  const currentNodeIndex = useMemo(() => {
    if (!lead?.current_node_id) return -1;
    return orderedNodes.findIndex((n: any) => n.id === lead.current_node_id);
  }, [orderedNodes, lead?.current_node_id]);

  if (!lead) return null;

  const contactData = lead.contact as any;
  const displayName =
    contactData?.first_name || contactData?.last_name
      ? `${contactData?.first_name || ""} ${contactData?.last_name || ""}`.trim()
      : contactData?.display_name || "Unknown";

  const initials =
    (contactData?.first_name?.[0] || "") + (contactData?.last_name?.[0] || "") ||
    contactData?.display_name?.[0] || "?";

  const subtitle = contactData?.job_title && contactData?.company
    ? `${contactData.job_title} at ${contactData.company}`
    : contactData?.job_title || contactData?.company || "";

  // A "completed" lead carrying the "Filtered out at …" marker didn't finish the
  // sequence — it exited at a condition branch with no outgoing edge. Show it as
  // a distinct "Filtered" state and stop progress at the real exit step instead
  // of falsely reporting 100%.
  const filteredOut = lead.status === "completed" && isFilteredOut(lead.error_message);
  const exitNodeId = leadActionLogs.length > 0 ? leadActionLogs[leadActionLogs.length - 1].node_id : null;
  const exitIndex = filteredOut && exitNodeId
    ? orderedNodes.findIndex((n: any) => n.id === exitNodeId)
    : -1;

  const statusConfig = filteredOut
    ? { label: "Filtered", color: "bg-amber-500/10 text-amber-600 border-amber-500/20" }
    : STATUS_CONFIG[lead.status] || STATUS_CONFIG.pending;

  // Progress calculation — when current_node_id is null and status is completed, all steps are done
  const isCompleted = lead.status === "completed" && !lead.current_node_id && !filteredOut;
  const completedSteps = filteredOut && exitIndex >= 0
    ? exitIndex + 1
    : isCompleted
      ? orderedNodes.length
      : orderedNodes.filter((_: any, i: number) => i < currentNodeIndex).length;
  const totalSteps = orderedNodes.length;
  const progressPercent = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  const hasKeyDates = lead.connection_sent_at || lead.connection_accepted_at || lead.last_message_at || lead.replied_at;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl w-full p-0 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 pr-12">
          <SheetHeader className="pb-0">
            <div className="flex items-start gap-3.5">
              <Avatar className="h-12 w-12 shrink-0">
                {contactData?.avatar_url && (
                  <AvatarImage src={contactData.avatar_url} alt={displayName} />
                )}
                <AvatarFallback className="bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 text-sm font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-lg font-semibold leading-tight truncate">
                  {displayName}
                </SheetTitle>
                {subtitle && (
                  <SheetDescription className="mt-0.5 truncate">
                    {subtitle}
                  </SheetDescription>
                )}
              </div>
            </div>
          </SheetHeader>

          {/* Status row */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Badge variant="outline" className={cn("text-xs font-medium", statusConfig.color)}>
              {statusConfig.label}
            </Badge>
            {lead.sender_account?.display_name && (
              <span className="text-xs text-muted-foreground">
                via {lead.sender_account.display_name}
              </span>
            )}
            {lead.next_action_at && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Next: {formatDistanceToNow(new Date(lead.next_action_at), { addSuffix: true })}
              </span>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2 mt-3">
            {contactData?.id && (
              <button
                onClick={() => navigate(`/contacts/${contactData.id}`)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20 transition-colors"
              >
                <UserCheck className="h-3.5 w-3.5" />
                View Contact
              </button>
            )}
            {(contactData?.linkedin_url || contact?.primary_linkedin_url) && (
              <button
                onClick={() =>
                  window.open(contactData?.linkedin_url || contact?.primary_linkedin_url, "_blank")
                }
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-[#0A66C2]/10 text-[#0A66C2] hover:bg-[#0A66C2]/20 dark:bg-[#0A66C2]/15 dark:text-[#4C9AE6] dark:hover:bg-[#0A66C2]/25 transition-colors"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
                LinkedIn
                <ExternalLink className="h-3 w-3 opacity-50" />
              </button>
            )}
            {lead.status === "replied" && contactData?.id && (
              <button
                onClick={() => navigate(`/inbox?contact=${contactData.id}`)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-500/10 dark:text-purple-400 dark:hover:bg-purple-500/20 transition-colors"
              >
                <Inbox className="h-3.5 w-3.5" />
                View Reply
              </button>
            )}
            {contactData?.id && (
              <button
                onClick={handleRerunAnalysis}
                disabled={isReanalyzing || startAnalysis.isPending}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Clear cached analysis and re-run analyse contact for this lead using Grok 4.1 Fast"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {isReanalyzing || startAnalysis.isPending ? "Re-analysing..." : "Re-run Analysis"}
              </button>
            )}
          </div>
        </div>

        {/* Filtered-out banner — an intentional screen-out, not a failure */}
        {filteredOut && lead.error_message && (
          <div className="mx-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
            <Filter className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300 leading-relaxed">
                {lead.error_message}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                This lead was intentionally screened out at this step — it is not a delivery failure.
              </p>
            </div>
          </div>
        )}

        {/* Error banner */}
        {!filteredOut && lead.error_message && (
          <div className="mx-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive leading-relaxed">{lead.error_message}</p>
          </div>
        )}

        {/* Key dates card */}
        {hasKeyDates && (
          <div className="mx-6 mt-3 rounded-lg bg-muted/50 px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {lead.connection_sent_at && (
              <span className="text-[11px] text-muted-foreground">
                Request sent {format(new Date(lead.connection_sent_at), "MMM d")}
              </span>
            )}
            {lead.connection_sent_at && lead.connection_accepted_at && (
              <span className="text-muted-foreground/40">·</span>
            )}
            {lead.connection_accepted_at && (
              <span className="text-[11px] text-green-600 dark:text-green-400 font-medium">
                Accepted {format(new Date(lead.connection_accepted_at), "MMM d")}
              </span>
            )}
            {(lead.connection_sent_at || lead.connection_accepted_at) && lead.last_message_at && (
              <span className="text-muted-foreground/40">·</span>
            )}
            {lead.last_message_at && (
              <span className="text-[11px] text-muted-foreground">
                Last msg {format(new Date(lead.last_message_at), "MMM d")}
              </span>
            )}
            {lead.last_message_at && lead.replied_at && (
              <span className="text-muted-foreground/40">·</span>
            )}
            {lead.replied_at && (
              <span className="text-[11px] text-purple-600 dark:text-purple-400 font-medium">
                Replied {format(new Date(lead.replied_at), "MMM d")}
              </span>
            )}
          </div>
        )}

        {/* Progress bar */}
        {totalSteps > 0 && (
          <div className="mx-6 mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {filteredOut
                  ? `Exited at step ${completedSteps} of ${totalSteps}`
                  : `Step ${Math.max(currentNodeIndex + 1, completedSteps)} of ${totalSteps}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {Math.round(progressPercent)}%
              </span>
            </div>
            <Progress
              value={progressPercent}
              className={cn("h-1.5", filteredOut ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500")}
            />
          </div>
        )}

        <Separator className="mt-4" />

        {/* Sequence Timeline */}
        <ScrollArea className="flex-1">
          <div className="px-6 pt-4 pb-6 pr-8">
            {orderedNodes.map((node: any, index: number) => {
              const nodeType = node.type as SequenceNodeType;
              const config = NODE_TYPE_CONFIGS[nodeType];
              const NodeIcon = NODE_ICONS[nodeType] || Circle;
              const rawActionLog = logByNodeId.get(node.id);
              // Suppress stale action logs: if the lead has been reverted to an earlier node,
              // logs for nodes after the current position are from a previous attempt
              const isStaleLog = rawActionLog && currentNodeIndex >= 0 && index > currentNodeIndex;
              const actionLog = isStaleLog ? undefined : rawActionLog;

              const isCurrent = node.id === lead.current_node_id;
              const isCompleted = actionLog?.status === "success";
              const isFailed = actionLog?.status === "failed";
              const isSkipped = actionLog?.status === "skipped";
              const isFuture = !actionLog && !isCurrent;
              const isLast = index === orderedNodes.length - 1;

              const { message, subject, isAI } = getMessageFromNode(node);
              const resolvedMessage = message ? resolveVariables(message, variableMap) : undefined;
              const resolvedSubject = subject ? resolveVariables(subject, variableMap) : undefined;
              const displayMessage = actionLog?.message_content || resolvedMessage;

              const nodeLabel = nodeType === "delay"
                ? `Wait ${getDelayLabel(node)}`
                : config?.label || nodeType;

              return (
                <div key={node.id} className="flex gap-3">
                  {/* Timeline gutter */}
                  <div className="flex flex-col items-center">
                    {/* Icon circle */}
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-200",
                        isCurrent && "ring-[3px] ring-primary/25 animate-pulse-subtle",
                        isCompleted && "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
                        isFailed && "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400",
                        isSkipped && "bg-slate-100 text-slate-400 dark:bg-slate-500/15 dark:text-slate-500",
                        isCurrent && getNodeColor(nodeType),
                        isFuture && "bg-muted text-muted-foreground/50"
                      )}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : isFailed ? (
                        <XCircle className="h-4 w-4" />
                      ) : (
                        <NodeIcon className="h-4 w-4" />
                      )}
                    </div>

                    {/* Connector line */}
                    {!isLast && (
                      <div
                        className={cn(
                          "w-0.5 flex-1 min-h-[16px]",
                          isCompleted ? "bg-emerald-300 dark:bg-emerald-700" : "bg-border"
                        )}
                      />
                    )}
                  </div>

                  {/* Step content */}
                  <div className={cn("flex-1 pb-4", isLast && "pb-0", isFuture && "opacity-50")}>
                    {/* Label row */}
                    <div className="flex items-center justify-between gap-2 min-h-[32px]">
                      <span
                        className={cn(
                          "text-sm font-medium leading-tight",
                          isSkipped && "line-through text-muted-foreground"
                        )}
                      >
                        {nodeLabel}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {filteredOut && index === exitIndex && (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-5 font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                          >
                            <Filter className="h-3 w-3 mr-1" />
                            Exited here
                          </Badge>
                        )}
                        {isCurrent && (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-5 font-semibold bg-primary/10 text-primary border-primary/30"
                          >
                            Current
                          </Badge>
                        )}
                        {isFailed && (
                          <Badge variant="outline" className="text-[10px] h-5 text-destructive border-destructive/30 bg-destructive/5">
                            Failed
                          </Badge>
                        )}
                        {isSkipped && (
                          <Badge variant="outline" className={cn(
                            "text-[10px] h-5",
                            actionLog?.error_message
                              ? "text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10"
                              : "text-muted-foreground bg-muted"
                          )}>
                            {actionLog?.error_message ? "Failed (continued)" : "Skipped"}
                          </Badge>
                        )}
                        {isCompleted && actionLog?.executed_at && (
                          <span className="text-[11px] text-muted-foreground">
                            {format(new Date(actionLog.executed_at), "MMM d, h:mm a")}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Message preview */}
                    {displayMessage && (
                      <div className="mt-1.5 border-l-2 border-muted-foreground/15 pl-3 space-y-1">
                        {isAI && !actionLog?.message_content && (
                          <Badge variant="outline" className="text-[10px] h-5 bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20">
                            AI-generated at send time
                          </Badge>
                        )}
                        {resolvedSubject && (
                          <p className="text-xs font-medium text-foreground">{resolvedSubject}</p>
                        )}
                        <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed line-clamp-4">
                          {displayMessage}
                        </p>
                      </div>
                    )}

                    {/* Delay description */}
                    {nodeType === "delay" && !displayMessage && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Wait {getDelayLabel(node)} before next step
                      </p>
                    )}

                    {/* Connection request status */}
                    {nodeType === "connectionRequest" && isCompleted && (
                      <div className="mt-1 flex items-center gap-1.5">
                        {lead.connection_accepted_at ? (
                          <Badge variant="outline" className="text-[10px] h-5 font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25">
                            <UserCheck className="h-3 w-3 mr-1" />
                            Accepted {format(new Date(lead.connection_accepted_at), "MMM d")}
                          </Badge>
                        ) : lead.connection_sent_at ? (
                          <Badge variant="outline" className="text-[10px] h-5 font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25">
                            <Clock className="h-3 w-3 mr-1" />
                            Pending
                          </Badge>
                        ) : null}
                      </div>
                    )}

                    {/* Condition description / branch result */}
                    {(nodeType === "conditionConnection" ||
                      nodeType === "conditionReplyReceived" ||
                      nodeType === "conditionChannelAvailable" ||
                      nodeType === "routeByChannel" ||
                      nodeType === "conditionEmailOpened" ||
                      nodeType === "conditionEmailClicked" ||
                      nodeType === "verifyEmail" ||
                      nodeType === "conditionIcpScore" ||
                      nodeType === "conditionOpenProfile" ||
                      nodeType === "conditionEnriched" ||
                      nodeType === "conditionAnalyzed" ||
                      nodeType === "whatsappCheckNumber") && (() => {
                      const conditionResult = getConditionResult(actionLog);
                      if (conditionResult) {
                        const isPositive = POSITIVE_HANDLES.has(conditionResult);
                        return (
                          <div className="mt-1 flex items-center gap-1.5">
                            <ArrowRight className={cn(
                              "h-3 w-3",
                              isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                            )} />
                            <Badge variant="outline" className={cn(
                              "text-[10px] h-5 font-medium",
                              isPositive
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                                : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"
                            )}>
                              {getHandleLabel(conditionResult)}
                            </Badge>
                          </div>
                        );
                      }
                      return (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {config?.description || "Check condition before proceeding"}
                        </p>
                      );
                    })()}

                    {/* Error detail */}
                    {(isFailed || isSkipped) && actionLog?.error_message && (
                      <div className={cn(
                        "mt-1.5 rounded-md px-2.5 py-1.5",
                        isFailed ? "bg-destructive/5 border border-destructive/20" : "bg-amber-500/5 border border-amber-500/20"
                      )}>
                        <p className={cn(
                          "text-[11px] leading-relaxed",
                          isFailed ? "text-destructive" : "text-amber-600 dark:text-amber-400"
                        )}>{actionLog.error_message}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {orderedNodes.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Circle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No sequence steps configured</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
