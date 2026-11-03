import { Fragment, useEffect, useMemo, useState } from "react";
import * as React from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, RefreshCcw, Pause, Play, X, Activity, ExternalLink, Check, AlertCircle,
  TrendingUp, UserPlus, Briefcase, Building2, Sparkles, ChevronDown, ChevronRight,
  ListFilter, Megaphone, Plus, Mail, Trash2, Pencil, Search, Linkedin, Globe,
  Users, Inbox, FileText, Loader2,
} from "lucide-react";
import { format, formatDistanceToNow, isToday, isYesterday, startOfDay } from "date-fns";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { ProfileMonitorPicker } from "@/components/signals/ProfileMonitorPicker";
import { useUnipileAccounts } from "@/hooks/useUnipileAccounts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  PACK_CATALOG,
  usePackSubscription,
  useUpdatePackSubscription,
  useDeletePackSubscription,
  useTriggerPackRefresh,
  useUpdateSignal,
  useSignalActivity,
  useSignalReviewQueue,
  useSignalCounts,
  useApifyRunsTotal,
  useDecideReviewItem,
  useSmartListInfo,
  useCampaignsTargetingList,
  useAvailableCampaigns,
  useLinkSmartListToCampaign,
  useSequencesTargetingList,
  useAvailableSequences,
  useLinkSmartListToSequence,
  useSmartListReachability,
  useWireSignalLists,
  useSignalCompanies,
  useSignalCompanyDetail,
  useFindDmsForCompany,
  useLibraryIcps,
  DM_FILTER_SENIORITY_OPTIONS,
  DM_FILTER_FUNCTION_OPTIONS,
  type LibraryIcp,
  type PackSubscription,
  type SignalActivityRow,
  type SignalOutcome,
  type RefreshCadence,
  type SignalCompanyRow,
  type SignalCompanyDetailRow,
  type CompanyOutcomeFilter,
  type CompanySortKey,
} from "@/hooks/useDiscovery";

function packLabel(key: string): string {
  return PACK_CATALOG.find((p) => p.key === key)?.label ?? key;
}

function packIcon(key: string) {
  switch (key) {
    case "just_funded_saas": return TrendingUp;
    case "aggressive_hiring": return UserPlus;
    case "new_leadership": return Briefcase;
    case "recent_acquisitions": return Building2;
    default: return Sparkles;
  }
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return "—"; }
}

function outcomeMeta(o: SignalOutcome): { color: string; label: string; dot: string; ring: string } {
  switch (o) {
    case "enrolled":
      // "Enrolled" was internal DB jargon — the company is being pushed
      // through DM lookup → email verification → CRM. Surface that as
      // "In pipeline" so users understand what they're looking at.
      return { color: "text-emerald-700 dark:text-emerald-400", label: "In pipeline", dot: "bg-emerald-500", ring: "ring-emerald-500/20" };
    case "enrolled_holding":
      return { color: "text-emerald-700 dark:text-emerald-400", label: "Holding (cap)", dot: "bg-emerald-500", ring: "ring-emerald-500/20" };
    case "review_pending":
      return { color: "text-amber-700 dark:text-amber-400", label: "Awaiting review", dot: "bg-amber-500", ring: "ring-amber-500/20" };
    case "dropped_below_threshold":
      return { color: "text-muted-foreground", label: "Skipped — low ICP score", dot: "bg-muted-foreground/40", ring: "ring-muted-foreground/10" };
    case "dropped_no_icp_match":
      return { color: "text-muted-foreground", label: "Skipped — no ICP match", dot: "bg-muted-foreground/40", ring: "ring-muted-foreground/10" };
    case "cap_hit":
      return { color: "text-orange-700", label: "Skipped — daily cap", dot: "bg-orange-500", ring: "ring-orange-500/20" };
    case "failed":
      return { color: "text-red-700", label: "Failed", dot: "bg-red-500", ring: "ring-red-500/20" };
  }
}

function dateBucket(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 7) return "Earlier this week";
  if (days < 30) return "Earlier this month";
  return "Older";
}

// ============================================================================
// Raw signal display helpers — turn the SignalBase response into a readable
// categorized field grid instead of a wall of JSON.
// ============================================================================

const FIELD_CATEGORIES = [
  {
    key: "signal",
    label: "Signal",
    fields: [
      "signalId", "signalType", "occurredAt", "discoveredAt", "createdAt",
      "confidenceScore", "verificationStatus", "isFreeAccess",
      "roundType", "roundFlavor", "amount", "currency", "announcedDate",
      "percentage",
    ],
  },
  {
    key: "company",
    label: "Company",
    fields: [
      "companyId", "companyName", "name", "companySlug", "slug",
      "companyWebsite", "website", "companyLinkedin", "companyLinkedinUrl",
      "linkedinUrl", "twitterUrl",
      "companyIndustry", "industry", "companyCountry", "headquartersCountry",
      "headquarters", "companyEmployeeCount", "employeeCount",
      "companyFoundedYear", "foundedYear",
      "companySubcategory", "companyCategories", "categories", "keywords",
      "companySpecialties", "specialties", "growthInfo",
      "companyLogo", "companyLogoUrl", "logoUrl",
    ],
  },
  {
    key: "job",
    label: "Job posting",
    fields: [
      "jobId", "jobUrl", "title", "location", "city", "region", "jobCountry",
      "datePosted", "validThrough", "employmentType", "seniorityLevel",
      "jobFunction", "industries", "numApplicants",
    ],
  },
  {
    key: "person",
    label: "Person",
    fields: [
      "personName", "personLinkedinUrl", "personCurrentTitle", "personHeadline",
      "personLocation", "personCity", "personCountry",
      "personFollowers", "personConnections", "personPosts",
      "newRole", "oldRole",
    ],
  },
  {
    key: "acquiring",
    label: "Acquiring company",
    fields: [
      "acquiringCompanyId", "acquiringCompanyName", "acquiringCompanySlug",
      "acquiringCompanyLogo", "acquiringCompanyWebsite", "acquiringCompanyLinkedin",
      "acquiringCompanyIndustry", "acquiringCompanyCountry",
      "acquiringCompanyFoundedYear", "acquiringCompanyEmployeeCount",
      "acquiringCompanySubcategory", "acquiringCompany",
    ],
  },
  {
    key: "investors",
    label: "Investors",
    fields: ["investors"],
  },
  {
    key: "sources",
    label: "Sources",
    fields: ["sources", "source", "takenFrom", "postContent"],
  },
  {
    key: "description",
    label: "Description",
    fields: ["companyDescription", "description", "descriptionText"],
  },
  {
    key: "investor_meta",
    label: "Investor profile",
    fields: ["type", "ticketSizeMin", "ticketSizeMax", "countries"],
  },
] as const;

const FRIENDLY_LABELS: Record<string, string> = {
  signalId: "Signal ID",
  signalType: "Signal type",
  occurredAt: "Occurred",
  discoveredAt: "Discovered",
  createdAt: "Created",
  confidenceScore: "Confidence",
  verificationStatus: "Verification",
  roundType: "Round",
  roundFlavor: "Flavor",
  amount: "Amount",
  currency: "Currency",
  announcedDate: "Announced",
  percentage: "% acquired",
  companyId: "Company ID",
  companyName: "Name",
  name: "Name",
  companySlug: "Slug",
  slug: "Slug",
  companyWebsite: "Website",
  website: "Website",
  companyLinkedin: "LinkedIn",
  companyLinkedinUrl: "LinkedIn",
  linkedinUrl: "LinkedIn",
  twitterUrl: "Twitter",
  companyIndustry: "Industry",
  industry: "Industry",
  companyCountry: "Country",
  headquartersCountry: "HQ country",
  headquarters: "HQ",
  companyEmployeeCount: "Employees",
  employeeCount: "Employees",
  companyFoundedYear: "Founded",
  foundedYear: "Founded",
  companySubcategory: "Subcategory",
  companyCategories: "Categories",
  categories: "Categories",
  keywords: "Keywords",
  companySpecialties: "Specialties",
  specialties: "Specialties",
  growthInfo: "Growth info",
  companyLogo: "Logo",
  companyLogoUrl: "Logo URL",
  logoUrl: "Logo",
  jobId: "Job ID",
  jobUrl: "Job URL",
  title: "Title",
  location: "Location",
  city: "City",
  region: "Region",
  jobCountry: "Country",
  datePosted: "Posted",
  validThrough: "Valid through",
  employmentType: "Type",
  seniorityLevel: "Seniority",
  jobFunction: "Function",
  industries: "Industries",
  numApplicants: "Applicants",
  personName: "Name",
  personLinkedinUrl: "LinkedIn",
  personCurrentTitle: "Current title",
  personHeadline: "Headline",
  personLocation: "Location",
  personCity: "City",
  personCountry: "Country",
  personFollowers: "Followers",
  personConnections: "Connections",
  personPosts: "Posts",
  newRole: "New role",
  oldRole: "Old role",
  acquiringCompanyId: "ID",
  acquiringCompanyName: "Name",
  acquiringCompanySlug: "Slug",
  acquiringCompanyLogo: "Logo",
  acquiringCompanyWebsite: "Website",
  acquiringCompanyLinkedin: "LinkedIn",
  acquiringCompanyIndustry: "Industry",
  acquiringCompanyCountry: "Country",
  acquiringCompanyFoundedYear: "Founded",
  acquiringCompanyEmployeeCount: "Employees",
  acquiringCompanySubcategory: "Subcategory",
  acquiringCompany: "Full record",
  investors: "Investors",
  sources: "Sources",
  source: "Source",
  takenFrom: "Taken from",
  postContent: "Post content",
  companyDescription: "About company",
  description: "Description",
  descriptionText: "Job description",
  isFreeAccess: "Free access",
  type: "Type",
  ticketSizeMin: "Min ticket",
  ticketSizeMax: "Max ticket",
  countries: "Countries",
};

const URL_FIELDS = new Set([
  "jobUrl", "companyWebsite", "website", "companyLinkedin", "companyLinkedinUrl",
  "linkedinUrl", "twitterUrl", "personLinkedinUrl",
  "acquiringCompanyWebsite", "acquiringCompanyLinkedin",
  "logoUrl", "companyLogo", "companyLogoUrl", "acquiringCompanyLogo",
  "takenFrom",
]);

const DATE_FIELDS = new Set([
  "occurredAt", "discoveredAt", "createdAt", "updatedAt",
  "announcedDate", "datePosted", "validThrough",
]);

const NUMBER_FIELDS = new Set([
  "companyEmployeeCount", "employeeCount", "amount", "ticketSizeMin",
  "ticketSizeMax", "personFollowers", "personConnections", "personPosts",
  "acquiringCompanyEmployeeCount",
]);

const LONG_TEXT_FIELDS = new Set([
  "companyDescription", "description", "descriptionText", "postContent",
]);

const HIDDEN_FIELDS = new Set(["id", "isFreeAccess"]); // noise

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === "object" && v !== null && Object.keys(v).length === 0) return true;
  if (typeof v === "string" && v.trim() === "[]") return true;
  return false;
}

function ensureUrl(v: string): string {
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v.replace(/^\/+/, "")}`;
}

function fmtAmount(n: number, currency?: string): string {
  // SignalBase returns amounts in USD whole units (e.g. 125000000 = $125M)
  // for funding. For acquisitions the schema documents `amount_min/max`
  // but funding values are already in dollars.
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B ${currency ?? "USD"}`.replace(" USD", "");
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M ${currency ?? "USD"}`.replace(" USD", "");
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K ${currency ?? "USD"}`.replace(" USD", "");
  return `${n.toLocaleString()} ${currency ?? "USD"}`.replace(" USD", "");
}

function fmtFieldValue(key: string, value: unknown, parentRecord?: Record<string, unknown>): React.ReactNode {
  if (isEmpty(value)) return <span className="text-muted-foreground/60 italic">—</span>;

  if (URL_FIELDS.has(key) && typeof value === "string") {
    const safe = ensureUrl(decodeURIComponent(value).trim());
    let label = value;
    try {
      const u = new URL(safe);
      label = u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname : "");
      if (label.length > 50) label = label.slice(0, 47) + "…";
    } catch {
      label = String(value).slice(0, 50);
    }
    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-primary hover:underline inline-flex items-center gap-1 break-all"
      >
        {label}
        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
      </a>
    );
  }

  if (DATE_FIELDS.has(key) && typeof value === "string") {
    try {
      const d = new Date(value);
      const rel = formatDistanceToNow(d, { addSuffix: true });
      const abs = format(d, "MMM d, yyyy");
      return <span title={value}>{abs} <span className="text-muted-foreground/70">· {rel}</span></span>;
    } catch {
      return String(value);
    }
  }

  if (NUMBER_FIELDS.has(key) && typeof value === "number") {
    if (key === "amount") {
      const currency = (parentRecord?.currency as string | undefined) ?? "USD";
      return <span className="font-medium tabular-nums">{currency === "USD" ? "$" : ""}{fmtAmount(value, currency)}</span>;
    }
    return <span className="tabular-nums">{value.toLocaleString()}</span>;
  }

  if (LONG_TEXT_FIELDS.has(key) && typeof value === "string") {
    return <LongText text={value} />;
  }

  if (key === "investors" && Array.isArray(value)) {
    return <InvestorsList investors={value as Array<Record<string, unknown>>} />;
  }

  if (key === "sources" && Array.isArray(value)) {
    return <SourcesList sources={value as Array<Record<string, unknown>>} />;
  }

  if (key === "acquiringCompany" && typeof value === "object" && value !== null) {
    return <NestedObject obj={value as Record<string, unknown>} />;
  }

  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) {
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((v, i) => (
            <Badge key={i} variant="outline" className="text-[10px] py-0 h-5 font-normal">{v}</Badge>
          ))}
        </span>
      );
    }
    return <pre className="text-[11px] bg-muted/30 p-1.5 rounded overflow-x-auto">{JSON.stringify(value, null, 2)}</pre>;
  }

  if (typeof value === "object" && value !== null) {
    return <NestedObject obj={value as Record<string, unknown>} />;
  }

  if (typeof value === "string" && value.length > 80) {
    return <span className="break-all">{value}</span>;
  }

  return <span className="break-words">{String(value)}</span>;
}

/**
 * Inline forecast under each link Select. Tells the user how many list
 * members can run each channel the picked destination needs. Informational —
 * the campaign-processor handles per-step skipping for missing channels, so
 * a partial reach isn't a failure mode, just transparency.
 */
function CampaignReachabilityForecast({
  total,
  withEmail,
  withLinkedIn,
  needsEmail,
  needsLinkedIn,
}: {
  total: number;
  withEmail: number;
  withLinkedIn: number;
  needsEmail: boolean;
  needsLinkedIn: boolean;
}) {
  if (total === 0) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <AlertCircle className="h-3 w-3 shrink-0" />
        No qualified contacts in this list yet — nothing will enroll until the signal finds matches.
      </p>
    );
  }
  // Reachability = how many can run every channel this destination needs.
  // If needs neither, every contact is reachable.
  const reachable = needsEmail && needsLinkedIn
    ? Math.min(withEmail, withLinkedIn)
    : needsEmail
      ? withEmail
      : needsLinkedIn
        ? withLinkedIn
        : total;
  const partial = reachable < total;
  return (
    <div className="flex items-start gap-1.5 text-[11px] leading-snug">
      <Check className={`mt-px h-3 w-3 shrink-0 ${partial ? "text-amber-700 dark:text-amber-500" : "text-emerald-700 dark:text-emerald-500"}`} />
      <div className={partial ? "text-amber-700 dark:text-amber-500" : "text-emerald-700 dark:text-emerald-500"}>
        <span className="font-medium tabular-nums">
          {reachable}/{total}
        </span>{" "}
        {reachable === 1 ? "lead" : "leads"} ready
        {needsEmail || needsLinkedIn ? " for every step" : ""}.
        <span className="ml-1 text-muted-foreground">
          ({withEmail} with email · {withLinkedIn} with LinkedIn)
        </span>
        {partial && (
          <span className="ml-1 text-muted-foreground">
            Others auto-skip the step they can't run.
          </span>
        )}
      </div>
    </div>
  );
}

function LongText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 220;
  if (!isLong) return <span className="leading-relaxed whitespace-pre-wrap">{text}</span>;
  return (
    <div className="leading-relaxed whitespace-pre-wrap">
      {expanded ? text : `${text.slice(0, 220).trim()}…`}
      <button
        type="button"
        className="ml-1 text-primary hover:underline text-[11px] font-medium"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

function InvestorsList({ investors }: { investors: Array<Record<string, unknown>> }) {
  return (
    <div className="flex flex-col gap-1.5">
      {investors.map((inv, i) => {
        const name = (inv.name as string) ?? "Unknown";
        const type = inv.type as string | null | undefined;
        const isLead = inv.isLead === true;
        const linkedin = inv.linkedin as string | null | undefined;
        const website = inv.website as string | null | undefined;
        return (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{name}</span>
            {isLead && <Badge className="text-[10px] py-0 h-5">Lead</Badge>}
            {type && <Badge variant="outline" className="text-[10px] py-0 h-5 font-normal">{type}</Badge>}
            {linkedin && (
              <a
                href={ensureUrl(linkedin)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-primary hover:underline text-[11px] inline-flex items-center gap-0.5"
              >
                LinkedIn <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {website && (
              <a
                href={ensureUrl(website)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-primary text-[11px] inline-flex items-center gap-0.5"
              >
                {website.replace(/^https?:\/\//, "").replace(/\/$/, "")} <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SourcesList({ sources }: { sources: Array<Record<string, unknown>> }) {
  return (
    <div className="flex flex-col gap-1">
      {sources.map((s, i) => {
        const url = s.url as string | undefined;
        const title = (s.title as string | null | undefined) || (s.sourceType as string | undefined) || url || "Source";
        const isPrimary = s.isPrimary === true;
        const publishedAt = s.publishedAt as string | null | undefined;
        return (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            {url ? (
              <a
                href={ensureUrl(url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                {title}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ) : (
              <span>{title}</span>
            )}
            {isPrimary && <Badge variant="outline" className="text-[10px] py-0 h-5 font-normal">Primary</Badge>}
            {publishedAt && (
              <span className="text-[11px] text-muted-foreground">
                {fmtRelative(publishedAt)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NestedObject({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj).filter(([, v]) => !isEmpty(v));
  if (entries.length === 0) return <span className="text-muted-foreground/60 italic">—</span>;
  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <span className="text-muted-foreground text-[11px]">{FRIENDLY_LABELS[k] ?? k}</span>
          <span className="text-[11px]">{fmtFieldValue(k, v, obj)}</span>
        </Fragment>
      ))}
    </div>
  );
}

function RawSignalView({ rawSignal }: { rawSignal: Record<string, unknown> }) {
  // Distribute fields into category buckets. Anything not assigned ends up
  // in a final "Other" group so we never hide unknown fields.
  const used = new Set<string>();
  const groups = FIELD_CATEGORIES.map((cat) => {
    const fields = cat.fields
      .filter((f) => f in rawSignal && !isEmpty(rawSignal[f]) && !HIDDEN_FIELDS.has(f))
      .map((f) => {
        used.add(f);
        return { key: f, value: rawSignal[f] };
      });
    return { ...cat, fields };
  }).filter((g) => g.fields.length > 0);

  const other = Object.entries(rawSignal).filter(
    ([k, v]) => !used.has(k) && !isEmpty(v) && !HIDDEN_FIELDS.has(k),
  );
  if (other.length > 0) {
    groups.push({
      key: "other",
      label: "Other",
      fields: other.map(([k, v]) => ({ key: k, value: v })),
    });
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
            {group.label}
          </p>
          <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 bg-muted/30 rounded-md p-2.5">
            {group.fields.map(({ key, value }) => (
              <Fragment key={key}>
                <span className="text-[11px] text-muted-foreground self-start pt-0.5">
                  {FRIENDLY_LABELS[key] ?? key}
                </span>
                <span className="text-[11px] min-w-0">
                  {fmtFieldValue(key, value, rawSignal)}
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Compute the pipeline stage label for a single activity row from the
 * fields we have (no extra joins). Three states:
 *   - in_crm: contact landed, ready for outreach
 *   - stuck_24h: enrolled but no contact after >24h, user should investigate
 *     or hit "Retry stuck"
 *   - processing: still moving through the DM scrape / pattern / SMTP path
 *
 * Skipped/dropped/review outcomes don't get a stage chip — their outcome
 * label already conveys the right state.
 */
function rowStage(row: SignalActivityRow): "in_crm" | "stuck_24h" | "processing" | null {
  if (row.exported_at) return "in_crm";
  if (row.outcome !== "enrolled" && row.outcome !== "enrolled_holding") return null;
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) return "stuck_24h";
  return "processing";
}

/**
 * Build a one-line, signal-type-specific summary for the activity row.
 * Pulls high-value fields directly out of raw_signal so the user gets the
 * gist without expanding. Falls back to row.signal_detail when raw isn't
 * available (older rows pre-2026-05-04).
 */
function buildQuickGlance(
  rawSignal: Record<string, unknown> | null,
  fallback: string | null,
): { primary: string | null; chips: string[] } {
  if (!rawSignal) return { primary: fallback, chips: [] };
  const signalType = rawSignal.signalType as string | undefined;
  const chips: string[] = [];

  if (signalType === "funding_round") {
    const round = rawSignal.roundType as string | undefined;
    const amount = rawSignal.amount as number | undefined;
    const currency = (rawSignal.currency as string | undefined) ?? "USD";
    const investors = (rawSignal.investors as Array<Record<string, unknown>> | undefined) ?? [];
    const lead = investors.find((i) => i.isLead) ?? investors[0];
    const parts: string[] = [];
    if (amount && amount > 0) {
      const fmtAmt = amount >= 1_000_000_000 ? `$${(amount / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`
        : amount >= 1_000_000 ? `$${(amount / 1_000_000).toFixed(0)}M`
        : amount >= 1_000 ? `$${(amount / 1_000).toFixed(0)}K`
        : `$${amount.toLocaleString()}`;
      parts.push(`${fmtAmt}${currency !== "USD" ? ` ${currency}` : ""}`);
    }
    if (round) parts.push(round.replace(/\b\w/g, (c) => c.toUpperCase()));
    if (lead?.name) parts.push(`${lead.name as string}-led`);
    if (rawSignal.companyIndustry) chips.push(rawSignal.companyIndustry as string);
    if (rawSignal.companyEmployeeCount) chips.push(`${(rawSignal.companyEmployeeCount as number).toLocaleString()} employees`);
    if (rawSignal.companyCountry) chips.push(rawSignal.companyCountry as string);
    return { primary: parts.join(" · ") || fallback, chips };
  }

  if (signalType === "acquisition") {
    const acquirer = rawSignal.acquiringCompanyName as string | undefined;
    const pct = rawSignal.percentage as number | null | undefined;
    const parts: string[] = [];
    if (acquirer) parts.push(`Acquired by ${acquirer}`);
    if (pct != null) parts.push(`${pct}%`);
    if (rawSignal.companyIndustry) chips.push(rawSignal.companyIndustry as string);
    if (rawSignal.companyCountry) chips.push(rawSignal.companyCountry as string);
    return { primary: parts.join(" · ") || fallback, chips };
  }

  if (signalType === "linkedin_post_engagement") {
    const kind = rawSignal.engagement_kind as string | undefined; // 'reaction' | 'comment'
    const reactionType = rawSignal.reaction_type as string | undefined;
    const postSnippet = rawSignal.post_snippet as string | undefined;
    const monitored = rawSignal.monitored_profile as string | undefined;
    const headline = rawSignal.engager_headline as string | undefined;
    const commentText = rawSignal.comment_text as string | undefined;

    // Pull just the slug from the monitored profile URL for a tighter line.
    const monitoredSlug = monitored?.match(/linkedin\.com\/(?:in|company)\/([^/?#]+)/i)?.[1]
      ?? monitored?.replace(/^https?:\/\//, "").replace(/\/$/, "")
      ?? "competitor";
    const verb = kind === "comment"
      ? `Commented on @${monitoredSlug}`
      : `Reacted to @${monitoredSlug}`;
    const quote = kind === "comment" && commentText
      ? `"${commentText.slice(0, 80)}${commentText.length > 80 ? "…" : ""}"`
      : postSnippet
        ? `"${postSnippet.slice(0, 80)}${postSnippet.length > 80 ? "…" : ""}"`
        : "";
    const primary = quote ? `${verb} — ${quote}` : verb;
    if (reactionType && kind === "reaction") chips.push(reactionType.toLowerCase());
    if (headline) chips.push(headline.length > 40 ? `${headline.slice(0, 38)}…` : headline);
    return { primary, chips };
  }

  if (signalType === "job_change") {
    const person = rawSignal.personName as string | undefined;
    const newRole = rawSignal.newRole as string | undefined;
    const co = rawSignal.companyName as string | undefined;
    const parts: string[] = [];
    if (person) parts.push(person);
    if (newRole) parts.push(`now ${newRole}`);
    if (co) parts.push(`@ ${co}`);
    if (rawSignal.companyIndustry) chips.push(rawSignal.companyIndustry as string);
    return { primary: parts.join(" ") || fallback, chips };
  }

  // Hiring records don't carry signalType but have title/seniorityLevel/location.
  if (rawSignal.title || rawSignal.jobUrl) {
    const title = rawSignal.title as string | undefined;
    const seniority = rawSignal.seniorityLevel as string | undefined;
    const loc = (rawSignal.location as string | undefined) ?? rawSignal.city as string | undefined;
    const parts: string[] = [];
    if (title) parts.push(title);
    if (loc) parts.push(`in ${loc}`);
    if (seniority) chips.push(seniority);
    if (rawSignal.jobFunction) chips.push(rawSignal.jobFunction as string);
    if (rawSignal.numApplicants) chips.push(`${rawSignal.numApplicants} applicants`);
    return { primary: parts.join(" ") || fallback, chips };
  }

  return { primary: fallback, chips };
}

// Groups multiple activity rows for the same company into one expandable
// header. Newest row renders inline; the rest collapse behind a "+N more"
// disclosure. Single-row groups render as a plain ActivityRow.
function GroupedActivityRows({ rows }: { rows: SignalActivityRow[] }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  if (rows.length === 1) return <ActivityRow row={rows[0]} />;
  // Rows are already date-bucketed; sort newest-first within the bucket so
  // the latest signal for this company surfaces as the visible representative.
  const sorted = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const [head, ...rest] = sorted;
  return (
    <div>
      <div className="relative">
        <ActivityRow row={head} />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="absolute right-10 top-3 text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:bg-muted/70 transition"
          aria-label={expanded ? "Hide other signals" : `Show ${rest.length} other signals`}
        >
          {expanded ? "Hide" : `+${rest.length} more`}
        </button>
      </div>
      {expanded && (
        <div className="ml-4 border-l-2 border-muted/60 pl-3 pb-1">
          {rest.map((r) => (
            <ActivityRow key={r.id} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ row }: { row: SignalActivityRow }) {
  const [open, setOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const meta = outcomeMeta(row.outcome);
  const data = (row.data as Record<string, unknown>) ?? {};
  const company = (data.company_name as string) ?? "Unknown";
  const evidenceUrl = data.evidence_url as string | undefined;
  const reasoning = data.icp_reasoning as string | undefined;
  const rawSignal = (data.raw_signal as Record<string, unknown> | null) ?? null;
  const hasMore = !!reasoning || !!rawSignal;
  const stage = rowStage(row);
  const glance = buildQuickGlance(rawSignal, row.signal_detail ?? null);
  return (
    <div className="border-b last:border-b-0">
      <div
        className={`flex items-start gap-3 py-3 px-2 -mx-2 rounded-md ${hasMore ? "cursor-pointer hover:bg-muted/40" : ""} transition`}
        onClick={() => hasMore && setOpen((v) => !v)}
      >
        <div className={`w-2 h-2 rounded-full mt-2 ring-4 ${meta.dot} ${meta.ring}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium uppercase tracking-wide ${meta.color}`}>{meta.label}</span>
            <span className="font-medium truncate">{company}</span>
            {row.icp_score != null && (
              <Badge variant="outline" className="text-xs tabular-nums">
                {row.icp_score}/100
              </Badge>
            )}
            {stage === "in_crm" && (
              <Badge variant="default" className="text-xs">
                <Check className="h-3 w-3 mr-1" /> In CRM
              </Badge>
            )}
            {stage === "stuck_24h" && (
              <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
                <AlertCircle className="h-3 w-3 mr-1" /> Stuck &gt; 24h
              </Badge>
            )}
            {stage === "processing" && (
              <Badge variant="outline" className="text-xs">
                Processing
              </Badge>
            )}
          </div>
          {glance.primary && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{glance.primary}</p>
          )}
          {glance.chips.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {glance.chips.slice(0, 4).map((c, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="text-[10px] py-0 h-4 font-normal text-muted-foreground"
                >
                  {c}
                </Badge>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground/70 mt-1">{fmtRelative(row.created_at)}</p>
        </div>
        {hasMore && (
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
        )}
        {evidenceUrl && (
          <Button variant="ghost" size="icon" asChild className="h-7 w-7 shrink-0">
            <a href={evidenceUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>
      {open && (reasoning || rawSignal) && (
        <div className="ml-7 pb-3 -mt-1 space-y-2">
          {reasoning && (
            <p className="text-xs text-muted-foreground leading-relaxed bg-muted/40 p-2 rounded">
              <span className="font-medium text-foreground/80">ICP scoring rationale: </span>
              {reasoning}
            </p>
          )}
          {rawSignal && (
            <div className="text-xs">
              <button
                type="button"
                className="font-medium text-foreground/80 hover:text-primary inline-flex items-center gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setRawOpen((v) => !v);
                }}
              >
                {rawOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Raw signal data <span className="text-muted-foreground font-normal">· {Object.keys(rawSignal).length} fields</span>
              </button>
              {rawOpen && (
                <div className="mt-2">
                  <RawSignalView rawSignal={rawSignal} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold mt-1 tabular-nums ${color ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Trigger filter enums (must match what SignalBase expects).
// Mirrored from src/pages/signals/SignalNewPage.tsx — keeping wizard + inline
// editor in sync would be cleaner via a shared module, but duplication here
// is small and avoids a refactor across the wizard.
// ============================================================================
const TRIGGER_FUNDING_ROUNDS = [
  "Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D",
  "Series E", "Series F", "Series G", "Growth", "Debt", "Grant", "IPO", "Undisclosed",
];
const TRIGGER_DEPARTMENTS = [
  { id: "marketing", label: "Marketing" },
  { id: "sales", label: "Sales" },
  { id: "engineering", label: "Engineering" },
  { id: "product", label: "Product" },
  { id: "design", label: "Design" },
  { id: "operations", label: "Operations" },
  { id: "finance", label: "Finance" },
  { id: "people", label: "People / HR" },
  { id: "data", label: "Data" },
  { id: "customer_success", label: "Customer Success" },
  { id: "growth", label: "Growth" },
  { id: "legal", label: "Legal" },
];
const TRIGGER_SENIORITIES = [
  { id: "founder", label: "Founder" },
  { id: "c_level", label: "C-suite" },
  { id: "vp", label: "VP" },
  { id: "director", label: "Director" },
  { id: "head", label: "Head" },
  { id: "lead", label: "Lead" },
  { id: "manager", label: "Manager" },
];
const DATE_PRESET_OPTIONS = [
  { value: "last_24h", label: "Last 24 hours" },
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_14d", label: "Last 14 days" },
  { value: "last_30d", label: "Last 30 days" },
  { value: "last_90d", label: "Last 90 days" },
];

/**
 * Inline-editable settings card. Every field is a live control — no "click
 * to edit" toggle. Chip toggles + dropdowns + sliders save immediately;
 * text inputs debounce 1s before saving so the user can type continuously.
 *
 * State management:
 * - `local` mirrors the props on mount and resyncs when sub.updated_at changes.
 * - All saves go through `useUpdateSignal`, which sends the full config back.
 *   Optimistic UI: we update `local` synchronously, mutation runs in
 *   background. On error the toast shows; the next refetch fixes the state.
 */
function SignalSettingsCard({
  sub,
  icps,
}: {
  sub: PackSubscription;
  icps: LibraryIcp[];
}) {
  const updateSignal = useUpdateSignal();
  // Collapsed by default — most users glance at the signal page for activity,
  // not config. Keeps the page above-the-fold focused on what matters.
  const [open, setOpen] = useState(false);
  const initialConfig = (sub.config ?? {}) as Record<string, unknown>;
  const [local, setLocal] = useState({
    config: initialConfig,
    icp_id: sub.icp_id,
    min_icp_score: sub.min_icp_score ?? 60,
    refresh_cadence: sub.refresh_cadence,
  });
  // Track which text input is being typed so we can debounce its save.
  const debounceRefs = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Resync local state when the sub updates remotely (other tab, other user,
  // refetch after a save). Only resync if updated_at changed to avoid
  // clobbering a pending edit.
  useEffect(() => {
    setLocal({
      config: (sub.config ?? {}) as Record<string, unknown>,
      icp_id: sub.icp_id,
      min_icp_score: sub.min_icp_score ?? 60,
      refresh_cadence: sub.refresh_cadence,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub.updated_at]);

  const dmFilter = (local.config.dm_filter ?? {}) as DmFilterShape;

  const commit = (patch: {
    config?: Record<string, unknown>;
    icp_id?: string | null;
    min_icp_score?: number;
    refresh_cadence?: RefreshCadence;
  }) => {
    updateSignal.mutate({ id: sub.id, ...patch });
  };

  const updateConfig = (next: Record<string, unknown>) => {
    setLocal((s) => ({ ...s, config: next }));
    commit({ config: next });
  };

  const updateConfigDebounced = (key: string, next: Record<string, unknown>) => {
    setLocal((s) => ({ ...s, config: next }));
    const refs = debounceRefs.current;
    if (refs[key]) clearTimeout(refs[key]);
    refs[key] = setTimeout(() => {
      commit({ config: next });
      delete refs[key];
    }, 1000);
  };

  const setTextField = (key: string, value: string) => {
    const next = { ...local.config };
    if (value.trim()) next[key] = value;
    else delete next[key];
    updateConfigDebounced(key, next);
  };

  const setNumberField = (key: string, value: string) => {
    const next = { ...local.config };
    const n = Number(value);
    if (value && !Number.isNaN(n)) next[key] = n;
    else delete next[key];
    updateConfigDebounced(key, next);
  };

  const toggleArrayField = (key: string, value: string) => {
    const cur = (local.config[key] as string | undefined)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const has = cur.includes(value);
    const nextArr = has ? cur.filter((v) => v !== value) : [...cur, value];
    const next = { ...local.config };
    if (nextArr.length > 0) next[key] = nextArr.join(",");
    else delete next[key];
    updateConfig(next);
  };

  const toggleDmArrayField = (key: "seniorityLevelIds" | "functionIds", value: string) => {
    const curArr = (dmFilter[key] ?? []) as string[];
    const has = curArr.includes(value);
    const nextArr = has ? curArr.filter((v) => v !== value) : [...curArr, value];
    const nextDm = { ...dmFilter, [key]: nextArr };
    updateConfig({ ...local.config, dm_filter: nextDm });
  };

  const setDmJobTitles = (value: string) => {
    const arr = value.split(",").map((s) => s.trim()).filter(Boolean);
    const nextDm = { ...dmFilter, jobTitles: arr };
    const next = { ...local.config, dm_filter: nextDm };
    updateConfigDebounced("dm_jobTitles", next);
  };

  const setDmMaxItems = (value: number) => {
    const nextDm = { ...dmFilter, maxItemsPerCompany: value };
    updateConfig({ ...local.config, dm_filter: nextDm });
  };

  const isFunding = sub.pack_key === "just_funded_saas";
  const isHiringOrLeadership = sub.pack_key === "aggressive_hiring" || sub.pack_key === "new_leadership";
  const isAcquisitions = sub.pack_key === "recent_acquisitions";
  const isPostEngagement = sub.pack_key === "linkedin_post_engagement";
  const isPostIntent = sub.pack_key === "linkedin_post_intent";
  const isUnipileInbound = sub.pack_key === "unipile_inbound";
  // SignalBase packs scrape companies → DMs and use the generic
  // look-back / countries / free-text-search filters. Person-first packs
  // have their own field shape and don't share these.
  const isSignalBasePack = isFunding || isHiringOrLeadership || isAcquisitions;
  const isPersonFirstPack = isPostEngagement || isPostIntent || isUnipileInbound;

  const dateValue = (local.config.date_preset as string) ?? "last_14d";
  const countriesValue = (local.config.countries as string) ?? "";
  const searchValue = (local.config.search as string) ?? "";
  const investorValue = (local.config.investor_name as string) ?? "";
  const amountMinValue = local.config.amount_min !== undefined ? String(local.config.amount_min) : "";
  const amountMaxValue = local.config.amount_max !== undefined ? String(local.config.amount_max) : "";
  const roundArr = (local.config.round as string | undefined)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const departmentsArr = (local.config.departments as string | undefined)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const senioritiesArr = (local.config.seniorities as string | undefined)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

  // ---- Person-first pack fields ----
  const engagementMode = ((local.config.engagement_mode as string) ?? "profiles") as "profiles" | "posts";
  const monitorProfileUrls = (local.config.monitor_profile_urls as string[] | undefined) ?? [];
  const postUrls = (local.config.post_urls as string[] | undefined) ?? [];
  const engagementTypesArr = (local.config.engagement_types as Array<"reactions" | "comments"> | undefined) ?? ["reactions", "comments"];
  const postsLookback = (local.config.posts_lookback as string | undefined) ?? "week";
  const commentsLookback = (local.config.comments_lookback as string | undefined) ?? "month";
  const maxPostsPerProfile = (local.config.max_posts_per_profile as number | undefined) ?? 5;
  const personFirstAccountId = (local.config.account_id as string | undefined) ?? "";
  const inboundSources = (local.config.sources as Array<"followers" | "relations" | "post_reactors" | "pending_invites"> | undefined) ?? [];
  const inboundPostIds = (local.config.post_ids as string[] | undefined) ?? [];
  const inboundExcludeRecent = (local.config.exclude_if_outbound_within_days as number | undefined) ?? 0;
  const intentSearchQuery = (local.config.search_query as string | undefined) ?? "";
  const intentPostedLimit = (local.config.posted_limit as string | undefined) ?? "week";
  const intentLimit = (local.config.limit as number | undefined) ?? 50;

  // Unipile accounts are only fetched if the pack actually needs them, so
  // SignalBase signals don't pay the network round-trip on every render.
  const unipileAccountsQuery = useUnipileAccounts();
  const linkedinAccounts = isPersonFirstPack
    ? (unipileAccountsQuery.data?.accounts ?? []).filter((a) => a.provider === "LINKEDIN")
    : [];

  const toggleEngagementType = (t: "reactions" | "comments") => {
    const next = engagementTypesArr.includes(t)
      ? engagementTypesArr.filter((x) => x !== t)
      : [...engagementTypesArr, t];
    updateConfig({ ...local.config, engagement_types: next });
  };

  const toggleInboundSource = (id: "followers" | "relations" | "post_reactors" | "pending_invites") => {
    const next = inboundSources.includes(id)
      ? inboundSources.filter((s) => s !== id)
      : [...inboundSources, id];
    updateConfig({ ...local.config, sources: next });
  };

  return (
    <Card>
      <CardHeader
        className={`pb-3 cursor-pointer select-none ${open ? "" : "pb-4"}`}
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
        aria-controls="signal-settings-body"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              {open ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <ListFilter className="h-4 w-4 text-muted-foreground" />
              Current settings
            </CardTitle>
            {open && (
              <CardDescription className="ml-10">
                Click any field to change it — everything saves automatically.
              </CardDescription>
            )}
          </div>
          {updateSignal.isPending && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          )}
        </div>
      </CardHeader>
      {open && (
      <CardContent id="signal-settings-body" className="space-y-5">
        {/* AUDIENCE */}
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Audience</p>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">ICP</Label>
              <Select
                value={local.icp_id ?? ""}
                onValueChange={(v) => {
                  setLocal((s) => ({ ...s, icp_id: v }));
                  commit({ icp_id: v });
                }}
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pick an ICP…" /></SelectTrigger>
                <SelectContent>
                  {icps.map((i) => (<SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Min ICP score</Label>
              <Input
                type="number"
                min={0}
                max={100}
                className="h-8"
                value={local.min_icp_score}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isNaN(n)) return;
                  setLocal((s) => ({ ...s, min_icp_score: n }));
                  const refs = debounceRefs.current;
                  if (refs.min_icp_score) clearTimeout(refs.min_icp_score);
                  refs.min_icp_score = setTimeout(() => {
                    commit({ min_icp_score: n });
                    delete refs.min_icp_score;
                  }, 1000);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Refresh cadence</Label>
              <Select
                value={local.refresh_cadence}
                onValueChange={(v) => {
                  const next = v as RefreshCadence;
                  setLocal((s) => ({ ...s, refresh_cadence: next }));
                  commit({ refresh_cadence: next });
                }}
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* TRIGGER FILTERS */}
        <div className="space-y-2 pt-4 border-t">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            Trigger ({packLabel(sub.pack_key)})
          </p>

          {isSignalBasePack && (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Look back</Label>
                  <Select value={dateValue} onValueChange={(v) => updateConfig({ ...local.config, date_preset: v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DATE_PRESET_OPTIONS.map((d) => (<SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  {(dateValue === "last_14d" || dateValue === "last_30d" || dateValue === "last_90d") && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
                      Heads up: each refresh re-scans the full window. Wider lookbacks burn more Apify credits per run.
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Countries (ISO-2, comma-separated)</Label>
                  <Input
                    className="h-8"
                    placeholder="US, GB, FR"
                    value={countriesValue}
                    onChange={(e) => setTextField("countries", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Free-text search</Label>
                <Input
                  className="h-8"
                  placeholder="e.g. AI, fintech, climate"
                  value={searchValue}
                  onChange={(e) => setTextField("search", e.target.value)}
                />
              </div>
            </>
          )}

          {isFunding && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Funding rounds</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TRIGGER_FUNDING_ROUNDS.map((r) => {
                    const active = roundArr.includes(r);
                    return (
                      <Badge
                        key={r}
                        variant={active ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleArrayField("round", r)}
                      >
                        {r}
                      </Badge>
                    );
                  })}
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Min amount (USD)</Label>
                  <Input className="h-8" type="number" placeholder="e.g. 1000000" value={amountMinValue} onChange={(e) => setNumberField("amount_min", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max amount (USD)</Label>
                  <Input className="h-8" type="number" placeholder="e.g. 50000000" value={amountMaxValue} onChange={(e) => setNumberField("amount_max", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Investor contains</Label>
                  <Input className="h-8" placeholder="e.g. Sequoia" value={investorValue} onChange={(e) => setTextField("investor_name", e.target.value)} />
                </div>
              </div>
            </>
          )}

          {isHiringOrLeadership && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Departments</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TRIGGER_DEPARTMENTS.map(({ id, label }) => {
                    const active = departmentsArr.includes(id);
                    return (
                      <Badge key={id} variant={active ? "default" : "outline"} className="cursor-pointer" onClick={() => toggleArrayField("departments", id)}>
                        {label}
                      </Badge>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Seniority levels</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TRIGGER_SENIORITIES.map(({ id, label }) => {
                    const active = senioritiesArr.includes(id);
                    return (
                      <Badge key={id} variant={active ? "default" : "outline"} className="cursor-pointer" onClick={() => toggleArrayField("seniorities", id)}>
                        {label}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* LinkedIn post engagement — competitor / creator monitor.
              Two modes: "profiles" (recommended; uses connected LinkedIn
              account, $0 / refresh) and "posts" (Apify, paid per result). */}
          {isPostEngagement && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Mode</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(["profiles", "posts"] as const).map((m) => (
                    <Badge
                      key={m}
                      variant={engagementMode === m ? "default" : "outline"}
                      className="cursor-pointer capitalize"
                      onClick={() => updateConfig({ ...local.config, engagement_mode: m })}
                    >
                      {m === "profiles" ? "Monitor profiles ($0)" : "Specific posts (Apify)"}
                    </Badge>
                  ))}
                </div>
              </div>

              {engagementMode === "profiles" && (
                <>
                  {unipileAccountsQuery.isLoading ? (
                    <p className="text-xs text-muted-foreground">Loading LinkedIn accounts…</p>
                  ) : linkedinAccounts.length === 0 ? (
                    <div className="p-3 rounded-md border border-dashed bg-muted/30">
                      <p className="text-sm">Connect a LinkedIn account first.</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Profile monitoring runs through your connected LinkedIn account, so it costs $0 per refresh.
                        Head to <Link to="/settings?tab=senders" className="underline">Settings → LinkedIn &amp; social</Link> to connect one.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-xs">LinkedIn account that does the scraping</Label>
                      <Select
                        value={personFirstAccountId}
                        onValueChange={(v) => updateConfig({ ...local.config, account_id: v })}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Pick a connected account…" />
                        </SelectTrigger>
                        <SelectContent>
                          {linkedinAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.display_name ?? a.username ?? a.unipile_account_id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label className="text-xs">
                      Profiles to monitor ({monitorProfileUrls.length})
                    </Label>
                    <ProfileMonitorPicker
                      value={monitorProfileUrls}
                      onChange={(next) => updateConfig({ ...local.config, monitor_profile_urls: next })}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Add LinkedIn URLs of competitors, thought leaders, or customers. Their recent
                      posts will be auto-pulled and every reactor + commenter captured.
                    </p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">
                        Posts to scan per profile: <strong>{maxPostsPerProfile}</strong>
                      </Label>
                      <Slider
                        value={[maxPostsPerProfile]}
                        onValueChange={([v]) => updateConfig({ ...local.config, max_posts_per_profile: v })}
                        min={1}
                        max={20}
                        step={1}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Lookback window</Label>
                      <Select
                        value={postsLookback}
                        onValueChange={(v) => updateConfig({ ...local.config, posts_lookback: v })}
                      >
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="24h">Last 24 hours</SelectItem>
                          <SelectItem value="week">Last week</SelectItem>
                          <SelectItem value="month">Last month</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}

              {engagementMode === "posts" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">LinkedIn post URLs (one per line)</Label>
                    <textarea
                      className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 min-h-[64px] font-mono"
                      placeholder="https://www.linkedin.com/posts/...&#10;https://www.linkedin.com/posts/..."
                      defaultValue={postUrls.join("\n")}
                      onChange={(e) => {
                        const next = {
                          ...local.config,
                          post_urls: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                        };
                        updateConfigDebounced("post_urls", next);
                      }}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Your own posts (content-warmed leads) or competitors' (defection signals).
                    </p>
                  </div>
                </>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Engagement types</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(["reactions", "comments"] as const).map((t) => (
                    <Badge
                      key={t}
                      variant={engagementTypesArr.includes(t) ? "default" : "outline"}
                      className="cursor-pointer capitalize"
                      onClick={() => toggleEngagementType(t)}
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>

              {engagementTypesArr.includes("comments") && (
                <div className="space-y-1">
                  <Label className="text-xs">Comments lookback</Label>
                  <Select
                    value={commentsLookback}
                    onValueChange={(v) => updateConfig({ ...local.config, comments_lookback: v })}
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24h">Last 24 hours</SelectItem>
                      <SelectItem value="week">Last week</SelectItem>
                      <SelectItem value="month">Last month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {/* LinkedIn topic intent — search posts for keywords. */}
          {isPostIntent && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Search query</Label>
                <Input
                  className="h-8"
                  placeholder='e.g. "marketing automation pain" OR "looking for CRM"'
                  value={intentSearchQuery}
                  onChange={(e) => setTextField("search_query", e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Same syntax as the LinkedIn post search bar. Quotes for phrases, OR for alternatives.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Posted within</Label>
                  <Select
                    value={intentPostedLimit}
                    onValueChange={(v) => updateConfig({ ...local.config, posted_limit: v })}
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1h">Last hour</SelectItem>
                      <SelectItem value="24h">Last 24 hours</SelectItem>
                      <SelectItem value="week">Last week</SelectItem>
                      <SelectItem value="month">Last month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Max posts: <strong>{intentLimit}</strong>
                  </Label>
                  <Slider
                    value={[intentLimit]}
                    onValueChange={([v]) => updateConfig({ ...local.config, limit: v })}
                    min={10}
                    max={200}
                    step={10}
                  />
                </div>
              </div>
            </>
          )}

          {/* Unipile inbound — followers / connections / pending invites
              from the user's connected LinkedIn account. */}
          {isUnipileInbound && (
            <>
              {unipileAccountsQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">Loading LinkedIn accounts…</p>
              ) : linkedinAccounts.length === 0 ? (
                <div className="p-3 rounded-md border border-dashed bg-muted/30">
                  <p className="text-sm">Connect a LinkedIn account first.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Head to <Link to="/settings?tab=senders" className="underline">Settings → LinkedIn &amp; social</Link> to connect one.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs">LinkedIn account</Label>
                  <Select
                    value={personFirstAccountId}
                    onValueChange={(v) => updateConfig({ ...local.config, account_id: v })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Pick a connected account…" />
                    </SelectTrigger>
                    <SelectContent>
                      {linkedinAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.display_name ?? a.username ?? a.unipile_account_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Sources to scan</Label>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { id: "followers", label: "New followers" },
                    { id: "relations", label: "New connections" },
                    { id: "post_reactors", label: "Post reactors" },
                    { id: "pending_invites", label: "Pending invites" },
                  ] as const).map((opt) => (
                    <Badge
                      key={opt.id}
                      variant={inboundSources.includes(opt.id) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleInboundSource(opt.id)}
                    >
                      {opt.label}
                    </Badge>
                  ))}
                </div>
              </div>

              {inboundSources.includes("post_reactors") && (
                <div className="space-y-1">
                  <Label className="text-xs">Post IDs to monitor (comma-separated)</Label>
                  <Input
                    className="h-8"
                    placeholder="urn:li:activity:7..."
                    defaultValue={inboundPostIds.join(", ")}
                    onChange={(e) => {
                      const next = {
                        ...local.config,
                        post_ids: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      };
                      updateConfigDebounced("post_ids", next);
                    }}
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">
                  Skip if we've messaged them within: <strong>{inboundExcludeRecent === 0 ? "off" : `${inboundExcludeRecent}d`}</strong>
                </Label>
                <Slider
                  min={0}
                  max={180}
                  step={5}
                  value={[inboundExcludeRecent]}
                  onValueChange={([v]) => updateConfig({ ...local.config, exclude_if_outbound_within_days: v })}
                />
              </div>
            </>
          )}
        </div>

        {/* DM FILTER — only relevant for company-first packs. Person-first
            packs (post engagement, intent, Unipile inbound) already give us
            the prospect directly; there's no company to scrape DMs from. */}
        {!isPersonFirstPack && (
        <div className="space-y-2 pt-4 border-t">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            Decision-makers to find at each company
          </p>

          <div className="space-y-1">
            <Label className="text-xs">Seniority</Label>
            <div className="flex flex-wrap gap-1.5">
              {DM_FILTER_SENIORITY_OPTIONS.map((opt) => {
                const active = (dmFilter.seniorityLevelIds ?? []).includes(opt.id);
                return (
                  <Badge key={opt.id} variant={active ? "default" : "outline"} className="cursor-pointer" onClick={() => toggleDmArrayField("seniorityLevelIds", opt.id)}>
                    {opt.label}
                  </Badge>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Function (none = all)</Label>
            <div className="flex flex-wrap gap-1.5">
              {DM_FILTER_FUNCTION_OPTIONS.filter((o) => o.common).map((opt) => {
                const active = (dmFilter.functionIds ?? []).includes(opt.id);
                return (
                  <Badge key={opt.id} variant={active ? "default" : "outline"} className="cursor-pointer" onClick={() => toggleDmArrayField("functionIds", opt.id)}>
                    {opt.label}
                  </Badge>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Job titles (optional, comma-separated)</Label>
            <Input
              className="h-8"
              placeholder='e.g. "Head of Sales", "VP Marketing"'
              defaultValue={(dmFilter.jobTitles ?? []).join(", ")}
              onChange={(e) => setDmJobTitles(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              Max decision-makers per company: <strong>{dmFilter.maxItemsPerCompany ?? 5}</strong>
            </Label>
            <Slider
              value={[dmFilter.maxItemsPerCompany ?? 5]}
              onValueChange={([v]) => setDmMaxItems(v)}
              min={1}
              max={25}
              step={1}
            />
          </div>
        </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}

// Local type for dm_filter shape, mirrors the DmFilter type from useDiscovery.
interface DmFilterShape {
  seniorityLevelIds?: string[];
  functionIds?: string[];
  jobTitles?: string[];
  maxItemsPerCompany?: number;
  profileScraperMode?: string;
}

/**
 * Click-to-edit signal title. Click switches to a text input; Enter or
 * blur commits via onSave; Escape reverts. Empty submission falls back
 * to the original (we never persist a blank name — it'd render as the
 * pack label and be confusing).
 */
function EditableTitle({
  value,
  onSave,
  isPending,
}: {
  value: string;
  onSave: (next: string) => void;
  isPending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  // Keep draft in sync when value changes externally (e.g. after a save).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        disabled={isPending}
        className="text-2xl font-bold bg-transparent border-b-2 border-primary outline-none px-0 py-0 min-w-0 flex-1"
        aria-label="Rename signal"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-2xl font-bold truncate text-left hover:text-primary transition cursor-text"
      title="Click to rename"
    >
      {value}
    </button>
  );
}

interface FunnelStage {
  label: string;
  hint: string;
  value: number;
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * 5-stage conversion funnel for the signal pipeline. Stages render as
 * cards in a single horizontal row on desktop with conversion-rate
 * connectors between them; on mobile they wrap into a 2-column grid
 * without connectors. Conversion < 30% is amber, < 10% is red, so the
 * bottleneck stage is visually unmissable.
 */
function PipelineFunnel({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-stretch sm:gap-0">
      {stages.map((stage, i) => {
        const next = stages[i + 1];
        const conversion = next && stage.value > 0
          ? Math.round((next.value / stage.value) * 100)
          : null;
        const conversionColor =
          conversion === null ? "text-muted-foreground bg-muted/40"
          : conversion < 10 ? "text-red-600 bg-red-50 dark:bg-red-950/30 border-red-500/30"
          : conversion < 30 ? "text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-500/30"
          : "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-500/30";
        const isLast = i === stages.length - 1;
        const Icon = stage.icon;
        const isTerminal = isLast && stage.value > 0;
        return (
          <Fragment key={stage.label}>
            <div
              className={`flex-1 min-w-0 rounded-md border bg-card transition hover:border-primary/40 ${
                isTerminal ? "border-emerald-500/40" : ""
              }`}
              title={stage.hint}
            >
              <div className="px-3 py-3 flex flex-col h-full">
                <div className="flex items-center gap-1.5">
                  {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium truncate">
                    {stage.label}
                  </p>
                </div>
                <p
                  className={`text-2xl font-bold mt-1 tabular-nums leading-none ${
                    isTerminal ? "text-emerald-600" : ""
                  }`}
                >
                  {stage.value}
                </p>
              </div>
            </div>
            {!isLast && (
              <div className="hidden sm:flex flex-col items-center justify-center px-1.5">
                <div
                  className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded border ${conversionColor}`}
                  title={`${stage.value} → ${next!.value}`}
                >
                  {conversion === null ? "—" : `${conversion}%`}
                </div>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// ============================================================================
// Companies tab — paginated, searchable, sortable table of every company the
// signal pipeline has surfaced. Designed to scale to 1000s of rows: server-
// side search + filter + sort + pagination via get_signal_companies SQL fn.
// Per-row expansion uses get_signal_company_detail for the drilldown.
// ============================================================================

const PAGE_SIZE = 25;

function CompanyOutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return null;
  // Plain-English labels — DB uses "enrolled" for "matched + going through
  // outreach pipeline" but that's internal jargon. Surface what the user
  // actually cares about: is this row LIVE (in pipeline) or not?
  const map: Record<string, { label: string; cls: string }> = {
    enrolled: { label: "In pipeline", cls: "bg-emerald-50 text-emerald-700 border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-400" },
    enrolled_holding: { label: "Holding (cap)", cls: "bg-emerald-50 text-emerald-700 border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-400" },
    review_pending: { label: "Awaiting review", cls: "bg-amber-50 text-amber-700 border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-400" },
    cap_hit: { label: "Skipped (cap)", cls: "bg-orange-50 text-orange-700 border-orange-500/30" },
    dropped_below_threshold: { label: "Skipped (low ICP)", cls: "bg-muted text-muted-foreground border-muted-foreground/20" },
    dropped_no_icp_match: { label: "Skipped (no ICP)", cls: "bg-muted text-muted-foreground border-muted-foreground/20" },
    failed: { label: "Failed", cls: "bg-red-50 text-red-700 border-red-500/30" },
  };
  const m = map[outcome] ?? { label: outcome, cls: "bg-muted" };
  return (
    <Badge variant="outline" className={`text-[10px] py-0 h-5 font-medium ${m.cls}`}>
      {m.label}
    </Badge>
  );
}

// Friendly labels for signal_type values stored in the DB.
const SIGNAL_TYPE_LABELS: Record<string, string> = {
  just_funded: "Just funded",
  aggressive_hiring: "Hiring",
  new_leadership: "New leader",
  recent_acquisition: "Acquired",
};

function signalTypeLabel(s: string): string {
  return SIGNAL_TYPE_LABELS[s] ?? s.replace(/_/g, " ");
}

/**
 * Inline signal detail under a company row. Uses buildQuickGlance to render
 * a signal-type-specific summary (job title for hiring, round + amount for
 * funding, person + role for job-changes, acquirer + % for acquisitions)
 * plus a row of context chips. Falls back to the plain signal_detail when
 * raw_signal is null (older rows from before raw_signal was persisted).
 */
function CompanySignalDetail({
  rawSignal,
  fallback,
  evidenceUrl,
}: {
  rawSignal: Record<string, unknown> | null;
  fallback: string | null;
  evidenceUrl?: string | null;
}) {
  const glance = buildQuickGlance(rawSignal, fallback);
  // Surface the source URL — the actual post / job ad / funding
  // announcement, NOT the engager's own profile. Different signal types
  // store the URL under different keys; fall back to evidenceUrl ONLY
  // if it looks like a post (older post-engagement records had
  // evidence_url pointing at the engager's profile, which would send
  // the user to the wrong place).
  const isPostLikeUrl = (u: string | null | undefined) =>
    !!u && /linkedin\.com\/(posts|feed\/update|jobs)\//i.test(u);
  const postUrl = (rawSignal?.post_url as string | undefined)
    ?? (rawSignal?.share_url as string | undefined)
    ?? (rawSignal?.jobUrl as string | undefined)
    ?? (isPostLikeUrl(evidenceUrl) ? evidenceUrl ?? null : null)
    ?? null;
  if (!glance.primary && glance.chips.length === 0 && !postUrl) return null;
  return (
    <div className="mt-1.5 min-w-0">
      {glance.primary && (
        <p className="text-xs text-foreground/80 truncate" title={glance.primary}>
          {glance.primary}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1 mt-1">
        {glance.chips.slice(0, 4).map((c, i) => (
          <Badge
            key={i}
            variant="outline"
            className="text-[10px] py-0 h-4 font-normal text-muted-foreground"
          >
            {c}
          </Badge>
        ))}
        {postUrl && (
          <a
            href={postUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] py-0 h-4 px-1.5 inline-flex items-center gap-1 rounded-md border border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/60 transition font-medium"
            title={postUrl}
          >
            <ExternalLink className="h-2.5 w-2.5" />
            View source
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Pipeline column — collapses the 4 micro-stats (DMs / Verified / In CRM)
 * into a single visual indicator: 4 dots representing the funnel stages.
 * Filled = stage reached. Tooltip on hover shows the actual numbers.
 *
 * Stages: Discovered (always filled if row exists) · DMs found ·
 * Emails verified · In CRM
 */
function PipelineDots({
  dms,
  verified,
  crm,
  onFindDms,
  findPending,
}: {
  dms: number;
  verified: number;
  crm: number;
  onFindDms: () => void;
  findPending: boolean;
}) {
  const dot = (filled: boolean, count: number, color: string) => (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full transition ${
        filled ? color : "bg-muted-foreground/20"
      }`}
      aria-label={`${count}`}
    />
  );

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1" title={`Discovered → DMs ${dms} → Verified ${verified} → CRM ${crm}`}>
        {dot(true, 1, "bg-blue-500")}
        {dot(dms > 0, dms, "bg-blue-500")}
        {dot(verified > 0, verified, "bg-amber-500")}
        {dot(crm > 0, crm, "bg-emerald-500")}
      </div>
      <div className="flex items-center gap-2 text-[11px] tabular-nums">
        {dms === 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFindDms();
            }}
            disabled={findPending}
            className="text-muted-foreground hover:text-primary inline-flex items-center gap-0.5 disabled:opacity-50"
            title="Trigger LinkedIn DM scrape for this company"
          >
            {findPending ? (
              <RefreshCcw className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Search className="h-2.5 w-2.5" />
            )}
            <span className="ml-0.5">Find DMs</span>
          </button>
        ) : (
          <>
            <span className="text-muted-foreground" title="DMs found">
              <Users className="inline h-2.5 w-2.5 mr-0.5" />
              {dms}
            </span>
            <span className={verified > 0 ? "text-amber-600" : "text-muted-foreground/50"} title="Verified emails">
              <Mail className="inline h-2.5 w-2.5 mr-0.5" />
              {verified}
            </span>
            {crm > 0 && (
              <span className="text-emerald-600 font-medium" title="In CRM">
                <Check className="inline h-2.5 w-2.5 mr-0.5" />
                {crm}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CompanyRow({
  row,
  expanded,
  onToggle,
  subscriptionId,
}: {
  row: SignalCompanyRow;
  expanded: boolean;
  onToggle: () => void;
  subscriptionId: string;
}) {
  const detail = useSignalCompanyDetail(subscriptionId, expanded ? row.company_id : null);
  const findDms = useFindDmsForCompany();
  const initials = row.company_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <Fragment>
      <TableRow className="cursor-pointer hover:bg-muted/40 transition border-b" onClick={onToggle}>
        <TableCell className="w-6 pl-3 pr-0 align-middle">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </TableCell>

        {/* Company — primary column. Shows: name + LinkedIn, domain/country/
            employees secondary line, and the latest signal's rich detail
            (job title + seniority + location for hiring, round size + amount
            for funding, etc.) plus a row of context chips pulled from the
            raw SignalBase record. */}
        <TableCell className="align-middle py-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-[11px] font-semibold text-primary mt-0.5">
              {initials || <Building2 className="h-3.5 w-3.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium truncate text-sm">{row.company_name}</p>
                {row.linkedin_url && (
                  <a
                    href={row.linkedin_url.startsWith("http") ? row.linkedin_url : `https://${row.linkedin_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground hover:text-primary shrink-0"
                    title="LinkedIn"
                  >
                    <Linkedin className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                {row.domain && (
                  <a
                    href={`https://${row.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-primary truncate max-w-[14rem]"
                  >
                    {row.domain}
                  </a>
                )}
                {(row.country || row.employee_count != null) && (
                  <span className="shrink-0">·</span>
                )}
                {row.country && <span className="shrink-0">{row.country}</span>}
                {row.employee_count != null && (
                  <span className="shrink-0">{row.employee_count.toLocaleString()} emp</span>
                )}
              </div>
              <CompanySignalDetail
                rawSignal={row.latest_raw_signal}
                fallback={row.latest_signal_detail}
                evidenceUrl={row.latest_evidence_url}
              />
            </div>
          </div>
        </TableCell>

        {/* Signal types — single line, friendly labels */}
        <TableCell className="align-middle py-2.5 whitespace-nowrap">
          <div className="flex items-center gap-1">
            {(row.signal_types ?? []).map((s) => (
              <Badge key={s} variant="secondary" className="text-[10px] py-0 h-5 font-normal whitespace-nowrap">
                {signalTypeLabel(s)}
              </Badge>
            ))}
            {row.signal_count > 1 && (
              <span className="text-[10px] text-muted-foreground">×{row.signal_count}</span>
            )}
          </div>
        </TableCell>

        {/* Outcome */}
        <TableCell className="align-middle py-2.5 whitespace-nowrap">
          <CompanyOutcomeBadge outcome={row.best_outcome} />
        </TableCell>

        {/* ICP score with subtle color hint */}
        <TableCell className="align-middle py-2.5 tabular-nums whitespace-nowrap">
          {row.best_icp_score != null ? (
            <span
              className={`text-xs font-medium px-1.5 py-0.5 rounded border ${
                row.best_icp_score >= 80
                  ? "bg-emerald-50 text-emerald-700 border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-400"
                  : row.best_icp_score >= 60
                  ? "bg-amber-50 text-amber-700 border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-400"
                  : "bg-muted text-muted-foreground border-muted-foreground/20"
              }`}
            >
              {row.best_icp_score}
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </TableCell>

        {/* Pipeline progress: visual dots + counts. Replaces 3 separate columns. */}
        <TableCell className="align-middle py-2.5 whitespace-nowrap">
          <PipelineDots
            dms={row.dms_count}
            verified={row.verified_emails_count}
            crm={row.crm_contacts_count}
            onFindDms={() => findDms.mutate(row.company_id)}
            findPending={findDms.isPending}
          />
        </TableCell>

        {/* Event date — the actual real-world signal date (funding date,
            hiring date, post date). Hover surfaces when WE discovered it
            so the user can spot stale-but-newly-found rows. */}
        <TableCell
          className="align-middle py-2.5 text-[11px] whitespace-nowrap pr-3"
          title={
            row.latest_signal_at
              ? `Discovered ${fmtRelative(row.latest_signal_at)}`
              : undefined
          }
        >
          <div className="flex flex-col">
            <span className="text-foreground/90 tabular-nums">
              {row.latest_signal_date
                ? format(new Date(row.latest_signal_date), "MMM d, yyyy")
                : "—"}
            </span>
            {row.latest_signal_at && (
              <span className="text-muted-foreground text-[10px]">
                seen {fmtRelative(row.latest_signal_at)}
              </span>
            )}
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="border-b-0">
          <TableCell colSpan={7} className="bg-muted/30 p-0">
            <CompanyExpandedView detail={detail.data ?? []} loading={detail.isLoading} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

/**
 * One signal occurrence in the expanded drilldown — chip + score + relative
 * time + signal_detail line, plus an expandable "Raw signal data (N fields)"
 * that opens the categorized RawSignalView (every field from the SignalBase
 * actor: jobUrl, descriptionText, investors[], roundType, etc.).
 */
function SignalOccurrenceItem({ signal }: { signal: SignalCompanyDetailRow }) {
  const [open, setOpen] = useState(false);
  const glance = buildQuickGlance(signal.raw_signal, signal.signal_detail);
  const fieldCount = signal.raw_signal ? Object.keys(signal.raw_signal).length : 0;

  return (
    <li className="text-xs">
      <div className="flex items-center gap-1.5 flex-wrap">
        {signal.signal_type && (
          <Badge variant="secondary" className="text-[10px] py-0 h-4 font-normal">
            {signalTypeLabel(signal.signal_type)}
          </Badge>
        )}
        {signal.icp_score != null && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            ICP {signal.icp_score}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground/70 ml-auto">
          {fmtRelative(signal.occurred_at)}
        </span>
      </div>
      {glance.primary && (
        <p className="text-[11px] mt-0.5 leading-snug">{glance.primary}</p>
      )}
      {glance.chips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {glance.chips.slice(0, 3).map((c, i) => (
            <Badge
              key={i}
              variant="outline"
              className="text-[10px] py-0 h-4 font-normal text-muted-foreground"
            >
              {c}
            </Badge>
          ))}
        </div>
      )}
      {fieldCount > 0 && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
          >
            {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
            Raw data <span className="text-muted-foreground/60">· {fieldCount} fields</span>
          </button>
          {open && signal.raw_signal && (
            <div className="mt-2">
              <RawSignalView rawSignal={signal.raw_signal} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function CompanyExpandedView({
  detail,
  loading,
}: {
  detail: SignalCompanyDetailRow[];
  loading: boolean;
}) {
  const signals = detail.filter((d) => d.kind === "signal");
  const dms = detail.filter((d) => d.kind === "dm");
  const contacts = detail.filter((d) => d.kind === "contact");

  if (loading && detail.length === 0) {
    return (
      <div className="px-4 py-3 space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-3/4" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 lg:divide-x divide-border">
      {/* CRM contacts — primary outreach surface, gets the most width */}
      <section className="lg:col-span-5 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <Check className="h-3 w-3 text-emerald-600" />
            In CRM
            <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">{contacts.length}</span>
          </h4>
        </div>
        {contacts.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-2">
            None yet — DMs need verified emails first.
          </p>
        ) : (
          <ul className="space-y-1">
            {contacts.map((c) => (
              <li key={c.ref_id} className="text-xs flex items-center gap-2 py-1 group">
                <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center text-[10px] font-semibold text-emerald-700 shrink-0">
                  {(c.contact_display_name ?? "")
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase())
                    .join("") || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{c.contact_display_name}</span>
                    {c.contact_job_title && (
                      <span className="text-muted-foreground text-[11px] truncate hidden sm:inline">
                        · {c.contact_job_title}
                      </span>
                    )}
                  </div>
                  {c.contact_primary_email && (
                    <a
                      href={`mailto:${c.contact_primary_email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] text-primary hover:underline truncate block"
                    >
                      {c.contact_primary_email}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* DMs found — middle column */}
      <section className="lg:col-span-4 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <Users className="h-3 w-3" />
            DMs found
            <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">{dms.length}</span>
          </h4>
        </div>
        {dms.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-2">
            No DMs scraped yet.
          </p>
        ) : (
          <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {dms.map((d) => (
              <li key={d.ref_id} className="text-xs py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium truncate">
                    {d.dm_first_name} {d.dm_last_name ?? ""}
                  </span>
                  {d.dm_email_status && (
                    <span
                      className={`text-[10px] px-1 py-0 rounded ${
                        d.dm_email_status === "verified"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                          : d.dm_email_status === "catch_all"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {d.dm_email_status === "catch_all" ? "catch-all" : d.dm_email_status}
                    </span>
                  )}
                  {d.dm_linkedin_url && (
                    <a
                      href={d.dm_linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-primary shrink-0"
                      title="LinkedIn"
                    >
                      <Linkedin className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
                {d.dm_title && (
                  <div className="text-muted-foreground text-[11px] truncate">{d.dm_title}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Signal occurrences — narrowest column, context. Each occurrence
          can be expanded to show its full SignalBase record (every field). */}
      <section className="lg:col-span-3 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <FileText className="h-3 w-3" />
            Signals
            <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">{signals.length}</span>
          </h4>
        </div>
        {signals.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-2">No signal occurrences.</p>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {signals.map((s) => (
              <SignalOccurrenceItem key={s.ref_id} signal={s} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CompaniesTab({ subscriptionId }: { subscriptionId: string }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Default to "in pipeline" — borderline (review_pending) rows already
  // surface in the dedicated "borderline matches awaiting your call"
  // section above the tabs, so showing them here too is redundant and
  // confusing. Users can still click "Awaiting review" or "All" to widen
  // the view when they want to.
  const [outcomeFilter, setOutcomeFilter] = useState<CompanyOutcomeFilter>("enrolled");
  // Default sort: real-world event date desc. Users care about WHEN the
  // funding/hiring/post happened, not when we discovered it. The pure
  // discovery timestamp is a poor proxy — a 2024 round discovered today
  // shouldn't outrank a 2026 round discovered yesterday.
  const [sortBy, setSortBy] = useState<CompanySortKey>("latest_signal_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 250ms search debounce
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const query = useSignalCompanies(subscriptionId, {
    search: debouncedSearch,
    outcomeFilter,
    sortBy,
    sortDir,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleSort = (key: CompanySortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const sortIcon = (key: CompanySortKey) => {
    if (sortBy !== key) return null;
    return <ChevronDown className={`h-3 w-3 inline ml-0.5 transition ${sortDir === "asc" ? "rotate-180" : ""}`} />;
  };

  const filterChips: Array<{ value: CompanyOutcomeFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "in_crm", label: "In CRM" },
    { value: "has_dms", label: "DMs found" },
    { value: "enrolled", label: "In pipeline" },
    { value: "review_pending", label: "Awaiting review" },
    { value: "no_dms", label: "No DMs" },
    { value: "dropped", label: "Skipped" },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[16rem] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search companies or domains…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {filterChips.map((c) => (
            <Button
              key={c.value}
              variant={outcomeFilter === c.value ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => {
                setOutcomeFilter(c.value);
                setPage(0);
              }}
            >
              {c.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {query.isLoading ? "Loading…" : `${total.toLocaleString()} ${total === 1 ? "company" : "companies"}`}
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-6 pl-3 pr-0" />
              <TableHead
                className="cursor-pointer select-none text-[11px] uppercase tracking-wider font-medium"
                onClick={() => toggleSort("company_name")}
              >
                Company {sortIcon("company_name")}
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider font-medium">
                Signals
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider font-medium">
                Outcome
              </TableHead>
              <TableHead
                className="cursor-pointer select-none text-[11px] uppercase tracking-wider font-medium"
                onClick={() => toggleSort("best_icp_score")}
              >
                ICP {sortIcon("best_icp_score")}
              </TableHead>
              <TableHead
                className="cursor-pointer select-none text-[11px] uppercase tracking-wider font-medium whitespace-nowrap"
                onClick={() => toggleSort("crm_contacts_count")}
                title="DMs found · Verified emails · In CRM"
              >
                Pipeline {sortIcon("crm_contacts_count")}
              </TableHead>
              <TableHead
                className="cursor-pointer select-none text-[11px] uppercase tracking-wider font-medium whitespace-nowrap pr-3"
                onClick={() => toggleSort("latest_signal_date")}
                title="Real-world event date (funding announcement, hiring date, post date, etc.). Hover the cell to see when we discovered it."
              >
                Event date {sortIcon("latest_signal_date")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading && rows.length === 0 ? (
              [0, 1, 2, 3, 4].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7} className="py-3">
                    <Skeleton className="h-7 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <Inbox className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {debouncedSearch
                      ? `No companies matching “${debouncedSearch}”.`
                      : outcomeFilter !== "all"
                      ? `No companies with outcome = ${outcomeFilter.replace(/_/g, " ")}.`
                      : "No companies discovered yet. Trigger a refresh."}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <CompanyRow
                  key={r.company_id}
                  row={r}
                  expanded={expandedId === r.company_id}
                  onToggle={() => setExpandedId((id) => (id === r.company_id ? null : r.company_id))}
                  subscriptionId={subscriptionId}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page + 1} of {totalPages} · showing {rows.length} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SignalDetailPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>();
  const navigate = useNavigate();
  const subQuery = usePackSubscription(subscriptionId);
  const counts = useSignalCounts(subscriptionId);
  const apifyRunsTotal = useApifyRunsTotal(subscriptionId);
  const activity = useSignalActivity(subscriptionId, 200);
  const reviewQueue = useSignalReviewQueue(subscriptionId);
  const updateSub = useUpdatePackSubscription();
  const deleteSub = useDeletePackSubscription();
  const triggerRefresh = useTriggerPackRefresh();
  const updateSignal = useUpdateSignal();
  const decide = useDecideReviewItem();
  const [outcomeFilter, setOutcomeFilter] = useState<
    "all" | "enrolled" | "review" | "skipped" | "stuck"
  >("enrolled");

  const sub = subQuery.data;
  const icpsQuery = useLibraryIcps();
  const smartList = useSmartListInfo(sub?.smart_list_id);
  const targetingCampaigns = useCampaignsTargetingList(sub?.smart_list_id);
  const availableCampaigns = useAvailableCampaigns();
  const linkCampaign = useLinkSmartListToCampaign();
  const targetingSequences = useSequencesTargetingList(sub?.smart_list_id);
  const availableSequences = useAvailableSequences();
  const linkSequence = useLinkSmartListToSequence();
  const wireLists = useWireSignalLists();
  // Local state for the sequence-link select (the campaign one already
  // exists nearby as `linkingCampaignId`). Kept separate so the user can
  // queue a campaign + a sequence in the same screen visit.
  const [linkingSequenceId, setLinkingSequenceId] = useState<string>("");
  const [linkingCampaignId, setLinkingCampaignId] = useState<string>("");

  // Channel forecast for the smart list — informational, not a gate. The
  // campaign-processor skip-and-continues per-step for contacts missing a
  // channel, so a no-LinkedIn lead in a LinkedIn campaign just skips the
  // LinkedIn nodes. Surfacing the breakdown lets the operator pick with
  // eyes open.
  const reachability = useSmartListReachability(sub?.smart_list_id);
  const selectedCampaign = (availableCampaigns.data ?? []).find((c) => c.id === linkingCampaignId) as
    | { id: string; name: string; status: string; needs_email?: boolean; needs_linkedin?: boolean }
    | undefined;
  const selectedCampaignNeedsEmail = !!selectedCampaign?.needs_email;
  const selectedCampaignNeedsLinkedIn = !!selectedCampaign?.needs_linkedin;

  const filteredActivity = useMemo(() => {
    const rows = activity.data ?? [];
    return rows.filter((r) => {
      if (outcomeFilter === "all") return true;
      if (outcomeFilter === "enrolled") return r.outcome === "enrolled" || r.outcome === "enrolled_holding";
      if (outcomeFilter === "review") return r.outcome === "review_pending";
      if (outcomeFilter === "skipped") return r.outcome === "dropped_below_threshold" || r.outcome === "cap_hit" || r.outcome === "failed";
      if (outcomeFilter === "stuck") {
        if (r.outcome !== "enrolled" && r.outcome !== "enrolled_holding") return false;
        if (r.exported_at) return false;
        const ageMs = Date.now() - new Date(r.created_at).getTime();
        return ageMs > 24 * 60 * 60 * 1000;
      }
      return true;
    });
  }, [activity.data, outcomeFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, SignalActivityRow[]>();
    for (const row of filteredActivity) {
      const bucket = dateBucket(row.created_at);
      if (!map.has(bucket)) map.set(bucket, []);
      map.get(bucket)!.push(row);
    }
    return Array.from(map.entries());
  }, [filteredActivity]);

  if (subQuery.isLoading) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="container mx-auto py-6 space-y-6">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-8 w-1/2" />
          <div className="grid grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </AppLayout>
    );
  }

  if (!sub) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="container mx-auto py-6 space-y-4">
          <Button variant="outline" size="sm" onClick={() => navigate("/signals")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to signals
          </Button>
          <p className="text-sm text-muted-foreground">Signal not found.</p>
        </div>
      </AppLayout>
    );
  }

  const Icon = packIcon(sub.pack_key);
  const displayName = sub.name?.trim() || packLabel(sub.pack_key);
  const togglePause = () =>
    updateSub.mutate({ id: sub.id, status: sub.status === "active" ? "paused" : "active" });
  const cancel = () => updateSub.mutate({ id: sub.id, status: "cancelled" });
  const deleteSignal = () => {
    deleteSub.mutate(sub.id, {
      onSuccess: () => navigate("/signals"),
    });
  };
  const pendingReview = reviewQueue.data ?? [];

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="container mx-auto py-6 space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/signals/dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" /> All signals
          </Link>
        </Button>

        {/* Hero */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <EditableTitle
                  value={displayName}
                  isPending={updateSignal.isPending}
                  onSave={(next) => updateSignal.mutate({ id: sub.id, name: next })}
                />
                <Badge variant={sub.status === "active" ? "default" : "secondary"} className="capitalize">
                  {sub.status === "active" ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Active
                    </span>
                  ) : sub.status}
                </Badge>
              </div>
              {sub.name && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Trigger: {packLabel(sub.pack_key)}
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-1">
                Last refresh {fmtRelative(sub.last_refreshed_at)}
                {sub.next_refresh_at && (
                  <> · next {format(new Date(sub.next_refresh_at), "MMM d, h:mm a")}</>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Current settings — every field is a live editor. Saves on
            change (debounced for text inputs). */}
        <SignalSettingsCard sub={sub} icps={icpsQuery.data ?? []} />

        {/* Output summary — focuses on what the user actually cares about:
            (1) how many leads are ready for outreach, (2) what needs their
            attention. The 5-stage funnel + 4 stat cards used to live here,
            but they mixed units (events vs companies) and surfaced
            engineering-grade metrics that don't help a user decide what to
            do next. Power users can see per-stage counts via the Companies
            tab + filter chips.

            Stuck-signal recovery is now handled by the
            signals-auto-recover-stuck cron (every 5 min) — no Retry button. */}
        <div className={`grid gap-3 ${(counts.data?.linkedin_only ?? 0) > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <Card className="bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-500/30">
            <CardContent className="py-5">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-medium">
                    Ready for outreach
                  </p>
                  <p className="text-3xl font-bold mt-1">
                    {counts.data?.in_crm ?? 0}
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                      contact{(counts.data?.in_crm ?? 0) === 1 ? "" : "s"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(counts.data?.in_crm ?? 0) > 0
                      ? "In your CRM with a verified email — point any campaign or sequence at the smart list below to start outreach."
                      : (counts.data?.enrolled_today ?? 0) > 0
                        ? "Companies are matching, but their decision-makers + emails are still being scraped. Verified contacts land here as the pipeline completes (typically a few minutes after each refresh)."
                        : "No contacts have cleared the verified-email step yet. They'll appear here as your trigger fires and the pipeline runs."}
                  </p>
                </div>
                <Check className="h-5 w-5 text-emerald-600 shrink-0" />
              </div>
            </CardContent>
          </Card>

          {(counts.data?.linkedin_only ?? 0) > 0 && (
            <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-500/30">
              <CardContent className="py-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-400 font-medium">
                      LinkedIn-only · Email not found
                    </p>
                    <p className="text-3xl font-bold mt-1">
                      {counts.data?.linkedin_only ?? 0}
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        contact{(counts.data?.linkedin_only ?? 0) === 1 ? "" : "s"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      We have their LinkedIn profile but no email. Reach out via LinkedIn DM — they already engaged with your content, so warmth is high. Open the contact to message them.
                    </p>
                  </div>
                  <Linkedin className="h-5 w-5 text-blue-600 shrink-0" />
                </div>
              </CardContent>
            </Card>
          )}

          {(counts.data?.pending_review ?? 0) > 0 ? (
            <Card className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-500/40">
              <CardContent className="py-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400 font-medium">
                      Needs your review
                    </p>
                    <p className="text-3xl font-bold mt-1">
                      {counts.data?.pending_review ?? 0}
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        compan{(counts.data?.pending_review ?? 0) === 1 ? "y" : "ies"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Borderline ICP score — approve or skip below.
                    </p>
                  </div>
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                      In pipeline this week
                    </p>
                    <p className="text-3xl font-bold mt-1">
                      {counts.data?.enrolled_week ?? 0}
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        compan{(counts.data?.enrolled_week ?? 0) === 1 ? "y" : "ies"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Matched companies being scraped + verified. Lifetime: {counts.data?.companies_total ?? 0}.
                    </p>
                  </div>
                  <Activity className="h-5 w-5 text-muted-foreground shrink-0" />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sticky controls */}
        <div className="sticky top-0 z-10 -mx-2 px-2 py-2 bg-background/95 backdrop-blur-sm border-b flex flex-wrap gap-2">
          <Button
            variant="cta"
            size="sm"
            onClick={() => triggerRefresh.mutate(sub.id)}
            disabled={triggerRefresh.isPending}
          >
            <RefreshCcw className={`h-4 w-4 mr-2 ${triggerRefresh.isPending ? "animate-spin" : ""}`} />
            {triggerRefresh.isPending ? "Refreshing…" : "Refresh now"}
          </Button>
          <Button variant="outline" size="sm" onClick={togglePause} disabled={updateSub.isPending}>
            {sub.status === "active" ? (
              <>
                <Pause className="h-4 w-4 mr-2" /> Pause
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" /> Resume
              </>
            )}
          </Button>
          {sub.lead_list_id && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/leads/lists/${sub.lead_list_id}`}>
                <ExternalLink className="h-4 w-4 mr-2" /> Lead list
              </Link>
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {apifyRunsTotal.data != null && apifyRunsTotal.data > 0 && (
              <span
                className="text-[11px] text-muted-foreground tabular-nums px-2 py-0.5 rounded bg-muted/50"
                title="Total Apify actor runs kicked off by this signal across all refreshes. Wider lookback windows + faster cadences burn more."
              >
                {apifyRunsTotal.data} Apify run{apifyRunsTotal.data === 1 ? "" : "s"}
              </span>
            )}
            <span className="text-xs text-muted-foreground">Cadence</span>
            <Select
              value={sub.refresh_cadence}
              onValueChange={(v) =>
                updateSub.mutate({ id: sub.id, refresh_cadence: v as RefreshCadence })
              }
            >
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
            {sub.status !== "cancelled" && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={cancel} disabled={updateSub.isPending}>
                <X className="h-4 w-4 mr-2" /> Cancel
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={deleteSub.isPending}
                  aria-label="Delete signal"
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this signal?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Future refreshes stop and the signal disappears from your list.
                    The smart list and any contacts already discovered stay in your CRM,
                    so campaigns wired to this list keep working.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep signal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={deleteSignal}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Review queue */}
        {pendingReview.length > 0 && (
          <Card className="border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                {pendingReview.length} borderline {pendingReview.length === 1 ? "match" : "matches"} awaiting your call
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {pendingReview.slice(0, 5).map((row) => (
                <div key={row.id} className="flex items-start gap-3 py-2 border-b last:border-b-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{row.signal_detail ?? "Signal"}</span>
                      {row.icp_score != null && (
                        <Badge variant="outline" className="text-xs tabular-nums">
                          {row.icp_score}/100
                        </Badge>
                      )}
                    </div>
                    {row.icp_score_reasoning && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {row.icp_score_reasoning}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="cta"
                      onClick={() => decide.mutate({ id: row.id, decision: "approved" })}
                      disabled={decide.isPending}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => decide.mutate({ id: row.id, decision: "rejected" })}
                      disabled={decide.isPending}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
              {pendingReview.length > 5 && (
                <p className="text-xs text-muted-foreground pt-2">+ {pendingReview.length - 5} more — handle inline below</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Smart list panel — the dynamic list of qualified contacts.
            This is THE handoff point from the signal pipeline to outreach:
            campaigns and email sequences pull leads by pointing at this
            smart list as their lead source. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListFilter className="h-4 w-4 text-primary" />
              Use these leads in a campaign or sequence
            </CardTitle>
            <CardDescription>
              Each company that matches your trigger produces contacts (with verified emails) that
              land in a smart list below. Point any campaign or email sequence at this list and new
              matches auto-enroll into outreach.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!sub.smart_list_id || !smartList.data ? (
              <div className="space-y-3 p-4 rounded-md border border-dashed bg-muted/20">
                <div>
                  <p className="text-sm font-medium">This signal isn't connected to a list yet</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Companies in the pipeline produce contacts, but without a list there's nowhere
                    for campaigns and sequences to pick them up. Click below to create the two
                    auto-managed lists for this signal: a "discovered" list (everything found) and a
                    "qualified" smart list (verified email + ICP score &ge; {sub.min_icp_score ?? 60}).
                  </p>
                </div>
                <Button
                  variant="cta"
                  size="sm"
                  disabled={wireLists.isPending}
                  onClick={() => wireLists.mutate(sub.id)}
                >
                  {wireLists.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating lists…
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Wire up lists
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 p-3 rounded-md bg-muted/40">
                  <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <Mail className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{smartList.data.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {smartList.data.member_count_live}{" "}
                      {smartList.data.member_count_live === 1 ? "contact" : "contacts"} match this
                      filter right now · auto-updates as new leads arrive
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/leads/lists/${sub.smart_list_id}`}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                    </Link>
                  </Button>
                </div>

                {/* Already-linked campaigns + sequences */}
                {((targetingCampaigns.data ?? []).length > 0 ||
                  (targetingSequences.data ?? []).length > 0) && (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                      Receiving these leads
                    </p>
                    {(targetingCampaigns.data ?? []).map((c) => (
                      <div
                        key={`camp-${c.id}`}
                        className="flex items-center gap-2 p-2 rounded-md border bg-background"
                      >
                        <Megaphone className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <Badge variant="outline" className="text-[10px] py-0 h-4">
                          Campaign
                        </Badge>
                        <span className="font-medium text-sm flex-1 truncate">{c.name}</span>
                        <Badge variant="outline" className="text-xs capitalize">
                          {c.status}
                        </Badge>
                        {c.auto_enroll_new_members && (
                          <Badge className="text-xs">auto-enroll</Badge>
                        )}
                      </div>
                    ))}
                    {(targetingSequences.data ?? []).map((s) => (
                      <div
                        key={`seq-${s.id}`}
                        className="flex items-center gap-2 p-2 rounded-md border bg-background"
                      >
                        <Mail className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <Badge variant="outline" className="text-[10px] py-0 h-4">
                          Sequence
                        </Badge>
                        <span className="font-medium text-sm flex-1 truncate">{s.name}</span>
                        <Badge variant="outline" className="text-xs capitalize">
                          {s.status}
                        </Badge>
                        {s.auto_enroll_new_members && (
                          <Badge className="text-xs">auto-enroll</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Dual link selectors — campaign and email sequence side by side */}
                <div className="grid sm:grid-cols-2 gap-3">
                  {/* Link to a multi-channel campaign (LinkedIn + email + ...) */}
                  <div className="space-y-2 p-3 rounded-md border bg-muted/20">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                        Multi-channel campaign
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                        For LinkedIn-first or mixed-channel outreach (DMs, email, WhatsApp, etc.).
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Select
                        value={linkingCampaignId}
                        onValueChange={(v) => setLinkingCampaignId(v)}
                      >
                        <SelectTrigger className="h-9 flex-1 min-w-0">
                          <SelectValue placeholder="Pick a campaign…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(availableCampaigns.data ?? [])
                            .filter((c) => c.lead_list_id !== sub.smart_list_id)
                            .map((c) => {
                              const opt = c as { id: string; name: string; needs_email?: boolean; needs_linkedin?: boolean };
                              const channelLabel = opt.needs_linkedin && opt.needs_email
                                ? "LinkedIn + Email"
                                : opt.needs_linkedin
                                  ? "LinkedIn only"
                                  : opt.needs_email
                                    ? "Email only"
                                    : "Other";
                              return (
                                <SelectItem key={c.id} value={c.id}>
                                  <span className="flex items-center gap-2">
                                    <span>{c.name}</span>
                                    <Badge variant="outline" className="h-4 shrink-0 py-0 text-[10px]">
                                      {channelLabel}
                                    </Badge>
                                  </span>
                                </SelectItem>
                              );
                            })}
                          {(availableCampaigns.data ?? []).length === 0 && (
                            <div className="p-2 text-xs text-muted-foreground">
                              No campaigns yet. Build one in /campaigns first.
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="cta"
                        size="sm"
                        className="shrink-0"
                        disabled={!linkingCampaignId || linkCampaign.isPending}
                        onClick={() => {
                          if (!linkingCampaignId || !sub.smart_list_id) return;
                          linkCampaign.mutate(
                            { campaign_id: linkingCampaignId, list_id: sub.smart_list_id },
                            { onSuccess: () => setLinkingCampaignId("") },
                          );
                        }}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Link
                      </Button>
                    </div>
                    {linkingCampaignId && reachability.data && (
                      <CampaignReachabilityForecast
                        total={reachability.data.total}
                        withEmail={reachability.data.withEmail}
                        withLinkedIn={reachability.data.withLinkedIn}
                        needsEmail={selectedCampaignNeedsEmail}
                        needsLinkedIn={selectedCampaignNeedsLinkedIn}
                      />
                    )}
                  </div>

                  {/* Link to an email sequence (email-only outreach) */}
                  <div className="space-y-2 p-3 rounded-md border bg-muted/20">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                        Email sequence
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                        For pure cold-email outreach. New eligible contacts enroll within about a minute.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Select
                        value={linkingSequenceId}
                        onValueChange={(v) => setLinkingSequenceId(v)}
                      >
                        <SelectTrigger className="h-9 flex-1 min-w-0">
                          <SelectValue placeholder="Pick a sequence…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(availableSequences.data ?? [])
                            .filter((s) => s.lead_list_id !== sub.smart_list_id)
                            .map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                <span className="flex items-center gap-2">
                                  <span>{s.name}</span>
                                  <Badge variant="outline" className="text-xs capitalize">
                                    {s.status}
                                  </Badge>
                                </span>
                              </SelectItem>
                            ))}
                          {(availableSequences.data ?? []).length === 0 && (
                            <div className="p-2 text-xs text-muted-foreground">
                              No email sequences yet. Build one in /sequences first.
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="cta"
                        size="sm"
                        className="shrink-0"
                        disabled={!linkingSequenceId || linkSequence.isPending}
                        onClick={() => {
                          if (!linkingSequenceId || !sub.smart_list_id) return;
                          linkSequence.mutate(
                            { sequence_id: linkingSequenceId, list_id: sub.smart_list_id },
                            { onSuccess: () => setLinkingSequenceId("") },
                          );
                        }}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Link
                      </Button>
                    </div>
                    {linkingSequenceId && reachability.data && (
                      <CampaignReachabilityForecast
                        total={reachability.data.total}
                        withEmail={reachability.data.withEmail}
                        withLinkedIn={reachability.data.withLinkedIn}
                        needsEmail
                        needsLinkedIn={false}
                      />
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Linking points the destination's lead source at this smart list AND turns on
                  auto-enroll. New qualified contacts flow into outreach as the signal finds them.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Tabs: Companies (default, the unit users care about) / Activity (raw event stream) */}
        <Tabs defaultValue="companies" className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-sm">
            <TabsTrigger value="companies">
              <Building2 className="h-3.5 w-3.5 mr-1.5" />
              Companies
            </TabsTrigger>
            <TabsTrigger value="activity">
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Activity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="companies" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                {sub && <CompaniesTab subscriptionId={sub.id} />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>Activity feed</CardTitle>
                  <div className="flex items-center gap-1 flex-wrap">
                    {(["enrolled", "stuck", "review", "skipped", "all"] as const).map((f) => {
                      const stuckCount = counts.data?.stuck_24h ?? 0;
                      const stuckColorClass = f === "stuck" && stuckCount > 0 ? "text-amber-600" : "";
                      // Internal filter values stay as-is (matched against
                      // outcome enum); display labels are plain English so
                      // users don't have to translate "enrolled" in their head.
                      const filterLabel: Record<typeof f, string> = {
                        enrolled: "In pipeline",
                        stuck: stuckCount > 0 ? `Stuck > 24h (${stuckCount})` : "Stuck > 24h",
                        review: "Awaiting review",
                        skipped: "Skipped",
                        all: "All",
                      };
                      return (
                        <Button
                          key={f}
                          variant={outcomeFilter === f ? "secondary" : "ghost"}
                          size="sm"
                          className={`h-7 px-2 text-xs ${stuckColorClass}`}
                          onClick={() => setOutcomeFilter(f)}
                        >
                          {filterLabel[f]}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {activity.isLoading ? (
                  <div className="space-y-2">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="flex gap-3 py-3">
                        <Skeleton className="h-2 w-2 rounded-full mt-2" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-1/3" />
                          <Skeleton className="h-3 w-2/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : grouped.length === 0 ? (
                  <div className="py-12 text-center space-y-2">
                    <Activity className="h-6 w-6 text-muted-foreground mx-auto" />
                    <p className="text-sm text-muted-foreground">
                      {outcomeFilter === "enrolled"
                        ? "Nothing in the pipeline yet."
                        : outcomeFilter === "stuck"
                        ? "No signals stuck — pipeline is healthy."
                        : outcomeFilter === "review"
                        ? "No companies waiting for review."
                        : outcomeFilter === "skipped"
                        ? "No skipped activity yet."
                        : "No activity yet."}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {outcomeFilter === "stuck"
                        ? "If a company moved into the pipeline but no contacts reached the CRM after 24h, it'll show up here."
                        : "Trigger a refresh or wait for the next scheduled run."}
                    </p>
                  </div>
                ) : (
                  grouped.map(([bucket, rows]) => {
                    // Within a date bucket, collapse rows for the same
                    // company into a single header — multiple signals for one
                    // company show as "+N more" instead of N near-identical
                    // rows. Falls back to evidence_url then company_name so
                    // we cover the case where discovered_company_id is null
                    // (cap_hit / dropped_below_threshold / failed paths).
                    const groupKeyOf = (r: SignalActivityRow): string => {
                      if (r.discovered_company_id) return `c:${r.discovered_company_id}`;
                      const data = (r.data as Record<string, unknown>) ?? {};
                      const company = (data.company_name as string | undefined) ?? "";
                      return `n:${company.toLowerCase()}`;
                    };
                    const byCompany = new Map<string, SignalActivityRow[]>();
                    for (const r of rows) {
                      const k = groupKeyOf(r);
                      if (!byCompany.has(k)) byCompany.set(k, []);
                      byCompany.get(k)!.push(r);
                    }
                    return (
                      <div key={bucket}>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">
                          {bucket}
                          <span className="ml-2 font-normal">{rows.length}</span>
                        </p>
                        <div className="space-y-0">
                          {Array.from(byCompany.entries()).map(([key, companyRows]) => (
                            <GroupedActivityRows key={key} rows={companyRows} />
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
