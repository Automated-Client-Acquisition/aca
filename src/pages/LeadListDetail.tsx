import { useState, useEffect, useRef, type ReactNode } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Users,
  Search,
  MoreVertical,
  Trash2,
  ExternalLink,
  Mail,
  Plus,
  Sparkles,
  RefreshCw,
  Settings2,
  Filter,
  Linkedin,
  Instagram,
  Upload,
  User,
  ChevronLeft,
  ChevronRight,
  Activity,
  Ban,
  Play,
  Building2,
  Briefcase,
  Globe,
  Code,
  BadgeCheck,
  ArrowUpDown,
  MessageCircle,
  MessageCircleOff,
  Reply,
  Brain,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Send,
  ShieldAlert,
  ShieldCheck,
  MailCheck,
  Phone,
  GitBranch,
  MapPin,
  Tag,
  Clock,
  Star,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ActivityTimeline } from "@/components/leads/ActivityTimeline";
import { ContactCell } from "@/components/contacts/ContactCell";
import { useLeadList, useRefreshSmartListCount, useUpdateSmartList, type SmartListFilterCriteria } from "@/hooks/useLeadLists";
import {
  useLeadListMembers,
  useRemoveLeadListMember,
  useBulkRemoveLeadListMembers,
  useBulkRemoveFilteredLeadListMembers,
  useBulkAddLeadListMembers,
  useFetchAllListMemberIds,
  buildRpcFilters,
} from "@/hooks/useLeadListMembers";
import { useLeadLists } from "@/hooks/useLeadLists";
import { useSmartListContacts, useFetchSmartListContactIds } from "@/hooks/useSmartListContacts";
import { useUpdateContact, useAddContactTag, useRemoveContactTag, useDeleteContact, useBulkDeleteContacts, type OutreachStatus, type AiAnalysisStatus } from "@/hooks/crm/useContacts";
import { ColumnSelector, type ColumnConfig } from "@/components/ColumnSelector";
import { useColumnResize } from "@/hooks/useColumnResize";
import { ResizeHandle } from "@/components/ui/resize-handle";
import {
  EditableTextCell,
  EditableTagsCell,
  EditableLocationCell,
} from "@/components/editable-cells";
import { useLeadListChannelStats, useRefreshChannelStats } from "@/hooks/useLeadListChannelStats";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmptyListState } from "@/components/lead-lists/EmptyListState";
import { SmartListFilterBuilder } from "@/components/lead-lists/SmartListFilterBuilder";
import { AnalyzeCompaniesDialog } from "@/components/lead-lists/AnalyzeCompaniesDialog";
import { useActiveCompanyAnalysisJobs } from "@/hooks/useCompanyAnalysisJobs";
import { GenerateEmailSequenceDialog } from "@/components/lead-lists/GenerateEmailSequenceDialog";
import { GenerateAndSendDialog } from "@/components/lead-lists/GenerateAndSendDialog";
import { PushSequencesToEmailToolDialog } from "@/components/lead-lists/PushSequencesToEmailToolDialog";
import { BulkEnrollEmailSequenceDialog } from "@/components/email/BulkEnrollEmailSequenceDialog";
import { GenerateNotionPagesDialog } from "@/components/lead-lists/GenerateNotionPagesDialog";
import { FindEmailsDialog } from "@/components/lead-lists/FindEmailsDialog";
import { VerifyEmailsDialog } from "@/components/lead-lists/VerifyEmailsDialog";
import { ListSourcesPanel } from "@/components/lead-lists/ListSourcesPanel";
import { ExportContactsDialog } from "@/components/contacts/ExportContactsDialog";
import { LeadHandoffsManager } from "@/components/lead-lists/LeadHandoffsManager";
import { LeadListBulkActionsBar } from "@/components/lead-lists/LeadListBulkActionsBar";
import { LeadListProcessingDialog } from "@/components/lead-lists/LeadListProcessingDialog";
import { LeadListProcessingStatus } from "@/components/lead-lists/LeadListProcessingStatus";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useEmailSequencesCounts, useBulkClearSequences, useBulkDeleteNotionPages, useCheckFirewalls, useVerifyEmails, useEmailVerifications, useDownloadMailtesterRawJson, type EmailVerificationStatus, type EmailVerificationInfo } from "@/hooks/useEmailSequences";
import { useWatchEmailSequenceJobCompletion } from "@/hooks/useEmailSequenceJobs";
import { useExportContacts } from "@/hooks/useExportContacts";
import { useActiveCSVImportJobForList } from "@/hooks/useCSVImportJob";
import { AdvancedFilters, type EnrichmentFilters } from "@/components/contacts/AdvancedFilters";
import { useContactScoresForProduct, type ContactProductScore } from "@/hooks/useContactProductScores";
import { useProducts } from "@/hooks/useProducts";
import { useLeadListProcessingPolicySummary, useLeadListProcessingStatus, usePauseLeadListProcessing, useResumeLeadListProcessing, useRunLeadListProcessing, useStartLeadListProcessing, useStopLeadListProcessing } from "@/hooks/useLeadListProcessing";
import { SmartSegmentFunnel } from "@/components/lead-lists/SmartSegmentFunnel";
import { ConnectedOutreach } from "@/components/lead-lists/ConnectedOutreach";
import { summarizeSmartSegmentCriteria, validateSmartSegmentCriteria } from "@/lib/smart-segment-rules";
import { mergeEnrichmentIntoCriteria } from "@/lib/smart-list-criteria";
import { Progress } from "@/components/ui/progress";
import { format, formatDistanceToNow } from "date-fns";
import { Target, UserCheck } from "lucide-react";
import { getFirmographicsSummary } from "@/lib/firmographics-display";
import { useCustomFieldDefs, type CustomFieldDef } from "@/hooks/useCustomFieldDefs";
import { cn } from "@/lib/utils";

// Column configuration for lead list tables
const LIST_COLUMNS: ColumnConfig[] = [
  { key: 'contact', label: 'Contact', alwaysVisible: true, group: 'Identity' },
  { key: 'linkedin_url', label: 'LinkedIn URL', group: 'Identity' },
  { key: 'email', label: 'Email', group: 'Identity' },
  { key: 'phone', label: 'Phone', group: 'Identity' },
  { key: 'location', label: 'Location', group: 'Identity' },
  { key: 'company', label: 'Company', group: 'Work' },
  { key: 'firmographics', label: 'Firmographics', group: 'Work' },
  { key: 'job_title', label: 'Job Title', group: 'Work' },
  { key: 'website', label: 'Website', group: 'Work' },
  { key: 'tags', label: 'Tags', group: 'CRM' },
  { key: 'source', label: 'Source', group: 'CRM' },
  { key: 'outreach', label: 'Outreach', group: 'Engagement' },
  { key: 'sequences', label: 'Sequences', group: 'Engagement' },
  { key: 'added', label: 'Added', group: 'Engagement' },
  { key: 'ai_analyzed', label: 'AI Analyzed', group: 'Intelligence' },
  { key: 'ai_insights', label: 'AI Insights', group: 'Intelligence' },
  { key: 'icp_score', label: 'ICP Score', group: 'Intelligence' },
  { key: 'dm_score', label: 'DM Fit', group: 'Intelligence' },
  { key: 'score', label: 'Score', group: 'Intelligence' },
  { key: 'notion_url', label: 'Notion URL', group: 'Data quality' },
  { key: 'seg_firewall', label: 'Email Firewall', group: 'Data quality' },
  { key: 'email_verified', label: 'Email Verified', group: 'Data quality' },
];

const DEFAULT_LIST_COLUMNS = ['contact', 'company', 'website', 'firmographics', 'email', 'outreach', 'ai_analyzed', 'score', 'seg_firewall', 'email_verified', 'sequences', 'notion_url', 'added'];
const LIST_COLUMN_PREFS_KEY = 'lead-list-table-columns';

// Default column widths in pixels for resizable columns
const LIST_DEFAULT_WIDTHS: Record<string, number> = {
  _checkbox: 48,
  contact: 250,
  linkedin_url: 220,
  company: 200,
  firmographics: 230,
  job_title: 150,
  email: 200,
  website: 130,
  phone: 140,
  location: 130,
  tags: 150,
  outreach: 110,
  ai_analyzed: 120,
  ai_insights: 200,
  icp_score: 90,
  dm_score: 90,
  source: 110,
  score: 90,
  sequences: 90,
  notion_url: 120,
  seg_firewall: 130,
  email_verified: 130,
  added: 120,
  _actions: 48,
};

// Small type icon shown before each column header label — matches the Clay-style
// treatment on /people (Contacts.tsx).
const LIST_COLUMN_ICONS: Record<string, LucideIcon> = {
  contact: User,
  linkedin_url: Linkedin,
  email: Mail,
  phone: Phone,
  location: MapPin,
  company: Building2,
  firmographics: BadgeCheck,
  job_title: Briefcase,
  website: Globe,
  tags: Tag,
  source: Upload,
  outreach: MessageCircle,
  sequences: Send,
  added: Clock,
  ai_analyzed: Brain,
  ai_insights: Sparkles,
  icp_score: Target,
  dm_score: UserCheck,
  score: Star,
  notion_url: ExternalLink,
  seg_firewall: ShieldAlert,
  email_verified: MailCheck,
};

function ColumnHeaderLabel({ columnKey, children }: { columnKey: string; children: ReactNode }) {
  const Icon = LIST_COLUMN_ICONS[columnKey];
  return (
    <div className="flex items-center gap-1.5">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      {children}
    </div>
  );
}

// Helper component for displaying email sequence indicator
function SequenceIndicator({
  count,
  status,
  pushedToTool,
}: {
  count?: number;
  status?: 'draft' | 'generating' | 'ready' | 'pushed' | 'failed' | 'archived';
  pushedToTool?: string | null;
}) {
  if (!count) {
    return <span className="text-muted-foreground">—</span>;
  }

  const statusColors: Record<string, string> = {
    draft: '',
    generating: 'status-warning',
    ready: 'status-success',
    pushed: 'status-info',
    failed: 'status-error',
    archived: '',
  };

  const colorClass = status ? statusColors[status] ?? statusColors.ready : statusColors.ready;
  const isPushed = status === 'pushed';

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge variant={colorClass ? "status" : "secondary"} className={`gap-1 text-xs ${colorClass}`}>
          {isPushed ? <Send className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
          {count}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {isPushed
          ? `Pushed to ${pushedToTool || 'email tool'}`
          : status === 'ready'
          ? 'Sequence ready'
          : status === 'generating'
          ? 'Generating...'
          : status === 'failed'
          ? 'Generation failed'
          : `${count} sequence${count !== 1 ? 's' : ''}`}
      </TooltipContent>
    </Tooltip>
  );
}

function FirmographicsCell({
  enrichmentData,
  customFields,
}: {
  enrichmentData: Record<string, unknown> | null | undefined;
  customFields?: Record<string, unknown> | null;
}) {
  const summary = getFirmographicsSummary(enrichmentData, customFields);
  const primary = [
    summary.employees ? `${summary.employees} employees` : undefined,
    summary.industry,
  ].filter(Boolean).join(" · ");
  const secondary = [summary.revenue, summary.seniority, summary.source]
    .filter(Boolean)
    .join(" · ");

  if (!primary && !secondary) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="min-w-0 space-y-0.5" title={[primary, secondary].filter(Boolean).join(" | ")}>
      {primary && <p className="text-sm font-medium truncate">{primary}</p>}
      {secondary && <p className="text-xs text-muted-foreground truncate">{secondary}</p>}
    </div>
  );
}

function LinkedInUrlCell({ url }: { url: string | null | undefined }) {
  if (!url) return <span className="text-muted-foreground">—</span>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-primary hover:underline truncate block max-w-[220px]"
      title={url}
      onClick={(event) => event.stopPropagation()}
    >
      {url}
    </a>
  );
}

function CustomFieldCell({ field, customFields }: { field: CustomFieldDef; customFields: Record<string, unknown> | null | undefined }) {
  const rawValue = customFields?.[field.field_key];
  const value = rawValue != null && rawValue !== '' ? String(rawValue) : field.default_value;
  return value ? (
    <span className="text-sm truncate block max-w-[200px]">{value}</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

/**
 * Displays outreach status badge
 * - Unreached: No messages sent yet (gray)
 * - Reached: At least one message sent (blue)
 * - Replied: Contact has replied (green)
 */
/**
 * Inline badge for email verification result (cached in
 * email_address_verifications). Renders nothing for unverified addresses
 * so the column reads as "—" until the user runs Verify Emails.
 */
function EmailVerifiedBadge({
  email,
  info,
}: {
  email: string | null | undefined;
  info: { status: EmailVerificationStatus; provider: string; verified_at: string } | undefined;
}) {
  if (!email) return <span className="text-xs text-muted-foreground">—</span>;
  if (!info) return <span className="text-xs text-muted-foreground">Not verified</span>;

  const config: Record<EmailVerificationStatus, { label: string; className: string }> = {
    valid:      { label: 'Valid',      className: 'status-success' },
    invalid:    { label: 'Invalid',    className: 'status-error' },
    disposable: { label: 'Disposable', className: 'status-error' },
    catch_all:  { label: 'Catch-all',  className: 'status-warning' },
    risky:      { label: 'Risky',      className: 'status-warning' },
    role:       { label: 'Role',       className: 'status-warning' },
    unknown:    { label: 'Unknown',    className: '' },
  };
  // Guard against a status value not present in the config map (e.g. the
  // legacy 'role_only' written to crm_contacts) — destructuring a missing
  // entry would throw and blank the whole row.
  const { label, className } = config[info.status] ?? config.unknown;
  const providerLabel =
    info.provider === 'apify_million_verifier' ? 'Million Verifier (Apify)'
    : info.provider === 'million_verifier'     ? 'Million Verifier'
    : info.provider === 'mailtester_ninja'     ? 'Mailtester Ninja'
    : info.provider === 'heuristic'            ? 'Lite (heuristic)'
    : info.provider;
  const verifiedAt = info.verified_at ? new Date(info.verified_at) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={className ? "status" : "outline"} className={`gap-1 text-[10px] ${className}`}>
          <MailCheck className="h-3 w-3" />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">
          {label}{providerLabel ? ` · ${providerLabel}` : ''}
          {verifiedAt && !isNaN(verifiedAt.getTime()) && (
            <>
              <br />
              Verified {verifiedAt.toLocaleString()}
            </>
          )}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// Valid badge statuses; anything else (e.g. crm_contacts' 'role_only') is
// normalized so the badge never receives an unmapped status.
const VERIFICATION_STATUSES: EmailVerificationStatus[] = [
  'valid', 'invalid', 'disposable', 'catch_all', 'risky', 'role', 'unknown',
];
function normalizeVerificationStatus(raw: string): EmailVerificationStatus {
  if (raw === 'role_only') return 'role';
  return (VERIFICATION_STATUSES as string[]).includes(raw)
    ? (raw as EmailVerificationStatus)
    : 'unknown';
}

/**
 * Resolves the "Email Verified" badge info for a contact. Prefers the
 * email_address_verifications cache (populated by the Mailtester kickoff/worker
 * path), then falls back to the native crm_contacts.email_verification_* columns
 * so lists verified via the processing pipeline, CSV import, or MCP/CLI — which
 * write the contact columns but not the cache — still render a status.
 */
function resolveEmailVerification(
  contact: {
    primary_email?: string | null;
    email_verification_status?: string | null;
    email_verification_source?: string | null;
    email_verified_at?: string | null;
  },
  cache: Map<string, EmailVerificationInfo> | undefined,
): EmailVerificationInfo | undefined {
  const email = contact.primary_email;
  if (!email) return undefined;
  const cached = cache?.get(email.toLowerCase().trim());
  if (cached) return cached;
  if (!contact.email_verification_status) return undefined;
  return {
    status: normalizeVerificationStatus(contact.email_verification_status),
    provider: contact.email_verification_source || 'unknown',
    verified_at: contact.email_verified_at || '',
  };
}

/**
 * Minimal dot + label status indicator — mirrors the People table's
 * StatusFlag (src/pages/Contacts.tsx), duplicated locally per this
 * codebase's existing per-page pattern for table-cell status renderers.
 */
function StatusFlag({
  label,
  dotClassName,
  textClassName,
  dotPulse = false,
}: {
  label: string;
  dotClassName: string;
  textClassName: string;
  dotPulse?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${textClassName}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClassName}${dotPulse ? " animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

/**
 * Right-aligned tabular score with an inline progress bar (0-100).
 * Duplicate of Contacts.tsx's ScoreBarCell — see StatusFlag comment above.
 */
function ScoreBarCell({ score }: { score: number | null }) {
  if (score === null || score === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const pct = Math.min(100, Math.max(0, score));
  return (
    <div className="flex items-center justify-end gap-2 tabular-nums">
      <div className="h-1 w-10 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-semibold text-xs w-5 text-right">{score}</span>
    </div>
  );
}

function OutreachStatusBadge({ status }: { status: OutreachStatus | undefined }) {
  const config: Record<OutreachStatus, { label: string; dotClassName: string; textClassName: string }> = {
    unreached: {
      label: 'Unreached',
      dotClassName: 'bg-gray-400 dark:bg-gray-500',
      textClassName: 'text-gray-600 dark:text-gray-400',
    },
    reached: {
      label: 'Reached',
      dotClassName: 'bg-blue-500',
      textClassName: 'text-blue-700 dark:text-blue-400',
    },
    replied: {
      label: 'Replied',
      dotClassName: 'bg-green-500',
      textClassName: 'text-green-700 dark:text-green-400',
    },
  };

  const effectiveStatus = status || 'unreached';
  const { label, dotClassName, textClassName } = config[effectiveStatus];

  return <StatusFlag label={label} dotClassName={dotClassName} textClassName={textClassName} />;
}

/**
 * Displays AI analysis status badge
 * - Not Analyzed: No AI analysis done (gray)
 * - Analyzing: AI analysis in progress (yellow/amber)
 * - Analyzed: AI analysis complete (green)
 * - Failed: AI analysis failed (red)
 */
function AiAnalysisStatusBadge({ status }: { status: AiAnalysisStatus | undefined }) {
  const config: Record<AiAnalysisStatus, { label: string; dotClassName: string; textClassName: string; dotPulse?: boolean; tooltip?: string }> = {
    not_analyzed: {
      label: 'Not Analyzed',
      dotClassName: 'bg-gray-400 dark:bg-gray-500',
      textClassName: 'text-gray-600 dark:text-gray-400',
    },
    analyzing: {
      label: 'Analyzing',
      dotClassName: 'bg-amber-500',
      textClassName: 'text-amber-700 dark:text-amber-400',
      dotPulse: true,
    },
    analyzed: {
      label: 'Analyzed',
      dotClassName: 'bg-green-500',
      textClassName: 'text-green-700 dark:text-green-400',
    },
    failed: {
      label: 'No Data',
      dotClassName: 'bg-orange-500',
      textClassName: 'text-orange-600 dark:text-orange-400',
      tooltip: 'Could not gather enough information — the website may be unreachable or blocked. You can retry or select a LinkedIn account for fallback.',
    },
  };

  const effectiveStatus = status || 'not_analyzed';
  const { label, dotClassName, textClassName, dotPulse, tooltip } = config[effectiveStatus];

  const badge = (
    <StatusFlag label={label} dotClassName={dotClassName} textClassName={textClassName} dotPulse={dotPulse} />
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{badge}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px]">
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return badge;
}

// Helper component for displaying filter criteria summary
function FilterCriteriaSummary({ criteria }: { criteria: SmartListFilterCriteria }) {
  if (criteria.rule_group) {
    return <p className="text-sm leading-relaxed text-foreground">{summarizeSmartSegmentCriteria(criteria)}</p>;
  }
  const items: { icon: React.ReactNode; label: string }[] = [];

  if (criteria.source) {
    const sourceLabels: Record<string, { icon: React.ReactNode; label: string }> = {
      linkedin_connection: { icon: <Linkedin className="h-3.5 w-3.5" />, label: "LinkedIn Connections" },
      linkedin_comment: { icon: <Linkedin className="h-3.5 w-3.5" />, label: "LinkedIn Leads" },
      instagram_comment: { icon: <Instagram className="h-3.5 w-3.5" />, label: "Instagram Leads" },
      manual: { icon: <User className="h-3.5 w-3.5" />, label: "Manual" },
      import: { icon: <Upload className="h-3.5 w-3.5" />, label: "Import" },
    };
    const src = sourceLabels[criteria.source];
    if (src) items.push(src);
  }

  if (criteria.status) {
    items.push({ icon: null, label: `Status: ${criteria.status}` });
  }

  if (criteria.tags?.length) {
    items.push({ icon: null, label: `${criteria.tags.length} tag(s)` });
  }

  if (criteria.min_score !== undefined || criteria.max_score !== undefined) {
    const min = criteria.min_score ?? 0;
    const max = criteria.max_score ?? 100;
    items.push({ icon: null, label: `Score: ${min}-${max}` });
  }

  if (criteria.created_days_ago) {
    items.push({ icon: null, label: `Created: last ${criteria.created_days_ago}d` });
  }

  if (criteria.activity_days_ago) {
    items.push({ icon: null, label: `Active: last ${criteria.activity_days_ago}d` });
  }

  if (criteria.has_email !== undefined) {
    items.push({ icon: <Mail className="h-3.5 w-3.5" />, label: criteria.has_email ? "Has email" : "No email" });
  }

  if (criteria.has_linkedin !== undefined) {
    items.push({ icon: <Linkedin className="h-3.5 w-3.5" />, label: criteria.has_linkedin ? "Has LinkedIn" : "No LinkedIn" });
  }

  // Enrichment filters
  if (criteria.industries?.length) {
    items.push({ icon: <Building2 className="h-3.5 w-3.5" />, label: `${criteria.industries.length} industry(ies)` });
  }

  if (criteria.company_sizes?.length) {
    items.push({ icon: <Users className="h-3.5 w-3.5" />, label: `${criteria.company_sizes.length} company size(s)` });
  }
  if (criteria.min_employee_count !== undefined || criteria.max_employee_count !== undefined) {
    const min = criteria.min_employee_count;
    const max = criteria.max_employee_count;
    const range = min !== undefined && max !== undefined ? `${min.toLocaleString()}–${max.toLocaleString()}` : min !== undefined ? `${min.toLocaleString()}+` : `up to ${max!.toLocaleString()}`;
    items.push({ icon: <Users className="h-3.5 w-3.5" />, label: `Employees: ${range}` });
  }

  if (criteria.seniorities?.length) {
    items.push({ icon: <Briefcase className="h-3.5 w-3.5" />, label: `${criteria.seniorities.length} seniority(ies)` });
  }

  if (criteria.departments?.length) {
    items.push({ icon: null, label: `${criteria.departments.length} department(s)` });
  }

  if (criteria.technologies?.length) {
    items.push({ icon: <Code className="h-3.5 w-3.5" />, label: `${criteria.technologies.length} tech(s)` });
  }

  if (criteria.email_verified !== undefined) {
    items.push({ icon: <BadgeCheck className="h-3.5 w-3.5" />, label: criteria.email_verified ? "Email verified" : "Not verified" });
  }

  if (criteria.min_email_confidence !== undefined) {
    items.push({ icon: <Mail className="h-3.5 w-3.5" />, label: `Confidence >= ${criteria.min_email_confidence}%` });
  }

  if (criteria.countries?.length) {
    items.push({ icon: <Globe className="h-3.5 w-3.5" />, label: `${criteria.countries.length} country(ies)` });
  }

  if (criteria.cities?.length) {
    items.push({ icon: null, label: `${criteria.cities.length} city(ies)` });
  }

  if (criteria.has_enrichment_data !== undefined) {
    items.push({ icon: <Sparkles className="h-3.5 w-3.5" />, label: criteria.has_enrichment_data ? "Has enrichment" : "No enrichment" });
  }

  if (items.length === 0) {
    return <span className="text-muted-foreground text-sm">No filters defined</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <Badge key={i} variant="secondary" className="gap-1">
          {item.icon}
          {item.label}
        </Badge>
      ))}
    </div>
  );
}

/** Renders a color-coded ICP score badge with optional reasoning tooltip. */
function IcpScoreBadge({ score, reasoning }: { score: number; reasoning: string | null }) {
  const label =
    score >= 80 ? "Perfect Fit" :
    score >= 60 ? "Good Fit" :
    score >= 40 ? "Moderate" : "Poor Fit";

  const colorClass =
    score >= 80 ? "status-success" :
    score >= 60 ? "status-info" :
    score >= 40 ? "status-warning" :
    "status-error";

  const badge = (
    <Badge variant="status" className={`text-xs whitespace-nowrap ${colorClass}`}>
      {score} — {label}
    </Badge>
  );

  if (reasoning) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {reasoning}
        </TooltipContent>
      </Tooltip>
    );
  }

  return badge;
}

/**
 * Renders ICP score in table cells.
 * When a product is selected: shows only that product's score (dash if unscored).
 * When "Overall" is selected: shows the enrichment-level ICP score.
 */
function IcpScoreCell({
  contactId,
  enrichmentData,
  productScoreMap,
  icpProductId,
}: {
  contactId: string;
  enrichmentData: Record<string, unknown> | null;
  productScoreMap: Map<string, { icp_score: number | null; icp_score_reasoning?: string | null }> | undefined;
  icpProductId: string | null;
}) {
  // Product selected → only show that product's score, no fallback
  if (icpProductId) {
    const productScore = productScoreMap?.get(contactId);
    if (!productScore || productScore.icp_score == null) {
      return <span className="text-muted-foreground">—</span>;
    }
    return <IcpScoreBadge score={productScore.icp_score} reasoning={productScore.icp_score_reasoning ?? null} />;
  }

  // No product selected → show overall enrichment ICP score
  const score = (enrichmentData?.icp_score as number | undefined) ?? null;
  const reasoning = (enrichmentData?.icp_score_reasoning as string | undefined) ?? null;

  if (score == null) {
    return <span className="text-muted-foreground">—</span>;
  }

  return <IcpScoreBadge score={score} reasoning={reasoning} />;
}

/**
 * Decision-Maker Fit score cell — only shows when a product is selected.
 */
function DmScoreCell({
  contactId,
  productScoreMap,
  icpProductId,
}: {
  contactId: string;
  productScoreMap: Map<string, ContactProductScore> | undefined;
  icpProductId: string | null;
}) {
  if (!icpProductId) {
    return <span className="text-muted-foreground">—</span>;
  }

  const productScore = productScoreMap?.get(contactId);
  if (!productScore || productScore.decision_maker_score == null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const score = productScore.decision_maker_score;
  const reasoning = productScore.decision_maker_reasoning;
  const source = productScore.decision_maker_source;

  const color =
    score >= 80 ? 'status-purple' :
    score >= 60 ? 'status-info' :
    score >= 40 ? 'status-warning' :
    'status-error';

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge variant="status" className={`text-xs font-semibold ${color}`}>
          {score}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium">DM Fit: {score}/100</p>
        {reasoning && <p className="text-xs text-muted-foreground mt-1 break-words">{reasoning}</p>}
        {source && (
          <p className="text-[10px] text-muted-foreground mt-1">
            {source === 'ai' ? 'AI-verified' : 'Estimated from title'}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function JumpToPage({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const [value, setValue] = useState("");

  const goToPage = () => {
    const page = Number.parseInt(value, 10);
    if (!Number.isFinite(page)) return;
    onPageChange(Math.min(Math.max(page, 1), totalPages));
    setValue("");
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Jump to</span>
      <Input
        type="number"
        min={1}
        max={totalPages}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") goToPage();
        }}
        placeholder={String(currentPage)}
        className="h-8 w-20"
      />
      <Button variant="outline" size="sm" onClick={goToPage} disabled={!value}>
        Go
      </Button>
    </div>
  );
}

export default function LeadListDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: list, isLoading: listLoading } = useLeadList(id);
  const { data: customFieldDefsData } = useCustomFieldDefs();
  const customFieldDefs = customFieldDefsData || [];
  const listColumns: ColumnConfig[] = [
    ...LIST_COLUMNS,
    ...customFieldDefs.map((field) => ({
      key: `custom_${field.field_key}`,
      label: field.display_name,
      group: 'Custom fields',
    })),
  ];

  // Detect active analysis jobs to enable row-level status polling
  const { data: activeAnalysisJobs } = useActiveCompanyAnalysisJobs();
  const hasActiveAnalysisJobs = (activeAnalysisJobs?.length ?? 0) > 0;

  // Shared advanced filters state (used by both static and smart list views)
  const [advancedFilters, setAdvancedFilters] = useState<EnrichmentFilters>({});
  const hasAdvancedFilters = Object.values(advancedFilters).some(
    (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
  );

  // For static lists - members from junction table with pagination
  const [staticListPage, setStaticListPage] = useState(1);
  const [staticListPageSize, setStaticListPageSize] = useState(50);
  const [staticListSearch, setStaticListSearch] = useState("");
  const { data: membersData, isLoading: membersLoading } = useLeadListMembers(
    list?.is_smart ? null : id, // Only fetch if NOT a smart list
    { page: staticListPage, pageSize: staticListPageSize, search: staticListSearch || undefined, refetchInterval: hasActiveAnalysisJobs ? 3000 : undefined, enrichmentFilters: advancedFilters }
  );
  // For smart lists - contacts from dynamic query using the same hook as Contacts page
  const [smartListPage, setSmartListPage] = useState(1);
  const [smartListSearch, setSmartListSearch] = useState("");
  const [smartListSortBy, setSmartListSortBy] = useState<"display_name" | "created_at" | "lead_score">("display_name");
  const [smartListSortDirection, setSmartListSortDirection] = useState<"asc" | "desc">("asc");

  // Saved membership and temporary table filters are intersected by the same
  // SQL contract used for bulk selection. View filters never replace rules.
  const smartViewCriteria: SmartListFilterCriteria = {
    ...mergeEnrichmentIntoCriteria({}, advancedFilters),
    ...(advancedFilters.hasEmail !== undefined ? { has_email: advancedFilters.hasEmail } : {}),
  };
  const smartContactOptions = {
    page: smartListPage,
    pageSize: 50,
    search: smartListSearch || undefined,
    viewCriteria: smartViewCriteria,
    sortBy: smartListSortBy,
    sortDirection: smartListSortDirection,
    refetchInterval: hasActiveAnalysisJobs ? 3000 : 60000,
  };
  const { data: smartContacts, isLoading: smartContactsLoading, error: smartContactsError, refetch: refetchSmartContacts } = useSmartListContacts(
    list?.is_smart ? id || null : null,
    smartContactOptions,
  );

  const { data: unfilteredSmartContacts } = useSmartListContacts(
    list?.is_smart && (smartListSearch || hasAdvancedFilters) ? id || null : null,
    { pageSize: 1, refetchInterval: 60000 },
  );
  const smartSegmentTotal = (smartListSearch || hasAdvancedFilters ? unfilteredSmartContacts?.total : smartContacts?.total) ?? list?.lead_count ?? 0;

  const removeMutation = useRemoveLeadListMember();
  const bulkRemoveMutation = useBulkRemoveLeadListMembers();
  const bulkRemoveFilteredMutation = useBulkRemoveFilteredLeadListMembers();
  const refreshCountMutation = useRefreshSmartListCount();
  const updateSmartListMutation = useUpdateSmartList();
  const addToListMutation = useBulkAddLeadListMembers();
  const runLeadListProcessing = useRunLeadListProcessing();
  const startLeadListProcessing = useStartLeadListProcessing();
  const stopLeadListProcessing = useStopLeadListProcessing();
  const processingPolicy = useLeadListProcessingPolicySummary(id);
  const { data: processingStatus } = useLeadListProcessingStatus(id);
  const pauseWorkflow = usePauseLeadListProcessing();
  const resumeWorkflow = useResumeLeadListProcessing();

  // Get all lists for exclusion list selection
  const { leadLists: allLists } = useLeadLists();
  // Filter to only static lists that can be used as exclusion lists (exclude current list and smart lists)
  const availableExclusionLists = allLists.filter(
    (l) => l.id !== id && !l.is_smart && l.status === "active"
  );

  // Channel stats
  const { data: channelStats, isLoading: channelStatsLoading } = useLeadListChannelStats(id);
  const refreshChannelStatsMutation = useRefreshChannelStats();

  // Active CSV import job for this list
  const { data: activeImportJob } = useActiveCSVImportJobForList(id);

  // Auto-correct page when current page is beyond available data
  // (e.g. after bulk delete/remove leaves the current page empty)
  useEffect(() => {
    if (membersData && membersData.total > 0 && membersData.data.length === 0 && staticListPage > 1) {
      const lastPage = Math.max(1, Math.ceil(membersData.total / staticListPageSize));
      setStaticListPage(Math.min(staticListPage, lastPage));
    }
  }, [membersData, staticListPage, staticListPageSize]);

  useEffect(() => {
    if (smartContacts && smartContacts.total > 0 && smartContacts.data.length === 0 && smartListPage > 1) {
      const lastPage = Math.max(1, Math.ceil(smartContacts.total / 50));
      setSmartListPage(Math.min(smartListPage, lastPage));
    }
  }, [smartContacts, smartListPage]);

  // Get all contact IDs for sequence count lookup (current page)
  const members = membersData?.data || [];
  const allContactIds = list?.is_smart
    ? (smartContacts?.data || []).map((c) => c.id)
    : members.map((m) => m.contact_id);
  const { data: sequenceCounts } = useEmailSequencesCounts(allContactIds);

  // Email verification statuses for the visible page (cached, batched).
  // Pulls from email_address_verifications keyed by email_lower; renders the
  // "Email Verified" column badge after a Verify Emails run.
  const visibleEmails = list?.is_smart
    ? (smartContacts?.data ?? [])
        .map((c) => c.primary_email)
        .filter((e): e is string => !!e && e.trim() !== "")
    : members
        .map((m) => m.contact?.primary_email)
        .filter((e): e is string => !!e && e.trim() !== "");
  const { data: emailVerifications } = useEmailVerifications(visibleEmails);

  // SEG firewall — now reads seg_provider directly from contacts (no separate cache query needed)

  // Per-product ICP score display
  const { products } = useProducts();
  const [icpProductId, setIcpProductId] = useState<string | null>(null);
  const { data: productScoreMap } = useContactScoresForProduct(allContactIds, icpProductId);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedIds(new Set());
  }, [id, smartListSearch, staticListSearch, advancedFilters, list?.filter_criteria]);

  // Select all across pages
  const fetchAllListMemberIds = useFetchAllListMemberIds();
  const fetchAllSmartListIds = useFetchSmartListContactIds();
  const isSelectingAllPages = fetchAllListMemberIds.isPending || fetchAllSmartListIds.isPending;
  const handleSelectAllPages = () => {
    const expected = list?.is_smart ? (smartContacts?.total ?? 0) : (membersData?.total ?? 0);
    const toastId = toast.loading(
      expected > 0
        ? `Selecting all ${expected.toLocaleString()} contacts… (this can take a few seconds for large lists)`
        : "Selecting all contacts…",
    );
    if (list?.is_smart && id) {
      // Smart list: fetch all IDs matching the filter criteria
      fetchAllSmartListIds.mutate({ listId: id, ...smartContactOptions }, {
        onSuccess: (ids) => {
          setSelectedIds(new Set(ids));
          toast.success(`Selected ${ids.length.toLocaleString()} contacts`, { id: toastId });
        },
        onError: (err) => {
          toast.error(`Select all failed: ${err instanceof Error ? err.message : "unknown"}`, { id: toastId });
        },
      });
    } else if (id) {
      // Static list: fetch all member contact IDs (respecting search + enrichment filters)
      fetchAllListMemberIds.mutate({
        listId: id,
        search: staticListSearch || undefined,
        enrichmentFilters: advancedFilters,
      }, {
        onSuccess: (ids) => {
          setSelectedIds(new Set(ids));
          toast.success(`Selected ${ids.length.toLocaleString()} contacts`, { id: toastId });
        },
        onError: (err) => {
          toast.error(`Select all failed: ${err instanceof Error ? err.message : "unknown"}`, { id: toastId });
        },
      });
    } else {
      toast.dismiss(toastId);
    }
  };

  const handleSelectFirstN = (n: number) => {
    const toastId = toast.loading(`Selecting first ${n.toLocaleString()}…`);
    if (list?.is_smart && id) {
      fetchAllSmartListIds.mutate({ listId: id, ...smartContactOptions, limit: n }, {
        onSuccess: (ids) => {
          const sliced = ids.slice(0, n);
          setSelectedIds(new Set(sliced));
          toast.success(`Selected ${sliced.length.toLocaleString()} contacts`, { id: toastId });
        },
        onError: (err) => {
          toast.error(`Select failed: ${err instanceof Error ? err.message : "unknown"}`, { id: toastId });
        },
      });
    } else if (id) {
      fetchAllListMemberIds.mutate({
        listId: id,
        search: staticListSearch || undefined,
        enrichmentFilters: advancedFilters,
        // Resolve only the first N ids server-side (ordered, early-exits) rather
        // than pulling the whole filtered set and slicing — the latter was slow
        // enough on huge lists that the selection silently never applied.
        limit: n,
      }, {
        onSuccess: (ids) => {
          const sliced = ids.slice(0, n);
          setSelectedIds(new Set(sliced));
          toast.success(`Selected ${sliced.length.toLocaleString()} contacts`, { id: toastId });
        },
        onError: (err) => {
          toast.error(`Select failed: ${err instanceof Error ? err.message : "unknown"}`, { id: toastId });
        },
      });
    } else {
      toast.dismiss(toastId);
    }
  };

  const [selectNValue, setSelectNValue] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null);
  const [showEditFiltersDialog, setShowEditFiltersDialog] = useState(false);
  const [editingCriteria, setEditingCriteria] = useState<SmartListFilterCriteria>({});
  const [activitySheetContact, setActivitySheetContact] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // Exclusion list dialog state
  const [showExclusionDialog, setShowExclusionDialog] = useState(false);
  const [contactsToExclude, setContactsToExclude] = useState<string[]>([]);
  // Company analysis dialog state
  const [showAnalyzeDialog, setShowAnalyzeDialog] = useState(false);
  const [showProcessingSetup, setShowProcessingSetup] = useState(false);
  // Email sequence dialogs state
  const [showGenerateSequenceDialog, setShowGenerateSequenceDialog] = useState(false);
  const [showGenerateAndSendDialog, setShowGenerateAndSendDialog] = useState(false);
  const [generateAndSendJobId, setGenerateAndSendJobId] = useState<string | null>(null);
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [showEnrollEmailSequenceDialog, setShowEnrollEmailSequenceDialog] = useState(false);
  // Notion pages dialog state
  const [showNotionPagesDialog, setShowNotionPagesDialog] = useState(false);
  const [showRegenerateNotionDialog, setShowRegenerateNotionDialog] = useState(false);
  const [singleRegenerateContactId, setSingleRegenerateContactId] = useState<string | null>(null);
  const [notionPagesJobId, setNotionPagesJobId] = useState<string | null>(null);
  // Find emails dialog state
  const [showFindEmailsDialog, setShowFindEmailsDialog] = useState(false);
  const [showVerifyEmailsDialog, setShowVerifyEmailsDialog] = useState(false);
  // Firewall check (async toast-based)
  const { run: runFirewallCheck } = useCheckFirewalls();
  const { run: runVerifyEmails } = useVerifyEmails();
  const downloadMailtesterRawJson = useDownloadMailtesterRawJson();
  // Export dialog state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportMode, setExportMode] = useState<"selected" | "filtered" | "all">("selected");
  const exportContactsMutation = useExportContacts();
  // Lead handoffs manager state
  const [showHandoffsManager, setShowHandoffsManager] = useState(false);

  // Watch for Generate & Send job completion (background toast)
  useWatchEmailSequenceJobCompletion(generateAndSendJobId);
  // Watch for Notion pages job completion (background toast)
  useWatchEmailSequenceJobCompletion(notionPagesJobId);

  // Get static lists for "Add to List" feature (exclude current list and smart lists)
  const staticListsForAddTo = allLists.filter(
    (l) => l.id !== id && !l.is_smart && l.status === "active"
  );

  // Column visibility state - load from localStorage
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(LIST_COLUMN_PREFS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        // Auto-add seg_firewall for users with saved prefs that don't include it
        if (!parsed.includes('seg_firewall')) {
          const insertIdx = parsed.indexOf('sequences');
          if (insertIdx !== -1) {
            parsed.splice(insertIdx, 0, 'seg_firewall');
          } else {
            parsed.push('seg_firewall');
          }
        }
        // Auto-add email_verified next to seg_firewall
        if (!parsed.includes('email_verified')) {
          const segIdx = parsed.indexOf('seg_firewall');
          if (segIdx !== -1) {
            parsed.splice(segIdx + 1, 0, 'email_verified');
          } else {
            parsed.push('email_verified');
          }
        }
        // Website and firmographics are core lead data. Auto-enable both for
        // existing saved preferences so provider facts are visible immediately.
        if (!parsed.includes('website')) {
          const companyIdx = parsed.indexOf('company');
          parsed.splice(companyIdx >= 0 ? companyIdx + 1 : 1, 0, 'website');
        }
        if (!parsed.includes('firmographics')) {
          const websiteIdx = parsed.indexOf('website');
          parsed.splice(websiteIdx >= 0 ? websiteIdx + 1 : 1, 0, 'firmographics');
        }
        return parsed;
      }
    } catch {}
    return DEFAULT_LIST_COLUMNS;
  });

  // Save column preferences to localStorage
  const handleColumnVisibilityChange = (columns: string[]) => {
    setVisibleColumns(columns);
    localStorage.setItem(LIST_COLUMN_PREFS_KEY, JSON.stringify(columns));
  };

  // Mutation hooks for inline editing
  const updateContact = useUpdateContact();
  const addTag = useAddContactTag();
  const removeTag = useRemoveContactTag();

  // Delete mutations
  const deleteContact = useDeleteContact();
  const bulkDeleteContacts = useBulkDeleteContacts();
  const bulkClearSequences = useBulkClearSequences();
  const bulkDeleteNotionPages = useBulkDeleteNotionPages();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<{ id: string; name: string } | null>(null);

  // Helper to check if a column is visible
  const isVisible = (key: string) => visibleColumns.includes(key);

  // Column resize hook
  const { getTableProps, getHeaderProps, getResizeHandleProps } = useColumnResize({
    tableId: 'lead-list-detail',
    defaultWidths: LIST_DEFAULT_WIDTHS,
  });

  const tableRef = useRef<HTMLTableElement>(null);
  const [isHScrolled, setIsHScrolled] = useState(false);

  // Build visible column keys for table width calculation
  const visibleColumnKeys = [
    '_checkbox',
    'contact',
    ...visibleColumns.filter(k => k !== 'contact'),
    '_actions',
  ];

  const isLoading = listLoading || (list?.is_smart ? smartContactsLoading : membersLoading);

  // Tracks horizontal scroll to show a shadow at the edge of the frozen identity
  // column. Only one of the smart/static tables is ever mounted at a time, so
  // both `<Table>` elements below share this single ref.
  useEffect(() => {
    const scrollEl = tableRef.current?.parentElement;
    if (!scrollEl) return;
    const handleScroll = () => setIsHScrolled(scrollEl.scrollLeft > 0);
    handleScroll();
    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', handleScroll);
    // Re-attach once loading finishes and the real table has mounted.
  }, [isLoading, list?.id]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const merged = new Set(selectedIds);
      members.forEach((m) => merged.add(m.contact_id));
      setSelectedIds(merged);
    } else {
      const remaining = new Set(selectedIds);
      members.forEach((m) => remaining.delete(m.contact_id));
      setSelectedIds(remaining);
    }
  };

  const handleSelectOne = (contactId: string, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) {
      newSet.add(contactId);
    } else {
      newSet.delete(contactId);
    }
    setSelectedIds(newSet);
  };

  const handleRemove = () => {
    if (!memberToRemove || !id) return;
    if (list?.is_smart) {
      toast.error("Smart list membership is controlled by its filters. Edit the filters to change who appears.");
      return;
    }
    removeMutation.mutate(
      { listId: id, contactId: memberToRemove },
      {
        onSuccess: () => {
          setMemberToRemove(null);
          // Reset to page 1 if removing from last page could leave it empty
          if (membersData && membersData.data.length <= 1 && staticListPage > 1) {
            setStaticListPage(1);
          }
        },
      }
    );
  };

  const handleBulkRemove = () => {
    if (selectedIds.size === 0 || !id) return;
    if (list?.is_smart) {
      toast.error("Smart list membership is controlled by its filters. Edit the filters to change who appears.");
      return;
    }
    // "Select all matching" on a static list → act by filter server-side so we
    // never ship thousands of UUIDs. Smart lists / partial selections use ids.
    const staticTotal = membersData?.total ?? 0;
    const allMatchingSelected = !list?.is_smart && staticTotal > 0 && selectedIds.size >= staticTotal;
    const count = allMatchingSelected ? staticTotal : selectedIds.size;
    const toastId = toast.loading(`Removing ${count} contact${count === 1 ? '' : 's'} from list...`);
    const handlers = {
      onSuccess: () => {
        toast.dismiss(toastId);
        setSelectedIds(new Set());
        setStaticListPage(1);
      },
      onError: () => {
        toast.dismiss(toastId);
      },
    };
    if (allMatchingSelected) {
      bulkRemoveFilteredMutation.mutate(
        { listId: id, filters: buildRpcFilters(staticListSearch, advancedFilters) },
        handlers
      );
    } else {
      bulkRemoveMutation.mutate({ listId: id, contactIds: Array.from(selectedIds) }, handlers);
    }
  };

  // Exclusion list handlers
  const handleOpenExclusionDialog = (contactIds: string[]) => {
    setContactsToExclude(contactIds);
    setShowExclusionDialog(true);
  };

  const handleAddToExclusionList = (targetListId: string) => {
    if (contactsToExclude.length === 0) return;
    addToListMutation.mutate(
      { list_id: targetListId, contact_ids: contactsToExclude },
      {
        onSuccess: () => {
          setShowExclusionDialog(false);
          setContactsToExclude([]);
          // Clear selection if it was a bulk action
          if (contactsToExclude.length > 1) {
            setSelectedIds(new Set());
          }
        },
      }
    );
  };


  if (isLoading) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 min-w-0 p-8 overflow-x-hidden">
          <div className="max-w-[1400px] mx-auto space-y-6 min-w-0">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-[400px] w-full" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!list) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 min-w-0 p-8 overflow-x-hidden">
          <div className="max-w-[1400px] mx-auto text-center py-12">
            <h2 className="text-xl font-semibold mb-2">List not found</h2>
            <p className="text-muted-foreground mb-4">The list you're looking for doesn't exist.</p>
            <Button onClick={() => navigate("/leads/lists")}>Go back to lists</Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-[1400px] mx-auto space-y-6">
          {/* Back button */}
          <Button variant="ghost" onClick={() => navigate("/leads/lists")} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Lists
          </Button>

          {/* Header — wraps on narrow viewports so badges stay readable.
              Title (left) takes flex-1 + min-w-0 so it shrinks; right side
              uses shrink-0 + flex-wrap so each badge / button stays a
              single line and just spills onto a new row when needed. */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1 flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                  list.is_smart
                    ? "bg-gradient-to-br from-primary/20 to-primary/10"
                    : "bg-gradient-to-br from-primary/20 to-pink-500/20"
                }`}>
                  {list.is_smart ? (
                    <Sparkles className="h-5 w-5 text-primary" />
                  ) : (
                    <Users className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold">{list.name}</h1>
                    {list.is_smart && (
                      <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 whitespace-nowrap shrink-0">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Smart segment
                      </Badge>
                    )}
                    {!list.is_smart && (
                      <Badge variant="outline" className="whitespace-nowrap text-muted-foreground">Static list</Badge>
                    )}
                    <Badge variant="secondary" className="whitespace-nowrap">
                      {(list.is_smart ? smartSegmentTotal : list.lead_count).toLocaleString()} people
                    </Badge>
                    {activeImportJob && (
                      <Badge variant="outline" className="border-blue-300 text-blue-600 bg-blue-50 gap-1 whitespace-nowrap shrink-0">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Importing ({activeImportJob.progress}%)
                      </Badge>
                    )}
                  </div>
                  {list.description && (
                    <p className="text-muted-foreground">{list.description}</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap shrink-0">
              {!list.is_smart && (hasAdvancedFilters || staticListSearch) && membersData && (
                <Badge variant="outline" className="gap-1 whitespace-nowrap shrink-0 border-primary/50 text-primary">
                  <Filter className="h-3 w-3" />
                  {membersData.total.toLocaleString()} of {list.lead_count.toLocaleString()} match filters
                </Badge>
              )}
              {list.is_smart && list.last_computed_at && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="gap-1 whitespace-nowrap shrink-0">
                      <RefreshCw className="h-3 w-3" />
                      {formatDistanceToNow(new Date(list.last_computed_at), { addSuffix: true })}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>Last refreshed</TooltipContent>
                </Tooltip>
              )}
              {channelStats && (list.lead_count > 0 || (smartContacts?.total ?? 0) > 0) && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Badge variant="outline" className="cursor-pointer gap-2 hover:bg-accent transition-colors">
                      <Linkedin className="h-3 w-3 text-[#0A66C2]" />
                      <span className="text-muted-foreground">{Math.round(channelStats.linkedin_pct)}%</span>
                      <span className="text-border">|</span>
                      <Mail className="h-3 w-3 text-red-500" />
                      <span className="text-muted-foreground">{Math.round(channelStats.email_pct)}%</span>
                      <span className="text-border">|</span>
                      <Phone className="h-3 w-3 text-green-500" />
                      <span className="text-muted-foreground">{Math.round(channelStats.phone_pct)}%</span>
                    </Badge>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="end">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-medium">Channel Availability</p>
                      {id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => refreshChannelStatsMutation.mutate(id)}
                          disabled={refreshChannelStatsMutation.isPending}
                        >
                          <RefreshCw className={`h-3 w-3 ${refreshChannelStatsMutation.isPending ? "animate-spin" : ""}`} />
                        </Button>
                      )}
                    </div>
                    <div className="space-y-2.5">
                      {[
                        { label: "LinkedIn", icon: Linkedin, count: channelStats.has_linkedin, pct: channelStats.linkedin_pct, color: "text-[#0A66C2]" },
                        { label: "Email", icon: Mail, count: channelStats.has_email, pct: channelStats.email_pct, color: "text-red-500" },
                        { label: "Phone", icon: Phone, count: channelStats.has_phone, pct: channelStats.phone_pct, color: "text-green-500" },
                      ].map((ch) => (
                        <div key={ch.label} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <ch.icon className={`h-3 w-3 ${ch.color}`} />
                              <span>{ch.label}</span>
                            </div>
                            <span className="text-muted-foreground">
                              {ch.count}/{channelStats.total_leads}
                            </span>
                          </div>
                          <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${ch.pct >= 70 ? "bg-green-500" : ch.pct >= 30 ? "bg-yellow-500" : "bg-red-500"}`}
                              style={{ width: `${Math.min(ch.pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>

          {/* Sticky action bar — primary list actions stay reachable while scrolling. */}
          <div className="sticky top-0 z-20 -mx-8 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-8 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {list.is_smart ? (
              <>
                <LeadListProcessingDialog listId={id!} listName={list.name} open={showProcessingSetup} onOpenChange={setShowProcessingSetup} />
                <Button
                  variant="outline"
                  onClick={() => refreshCountMutation.mutate(id!)}
                  disabled={refreshCountMutation.isPending}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshCountMutation.isPending ? "animate-spin" : ""}`} />
                  Refresh audience
                </Button>
                <Button
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    setEditingCriteria(list.filter_criteria || {});
                    setShowEditFiltersDialog(true);
                  }}
                >
                  <Settings2 className="h-4 w-4 mr-2" />
                  Edit rules
                </Button>
              </>
            ) : (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <LeadListProcessingDialog listId={id!} listName={list.name} open={showProcessingSetup} onOpenChange={setShowProcessingSetup} />
                <Button variant="cta" onClick={() => navigate(`/leads/import?listId=${id}`)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add People
                </Button>
              </div>
            )}
          </div>

          {/* One-click Start — process every contact in the list. A list that keeps
              gaining new members (e.g. a live source) auto-queues each arrival via
              the enqueue trigger, so hasWork can go true within moments of enabling
              the workflow — before the operator ever gets to backfill the members
              who were already in the list. Keep showing Start until every member
              actually has a processing item, not just until something is queued. */}
          {(() => {
            const totalEligible = list.is_smart ? (smartContacts?.total ?? list.lead_count) : list.lead_count;
            const hasUnqueuedBacklog = typeof totalEligible === "number" && (processingStatus?.total ?? 0) < totalEligible;
            return id && processingPolicy.data && !processingStatus?.isPaused && (!processingStatus?.hasWork || hasUnqueuedBacklog);
          })() && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Ready to run this list</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Runs every contact in the list through your workflow{typeof list.lead_count === "number" ? ` (${list.lead_count.toLocaleString()} contact${list.lead_count === 1 ? "" : "s"})` : ""}. To run only some, select them in the table and use Actions.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowProcessingSetup(true)}>
                    <Settings2 className="mr-1.5 h-4 w-4" />
                    Edit workflow
                  </Button>
                  <Button
                    variant="cta"
                    onClick={() => {
                      if (processingStatus?.isPaused) {
                        toast.info("Resume the list workflow before starting a new run.");
                        return;
                      }
                      const toastId = toast.loading("Starting the workflow for the whole list...");
                      startLeadListProcessing.mutate(id, {
                        onSuccess: ({ queued }) => {
                          toast.success(`${queued.toLocaleString()} contact${queued === 1 ? "" : "s"} queued`, { id: toastId });
                        },
                        onError: (error) => {
                          toast.error(error instanceof Error ? error.message : "Could not start enrich & enroll", { id: toastId });
                        },
                      });
                    }}
                    disabled={startLeadListProcessing.isPending}
                  >
                    {startLeadListProcessing.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
                    Start workflow
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {id && (
            <LeadListProcessingStatus
              listId={id}
              onConfigure={() => setShowProcessingSetup(true)}
              onShowFilter={(filter) => {
                setAdvancedFilters((prev) => ({ ...prev, aiAnalysisStatus: filter }));
                setStaticListPage(1);
              }}
              onDownloadRawJson={() => downloadMailtesterRawJson.mutate({ listId: id })}
              downloadingRawJson={downloadMailtesterRawJson.isPending}
            />
          )}

          {/* Dynamic sources — watched posts/creators feeding this list */}
          {!list.is_smart && id && <ListSourcesPanel listId={id} />}

          {list.is_smart && smartContactsError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p>Could not load this segment’s people. {smartContactsError instanceof Error ? smartContactsError.message : "Try again."}</p>
            <Button variant="outline" size="sm" onClick={() => refetchSmartContacts()}>Retry audience</Button>
          </div>}

          <div className={list.is_smart ? "grid items-start gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" : ""}>
          {/* Smart List Filter Criteria Card */}
          {list.is_smart && list.filter_criteria && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Filter className="h-4 w-4 text-primary" />
                  Segment rules
                </CardTitle>
                <CardDescription>
                  People matching these rules are automatically included
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FilterCriteriaSummary criteria={list.filter_criteria} />
              </CardContent>
            </Card>
          )}

          {id && <ConnectedOutreach
            listId={id}
            listName={list.name}
            isSmart={!!list.is_smart}
            processingDestination={processingPolicy.data?.approved_destination_id && processingPolicy.data.approved_destination_type !== "none" ? {
              type: processingPolicy.data.approved_destination_type,
              id: processingPolicy.data.approved_destination_id,
              name: processingPolicy.data.destinationName ?? undefined,
              enabled: processingPolicy.data.enabled,
              isPaused: processingStatus?.isPaused,
            } : undefined}
          />}

          </div>
          {/* Optional processing progress */}
          {list.is_smart && processingPolicy.data && (
            <SmartSegmentFunnel
              isSmart={!!list.is_smart}
              counts={{
                matching: smartSegmentTotal,
                hasEmail: channelStats?.has_email,
                inWorkflow: processingStatus ? (processingStatus.pending + processingStatus.processing + processingStatus.retrying) : 0,
              }}
              processing={{
                hasPolicy: !!processingPolicy.data,
                enabled: !!processingPolicy.data?.enabled,
                isPaused: !!processingStatus?.isPaused,
                destinationLabel: processingPolicy.data?.destinationName ?? null,
                total: processingStatus?.total,
                completed: processingStatus?.completed,
                retrying: processingStatus?.retrying,
                processing: processingStatus?.processing,
                pending: processingStatus?.pending,
                rejected: processingStatus?.rejected,
              }}
              onSetupOutreach={() => setShowProcessingSetup(true)}
              onPause={() => {
                if (!id) return;
                pauseWorkflow.mutate({ listId: id }, {
                  onSuccess: () => toast.success("Workflow paused — new matches are queued until you resume."),
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Could not pause"),
                });
              }}
              onResume={() => {
                if (!id) return;
                resumeWorkflow.mutate({ listId: id }, {
                  onSuccess: () => toast.success("Workflow resumed — queued matches will process."),
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Could not resume"),
                });
              }}
              pausing={pauseWorkflow.isPending}
              resuming={resumeWorkflow.isPending}
            />
          )}

          {/* Active Import Progress Banner */}
          {activeImportJob && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
                    <span className="font-medium">Import in progress</span>
                  </div>
                  <div className="flex-1">
                    <Progress value={activeImportJob.progress} className="h-2" />
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-medium tabular-nums">{activeImportJob.progress}%</span>
                    <span className="text-muted-foreground">
                      {activeImportJob.imported_count.toLocaleString()} imported
                    </span>
                    {activeImportJob.skipped_count > 0 && (
                      <span className="text-amber-600">
                        {activeImportJob.skipped_count.toLocaleString()} skipped
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty State or Content */}
          {list.is_smart ? (
            /* Smart List Content */
            smartContacts && smartContacts.data.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Sparkles className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <h3 className="text-lg font-semibold mb-2">No matching contacts</h3>
                  <p className="text-muted-foreground mb-4">
                    {smartListSearch || hasAdvancedFilters ? "No segment members match this search or view filter." : "No people currently match the saved audience rules."}
                  </p>
                  {(smartListSearch || hasAdvancedFilters) && <Button variant="cta" className="mr-2" onClick={() => { setSmartListSearch(""); setAdvancedFilters({}); setSmartListPage(1); }}>Clear search and view filters</Button>}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingCriteria(list.filter_criteria || {});
                      setShowEditFiltersDialog(true);
                    }}
                  >
                    <Settings2 className="h-4 w-4 mr-2" />
                    Edit audience rules
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Smart List Toolbar */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search contacts..."
                      value={smartListSearch}
                      onChange={(e) => {
                        setSmartListSearch(e.target.value);
                        setSmartListPage(1);
                      }}
                      className="pl-9"
                    />
                  </div>

                  {/* Sort By */}
                  <Select
                    value={`${smartListSortBy}-${smartListSortDirection}`}
                    onValueChange={(v) => {
                      const [field, dir] = v.split("-");
                      setSmartListSortBy(field as typeof smartListSortBy);
                      setSmartListSortDirection(dir as typeof smartListSortDirection);
                      setSmartListPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[170px]">
                      <ArrowUpDown className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="display_name-asc">Name (A-Z)</SelectItem>
                      <SelectItem value="display_name-desc">Name (Z-A)</SelectItem>
                      <SelectItem value="created_at-desc">Recently Added</SelectItem>
                      <SelectItem value="created_at-asc">First Added</SelectItem>
                      <SelectItem value="lead_score-desc">Highest Score</SelectItem>
                      <SelectItem value="lead_score-asc">Lowest Score</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Column Selector */}
                  <ColumnSelector
                    columns={listColumns}
                    visibleColumns={visibleColumns}
                    onVisibilityChange={handleColumnVisibilityChange}
                    defaultVisibleColumns={DEFAULT_LIST_COLUMNS}
                  />
                </div>

                {/* Nested segments own their rules in the editor; showing a
                    second flat filter surface here would imply it changes
                    membership when it does not. */}
                {!list.filter_criteria?.rule_group && (
                  <AdvancedFilters
                    defaultOpen={hasAdvancedFilters}
                    filters={advancedFilters}
                    onChange={(filters) => {
                      setAdvancedFilters(filters);
                      setSmartListPage(1);
                    }}
                  />
                )}

                {/* Smart List Table */}
                <div className="border rounded-lg overflow-x-auto">
                  {(() => {
                    const smartData = smartContacts?.data || [];
                    const smartTotal = smartContacts?.total || 0;
                    const allPageSelected = smartData.length > 0 && smartData.every((c) => selectedIds.has(c.id));
                    const hasMorePages = smartTotal > smartData.length;
                    const allPagesAlreadySelected = selectedIds.size === smartTotal;
                    if (allPageSelected && hasMorePages && !allPagesAlreadySelected) {
                      return (
                        <div className="bg-muted/50 border-b px-4 py-2 text-center text-sm flex items-center justify-center gap-2 flex-wrap">
                          <span>All {smartData.length} contacts on this page are selected.</span>
                          <button className="text-primary font-medium hover:underline disabled:opacity-50 inline-flex items-center gap-1" onClick={handleSelectAllPages} disabled={isSelectingAllPages}>
                            {isSelectingAllPages ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Selecting {smartTotal.toLocaleString()}…
                              </>
                            ) : (
                              `Select all ${smartTotal.toLocaleString()}`
                            )}
                          </button>
                          <span className="text-muted-foreground">or select first</span>
                          <input
                            type="number"
                            min={1}
                            max={smartTotal}
                            placeholder="e.g. 1000"
                            value={selectNValue}
                            onChange={(e) => setSelectNValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { const n = parseInt(selectNValue); if (n > 0) handleSelectFirstN(n); } }}
                            disabled={isSelectingAllPages}
                            className="w-24 h-7 px-2 text-sm border rounded bg-background text-foreground disabled:opacity-50"
                          />
                          <button
                            className="text-primary font-medium hover:underline disabled:opacity-50"
                            disabled={isSelectingAllPages || !selectNValue || parseInt(selectNValue) < 1}
                            onClick={() => { const n = parseInt(selectNValue); if (n > 0) handleSelectFirstN(n); }}
                          >Go</button>
                        </div>
                      );
                    }
                    if (allPagesAlreadySelected && selectedIds.size > smartData.length) {
                      return (
                        <div className="bg-muted/50 border-b px-4 py-2 text-center text-sm">
                          All {smartTotal.toLocaleString()} contacts are selected.{" "}
                          <button className="text-primary font-medium hover:underline" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <Table ref={tableRef} style={getTableProps(visibleColumnKeys).style}>
                    <TableHeader>
                      <TableRow className="[&>th]:text-[10px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:border-b-2 [&>th]:border-foreground/70">
                        <TableHead
                          className="sticky left-0 z-30 h-9 bg-background px-3 py-1.5"
                          style={getHeaderProps('_checkbox').style}
                        >
                          <Checkbox
                            checked={
                              smartContacts?.data &&
                              smartContacts.data.length > 0 &&
                              smartContacts.data.every((c) => selectedIds.has(c.id))
                            }
                            onCheckedChange={(checked) => {
                              if (checked) {
                                const merged = new Set(selectedIds);
                                (smartContacts?.data || []).forEach((c) => merged.add(c.id));
                                setSelectedIds(merged);
                              } else {
                                const remaining = new Set(selectedIds);
                                (smartContacts?.data || []).forEach((c) => remaining.delete(c.id));
                                setSelectedIds(remaining);
                              }
                            }}
                          />
                        </TableHead>
                        <TableHead
                          className={cn(
                            "sticky z-30 h-9 bg-background px-3 py-1.5 text-xs",
                            isHScrolled && "shadow-[4px_0_6px_-2px_rgba(0,0,0,0.12)] dark:shadow-black/40",
                          )}
                          style={{ left: LIST_DEFAULT_WIDTHS._checkbox, ...getHeaderProps('contact').style }}
                        >
                          <ColumnHeaderLabel columnKey="contact">Contact</ColumnHeaderLabel>
                          <ResizeHandle {...getResizeHandleProps('contact')} />
                        </TableHead>
                        {isVisible('linkedin_url') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('linkedin_url').style}>
                            <ColumnHeaderLabel columnKey="linkedin_url">LinkedIn URL</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('linkedin_url')} />
                          </TableHead>
                        )}
                        {isVisible('company') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('company').style}>
                            <ColumnHeaderLabel columnKey="company">Company</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('company')} />
                          </TableHead>
                        )}
                        {isVisible('firmographics') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('firmographics').style}>
                            <ColumnHeaderLabel columnKey="firmographics">Firmographics</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('firmographics')} />
                          </TableHead>
                        )}
                        {isVisible('job_title') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('job_title').style}>
                            <ColumnHeaderLabel columnKey="job_title">Job Title</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('job_title')} />
                          </TableHead>
                        )}
                        {isVisible('email') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('email').style}>
                            <ColumnHeaderLabel columnKey="email">Email</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('email')} />
                          </TableHead>
                        )}
                        {isVisible('website') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('website').style}>
                            <ColumnHeaderLabel columnKey="website">Website</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('website')} />
                          </TableHead>
                        )}
                        {isVisible('phone') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('phone').style}>
                            <ColumnHeaderLabel columnKey="phone">Phone</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('phone')} />
                          </TableHead>
                        )}
                        {isVisible('location') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('location').style}>
                            <ColumnHeaderLabel columnKey="location">Location</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('location')} />
                          </TableHead>
                        )}
                        {isVisible('tags') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('tags').style}>
                            <ColumnHeaderLabel columnKey="tags">Tags</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('tags')} />
                          </TableHead>
                        )}
                        {isVisible('outreach') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('outreach').style}>
                            <ColumnHeaderLabel columnKey="outreach">Outreach</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('outreach')} />
                          </TableHead>
                        )}
                        {isVisible('ai_analyzed') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('ai_analyzed').style}>
                            <ColumnHeaderLabel columnKey="ai_analyzed">AI Analyzed</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('ai_analyzed')} />
                          </TableHead>
                        )}
                        {isVisible('ai_insights') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('ai_insights').style}>
                            <ColumnHeaderLabel columnKey="ai_insights">AI Insights</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('ai_insights')} />
                          </TableHead>
                        )}
                        {isVisible('icp_score') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('icp_score').style}>
                            <div className="flex items-center gap-1">
                              <Target className="h-3 w-3 shrink-0" />
                              {products && products.length > 0 ? (
                                <Select
                                  value={icpProductId || "_overall"}
                                  onValueChange={(v) => setIcpProductId(v === "_overall" ? null : v)}
                                >
                                  <SelectTrigger className="h-6 text-xs border-none shadow-none px-1 min-w-0 w-auto bg-transparent">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_overall">ICP (Overall)</SelectItem>
                                    {products.map((p) => (
                                      <SelectItem key={p.id} value={p.id}>
                                        ICP: {p.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span>ICP Score</span>
                              )}
                            </div>
                            <ResizeHandle {...getResizeHandleProps('icp_score')} />
                          </TableHead>
                        )}
                        {isVisible('dm_score') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('dm_score').style}>
                            <div className="flex items-center gap-1">
                              <UserCheck className="h-3 w-3 shrink-0 text-violet-500" />
                              {products && products.length > 0 ? (
                                <Select
                                  value={icpProductId || "_overall"}
                                  onValueChange={(v) => setIcpProductId(v === "_overall" ? null : v)}
                                >
                                  <SelectTrigger className="h-6 text-xs border-none shadow-none px-1 min-w-0 w-auto bg-transparent">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_overall">DM Fit (Overall)</SelectItem>
                                    {products.map((p) => (
                                      <SelectItem key={p.id} value={p.id}>
                                        DM: {p.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span>DM Fit</span>
                              )}
                            </div>
                            <ResizeHandle {...getResizeHandleProps('dm_score')} />
                          </TableHead>
                        )}
                        {isVisible('source') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('source').style}>
                            <ColumnHeaderLabel columnKey="source">Source</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('source')} />
                          </TableHead>
                        )}
                        {isVisible('score') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs text-right" style={getHeaderProps('score').style}>
                            <div className="flex justify-end">
                              <ColumnHeaderLabel columnKey="score">Score</ColumnHeaderLabel>
                            </div>
                            <ResizeHandle {...getResizeHandleProps('score')} />
                          </TableHead>
                        )}
                        {isVisible('sequences') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('sequences').style}>
                            <ColumnHeaderLabel columnKey="sequences">Sequences</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('sequences')} />
                          </TableHead>
                        )}
                        {isVisible('notion_url') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('notion_url').style}>
                            <ColumnHeaderLabel columnKey="notion_url">Notion URL</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('notion_url')} />
                          </TableHead>
                        )}
                        {isVisible('seg_firewall') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('seg_firewall').style}>
                            <ColumnHeaderLabel columnKey="seg_firewall">Email Firewall</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('seg_firewall')} />
                          </TableHead>
                        )}
                        {isVisible('email_verified') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('email_verified').style}>
                            <ColumnHeaderLabel columnKey="email_verified">Email Verified</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('email_verified')} />
                          </TableHead>
                        )}
                        {customFieldDefs.filter((field) => isVisible(`custom_${field.field_key}`)).map((field) => (
                          <TableHead key={field.id} className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps(`custom_${field.field_key}`).style}>
                            {field.display_name}
                            <ResizeHandle {...getResizeHandleProps(`custom_${field.field_key}`)} />
                          </TableHead>
                        ))}
                        <TableHead className="h-9 px-3 py-1.5" style={getHeaderProps('_actions').style}></TableHead>
                        <TableHead className="h-9 w-10 p-0">
                          <ColumnSelector
                            columns={listColumns}
                            visibleColumns={visibleColumns}
                            onVisibilityChange={handleColumnVisibilityChange}
                            defaultVisibleColumns={DEFAULT_LIST_COLUMNS}
                            trigger={
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Add field">
                                <Plus className="h-4 w-4" />
                              </Button>
                            }
                          />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(smartContacts?.data || []).map((contact) => {
                          const getSourceLabel = (source: string | null) => {
                            if (!source) return null;
                            const labels: Record<string, string> = {
                              linkedin_connection: "LinkedIn",
                              linkedin_comment: "LinkedIn Lead",
                              instagram_comment: "Instagram",
                              manual: "Manual",
                              import: "Import",
                              api: "API",
                            };
                            return labels[source] || source;
                          };

                          // Get LinkedIn identity avatar as fallback
                          const linkedinIdentity = contact.identities?.find(
                            (i) => i.channel === "linkedin"
                          );
                          const fallbackAvatarUrl = linkedinIdentity?.platform_avatar_url;

                          const isSelected = selectedIds.has(contact.id);
                          return (
                            <TableRow key={contact.id} className="group">
                              {/* Selection checkbox — frozen */}
                              <TableCell
                                className={cn(
                                  "sticky left-0 z-20 bg-background px-3 py-1.5 group-hover:bg-muted",
                                  isSelected && "!bg-muted",
                                )}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    const newSet = new Set(selectedIds);
                                    if (checked) {
                                      newSet.add(contact.id);
                                    } else {
                                      newSet.delete(contact.id);
                                    }
                                    setSelectedIds(newSet);
                                  }}
                                />
                              </TableCell>
                              {/* Contact - always visible, frozen */}
                              <TableCell
                                className={cn(
                                  "sticky z-20 bg-background px-3 py-1.5 group-hover:bg-muted",
                                  isSelected && "!bg-muted",
                                  isHScrolled && "shadow-[4px_0_6px_-2px_rgba(0,0,0,0.12)] dark:shadow-black/40",
                                )}
                                style={{ left: LIST_DEFAULT_WIDTHS._checkbox }}
                              >
                                <ContactCell
                                  contactId={contact.id}
                                  displayName={contact.display_name}
                                  avatarUrl={contact.avatar_url}
                                  fallbackAvatarUrl={fallbackAvatarUrl}
                                  email={contact.primary_email}
                                  avatarClassName="h-7 w-7 rounded-md"
                                  fallbackClassName="rounded-md bg-primary/10 text-primary font-semibold"
                                />
                              </TableCell>
                              {isVisible('linkedin_url') && (
                                <TableCell className="px-3 py-1.5"><LinkedInUrlCell url={contact.primary_linkedin_url} /></TableCell>
                              )}
                              {/* Company - editable */}
                              {isVisible('company') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTextCell
                                    value={contact.company}
                                    onSave={async (value) => {
                                      await updateContact.mutateAsync({ id: contact.id, company: value });
                                    }}
                                    placeholder="Add company"
                                  />
                                </TableCell>
                              )}
                              {isVisible('firmographics') && (
                                <TableCell className="px-3 py-1.5">
                                  <FirmographicsCell
                                    enrichmentData={contact.enrichment_data as Record<string, unknown> | null}
                                    customFields={contact.custom_fields as Record<string, unknown> | null}
                                  />
                                </TableCell>
                              )}
                              {/* Job Title - editable */}
                              {isVisible('job_title') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTextCell
                                    value={contact.job_title}
                                    onSave={async (value) => {
                                      await updateContact.mutateAsync({ id: contact.id, job_title: value });
                                    }}
                                    placeholder="Add job title"
                                  />
                                </TableCell>
                              )}
                              {/* Email - editable */}
                              {isVisible('email') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTextCell
                                    value={contact.primary_email}
                                    onSave={async (value) => {
                                      await updateContact.mutateAsync({ id: contact.id, primary_email: value });
                                    }}
                                    placeholder="Add email"
                                    type="email"
                                  />
                                </TableCell>
                              )}
                              {/* Website - editable */}
                              {isVisible('website') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTextCell
                                    value={contact.company_website}
                                    onSave={async (value) => {
                                      await updateContact.mutateAsync({ id: contact.id, company_website: value });
                                    }}
                                    placeholder="Add website"
                                    type="url"
                                  />
                                </TableCell>
                              )}
                              {/* Phone - editable */}
                              {isVisible('phone') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTextCell
                                    value={contact.primary_phone}
                                    onSave={async (value) => {
                                      await updateContact.mutateAsync({ id: contact.id, primary_phone: value });
                                    }}
                                    placeholder="Add phone"
                                    type="tel"
                                  />
                                </TableCell>
                              )}
                              {/* Location - editable */}
                              {isVisible('location') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableLocationCell
                                    city={contact.city}
                                    state={contact.state}
                                    country={contact.country}
                                    onSave={async (location) => {
                                      await updateContact.mutateAsync({
                                        id: contact.id,
                                        city: location.city,
                                        state: location.state,
                                        country: location.country,
                                      });
                                    }}
                                  />
                                </TableCell>
                              )}
                              {/* Tags - editable */}
                              {isVisible('tags') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTagsCell
                                    tags={contact.tags || []}
                                    onAddTag={async (tag) => {
                                      await addTag.mutateAsync({ contactId: contact.id, tag });
                                    }}
                                    onRemoveTag={async (tag) => {
                                      await removeTag.mutateAsync({ contactId: contact.id, tag });
                                    }}
                                  />
                                </TableCell>
                              )}
                              {/* Outreach Status - read only */}
                              {isVisible('outreach') && (
                                <TableCell className="px-3 py-1.5">
                                  <OutreachStatusBadge status={contact.outreach_status} />
                                </TableCell>
                              )}
                              {/* AI Analysis Status - read only */}
                              {isVisible('ai_analyzed') && (
                                <TableCell className="px-3 py-1.5">
                                  <AiAnalysisStatusBadge status={contact.ai_analysis_status} />
                                </TableCell>
                              )}
                              {/* AI Insights - primary need from analysis */}
                              {isVisible('ai_insights') && (
                                <TableCell className="px-3 py-1.5">
                                  {contact.enrichment_data && (contact.enrichment_data as { primary_need?: string }).primary_need ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-sm break-words line-clamp-2 cursor-help">
                                          {(contact.enrichment_data as { primary_need?: string }).primary_need}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[350px]">
                                        <p className="font-medium mb-1">Primary Need</p>
                                        <p className="break-words">{(contact.enrichment_data as { primary_need?: string }).primary_need}</p>
                                        {(contact.enrichment_data as { primary_need_reasoning?: string }).primary_need_reasoning && (
                                          <>
                                            <p className="font-medium mt-2 mb-1">Reasoning</p>
                                            <p className="break-words text-muted-foreground">{(contact.enrichment_data as { primary_need_reasoning?: string }).primary_need_reasoning}</p>
                                          </>
                                        )}
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              )}
                              {/* ICP Score (per-product or overall) */}
                              {isVisible('icp_score') && (
                                <TableCell className="px-3 py-1.5">
                                  <IcpScoreCell
                                    contactId={contact.id}
                                    enrichmentData={contact.enrichment_data as Record<string, unknown> | null}
                                    productScoreMap={productScoreMap}
                                    icpProductId={icpProductId}
                                  />
                                </TableCell>
                              )}
                              {/* DM Fit Score (per-product only) */}
                              {isVisible('dm_score') && (
                                <TableCell className="px-3 py-1.5">
                                  <DmScoreCell
                                    contactId={contact.id}
                                    productScoreMap={productScoreMap}
                                    icpProductId={icpProductId}
                                  />
                                </TableCell>
                              )}
                              {/* Source - read only */}
                              {isVisible('source') && (
                                <TableCell className="px-3 py-1.5">
                                  {contact.source ? (
                                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                                      {getSourceLabel(contact.source)}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              )}
                              {/* Score - read only */}
                              {isVisible('score') && (
                                <TableCell className="px-3 py-1.5 text-right">
                                  <ScoreBarCell score={contact.lead_score} />
                                </TableCell>
                              )}
                              {/* Sequences - read only indicator */}
                              {isVisible('sequences') && (
                                <TableCell className="px-3 py-1.5">
                                  <SequenceIndicator
                                    count={sequenceCounts?.get(contact.id)?.count}
                                    status={sequenceCounts?.get(contact.id)?.latestStatus}
                                    pushedToTool={sequenceCounts?.get(contact.id)?.pushedToTool}
                                  />
                                </TableCell>
                              )}
                              {/* Notion URL - read only */}
                              {isVisible('notion_url') && (
                                <TableCell className="px-3 py-1.5">
                                  {(contact as any).notion_preview_url ? (
                                    <a
                                      href={(contact as any).notion_preview_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Badge variant="outline" className="text-xs gap-1 cursor-pointer hover:bg-accent">
                                        <ExternalLink className="h-3 w-3" />
                                        Notion
                                      </Badge>
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              )}
                              {/* Email Firewall (SEG) */}
                              {isVisible('seg_firewall') && (
                                <TableCell className="px-3 py-1.5">
                                  {contact.seg_provider ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="status" className="status-warning gap-1 text-[10px]">
                                          <ShieldAlert className="h-3 w-3" />
                                          {contact.seg_provider}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-xs">This domain routes through {contact.seg_provider} email firewall</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : contact.seg_checked_at ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="status" className="status-success gap-1 text-[10px]">
                                          <ShieldCheck className="h-3 w-3" />
                                          Clear
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-xs">No email firewall detected</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              )}
                              {/* Email Verified */}
                              {isVisible('email_verified') && (
                                <TableCell className="px-3 py-1.5">
                                  <EmailVerifiedBadge
                                    email={contact.primary_email}
                                    info={resolveEmailVerification(contact, emailVerifications)}
                                  />
                                </TableCell>
                              )}
                              {customFieldDefs.filter((field) => isVisible(`custom_${field.field_key}`)).map((field) => (
                                <TableCell key={field.id} className="px-3 py-1.5">
                                  <CustomFieldCell field={field} customFields={contact.custom_fields} />
                                </TableCell>
                              ))}
                              {/* Actions */}
                              <TableCell className="px-3 py-1.5">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem asChild>
                                      <Link to={`/people/${contact.id}`}>
                                        <ExternalLink className="h-4 w-4 mr-2" />
                                        View Contact
                                      </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => setActivitySheetContact({
                                        id: contact.id,
                                        name: contact.display_name,
                                      })}
                                    >
                                      <Activity className="h-4 w-4 mr-2" />
                                      View Activity
                                    </DropdownMenuItem>
                                    {contact.primary_linkedin_url && (
                                      <DropdownMenuItem asChild>
                                        <a
                                          href={contact.primary_linkedin_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          <ExternalLink className="h-4 w-4 mr-2" />
                                          LinkedIn Profile
                                        </a>
                                      </DropdownMenuItem>
                                    )}
                                    {availableExclusionLists.length > 0 && (
                                      <DropdownMenuItem
                                        onClick={() => handleOpenExclusionDialog([contact.id])}
                                      >
                                        <Ban className="h-4 w-4 mr-2" />
                                        Add to Exclusion List
                                      </DropdownMenuItem>
                                    )}
                                    {(contact as any).notion_preview_url && (
                                      <DropdownMenuItem
                                        onClick={() => setSingleRegenerateContactId(contact.id)}
                                      >
                                        <RefreshCw className="h-4 w-4 mr-2" />
                                        Regenerate Notion Page
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                      onClick={() => setContactToDelete({ id: contact.id, name: contact.display_name || 'Contact' })}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete Contact
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                              <TableCell className="w-10 p-0" />
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>

                {/* Smart List Pagination */}
                {smartContacts && smartContacts.totalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Showing {((smartContacts.page - 1) * smartContacts.pageSize) + 1} - {Math.min(smartContacts.page * smartContacts.pageSize, smartContacts.total)} of {smartContacts.total}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={smartContacts.page <= 1}
                        onClick={() => setSmartListPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground px-2">
                        Page {smartContacts.page} of {smartContacts.totalPages}
                      </span>
                      <JumpToPage
                        currentPage={smartContacts.page}
                        totalPages={smartContacts.totalPages}
                        onPageChange={setSmartListPage}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={smartContacts.page >= smartContacts.totalPages}
                        onClick={() => setSmartListPage((p) => p + 1)}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )
          ) : (
            /* Static List Content */
            membersData && membersData.total === 0 && !staticListSearch && !hasAdvancedFilters ? (
              <EmptyListState listId={id!} listName={list.name} />
            ) : (
              <>
                {/* Static List Toolbar */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search contacts..."
                      value={staticListSearch}
                      onChange={(e) => {
                        setStaticListSearch(e.target.value);
                        setStaticListPage(1);
                      }}
                      className="pl-9"
                    />
                  </div>

                  {/* Column Selector */}
                  <ColumnSelector
                    columns={listColumns}
                    visibleColumns={visibleColumns}
                    onVisibilityChange={handleColumnVisibilityChange}
                    defaultVisibleColumns={DEFAULT_LIST_COLUMNS}
                  />
                </div>

                {/* Advanced Filters */}
                <AdvancedFilters
                  defaultOpen={hasAdvancedFilters}
                  filters={advancedFilters}
                  onChange={(filters) => {
                    setAdvancedFilters(filters);
                    setStaticListPage(1);
                  }}
                />

                {/* Members Table */}
                <div className="border rounded-lg overflow-x-auto">
                  {(() => {
                    const memberTotal = membersData?.total || 0;
                    const allPageSelected = members.length > 0 && members.every((m) => selectedIds.has(m.contact_id));
                    const hasMorePages = memberTotal > members.length;
                    const allPagesAlreadySelected = selectedIds.size === memberTotal;
                    if (allPageSelected && hasMorePages && !allPagesAlreadySelected) {
                      return (
                        <div className="bg-muted/50 border-b px-4 py-2 text-center text-sm flex items-center justify-center gap-2 flex-wrap">
                          <span>All {members.length} contacts on this page are selected.</span>
                          <button className="text-primary font-medium hover:underline disabled:opacity-50 inline-flex items-center gap-1" onClick={handleSelectAllPages} disabled={isSelectingAllPages}>
                            {isSelectingAllPages ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Selecting {memberTotal.toLocaleString()}…
                              </>
                            ) : (
                              `Select all ${memberTotal.toLocaleString()}`
                            )}
                          </button>
                          <span className="text-muted-foreground">or select first</span>
                          <input
                            type="number"
                            min={1}
                            max={memberTotal}
                            placeholder="e.g. 1000"
                            value={selectNValue}
                            onChange={(e) => setSelectNValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { const n = parseInt(selectNValue); if (n > 0) handleSelectFirstN(n); } }}
                            disabled={isSelectingAllPages}
                            className="w-24 h-7 px-2 text-sm border rounded bg-background text-foreground disabled:opacity-50"
                          />
                          <button
                            className="text-primary font-medium hover:underline disabled:opacity-50"
                            disabled={isSelectingAllPages || !selectNValue || parseInt(selectNValue) < 1}
                            onClick={() => { const n = parseInt(selectNValue); if (n > 0) handleSelectFirstN(n); }}
                          >Go</button>
                        </div>
                      );
                    }
                    if (allPagesAlreadySelected && selectedIds.size > members.length) {
                      return (
                        <div className="bg-muted/50 border-b px-4 py-2 text-center text-sm">
                          All {memberTotal.toLocaleString()} contacts are selected.{" "}
                          <button className="text-primary font-medium hover:underline" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <Table ref={tableRef} style={getTableProps(visibleColumnKeys).style}>
                    <TableHeader>
                      <TableRow className="[&>th]:text-[10px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:border-b-2 [&>th]:border-foreground/70">
                        <TableHead
                          className="sticky left-0 z-30 h-9 bg-background px-3 py-1.5"
                          style={getHeaderProps('_checkbox').style}
                        >
                          <Checkbox
                            checked={
                              members.length > 0 &&
                              members.every((m) => selectedIds.has(m.contact_id))
                            }
                            onCheckedChange={handleSelectAll}
                          />
                        </TableHead>
                        <TableHead
                          className={cn(
                            "sticky z-30 h-9 bg-background px-3 py-1.5 text-xs",
                            isHScrolled && "shadow-[4px_0_6px_-2px_rgba(0,0,0,0.12)] dark:shadow-black/40",
                          )}
                          style={{ left: LIST_DEFAULT_WIDTHS._checkbox, ...getHeaderProps('contact').style }}
                        >
                          <ColumnHeaderLabel columnKey="contact">Contact</ColumnHeaderLabel>
                          <ResizeHandle {...getResizeHandleProps('contact')} />
                        </TableHead>
                        {isVisible('linkedin_url') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('linkedin_url').style}>
                            <ColumnHeaderLabel columnKey="linkedin_url">LinkedIn URL</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('linkedin_url')} />
                          </TableHead>
                        )}
                        {isVisible('company') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('company').style}>
                            <ColumnHeaderLabel columnKey="company">Company</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('company')} />
                          </TableHead>
                        )}
                        {isVisible('firmographics') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('firmographics').style}>
                            <ColumnHeaderLabel columnKey="firmographics">Firmographics</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('firmographics')} />
                          </TableHead>
                        )}
                        {isVisible('job_title') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('job_title').style}>
                            <ColumnHeaderLabel columnKey="job_title">Job Title</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('job_title')} />
                          </TableHead>
                        )}
                        {isVisible('email') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('email').style}>
                            <ColumnHeaderLabel columnKey="email">Email</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('email')} />
                          </TableHead>
                        )}
                        {isVisible('website') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('website').style}>
                            <ColumnHeaderLabel columnKey="website">Website</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('website')} />
                          </TableHead>
                        )}
                        {isVisible('phone') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('phone').style}>
                            <ColumnHeaderLabel columnKey="phone">Phone</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('phone')} />
                          </TableHead>
                        )}
                        {isVisible('location') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('location').style}>
                            <ColumnHeaderLabel columnKey="location">Location</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('location')} />
                          </TableHead>
                        )}
                        {isVisible('tags') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('tags').style}>
                            <ColumnHeaderLabel columnKey="tags">Tags</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('tags')} />
                          </TableHead>
                        )}
                        {isVisible('outreach') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('outreach').style}>
                            <ColumnHeaderLabel columnKey="outreach">Outreach</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('outreach')} />
                          </TableHead>
                        )}
                        {isVisible('ai_analyzed') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('ai_analyzed').style}>
                            <ColumnHeaderLabel columnKey="ai_analyzed">AI Analyzed</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('ai_analyzed')} />
                          </TableHead>
                        )}
                        {isVisible('ai_insights') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('ai_insights').style}>
                            <ColumnHeaderLabel columnKey="ai_insights">AI Insights</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('ai_insights')} />
                          </TableHead>
                        )}
                        {isVisible('icp_score') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('icp_score').style}>
                            <div className="flex items-center gap-1">
                              <Target className="h-3 w-3 shrink-0" />
                              {products && products.length > 0 ? (
                                <Select
                                  value={icpProductId || "_overall"}
                                  onValueChange={(v) => setIcpProductId(v === "_overall" ? null : v)}
                                >
                                  <SelectTrigger className="h-6 text-xs border-none shadow-none px-1 min-w-0 w-auto bg-transparent">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_overall">ICP (Overall)</SelectItem>
                                    {products.map((p) => (
                                      <SelectItem key={p.id} value={p.id}>
                                        ICP: {p.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span>ICP Score</span>
                              )}
                            </div>
                            <ResizeHandle {...getResizeHandleProps('icp_score')} />
                          </TableHead>
                        )}
                        {isVisible('dm_score') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('dm_score').style}>
                            <div className="flex items-center gap-1">
                              <UserCheck className="h-3 w-3 shrink-0 text-violet-500" />
                              {products && products.length > 0 ? (
                                <Select
                                  value={icpProductId || "_overall"}
                                  onValueChange={(v) => setIcpProductId(v === "_overall" ? null : v)}
                                >
                                  <SelectTrigger className="h-6 text-xs border-none shadow-none px-1 min-w-0 w-auto bg-transparent">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_overall">DM Fit (Overall)</SelectItem>
                                    {products.map((p) => (
                                      <SelectItem key={p.id} value={p.id}>
                                        DM: {p.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span>DM Fit</span>
                              )}
                            </div>
                            <ResizeHandle {...getResizeHandleProps('dm_score')} />
                          </TableHead>
                        )}
                        {isVisible('source') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('source').style}>
                            <ColumnHeaderLabel columnKey="source">Source</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('source')} />
                          </TableHead>
                        )}
                        {isVisible('score') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs text-right" style={getHeaderProps('score').style}>
                            <div className="flex justify-end">
                              <ColumnHeaderLabel columnKey="score">Score</ColumnHeaderLabel>
                            </div>
                            <ResizeHandle {...getResizeHandleProps('score')} />
                          </TableHead>
                        )}
                        {isVisible('sequences') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('sequences').style}>
                            <ColumnHeaderLabel columnKey="sequences">Sequences</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('sequences')} />
                          </TableHead>
                        )}
                        {isVisible('notion_url') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('notion_url').style}>
                            <ColumnHeaderLabel columnKey="notion_url">Notion URL</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('notion_url')} />
                          </TableHead>
                        )}
                        {isVisible('seg_firewall') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('seg_firewall').style}>
                            <ColumnHeaderLabel columnKey="seg_firewall">Email Firewall</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('seg_firewall')} />
                          </TableHead>
                        )}
                        {isVisible('email_verified') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('email_verified').style}>
                            <ColumnHeaderLabel columnKey="email_verified">Email Verified</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('email_verified')} />
                          </TableHead>
                        )}
                        {isVisible('added') && (
                          <TableHead className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps('added').style}>
                            <ColumnHeaderLabel columnKey="added">Added</ColumnHeaderLabel>
                            <ResizeHandle {...getResizeHandleProps('added')} />
                          </TableHead>
                        )}
                        {customFieldDefs.filter((field) => isVisible(`custom_${field.field_key}`)).map((field) => (
                          <TableHead key={field.id} className="relative h-9 px-3 py-1.5 text-xs" style={getHeaderProps(`custom_${field.field_key}`).style}>
                            {field.display_name}
                            <ResizeHandle {...getResizeHandleProps(`custom_${field.field_key}`)} />
                          </TableHead>
                        ))}
                        <TableHead className="h-9 px-3 py-1.5" style={getHeaderProps('_actions').style}></TableHead>
                        <TableHead className="h-9 w-10 p-0">
                          <ColumnSelector
                            columns={listColumns}
                            visibleColumns={visibleColumns}
                            onVisibilityChange={handleColumnVisibilityChange}
                            defaultVisibleColumns={DEFAULT_LIST_COLUMNS}
                            trigger={
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Add field">
                                <Plus className="h-4 w-4" />
                              </Button>
                            }
                          />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={visibleColumns.length + 2} className="text-center py-8 text-muted-foreground">
                            No contacts match your filters
                          </TableCell>
                        </TableRow>
                      ) : (
                        members.map((member) => {
                          const contact = member.contact;
                          if (!contact) return null;

                          const getSourceLabel = (source: string | null) => {
                            if (!source) return null;
                            const labels: Record<string, string> = {
                              linkedin_connection: "LinkedIn",
                              linkedin_comment: "LinkedIn Lead",
                              instagram_comment: "Instagram",
                              manual: "Manual",
                              import: "Import",
                              api: "API",
                            };
                            return labels[source] || source;
                          };

                          // Get LinkedIn identity avatar as fallback
                          const linkedinIdentity = contact.identities?.find(
                            (i) => i.channel === "linkedin"
                          );
                          const fallbackAvatarUrl = linkedinIdentity?.platform_avatar_url;

                          const isSelected = selectedIds.has(member.contact_id);
                          return (
                            <TableRow key={member.id} className="group">
                              {/* Selection checkbox — frozen */}
                              <TableCell
                                className={cn(
                                  "sticky left-0 z-20 bg-background px-3 py-1.5 group-hover:bg-muted",
                                  isSelected && "!bg-muted",
                                )}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) =>
                                    handleSelectOne(member.contact_id, checked as boolean)
                                  }
                                />
                              </TableCell>
                              {/* Contact - always visible, frozen */}
                              <TableCell
                                className={cn(
                                  "sticky z-20 bg-background px-3 py-1.5 group-hover:bg-muted",
                                  isSelected && "!bg-muted",
                                  isHScrolled && "shadow-[4px_0_6px_-2px_rgba(0,0,0,0.12)] dark:shadow-black/40",
                                )}
                                style={{ left: LIST_DEFAULT_WIDTHS._checkbox }}
                              >
                                <ContactCell
                                  contactId={contact.id}
                                  displayName={contact.display_name}
                                  avatarUrl={contact.avatar_url}
                                  fallbackAvatarUrl={fallbackAvatarUrl}
                                  email={contact.primary_email}
                                  avatarClassName="h-7 w-7 rounded-md"
                                  fallbackClassName="rounded-md bg-primary/10 text-primary font-semibold"
                                />
                              </TableCell>
                              {isVisible('linkedin_url') && (
                                <TableCell className="px-3 py-1.5"><LinkedInUrlCell url={contact.primary_linkedin_url} /></TableCell>
                              )}
                              {/* Company - editable */}
                              {isVisible('company') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTextCell
                                    value={contact.company}
                                    onSave={async (value) => {
                                      await updateContact.mutateAsync({ id: contact.id, company: value });
                                    }}
                                    placeholder="Add company"
                                  />
                                </TableCell>
                              )}
                              {isVisible('firmographics') && (
                                <TableCell className="px-3 py-1.5">
                                  <FirmographicsCell
                                    enrichmentData={contact.enrichment_data as Record<string, unknown> | null}
                                    customFields={contact.custom_fields as Record<string, unknown> | null}
                                  />
                                </TableCell>
                              )}
                              {/* Job Title - editable */}
                              {isVisible('job_title') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTextCell
                                    value={contact.job_title}
                                    onSave={async (value) => {
                                      await updateContact.mutateAsync({ id: contact.id, job_title: value });
                                    }}
                                    placeholder="Add job title"
                                  />
                                </TableCell>
                              )}
                              {/* Email - editable */}
                              {isVisible('email') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTextCell
                                    value={contact.primary_email}
                                    onSave={async (value) => {
                                      await updateContact.mutateAsync({ id: contact.id, primary_email: value });
                                    }}
                                    placeholder="Add email"
                                    type="email"
                                  />
                                </TableCell>
                              )}
                              {/* Website - editable */}
                              {isVisible('website') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTextCell
                                    value={contact.company_website}
                                    onSave={async (value) => {
                                      await updateContact.mutateAsync({ id: contact.id, company_website: value });
                                    }}
                                    placeholder="Add website"
                                    type="url"
                                  />
                                </TableCell>
                              )}
                              {/* Phone - editable */}
                              {isVisible('phone') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTextCell
                                    value={contact.primary_phone}
                                    onSave={async (value) => {
                                      await updateContact.mutateAsync({ id: contact.id, primary_phone: value });
                                    }}
                                    placeholder="Add phone"
                                    type="tel"
                                  />
                                </TableCell>
                              )}
                              {/* Location - editable */}
                              {isVisible('location') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableLocationCell
                                    city={contact.city}
                                    state={contact.state}
                                    country={contact.country}
                                    onSave={async (location) => {
                                      await updateContact.mutateAsync({
                                        id: contact.id,
                                        city: location.city,
                                        state: location.state,
                                        country: location.country,
                                      });
                                    }}
                                  />
                                </TableCell>
                              )}
                              {/* Tags - editable */}
                              {isVisible('tags') && (
                                <TableCell className="px-3 py-1.5">
                                  <EditableTagsCell
                                    tags={contact.tags || []}
                                    onAddTag={async (tag) => {
                                      await addTag.mutateAsync({ contactId: contact.id, tag });
                                    }}
                                    onRemoveTag={async (tag) => {
                                      await removeTag.mutateAsync({ contactId: contact.id, tag });
                                    }}
                                  />
                                </TableCell>
                              )}
                              {/* Outreach Status - read only */}
                              {isVisible('outreach') && (
                                <TableCell className="px-3 py-1.5">
                                  <OutreachStatusBadge status={contact.outreach_status} />
                                </TableCell>
                              )}
                              {/* AI Analysis Status - read only */}
                              {isVisible('ai_analyzed') && (
                                <TableCell className="px-3 py-1.5">
                                  <AiAnalysisStatusBadge status={contact.ai_analysis_status} />
                                </TableCell>
                              )}
                              {/* AI Insights - primary need from analysis */}
                              {isVisible('ai_insights') && (
                                <TableCell className="px-3 py-1.5">
                                  {contact.enrichment_data && (contact.enrichment_data as { primary_need?: string }).primary_need ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-sm break-words line-clamp-2 cursor-help">
                                          {(contact.enrichment_data as { primary_need?: string }).primary_need}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[350px]">
                                        <p className="font-medium mb-1">Primary Need</p>
                                        <p className="break-words">{(contact.enrichment_data as { primary_need?: string }).primary_need}</p>
                                        {(contact.enrichment_data as { primary_need_reasoning?: string }).primary_need_reasoning && (
                                          <>
                                            <p className="font-medium mt-2 mb-1">Reasoning</p>
                                            <p className="break-words text-muted-foreground">{(contact.enrichment_data as { primary_need_reasoning?: string }).primary_need_reasoning}</p>
                                          </>
                                        )}
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              )}
                              {/* ICP Score (per-product or overall) */}
                              {isVisible('icp_score') && (
                                <TableCell className="px-3 py-1.5">
                                  <IcpScoreCell
                                    contactId={contact.id}
                                    enrichmentData={contact.enrichment_data as Record<string, unknown> | null}
                                    productScoreMap={productScoreMap}
                                    icpProductId={icpProductId}
                                  />
                                </TableCell>
                              )}
                              {/* DM Fit Score (per-product only) */}
                              {isVisible('dm_score') && (
                                <TableCell className="px-3 py-1.5">
                                  <DmScoreCell
                                    contactId={contact.id}
                                    productScoreMap={productScoreMap}
                                    icpProductId={icpProductId}
                                  />
                                </TableCell>
                              )}
                              {/* Source - read only */}
                              {isVisible('source') && (
                                <TableCell className="px-3 py-1.5">
                                  {contact.source ? (
                                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                                      {getSourceLabel(contact.source)}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              )}
                              {/* Score - read only */}
                              {isVisible('score') && (
                                <TableCell className="px-3 py-1.5 text-right">
                                  <ScoreBarCell score={contact.lead_score} />
                                </TableCell>
                              )}
                              {/* Sequences - read only indicator */}
                              {isVisible('sequences') && (
                                <TableCell className="px-3 py-1.5">
                                  <SequenceIndicator
                                    count={sequenceCounts?.get(contact.id)?.count}
                                    status={sequenceCounts?.get(contact.id)?.latestStatus}
                                    pushedToTool={sequenceCounts?.get(contact.id)?.pushedToTool}
                                  />
                                </TableCell>
                              )}
                              {/* Notion URL - read only */}
                              {isVisible('notion_url') && (
                                <TableCell className="px-3 py-1.5">
                                  {(contact as any).notion_preview_url ? (
                                    <a
                                      href={(contact as any).notion_preview_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Badge variant="outline" className="text-xs gap-1 cursor-pointer hover:bg-accent">
                                        <ExternalLink className="h-3 w-3" />
                                        Notion
                                      </Badge>
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              )}
                              {/* Email Firewall (SEG) */}
                              {isVisible('seg_firewall') && (
                                <TableCell className="px-3 py-1.5">
                                  {contact.seg_provider ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="status" className="status-warning gap-1 text-[10px]">
                                          <ShieldAlert className="h-3 w-3" />
                                          {contact.seg_provider}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-xs">This domain routes through {contact.seg_provider} email firewall</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : contact.seg_checked_at ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="status" className="status-success gap-1 text-[10px]">
                                          <ShieldCheck className="h-3 w-3" />
                                          Clear
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-xs">No email firewall detected</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              )}
                              {/* Email Verified */}
                              {isVisible('email_verified') && (
                                <TableCell className="px-3 py-1.5">
                                  <EmailVerifiedBadge
                                    email={contact.primary_email}
                                    info={resolveEmailVerification(contact, emailVerifications)}
                                  />
                                </TableCell>
                              )}
                              {/* Added - read only */}
                              {isVisible('added') && (
                                <TableCell className="px-3 py-1.5 text-sm text-muted-foreground whitespace-nowrap">
                                  {format(new Date(member.added_at), "MMM d, yyyy")}
                                </TableCell>
                              )}
                              {customFieldDefs.filter((field) => isVisible(`custom_${field.field_key}`)).map((field) => (
                                <TableCell key={field.id} className="px-3 py-1.5">
                                  <CustomFieldCell field={field} customFields={contact.custom_fields} />
                                </TableCell>
                              ))}
                              {/* Actions */}
                              <TableCell className="px-3 py-1.5">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem asChild>
                                      <Link to={`/people/${contact.id}`}>
                                        <ExternalLink className="h-4 w-4 mr-2" />
                                        View Contact
                                      </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => setActivitySheetContact({
                                        id: contact.id,
                                        name: contact.display_name,
                                      })}
                                    >
                                      <Activity className="h-4 w-4 mr-2" />
                                      View Activity
                                    </DropdownMenuItem>
                                    {contact.primary_linkedin_url && (
                                      <DropdownMenuItem asChild>
                                        <a
                                          href={contact.primary_linkedin_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          <ExternalLink className="h-4 w-4 mr-2" />
                                          LinkedIn Profile
                                        </a>
                                      </DropdownMenuItem>
                                    )}
                                    {availableExclusionLists.length > 0 && (
                                      <DropdownMenuItem
                                        onClick={() => handleOpenExclusionDialog([member.contact_id])}
                                      >
                                        <Ban className="h-4 w-4 mr-2" />
                                        Add to Exclusion List
                                      </DropdownMenuItem>
                                    )}
                                    {(contact as any).notion_preview_url && (
                                      <DropdownMenuItem
                                        onClick={() => setSingleRegenerateContactId(contact.id)}
                                      >
                                        <RefreshCw className="h-4 w-4 mr-2" />
                                        Regenerate Notion Page
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                      onClick={() => setMemberToRemove(member.contact_id)}
                                      className="text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Remove from List
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => setContactToDelete({ id: contact.id, name: contact.display_name || 'Contact' })}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete Contact
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                              <TableCell className="w-10 p-0" />
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Static List Pagination */}
                {membersData && membersData.totalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Showing {((membersData.page - 1) * membersData.pageSize) + 1} - {Math.min(membersData.page * membersData.pageSize, membersData.total)} of {membersData.total}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={membersData.page <= 1}
                        onClick={() => setStaticListPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground px-2">
                        Page {membersData.page} of {membersData.totalPages}
                      </span>
                      <JumpToPage
                        currentPage={membersData.page}
                        totalPages={membersData.totalPages}
                        onPageChange={setStaticListPage}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={membersData.page >= membersData.totalPages}
                        onClick={() => setStaticListPage((p) => p + 1)}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>

      {/* Remove Confirmation Dialog */}
      <AlertDialog open={!!memberToRemove} onOpenChange={(open) => !open && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from List</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this contact from the list? The contact will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add to Exclusion List Dialog */}
      <Dialog open={showExclusionDialog} onOpenChange={setShowExclusionDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center">
                <Ban className="h-4 w-4 text-orange-600" />
              </div>
              Add to Exclusion List
            </DialogTitle>
            <DialogDescription>
              Select an exclusion list to add {contactsToExclude.length === 1 ? "this contact" : `${contactsToExclude.length} contacts`} to.
              Contacts in exclusion lists will be skipped in campaigns.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {availableExclusionLists.length === 0 ? (
              <div className="text-center py-6">
                <Ban className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground mb-4">
                  No exclusion lists available. Create a new list first.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowExclusionDialog(false);
                    navigate("/leads/lists");
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create List
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {availableExclusionLists.map((exclusionList) => (
                  <button
                    key={exclusionList.id}
                    onClick={() => handleAddToExclusionList(exclusionList.id)}
                    disabled={addToListMutation.isPending}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-accent hover:border-accent-foreground/20 transition-colors text-left"
                  >
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/20 to-pink-500/20 flex items-center justify-center">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{exclusionList.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {exclusionList.lead_count} contacts
                      </div>
                    </div>
                    {addToListMutation.isPending && (
                      <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExclusionDialog(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Smart List Filters Dialog */}
      <Dialog open={showEditFiltersDialog} onOpenChange={setShowEditFiltersDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[960px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              Edit segment rules
            </DialogTitle>
            <DialogDescription>
              Update who belongs in this segment. Changes affect future enrollment; people already enrolled continue in their destination.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto py-4 pr-2">
            <SmartListFilterBuilder
              criteria={editingCriteria}
              onChange={setEditingCriteria}
              showPreviewCount={true}
              active={showEditFiltersDialog}
            />
          </div>
          <DialogFooter className="pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setShowEditFiltersDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={() => {
                if (validateSmartSegmentCriteria(editingCriteria).length) return;
                updateSmartListMutation.mutate(
                  { id: id!, filter_criteria: editingCriteria },
                  {
                    onSuccess: () => {
                      setShowEditFiltersDialog(false);
                    },
                  }
                );
              }}
              disabled={updateSmartListMutation.isPending || validateSmartSegmentCriteria(editingCriteria).length > 0}
            >
              {updateSmartListMutation.isPending && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activity Timeline Sheet */}
      <Sheet open={!!activitySheetContact} onOpenChange={(open) => !open && setActivitySheetContact(null)}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {activitySheetContact?.name}
            </SheetTitle>
            <SheetDescription>Campaign activity timeline for this contact</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <ActivityTimeline contactId={activitySheetContact?.id} showCard={false} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Analyze Companies Dialog */}
      <AnalyzeCompaniesDialog
        contactIds={Array.from(selectedIds)}
        open={showAnalyzeDialog}
        onOpenChange={setShowAnalyzeDialog}
        onComplete={() => setSelectedIds(new Set())}
      />

      {/* Generate Email Sequence Dialog */}
      <GenerateEmailSequenceDialog
        contactIds={Array.from(selectedIds)}
        open={showGenerateSequenceDialog}
        onOpenChange={setShowGenerateSequenceDialog}
        onComplete={() => setSelectedIds(new Set())}
      />

      {/* Generate & Send Dialog */}
      <GenerateAndSendDialog
        contactIds={Array.from(selectedIds)}
        open={showGenerateAndSendDialog}
        onOpenChange={setShowGenerateAndSendDialog}
        onComplete={() => setSelectedIds(new Set())}
        onJobStarted={setGenerateAndSendJobId}
      />

      {/* Push Sequences to Email Tool Dialog */}
      <PushSequencesToEmailToolDialog
        contactIds={Array.from(selectedIds)}
        open={showPushDialog}
        onOpenChange={setShowPushDialog}
        onComplete={() => setSelectedIds(new Set())}
      />

      {/* Enroll in Email Sequence Dialog. When the whole matching set of a
          static list is selected, enroll by filter server-side. */}
      {(() => {
        const staticTotal = membersData?.total ?? 0;
        const enrollAllMatching = !list.is_smart && !!id && staticTotal > 0 && selectedIds.size >= staticTotal;
        return (
          <BulkEnrollEmailSequenceDialog
            contactIds={Array.from(selectedIds)}
            open={showEnrollEmailSequenceDialog}
            onOpenChange={setShowEnrollEmailSequenceDialog}
            onComplete={() => setSelectedIds(new Set())}
            listId={enrollAllMatching ? id! : undefined}
            filters={enrollAllMatching ? buildRpcFilters(staticListSearch, advancedFilters) : undefined}
            allMatching={enrollAllMatching}
            totalCount={staticTotal}
          />
        );
      })()}

      {/* Generate Notion Pages Dialog */}
      <GenerateNotionPagesDialog
        contactIds={Array.from(selectedIds)}
        open={showNotionPagesDialog}
        onOpenChange={setShowNotionPagesDialog}
        onComplete={() => setSelectedIds(new Set())}
        onJobStarted={setNotionPagesJobId}
      />

      {/* Regenerate Notion Pages Dialog (bulk) */}
      <GenerateNotionPagesDialog
        contactIds={Array.from(selectedIds)}
        open={showRegenerateNotionDialog}
        onOpenChange={setShowRegenerateNotionDialog}
        onComplete={() => setSelectedIds(new Set())}
        onJobStarted={setNotionPagesJobId}
        regenerate
      />

      {/* Regenerate Notion Page Dialog (single contact) */}
      <GenerateNotionPagesDialog
        contactIds={singleRegenerateContactId ? [singleRegenerateContactId] : []}
        open={!!singleRegenerateContactId}
        onOpenChange={(open) => { if (!open) setSingleRegenerateContactId(null); }}
        onJobStarted={setNotionPagesJobId}
        regenerate
      />

      {/* Find Emails Dialog */}
      <FindEmailsDialog
        contactIds={Array.from(selectedIds)}
        open={showFindEmailsDialog}
        onOpenChange={setShowFindEmailsDialog}
        onComplete={() => {
          // Auto-run firewall check after Find Emails completes
          runFirewallCheck(Array.from(selectedIds));
          setSelectedIds(new Set());
        }}
      />

      {/* Verify Emails Dialog */}
      <VerifyEmailsDialog
        contactIds={Array.from(selectedIds)}
        open={showVerifyEmailsDialog}
        onOpenChange={setShowVerifyEmailsDialog}
        onConfirm={(provider) => {
          // For static lists: if the user picked the whole list (Select all N
          // banner), hand the kickoff a list_id rather than shipping 79k+
          // UUIDs in a multi-MB POST body. Falls back to contact_ids for
          // partial selections and for smart lists.
          const staticTotal = membersData?.total ?? 0;
          const entireStaticListSelected =
            !list?.is_smart && !!id && staticTotal > 0 && selectedIds.size >= staticTotal;
          runVerifyEmails(Array.from(selectedIds), provider, {
            listId: entireStaticListSelected ? id : undefined,
            entireList: entireStaticListSelected,
          });
        }}
      />

      {/* Export Contacts Dialog */}
      <ExportContactsDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        onSubmit={(data) => {
          exportContactsMutation.mutate({
            email: data.email,
            format: data.format,
            columns: data.columns,
            contactIds: Array.from(selectedIds),
          }, {
            onSuccess: () => {
              setShowExportDialog(false);
              setSelectedIds(new Set());
            },
          });
        }}
        isLoading={exportContactsMutation.isPending}
        selectedCount={selectedIds.size}
        mode={exportMode}
      />

      {/* Lead Handoffs Manager - Delete contacts from email tools */}
      <LeadHandoffsManager
        open={showHandoffsManager}
        onOpenChange={setShowHandoffsManager}
        contactIds={selectedIds.size > 0 ? Array.from(selectedIds) : undefined}
      />

      {/* Floating Bulk Actions Bar */}
      <LeadListBulkActionsBar
        selectedCount={selectedIds.size}
        onClearSelection={() => setSelectedIds(new Set())}
        isSmartList={list.is_smart}
        staticLists={staticListsForAddTo}
        onAddToList={(listId, listName) => {
          const staticTotal = membersData?.total ?? 0;
          const allMatchingSelected = !list.is_smart && !!id && staticTotal > 0 && selectedIds.size >= staticTotal;
          const count = allMatchingSelected ? staticTotal : selectedIds.size;
          const toastId = toast.loading(`Adding ${count.toLocaleString()} contacts to ${listName}...`);
          addToListMutation.mutate(
            allMatchingSelected
              ? { list_id: listId, contact_ids: [], source_list_id: id!, filters: buildRpcFilters(staticListSearch, advancedFilters) }
              : {
                  list_id: listId,
                  contact_ids: Array.from(selectedIds),
                  onProgress: (processed, total) => {
                    toast.loading(`Adding contacts to ${listName}... ${processed} / ${total}`, { id: toastId });
                  },
                },
            {
              onSuccess: () => {
                toast.dismiss(toastId);
                toast.success(`Added ${count.toLocaleString()} contacts to ${listName}`);
                setSelectedIds(new Set());
              },
              onError: () => {
                toast.dismiss(toastId);
              },
            }
          );
        }}
        isAddingToList={addToListMutation.isPending}
        onRunProcessing={() => {
          if (!id) return;
          if (!processingPolicy.data) {
            toast.info("Configure and save an enrich & enroll workflow for this list first.");
            setShowProcessingSetup(true);
            return;
          }
          if (processingStatus?.isPaused) {
            toast.info("Resume the list workflow before adding contacts to the run.");
            return;
          }
          // No selection → process the whole list; a selection → process just those.
          if (selectedIds.size === 0) {
            const toastId = toast.loading("Starting the workflow for the whole list...");
            startLeadListProcessing.mutate(id, {
              onSuccess: ({ queued }) => {
                toast.success(`${queued.toLocaleString()} contact${queued === 1 ? "" : "s"} queued`, { id: toastId });
              },
              onError: (error) => {
                toast.error(error instanceof Error ? error.message : "Could not start enrich & enroll", { id: toastId });
              },
            });
            return;
          }
          const count = selectedIds.size;
          const toastId = toast.loading(`Queuing ${count.toLocaleString()} selected contact${count === 1 ? "" : "s"}...`);
          runLeadListProcessing.mutate(
            { listId: id, contactIds: Array.from(selectedIds) },
            {
              onSuccess: ({ queued }) => {
                toast.success(`${queued.toLocaleString()} contact${queued === 1 ? "" : "s"} queued`, { id: toastId });
                setSelectedIds(new Set());
              },
              onError: (error) => {
                toast.error(error instanceof Error ? error.message : "Could not start enrich & enroll", { id: toastId });
              },
            },
          );
        }}
        isRunningProcessing={runLeadListProcessing.isPending || startLeadListProcessing.isPending}
        isProcessingConfigured={!!processingPolicy.data}
        isProcessingConfigurationLoading={processingPolicy.isLoading}
        onStopProcessing={() => {
          if (!id || selectedIds.size === 0) return;
          const count = selectedIds.size;
          const toastId = toast.loading(`Stopping enrich & enroll for ${count.toLocaleString()} selected contact${count === 1 ? "" : "s"}...`);
          stopLeadListProcessing.mutate(
            { listId: id, contactIds: Array.from(selectedIds) },
            {
              onSuccess: ({ stopped }) => {
                const finalizing = count - stopped;
                toast.success(
                  finalizing > 0
                    ? `Stopped ${stopped.toLocaleString()} contact${stopped === 1 ? "" : "s"}. ${finalizing.toLocaleString()} had already finished or started final enrollment.`
                    : `Stopped enrich & enroll for ${stopped.toLocaleString()} contact${stopped === 1 ? "" : "s"}.`,
                  { id: toastId },
                );
                setSelectedIds(new Set());
              },
              onError: (error) => {
                toast.error(error instanceof Error ? error.message : "Could not stop enrich & enroll", { id: toastId });
              },
            },
          );
        }}
        isStoppingProcessing={stopLeadListProcessing.isPending}
        onFindEmails={() => setShowFindEmailsDialog(true)}
        onAnalyzeCompanies={() => setShowAnalyzeDialog(true)}
        onCheckFirewalls={() => runFirewallCheck(Array.from(selectedIds))}
        onVerifyEmails={() => setShowVerifyEmailsDialog(true)}
        onGenerateSequences={() => setShowGenerateSequenceDialog(true)}
        onGenerateAndSend={() => setShowGenerateAndSendDialog(true)}
        onPushToEmailTool={() => setShowPushDialog(true)}
        onEnrollInEmailSequence={() => setShowEnrollEmailSequenceDialog(true)}
        onClearSequences={() => {
          const count = selectedIds.size;
          const toastId = toast.loading(`Clearing sequences for ${count} contact${count === 1 ? '' : 's'}...`);
          bulkClearSequences.mutate(Array.from(selectedIds), {
            onSettled: () => toast.dismiss(toastId),
          });
        }}
        isClearingSequences={bulkClearSequences.isPending}
        onGenerateNotionPages={() => setShowNotionPagesDialog(true)}
        onRegenerateNotionPages={() => setShowRegenerateNotionDialog(true)}
        onDeleteNotionPages={() => {
          const count = selectedIds.size;
          const toastId = toast.loading(`Deleting Notion pages for ${count} contact${count === 1 ? '' : 's'}...`);
          bulkDeleteNotionPages.mutate(Array.from(selectedIds), {
            onSettled: () => toast.dismiss(toastId),
          });
        }}
        isDeletingNotionPages={bulkDeleteNotionPages.isPending}
        onManagePushed={() => setShowHandoffsManager(true)}
        onAddToExclusionList={() => handleOpenExclusionDialog(Array.from(selectedIds))}
        hasExclusionLists={availableExclusionLists.length > 0}
        onExport={() => {
          setExportMode("selected");
          setShowExportDialog(true);
        }}
        onRemoveFromList={handleBulkRemove}
        isRemoving={bulkRemoveMutation.isPending || bulkRemoveFilteredMutation.isPending}
        onDeleteContacts={() => setShowDeleteDialog(true)}
        isDeleting={bulkDeleteContacts.isPending}
      />

      {/* Bulk Delete Confirmation Dialog. When the whole matching set of a
          static list is selected, delete by filter server-side (no huge id
          payload) and require the user to type the count to confirm. */}
      {(() => {
        const staticTotal = membersData?.total ?? 0;
        const deleteViaFilter = !list.is_smart && !!id && staticTotal > 0 && selectedIds.size >= staticTotal;
        const deleteCount = deleteViaFilter ? staticTotal : selectedIds.size;
        return (
          <DeleteConfirmDialog
            open={showDeleteDialog}
            onOpenChange={setShowDeleteDialog}
            onConfirm={() => {
              if (deleteViaFilter && id) {
                bulkDeleteContacts.mutate(
                  { sourceListId: id, filters: buildRpcFilters(staticListSearch, advancedFilters), total: deleteCount },
                  { onSettled: () => setSelectedIds(new Set()) }
                );
              } else {
                bulkDeleteContacts.mutate(Array.from(selectedIds), {
                  onSettled: () => setSelectedIds(new Set()),
                });
              }
            }}
            itemName={`${deleteCount.toLocaleString()} contact${deleteCount === 1 ? '' : 's'}`}
            itemType="contacts"
            description={`Permanently delete ${deleteCount.toLocaleString()} contact${deleteCount === 1 ? '' : 's'}? This removes them from every list and cannot be undone.`}
            confirmText={deleteViaFilter ? String(deleteCount) : undefined}
          />
        );
      })()}

      {/* Single Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={!!contactToDelete}
        onOpenChange={(open) => !open && setContactToDelete(null)}
        onConfirm={() => {
          if (contactToDelete) {
            deleteContact.mutate(contactToDelete.id);
            setContactToDelete(null);
          }
        }}
        itemName={contactToDelete?.name || ''}
        itemType="contact"
      />
    </AppLayout>
  );
}
