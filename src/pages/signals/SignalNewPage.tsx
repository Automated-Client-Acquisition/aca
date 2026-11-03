import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Activity, Sparkles, Loader2, Check } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PACK_CATALOG,
  useLibraryIcps,
  useCreateSignal,
  useUpdateSignal,
  usePackSubscription,
  DM_FILTER_DEFAULT,
  DM_FILTER_SENIORITY_OPTIONS,
  DM_FILTER_FUNCTION_OPTIONS,
  type DmFilter,
  type PackTier,
  type RefreshCadence,
} from "@/hooks/useDiscovery";
import { useScrapeAndCreateIcp } from "@/hooks/useICPs";
import { useUnipileAccounts } from "@/hooks/useUnipileAccounts";
import { ProfileMonitorPicker } from "@/components/signals/ProfileMonitorPicker";

type Step = 1 | 2 | 3;

type DatePreset = "last_24h" | "last_7d" | "last_14d" | "last_30d" | "last_90d";

const DATE_PRESET_OPTIONS: Array<{ value: DatePreset; label: string }> = [
  { value: "last_24h", label: "Last 24 hours" },
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_14d", label: "Last 14 days" },
  { value: "last_30d", label: "Last 30 days" },
  { value: "last_90d", label: "Last 90 days" },
];

// All enum values below match the SignalBase actor README at
// https://console.apify.com/actors/fzywn8Ow4rvDK6VPc — sending values
// outside these enums causes the actor to silently filter to ~0 results.

const FUNDING_ROUNDS = [
  "Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D",
  "Series E", "Series F", "Series G", "Growth", "Debt", "Grant", "IPO", "Undisclosed",
];
const FUNDING_ROUND_LABEL: Record<string, string> = {
  "Pre-Seed": "Pre-Seed",
  "Seed": "Seed",
  "Series A": "Series A",
  "Series B": "Series B",
  "Series C": "Series C",
  "Series D": "Series D",
  "Series E": "Series E",
  "Series F": "Series F",
  "Series G": "Series G",
  "Growth": "Growth",
  "Debt": "Debt",
  "Grant": "Grant",
  "IPO": "IPO",
  "Undisclosed": "Undisclosed",
};

const SENIORITIES = ["founder", "c_level", "vp", "director", "head", "lead", "manager"];
const SENIORITY_LABEL: Record<string, string> = {
  founder: "Founder",
  c_level: "C-suite",
  vp: "VP",
  director: "Director",
  head: "Head",
  lead: "Lead",
  manager: "Manager",
};

const DEPARTMENTS = [
  "marketing", "sales", "engineering", "product", "design",
  "operations", "finance", "people", "data", "customer_success",
  "growth", "legal",
];
const DEPARTMENT_LABEL: Record<string, string> = {
  marketing: "Marketing",
  sales: "Sales",
  engineering: "Engineering",
  product: "Product",
  design: "Design",
  operations: "Operations",
  finance: "Finance",
  people: "People / HR",
  data: "Data",
  customer_success: "Customer Success",
  growth: "Growth",
  legal: "Legal",
};

const POSITIONS = [
  "ceo", "cto", "cfo", "coo",
  "vp of engineering", "vp of sales", "vp of marketing",
  "head of product", "head of growth", "head of engineering",
  "engineering manager", "product manager",
  "sales manager", "marketing manager",
  "founder", "co-founder",
];
const POSITION_LABEL: Record<string, string> = {
  ceo: "CEO",
  cto: "CTO",
  cfo: "CFO",
  coo: "COO",
  "vp of engineering": "VP of Engineering",
  "vp of sales": "VP of Sales",
  "vp of marketing": "VP of Marketing",
  "head of product": "Head of Product",
  "head of growth": "Head of Growth",
  "head of engineering": "Head of Engineering",
  "engineering manager": "Engineering Manager",
  "product manager": "Product Manager",
  "sales manager": "Sales Manager",
  "marketing manager": "Marketing Manager",
  founder: "Founder",
  "co-founder": "Co-founder",
};

interface TriggerFilters {
  date_preset?: DatePreset;
  countries?: string;          // comma-separated ISO codes
  search?: string;
  // Funding
  round?: string[];
  amount_min?: number;
  amount_max?: number;
  investor_name?: string;
  // Hiring + job-changes
  positions?: string[];        // multi-select (actor enum)
  departments?: string[];
  seniorities?: string[];
  // Unipile inbound
  account_id?: string;                                                                  // unipile_accounts.id
  sources?: Array<"followers" | "relations" | "post_reactors" | "pending_invites">;
  post_ids?: string[];
  /** Skip a candidate if we've sent them an outbound message within the last N days. 0 = off. */
  exclude_if_outbound_within_days?: number;
  // LinkedIn post engagement
  /** Mode toggle — "posts" = paste URLs of specific posts; "profiles" = monitor competitor / thought-leader profiles. */
  engagement_mode?: "posts" | "profiles";
  post_urls?: string[];
  engagement_types?: Array<"reactions" | "comments">;
  comments_lookback?: "24h" | "week" | "month";
  monitor_profile_urls?: string[];
  posts_lookback?: "24h" | "week" | "month";
  max_posts_per_profile?: number;
  max_engagement_per_post?: number;
  // LinkedIn topic intent
  search_query?: string;
  posted_limit?: "1h" | "24h" | "week" | "month";
  // Shared cap (post-engagement + post-intent)
  limit?: number;
}

interface FormState {
  name: string;
  icp_id: string | null;
  match_quality: "top" | "strong" | "decent";
  triggers: Record<string, { enabled: boolean; filters: TriggerFilters }>;
  refresh_cadence: RefreshCadence;
  /** Used only when refresh_cadence === "custom". Stored as minutes. */
  refresh_interval_minutes: number;
  daily_cap: number;
  weekly_cap: number;
  /**
   * Per-company DM filter — applied when scraping LinkedIn employees for
   * each discovered company. Persisted under config.dm_filter so the
   * dm-scraper edge function can read it. Defaults to senior-only +
   * Full+email mode.
   */
  dm_filter: DmFilter;
}

const CADENCE_OPTIONS: Array<{ value: RefreshCadence; label: string; description: string }> = [
  { value: "daily", label: "Daily", description: "Fastest signal-to-outreach time. Higher SignalBase usage." },
  { value: "weekly", label: "Weekly", description: "Balanced. Catches the week's wave in one batch." },
  { value: "monthly", label: "Monthly", description: "Minimal cost. For low-velocity verticals only." },
  { value: "custom", label: "Custom", description: "Your own interval — every N hours or days. Min 1h." },
];

function defaultFiltersFor(packKey: string): TriggerFilters {
  switch (packKey) {
    case "just_funded_saas":
      return { date_preset: "last_14d" };
    case "aggressive_hiring":
    case "new_leadership":
      return { date_preset: "last_30d" };
    case "recent_acquisitions":
      return { date_preset: "last_30d" };
    case "unipile_inbound":
      return { sources: ["followers", "relations", "pending_invites"] };
    case "linkedin_post_engagement":
      return {
        engagement_mode: "profiles",
        monitor_profile_urls: [],
        posts_lookback: "week",
        max_posts_per_profile: 5,
        engagement_types: ["reactions", "comments"],
        post_urls: [],
        limit: 100,
        comments_lookback: "month",
      };
    case "linkedin_post_intent":
      return { search_query: "", posted_limit: "week", limit: 50 };
    default:
      return { date_preset: "last_14d" };
  }
}

function emptyTriggers(): FormState["triggers"] {
  return PACK_CATALOG.reduce(
    (acc, p) => ({ ...acc, [p.key]: { enabled: p.key === "just_funded_saas", filters: defaultFiltersFor(p.key) } }),
    {} as FormState["triggers"],
  );
}

// Volume estimates were removed — ICP fit varies too much per signal type +
// geography for any "leads/week" number to be honest. The thresholds are
// what actually matter; the description explains what passes and what hits
// the review queue at each tier.
const QUALITY_LABELS: Record<FormState["match_quality"], { label: string; threshold: number; review_band: number; description: string }> = {
  top: {
    label: "Tight fit only",
    threshold: 80,
    review_band: 5,
    description: "Auto-enroll only the strongest matches. Use when each touch is expensive (LinkedIn DMs, hand-written outreach).",
  },
  strong: {
    label: "Strong matches",
    threshold: 60,
    review_band: 10,
    description: "Auto-enroll solid fits, send borderline ones to your review queue. A good default.",
  },
  decent: {
    label: "Wide net",
    threshold: 40,
    review_band: 15,
    description: "Cast wider — accept softer matches automatically and review more borderline ones. Use for high-volume channels (cold email).",
  },
};

/**
 * Reverse `toSignalBaseConfig` — turn the persisted SignalBase config back
 * into the wizard's TriggerFilters shape so edit mode can pre-fill.
 */
function fromSignalBaseConfig(cfg: Record<string, unknown> | null | undefined): TriggerFilters {
  if (!cfg) return {};
  const filters: TriggerFilters = {};
  if (typeof cfg.date_preset === "string") filters.date_preset = cfg.date_preset as DatePreset;
  if (typeof cfg.countries === "string") filters.countries = cfg.countries;
  if (typeof cfg.search === "string") filters.search = cfg.search;
  if (typeof cfg.round === "string") filters.round = cfg.round.split(",").filter(Boolean);
  if (typeof cfg.amount_min === "number") filters.amount_min = cfg.amount_min;
  if (typeof cfg.amount_max === "number") filters.amount_max = cfg.amount_max;
  if (typeof cfg.investor_name === "string") filters.investor_name = cfg.investor_name;
  if (typeof cfg.positions === "string") {
    filters.positions = cfg.positions.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(cfg.positions)) {
    filters.positions = cfg.positions.filter((s): s is string => typeof s === "string");
  }
  if (typeof cfg.departments === "string") filters.departments = cfg.departments.split(",").filter(Boolean);
  if (typeof cfg.seniorities === "string") filters.seniorities = cfg.seniorities.split(",").filter(Boolean);
  // Unipile inbound
  if (typeof cfg.account_id === "string") filters.account_id = cfg.account_id;
  if (Array.isArray(cfg.sources)) filters.sources = cfg.sources as TriggerFilters["sources"];
  if (Array.isArray(cfg.post_ids)) filters.post_ids = cfg.post_ids as string[];
  if (typeof cfg.exclude_if_outbound_within_days === "number") {
    filters.exclude_if_outbound_within_days = cfg.exclude_if_outbound_within_days;
  }
  // LinkedIn post engagement
  if (cfg.engagement_mode === "posts" || cfg.engagement_mode === "profiles") {
    filters.engagement_mode = cfg.engagement_mode;
  }
  if (Array.isArray(cfg.post_urls)) filters.post_urls = cfg.post_urls as string[];
  if (Array.isArray(cfg.engagement_types)) filters.engagement_types = cfg.engagement_types as TriggerFilters["engagement_types"];
  if (typeof cfg.comments_lookback === "string") filters.comments_lookback = cfg.comments_lookback as TriggerFilters["comments_lookback"];
  if (Array.isArray(cfg.monitor_profile_urls)) filters.monitor_profile_urls = cfg.monitor_profile_urls as string[];
  if (typeof cfg.posts_lookback === "string") filters.posts_lookback = cfg.posts_lookback as TriggerFilters["posts_lookback"];
  if (typeof cfg.max_posts_per_profile === "number") filters.max_posts_per_profile = cfg.max_posts_per_profile;
  if (typeof cfg.max_engagement_per_post === "number") filters.max_engagement_per_post = cfg.max_engagement_per_post;
  // LinkedIn topic intent
  if (typeof cfg.search_query === "string") filters.search_query = cfg.search_query;
  if (typeof cfg.posted_limit === "string") filters.posted_limit = cfg.posted_limit as TriggerFilters["posted_limit"];
  if (typeof cfg.limit === "number") filters.limit = cfg.limit;
  return filters;
}

/**
 * Map (min_icp_score, review_band) back to a match_quality preset.
 * Defaults to "strong" when nothing matches exactly so edit mode always
 * shows a selected radio.
 */
function inferMatchQuality(threshold: number | null, _band: number | null): FormState["match_quality"] {
  if (threshold == null) return "strong";
  if (threshold >= 80) return "top";
  if (threshold >= 60) return "strong";
  return "decent";
}

// ============================================================================
// Per-pack filter sub-components — kept here (vs separate files) because they
// only render inside the wizard and share its TriggerFilters shape.
// ============================================================================

const UNIPILE_SOURCE_OPTIONS = [
  { id: "followers", label: "New followers" },
  { id: "relations", label: "New connections" },
  { id: "post_reactors", label: "Post reactors" },
  { id: "pending_invites", label: "Pending invites" },
] as const;

function UnipileInboundFilters({
  filters,
  setFilter,
}: {
  filters: TriggerFilters;
  setFilter: (k: keyof TriggerFilters, v: TriggerFilters[keyof TriggerFilters]) => void;
}) {
  const accountsQuery = useUnipileAccounts();
  const linkedinAccounts = (accountsQuery.data?.accounts ?? []).filter(
    (a) => a.provider === "LINKEDIN",
  );

  const enabledSources = (filters.sources ?? []) as Array<typeof UNIPILE_SOURCE_OPTIONS[number]["id"]>;
  const toggleSource = (id: typeof UNIPILE_SOURCE_OPTIONS[number]["id"]) => {
    const next = enabledSources.includes(id)
      ? enabledSources.filter((s) => s !== id)
      : [...enabledSources, id];
    setFilter("sources", next as TriggerFilters["sources"]);
  };

  if (accountsQuery.isLoading) {
    return <p className="text-xs text-muted-foreground">Loading connected accounts…</p>;
  }
  if (linkedinAccounts.length === 0) {
    return (
      <div className="p-3 rounded-md border border-dashed bg-muted/30">
        <p className="text-sm">Connect a LinkedIn account first.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Head to <Link to="/settings?tab=senders" className="underline">Settings → LinkedIn &amp; social</Link> to connect one. This signal
          pulls followers, connections, post reactors, and pending invites from your account.
        </p>
      </div>
    );
  }

  return (
    <>
      <div>
        <Label className="text-xs">LinkedIn account</Label>
        <Select
          value={filters.account_id ?? ""}
          onValueChange={(v) => setFilter("account_id", v)}
        >
          <SelectTrigger className="h-8">
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

      <div>
        <Label className="text-xs">Sources to scan</Label>
        <div className="flex flex-wrap gap-2 mt-1">
          {UNIPILE_SOURCE_OPTIONS.map((opt) => {
            const active = enabledSources.includes(opt.id);
            return (
              <Badge
                key={opt.id}
                variant={active ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleSource(opt.id)}
              >
                {opt.label}
              </Badge>
            );
          })}
        </div>
      </div>

      {enabledSources.includes("post_reactors") && (
        <div>
          <Label className="text-xs">Post IDs to monitor (comma-separated)</Label>
          <Input
            className="h-8"
            placeholder="urn:li:activity:7..."
            value={(filters.post_ids ?? []).join(", ")}
            onChange={(e) =>
              setFilter(
                "post_ids",
                e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              )
            }
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Required when "Post reactors" is enabled. Paste your own post URNs/IDs.
          </p>
        </div>
      )}

      <div className="pt-1 border-t">
        <div className="flex items-center justify-between">
          <Label className="text-xs">
            Skip if we've messaged them recently
          </Label>
          <span className="text-xs font-medium tabular-nums">
            {(filters.exclude_if_outbound_within_days ?? 0) === 0
              ? "Off"
              : `${filters.exclude_if_outbound_within_days}d`}
          </span>
        </div>
        <Slider
          className="mt-2"
          min={0}
          max={180}
          step={5}
          value={[filters.exclude_if_outbound_within_days ?? 0]}
          onValueChange={([v]) => setFilter("exclude_if_outbound_within_days", v)}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          A follower we DM'd 3 weeks ago and never heard back from will re-surface here on every refresh.
          Set this to skip anyone we've sent an outbound message to within the last N days. Recommended: 30-60 days.
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        No credits used — pulled live from your connected LinkedIn account. New connections show up
        within ~10 minutes via webhook. Each refresh handles up to 500 records and resumes from
        where the last one left off.
      </p>
    </>
  );
}

function PostEngagementFilters({
  filters,
  setFilter,
}: {
  filters: TriggerFilters;
  setFilter: (k: keyof TriggerFilters, v: TriggerFilters[keyof TriggerFilters]) => void;
}) {
  const mode = (filters.engagement_mode ?? "profiles") as "posts" | "profiles";
  const enabledTypes = (filters.engagement_types ?? ["reactions", "comments"]) as Array<"reactions" | "comments">;
  const toggleType = (t: "reactions" | "comments") => {
    const next = enabledTypes.includes(t)
      ? enabledTypes.filter((x) => x !== t)
      : [...enabledTypes, t];
    setFilter("engagement_types", next);
  };

  // Profile-monitor mode runs through your connected LinkedIn account via Unipile — $0 per refresh.
  // Specific-posts mode still uses Apify (per-result cost) since it doesn't burn your account's
  // LinkedIn rate-limit budget for one-off captures.
  const linkedinAccountsQuery = useUnipileAccounts();
  const linkedinAccounts = (linkedinAccountsQuery.data?.accounts ?? []).filter(
    (a) => a.provider === "LINKEDIN",
  );

  const limit = filters.limit ?? 100;
  const profiles = filters.monitor_profile_urls ?? [];
  const maxPostsPerProfile = filters.max_posts_per_profile ?? 5;
  const postCostEstimate = limit * 0.0075;

  return (
    <>
      {/* Mode toggle — two choice cards. Profiles is primary (left). */}
      <div className="space-y-2">
        <Label className="text-xs">How do you want to find engagers?</Label>
        <div className="grid sm:grid-cols-2 gap-2">
          <Card
            className={`cursor-pointer transition ${mode === "profiles" ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
            onClick={() => setFilter("engagement_mode", "profiles")}
          >
            <CardContent className="py-3 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${mode === "profiles" ? "border-primary" : "border-muted-foreground/40"}`}>
                  {mode === "profiles" && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                </div>
                <span className="font-medium text-sm">Monitor profiles</span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Recommended</Badge>
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">$0 / refresh</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Add the LinkedIn profiles of your competitors, thought leaders, or customers. Your connected LinkedIn account auto-pulls their recent posts every refresh and captures every reactor and commenter — no URL-pasting per post, no per-result fees.
              </p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition ${mode === "posts" ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
            onClick={() => setFilter("engagement_mode", "posts")}
          >
            <CardContent className="py-3 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${mode === "posts" ? "border-primary" : "border-muted-foreground/40"}`}>
                  {mode === "posts" && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                </div>
                <span className="font-medium text-sm">Specific posts</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">Apify · paid</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Paste URLs of individual posts. One-shot capture — useful for a single viral post or one-off launch you want to scrape without burning your account's daily request budget. ~$0.005-0.01 per result.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mode A — specific posts */}
      {mode === "posts" && (
        <>
          <div>
            <Label className="text-xs">LinkedIn post URLs (one per line)</Label>
            <textarea
              className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 min-h-[64px] font-mono"
              placeholder="https://www.linkedin.com/posts/...
https://www.linkedin.com/posts/..."
              value={(filters.post_urls ?? []).join("\n")}
              onChange={(e) =>
                setFilter(
                  "post_urls",
                  e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                )
              }
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Your own posts (content-warmed leads) or competitors' (defection signals).
            </p>
          </div>

          <div>
            <Label className="text-xs">Engagement types</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {(["reactions", "comments"] as const).map((t) => {
                const active = enabledTypes.includes(t);
                return (
                  <Badge
                    key={t}
                    variant={active ? "default" : "outline"}
                    className="cursor-pointer capitalize"
                    onClick={() => toggleType(t)}
                  >
                    {t}
                  </Badge>
                );
              })}
            </div>
          </div>

          {enabledTypes.includes("comments") && (
            <div>
              <Label className="text-xs">Comments lookback</Label>
              <Select
                value={filters.comments_lookback ?? "month"}
                onValueChange={(v) => setFilter("comments_lookback", v as "24h" | "week" | "month")}
              >
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="week">Last week</SelectItem>
                  <SelectItem value="month">Last month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-xs">
              Max results per actor: <strong>{limit}</strong>
            </Label>
            <Slider
              value={[limit]}
              onValueChange={([v]) => setFilter("limit", v)}
              min={25}
              max={500}
              step={25}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Approx cost per refresh: <strong>~${postCostEstimate.toFixed(2)}</strong>.
            </p>
          </div>
        </>
      )}

      {/* Mode B — profile monitor (Unipile-powered, $0 per refresh) */}
      {mode === "profiles" && (
        <>
          {linkedinAccountsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading connected accounts…</p>
          ) : linkedinAccounts.length === 0 ? (
            <div className="p-3 rounded-md border border-dashed bg-muted/30">
              <p className="text-sm">Connect a LinkedIn account first.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Profile monitoring runs through your connected LinkedIn account, so it costs $0 per refresh.
                Head to <Link to="/settings?tab=senders" className="underline">Settings → LinkedIn &amp; social</Link> to connect one.
              </p>
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs">LinkedIn account that does the scraping</Label>
                <Select
                  value={filters.account_id ?? ""}
                  onValueChange={(v) => setFilter("account_id", v)}
                >
                  <SelectTrigger className="h-8">
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
                <p className="text-[11px] text-muted-foreground mt-1">
                  Each refresh uses ~{maxPostsPerProfile * 2 + 1} LinkedIn requests per profile against this account's normal rate limit. No Apify credits used.
                </p>
              </div>

              <div>
                <Label className="text-xs">Profiles to monitor</Label>
                <div className="mt-1.5">
                  <ProfileMonitorPicker
                    value={filters.monitor_profile_urls ?? []}
                    onChange={(next) => setFilter("monitor_profile_urls", next)}
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Posts to scan per profile</Label>
                  <Slider
                    value={[maxPostsPerProfile]}
                    onValueChange={([v]) => setFilter("max_posts_per_profile", v)}
                    min={1}
                    max={20}
                    step={1}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Most recent <strong>{maxPostsPerProfile}</strong> posts per profile.
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Lookback window</Label>
                  <Select
                    value={filters.posts_lookback ?? "week"}
                    onValueChange={(v) => setFilter("posts_lookback", v as "24h" | "week" | "month")}
                  >
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24h">Last 24 hours</SelectItem>
                      <SelectItem value="week">Last week</SelectItem>
                      <SelectItem value="month">Last month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {(() => {
                // Account-load heuristic: ~2 + posts × engagement-types LinkedIn calls
                // per profile, against an established account's typical ~300 actions/day
                // capacity for browsing-style traffic.
                const callsPerProfile = 2 + maxPostsPerProfile * Math.max(1, enabledTypes.length);
                const totalCalls = profiles.length * callsPerProfile;
                const pct = Math.round((totalCalls / 300) * 100);
                let level: "light" | "moderate" | "heavy";
                let levelLabel: string;
                let levelColor: string;
                if (pct <= 30) {
                  level = "light";
                  levelLabel = "Light load";
                  levelColor = "text-emerald-700 dark:text-emerald-400";
                } else if (pct <= 70) {
                  level = "moderate";
                  levelLabel = "Moderate load";
                  levelColor = "text-amber-600 dark:text-amber-400";
                } else {
                  level = "heavy";
                  levelLabel = "Heavy load";
                  levelColor = "text-orange-600 dark:text-orange-400";
                }
                return (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                        Free — uses your LinkedIn account
                      </span>
                      {profiles.length > 0 && (
                        <span className={`text-xs font-medium ${levelColor}`}>
                          {levelLabel}
                        </span>
                      )}
                    </div>
                    {profiles.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        Add profiles above to see how much of your account's daily LinkedIn activity this will use.
                      </p>
                    ) : level === "heavy" ? (
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Heads up — at {profiles.length} profiles this is a heavy share of your account's daily LinkedIn activity. Consider weekly cadence, or trim to ~{Math.max(1, Math.floor(profiles.length * 0.5))} profiles for a safer cushion.
                      </p>
                    ) : level === "moderate" ? (
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Comfortably within your account's daily LinkedIn capacity. Daily cadence is fine.
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Tiny footprint on your LinkedIn account — daily cadence is fine, plenty of headroom for other automations.
                      </p>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </>
      )}
    </>
  );
}

function PostIntentFilters({
  filters,
  setFilter,
}: {
  filters: TriggerFilters;
  setFilter: (k: keyof TriggerFilters, v: TriggerFilters[keyof TriggerFilters]) => void;
}) {
  const limit = filters.limit ?? 50;
  const estCost = (limit * 0.005).toFixed(2);

  return (
    <>
      <div>
        <Label className="text-xs">Search query</Label>
        <Input
          className="h-8"
          placeholder='e.g. "marketing automation pain" OR "looking for CRM"'
          value={filters.search_query ?? ""}
          onChange={(e) => setFilter("search_query", e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Same syntax as the LinkedIn post search bar. Quotes for phrases, OR for alternatives.
        </p>
      </div>

      <div>
        <Label className="text-xs">Posted within</Label>
        <Select
          value={filters.posted_limit ?? "week"}
          onValueChange={(v) => setFilter("posted_limit", v as "1h" | "24h" | "week" | "month")}
        >
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1h">Last hour</SelectItem>
            <SelectItem value="24h">Last 24 hours</SelectItem>
            <SelectItem value="week">Last week</SelectItem>
            <SelectItem value="month">Last month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">
          Max posts: <strong>{limit}</strong>
        </Label>
        <Slider
          value={[limit]}
          onValueChange={([v]) => setFilter("limit", v)}
          min={10}
          max={200}
          step={10}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Approx cost per refresh: <strong>~${estCost}</strong>.
        </p>
      </div>
    </>
  );
}

export default function SignalNewPage() {
  const navigate = useNavigate();
  const { subscriptionId } = useParams<{ subscriptionId: string }>();
  const isEditMode = !!subscriptionId;
  const editingSubQuery = usePackSubscription(subscriptionId);
  const editingSub = editingSubQuery.data;
  const icpsQuery = useLibraryIcps();
  const createSignal = useCreateSignal();
  const updateSignal = useUpdateSignal();
  const scrapeIcp = useScrapeAndCreateIcp();

  // Local state for the inline ICP scraper (shown when icps.length === 0).
  // Pulled into the parent so the loading + progress UI lives in JSX below.
  const [icpWebsiteUrl, setIcpWebsiteUrl] = useState("");
  const [icpLinkedinUrl, setIcpLinkedinUrl] = useState("");
  const [icpScrapeMessage, setIcpScrapeMessage] = useState("");

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>({
    name: "",
    icp_id: null,
    match_quality: "strong",
    triggers: emptyTriggers(),
    refresh_cadence: "daily",
    refresh_interval_minutes: 12 * 60,  // sensible default (every 12h) when user picks Custom
    daily_cap: 50,
    weekly_cap: 200,
    dm_filter: { ...DM_FILTER_DEFAULT },
  });
  const [hasPrefilled, setHasPrefilled] = useState(false);
  /**
   * UI affordance — toggles whether the rare lower-seniority chips
   * (IC tiers + In Training) are shown. They're hidden by default to
   * keep the senior-focused defaults from looking like noise.
   */
  const [showAllSeniority, setShowAllSeniority] = useState(false);
  /** Same idea for the long tail of harvestapi function IDs. */
  const [showAllFunctions, setShowAllFunctions] = useState(false);

  // Edit-mode prefill: once the existing subscription loads, hydrate form
  // state from its persisted config. Only runs once so the user's mid-edit
  // changes don't get clobbered.
  useEffect(() => {
    if (!isEditMode || !editingSub || hasPrefilled) return;
    const cfg = (editingSub.config ?? {}) as Record<string, unknown>;
    const persistedDm = cfg.dm_filter as Partial<DmFilter> | undefined;
    setForm({
      name: editingSub.name ?? "",
      icp_id: editingSub.icp_id ?? null,
      match_quality: inferMatchQuality(editingSub.min_icp_score, editingSub.review_band),
      triggers: PACK_CATALOG.reduce(
        (acc, p) => ({
          ...acc,
          [p.key]: {
            enabled: p.key === editingSub.pack_key,
            filters:
              p.key === editingSub.pack_key
                ? fromSignalBaseConfig(cfg)
                : defaultFiltersFor(p.key),
          },
        }),
        {} as FormState["triggers"],
      ),
      refresh_cadence: editingSub.refresh_cadence,
      refresh_interval_minutes: editingSub.refresh_interval_minutes ?? 12 * 60,
      daily_cap: editingSub.daily_cap ?? 50,
      weekly_cap: editingSub.weekly_cap ?? 200,
      // Auto-default missing keys so existing subs that predate the
      // dm_filter feature land on senior-only Full+email mode without
      // requiring a wizard re-edit.
      dm_filter: {
        seniorityLevelIds: persistedDm?.seniorityLevelIds ?? DM_FILTER_DEFAULT.seniorityLevelIds,
        functionIds: persistedDm?.functionIds ?? DM_FILTER_DEFAULT.functionIds,
        jobTitles: persistedDm?.jobTitles ?? DM_FILTER_DEFAULT.jobTitles,
        maxItemsPerCompany: persistedDm?.maxItemsPerCompany ?? DM_FILTER_DEFAULT.maxItemsPerCompany,
        profileScraperMode: persistedDm?.profileScraperMode ?? DM_FILTER_DEFAULT.profileScraperMode,
      },
    });
    setHasPrefilled(true);
  }, [isEditMode, editingSub, hasPrefilled]);

  const enabledTriggers = useMemo(
    () => Object.entries(form.triggers).filter(([, v]) => v.enabled).map(([k]) => k),
    [form.triggers],
  );

  const icps = useMemo(() => icpsQuery.data ?? [], [icpsQuery.data]);
  const selectedIcp = useMemo(
    () => icps.find((i) => i.id === form.icp_id),
    [icps, form.icp_id],
  );
  const canNext1 = !!form.icp_id;
  const canNext2 = enabledTriggers.length > 0;

  /**
   * Convert filter UI state to the SignalBaseConfig the actor accepts.
   * Multi-selects become comma-separated strings; empty values are dropped.
   * dm_filter is included as a nested object — read at scrape time by the
   * dm-scraper edge function (not by SignalBase).
   */
  function toSignalBaseConfig(filters: TriggerFilters): Record<string, unknown> {
    const cfg: Record<string, unknown> = {};
    if (filters.date_preset) cfg.date_preset = filters.date_preset;
    if (filters.countries?.trim()) cfg.countries = filters.countries.replace(/\s+/g, "");
    if (filters.search?.trim()) cfg.search = filters.search.trim();
    if (filters.round?.length) cfg.round = filters.round.join(",");
    if (filters.amount_min) cfg.amount_min = filters.amount_min;
    if (filters.amount_max) cfg.amount_max = filters.amount_max;
    if (filters.investor_name?.trim()) cfg.investor_name = filters.investor_name.trim();
    if (filters.positions?.length) cfg.positions = filters.positions.join(",");
    if (filters.departments?.length) cfg.departments = filters.departments.join(",");
    if (filters.seniorities?.length) cfg.seniorities = filters.seniorities.join(",");
    // Unipile inbound — store arrays/account_id as-is. Backend reads these
    // straight off pack_subscriptions.config (no comma-join trick needed).
    if (filters.account_id) cfg.account_id = filters.account_id;
    if (filters.sources?.length) cfg.sources = filters.sources;
    if (filters.post_ids?.length) cfg.post_ids = filters.post_ids;
    if (typeof filters.exclude_if_outbound_within_days === "number" && filters.exclude_if_outbound_within_days > 0) {
      cfg.exclude_if_outbound_within_days = filters.exclude_if_outbound_within_days;
    }
    // LinkedIn post engagement
    if (filters.engagement_mode) cfg.engagement_mode = filters.engagement_mode;
    if (filters.post_urls?.length) cfg.post_urls = filters.post_urls;
    if (filters.engagement_types?.length) cfg.engagement_types = filters.engagement_types;
    if (filters.comments_lookback) cfg.comments_lookback = filters.comments_lookback;
    if (filters.monitor_profile_urls?.length) cfg.monitor_profile_urls = filters.monitor_profile_urls;
    if (filters.posts_lookback) cfg.posts_lookback = filters.posts_lookback;
    if (typeof filters.max_posts_per_profile === "number") cfg.max_posts_per_profile = filters.max_posts_per_profile;
    if (typeof filters.max_engagement_per_post === "number") cfg.max_engagement_per_post = filters.max_engagement_per_post;
    // LinkedIn topic intent
    if (filters.search_query?.trim()) cfg.search_query = filters.search_query.trim();
    if (filters.posted_limit) cfg.posted_limit = filters.posted_limit;
    // Shared cap
    if (filters.limit) cfg.limit = filters.limit;
    cfg.dm_filter = form.dm_filter;
    return cfg;
  }

  const submit = () => {
    const quality = QUALITY_LABELS[form.match_quality];

    // Edit mode: update the single existing subscription. Pack key is
    // immutable so we don't change the trigger type.
    if (isEditMode && subscriptionId && editingSub) {
      const filters = form.triggers[editingSub.pack_key]?.filters ?? defaultFiltersFor(editingSub.pack_key);
      updateSignal.mutate(
        {
          id: subscriptionId,
          name: form.name.trim() || null,
          icp_id: form.icp_id,
          config: toSignalBaseConfig(filters),
          refresh_cadence: form.refresh_cadence,
          refresh_interval_minutes:
            form.refresh_cadence === "custom" ? form.refresh_interval_minutes : null,
          min_icp_score: quality.threshold,
          review_band: quality.review_band,
          daily_cap: form.daily_cap,
          weekly_cap: form.weekly_cap,
          // Signals are now just Smart Segment selectors — retire the legacy
          // direct auto-add path if this signal still had a destination.
          destination_type: null,
          destination_id: null,
        },
        {
          onSuccess: () => navigate(`/signals/${subscriptionId}`),
        },
      );
      return;
    }

    // Create mode: one signal pipeline = one trigger. Multi-trigger spawns
    // multiple pack_subscriptions in sequence — the user gets one card per
    // trigger in /signals.
    const enabledKeys = enabledTriggers;
    if (enabledKeys.length === 0) return;

    let firstId: string | null = null;
    let pending = enabledKeys.length;
    for (const packKey of enabledKeys) {
      const pack = PACK_CATALOG.find((p) => p.key === packKey);
      if (!pack) continue;
      const filters = form.triggers[packKey].filters;
      const baseName = form.name.trim() || pack.label;
      // For multi-trigger creation, suffix the trigger label so each row is uniquely named.
      const finalName = enabledKeys.length > 1 ? `${baseName} · ${pack.label}` : baseName;
      createSignal.mutate(
        {
          pack_key: pack.key,
          tier: pack.tier as PackTier,
          config: toSignalBaseConfig(filters),
          refresh_cadence: form.refresh_cadence,
          refresh_interval_minutes:
            form.refresh_cadence === "custom" ? form.refresh_interval_minutes : null,
          name: finalName,
          icp_id: form.icp_id,
          min_icp_score: quality.threshold,
          review_band: quality.review_band,
          daily_cap: form.daily_cap,
          weekly_cap: form.weekly_cap,
        },
        {
          onSuccess: (created) => {
            if (!firstId) firstId = created.id;
            pending -= 1;
            if (pending === 0) navigate(`/signals/${firstId}`);
          },
        },
      );
    }
  };

  // Edit mode: while the existing sub is loading, render a skeleton in the
  // wizard's place so we don't flash the empty default form on first paint.
  if (isEditMode && (editingSubQuery.isLoading || !hasPrefilled)) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="container mx-auto py-6 max-w-3xl space-y-6">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-96" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="container mx-auto py-6 max-w-3xl space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to={isEditMode && subscriptionId ? `/signals/${subscriptionId}` : "/signals"}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {isEditMode ? "Back to signal" : "Back to signals"}
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">{isEditMode ? "Edit signal" : "New signal"}</h1>
        </div>

        {/* progress */}
        <div className="flex items-center gap-3">
          {[
            { n: 1, label: "Audience" },
            { n: 2, label: "Triggers" },
            { n: 3, label: "Launch" },
          ].map(({ n, label }, idx) => (
            <div key={n} className="flex items-center gap-3 flex-1 last:flex-initial">
              <button
                type="button"
                onClick={() => n < step && setStep(n as Step)}
                className={`flex items-center gap-2 transition ${n < step ? "cursor-pointer hover:opacity-80" : ""}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition ${
                    step === n
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : step > n
                        ? "bg-primary/15 text-primary border-primary"
                        : "bg-background text-muted-foreground border-border"
                  }`}
                >
                  {step > n ? <Check className="h-4 w-4" /> : n}
                </div>
                <span
                  className={`text-sm font-medium ${
                    step === n ? "text-foreground" : step > n ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
              </button>
              {idx < 2 && (
                <div
                  className={`h-0.5 flex-1 rounded transition ${
                    step > n ? "bg-primary/40" : "bg-border"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* STEP 1: Who */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Who should this find?</CardTitle>
              <CardDescription>
                Define your audience at two levels: the ICP that matched companies are scored
                against, and which people at each matched company we scrape from LinkedIn.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Target audience (ICP)</Label>
                {icpsQuery.isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : icps.length === 0 ? (
                  // Empty state — no ICPs yet. Inline scraper: paste your
                  // website + one example LinkedIn profile and AI generates
                  // the ICP. Auto-selects the new ICP on success so the user
                  // can hit Next without an extra click. Manual fallback link
                  // for users who'd rather skip the scraper.
                  <div className="space-y-3 p-4 rounded-md border border-dashed bg-muted/20">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                        <Sparkles className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">Generate your first ICP from two URLs</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          Paste your website (what you sell) and one LinkedIn profile that
                          represents your ideal buyer. AI will draft the ICP — you can refine
                          later in <Link to="/assets?tab=icps" className="underline">Assets &gt; Target Audiences</Link>.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Input
                        placeholder="https://yourcompany.com"
                        value={icpWebsiteUrl}
                        onChange={(e) => setIcpWebsiteUrl(e.target.value)}
                        disabled={scrapeIcp.isPending}
                        className="h-9"
                      />
                      <Input
                        placeholder="https://www.linkedin.com/in/an-ideal-customer/"
                        value={icpLinkedinUrl}
                        onChange={(e) => setIcpLinkedinUrl(e.target.value)}
                        disabled={scrapeIcp.isPending}
                        className="h-9"
                      />
                    </div>

                    {scrapeIcp.isPending && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>{icpScrapeMessage || "Working on it…"}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        variant="cta"
                        size="sm"
                        disabled={
                          scrapeIcp.isPending
                            || !icpWebsiteUrl.trim()
                            || !icpLinkedinUrl.trim()
                        }
                        onClick={() => {
                          scrapeIcp.mutate(
                            {
                              websiteUrl: icpWebsiteUrl.trim(),
                              linkedinProfileUrl: icpLinkedinUrl.trim(),
                              onProgress: (_status, message) => setIcpScrapeMessage(message),
                            },
                            {
                              onSuccess: (created) => {
                                setForm((f) => ({ ...f, icp_id: created.id }));
                                setIcpScrapeMessage("");
                              },
                              onError: () => {
                                setIcpScrapeMessage("");
                              },
                            },
                          );
                        }}
                      >
                        {scrapeIcp.isPending ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating…
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate my ICP
                          </>
                        )}
                      </Button>
                      <Button variant="outline" size="sm" asChild disabled={scrapeIcp.isPending}>
                        <Link to="/assets?tab=icps">
                          Or build manually
                        </Link>
                      </Button>
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                      Takes ~30 seconds. We read both pages, then synthesise the audience profile —
                      pain points, desired outcomes, language style, target seniorities.
                    </p>
                  </div>
                ) : (
                  <Select
                    value={form.icp_id ?? ""}
                    onValueChange={(v) => setForm((f) => ({ ...f, icp_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose an ICP" />
                    </SelectTrigger>
                    <SelectContent>
                      {icps.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {selectedIcp && (
                  <Card className="bg-muted/30 border-dashed">
                    <CardContent className="py-3 space-y-2">
                      {selectedIcp.summary && (
                        <p className="text-sm leading-relaxed">{selectedIcp.summary}</p>
                      )}
                      {selectedIcp.tags && selectedIcp.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {selectedIcp.tags.slice(0, 8).map((t) => (
                            <Badge key={t} variant="secondary" className="text-[10px] font-normal">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="space-y-2">
                <Label>Match quality</Label>
                <RadioGroup
                  value={form.match_quality}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, match_quality: v as FormState["match_quality"] }))
                  }
                  className="space-y-2"
                >
                  {(Object.keys(QUALITY_LABELS) as Array<FormState["match_quality"]>).map((k) => (
                    <Card
                      key={k}
                      className={`cursor-pointer transition ${
                        form.match_quality === k ? "border-primary" : ""
                      }`}
                      onClick={() => setForm((f) => ({ ...f, match_quality: k }))}
                    >
                      <CardContent className="py-3 flex items-start gap-3">
                        <RadioGroupItem value={k} id={`q-${k}`} className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor={`q-${k}`} className="font-medium cursor-pointer">
                            {QUALITY_LABELS[k].label}
                            {k === "strong" && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                Recommended
                              </Badge>
                            )}
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {QUALITY_LABELS[k].description}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </RadioGroup>
              </div>

              {/* ============================================================
                  Decision-makers to find — a "WHO" question (which people at
                  matched companies to scrape from LinkedIn). Lives in Step 1
                  alongside the ICP because both define your audience.
                  Persisted under config.dm_filter; the dm-scraper edge
                  function reads it when calling harvestapi for each company.
                  ============================================================ */}
              <div className="space-y-3 pt-2 border-t">
                <div>
                  <Label>Decision-makers to find at each matched company</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    When a company matches, we scrape LinkedIn for the people you'd actually
                    message. Defaults aim at senior decision-makers.
                  </p>
                </div>

                {/* Seniority */}
                <div>
                  <Label className="text-xs">Seniority</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {DM_FILTER_SENIORITY_OPTIONS
                      .filter((opt, idx) => showAllSeniority || idx < 4)
                      .map((opt) => {
                        const active = form.dm_filter.seniorityLevelIds.includes(opt.id);
                        return (
                          <Badge
                            key={opt.id}
                            variant={active ? "default" : "outline"}
                            className="cursor-pointer"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                dm_filter: {
                                  ...f.dm_filter,
                                  seniorityLevelIds: active
                                    ? f.dm_filter.seniorityLevelIds.filter((s) => s !== opt.id)
                                    : [...f.dm_filter.seniorityLevelIds, opt.id],
                                },
                              }))
                            }
                          >
                            {opt.label}
                          </Badge>
                        );
                      })}
                    <Badge
                      variant="outline"
                      className="cursor-pointer text-muted-foreground border-dashed"
                      onClick={() => setShowAllSeniority((v) => !v)}
                    >
                      {showAllSeniority ? "Hide ICs" : "+ Show ICs"}
                    </Badge>
                  </div>
                </div>

                {/* Function */}
                <div>
                  <Label className="text-xs">Function (leave empty for all)</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {DM_FILTER_FUNCTION_OPTIONS
                      .filter((opt) => showAllFunctions || opt.common)
                      .map((opt) => {
                        const active = form.dm_filter.functionIds.includes(opt.id);
                        return (
                          <Badge
                            key={opt.id}
                            variant={active ? "default" : "outline"}
                            className="cursor-pointer"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                dm_filter: {
                                  ...f.dm_filter,
                                  functionIds: active
                                    ? f.dm_filter.functionIds.filter((s) => s !== opt.id)
                                    : [...f.dm_filter.functionIds, opt.id],
                                },
                              }))
                            }
                          >
                            {opt.label}
                          </Badge>
                        );
                      })}
                    <Badge
                      variant="outline"
                      className="cursor-pointer text-muted-foreground border-dashed"
                      onClick={() => setShowAllFunctions((v) => !v)}
                    >
                      {showAllFunctions ? "Hide" : "+ More"}
                    </Badge>
                  </div>
                </div>

                {/* Job titles */}
                <div>
                  <Label className="text-xs">
                    Job titles (optional, fuzzy match — comma-separated)
                  </Label>
                  <Input
                    className="h-8"
                    placeholder='e.g. "Head of Sales", "VP Marketing"'
                    value={form.dm_filter.jobTitles.join(", ")}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        dm_filter: {
                          ...f.dm_filter,
                          jobTitles: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Use sparingly — narrows the search. Empty = match any title at the chosen
                    seniority.
                  </p>
                </div>

                {/* Max DMs per company */}
                <div>
                  <Label className="text-xs">
                    Max decision-makers per company:{" "}
                    <strong>{form.dm_filter.maxItemsPerCompany}</strong>
                  </Label>
                  <Slider
                    value={[form.dm_filter.maxItemsPerCompany]}
                    onValueChange={([v]) =>
                      setForm((f) => ({
                        ...f,
                        dm_filter: { ...f.dm_filter, maxItemsPerCompany: v },
                      }))
                    }
                    min={1}
                    max={25}
                    step={1}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Each result costs ~$0.012 in Full+email mode. 5 DMs ≈ $0.06 per company.
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button variant="cta" disabled={!canNext1} onClick={() => setStep(2)}>
                  Next <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP 2: When */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>When should this fire?</CardTitle>
              <CardDescription>
                {isEditMode
                  ? "Adjust the filter for this trigger. The trigger type itself is locked — to change it, create a new signal."
                  : "Pick the buyer triggers you want this signal to watch for, then narrow each one with filters that match your target buyer."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(isEditMode && editingSub
                ? PACK_CATALOG.filter((p) => p.key === editingSub.pack_key)
                : PACK_CATALOG
              ).map((pack) => {
                const t = form.triggers[pack.key];
                const checked = t?.enabled ?? false;
                const setFilter = (k: keyof TriggerFilters, v: TriggerFilters[keyof TriggerFilters]) =>
                  setForm((f) => ({
                    ...f,
                    triggers: {
                      ...f.triggers,
                      [pack.key]: { ...f.triggers[pack.key], filters: { ...f.triggers[pack.key].filters, [k]: v } },
                    },
                  }));
                const toggle = () => {
                  // In edit mode, the trigger is locked — can't disable
                  // the one trigger driving this signal.
                  if (isEditMode) return;
                  setForm((f) => ({
                    ...f,
                    triggers: { ...f.triggers, [pack.key]: { ...f.triggers[pack.key], enabled: !checked } },
                  }));
                };
                const toggleArray = (k: "round" | "departments" | "seniorities" | "positions", value: string) => {
                  const cur = (t.filters[k] as string[] | undefined) ?? [];
                  const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
                  setFilter(k, next);
                };

                return (
                  <Card
                    key={pack.key}
                    className={`transition ${checked ? "border-primary" : ""}`}
                  >
                    <CardContent className="py-3 space-y-3">
                      <div className="flex items-start gap-3 cursor-pointer" onClick={toggle}>
                        <Checkbox checked={checked} className="mt-1" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                            <span className="font-medium">{pack.label}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{pack.description}</p>
                        </div>
                      </div>

                      {checked && (
                        <div className="pl-7 space-y-3 pt-2 border-t">
                          {/* Common filters — only for SignalBase packs.
                              The 3 new packs (unipile_inbound,
                              linkedin_post_engagement, linkedin_post_intent)
                              have their own pack-specific inputs below. */}
                          {["just_funded_saas", "aggressive_hiring", "new_leadership", "recent_acquisitions"].includes(pack.key) && (
                            <>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <Label className="text-xs">Look back</Label>
                                  <Select
                                    value={t.filters.date_preset ?? "last_14d"}
                                    onValueChange={(v) => setFilter("date_preset", v as DatePreset)}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {DATE_PRESET_OPTIONS.map((d) => (
                                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-xs">Countries (ISO 2-letter, comma-separated)</Label>
                                  <Input
                                    className="h-8"
                                    placeholder="US, GB, FR, DE"
                                    value={t.filters.countries ?? ""}
                                    onChange={(e) => setFilter("countries", e.target.value)}
                                  />
                                </div>
                              </div>

                              <div>
                                <Label className="text-xs">Free-text search (matches company name / description)</Label>
                                <Input
                                  className="h-8"
                                  placeholder="e.g. AI, fintech, climate"
                                  value={t.filters.search ?? ""}
                                  onChange={(e) => setFilter("search", e.target.value)}
                                />
                              </div>
                            </>
                          )}

                          {/* Unipile inbound — pick a connected LinkedIn account + sources */}
                          {pack.key === "unipile_inbound" && (
                            <UnipileInboundFilters
                              filters={t.filters}
                              setFilter={setFilter}
                            />
                          )}

                          {/* LinkedIn post engagement — paste post URLs + chips */}
                          {pack.key === "linkedin_post_engagement" && (
                            <PostEngagementFilters
                              filters={t.filters}
                              setFilter={setFilter}
                            />
                          )}

                          {/* LinkedIn topic intent — keyword search */}
                          {pack.key === "linkedin_post_intent" && (
                            <PostIntentFilters
                              filters={t.filters}
                              setFilter={setFilter}
                            />
                          )}

                          {/* Funding-specific */}
                          {pack.key === "just_funded_saas" && (
                            <>
                              <div>
                                <Label className="text-xs">Funding rounds</Label>
                                <div className="flex flex-wrap gap-2 mt-1">
                                  {FUNDING_ROUNDS.map((r) => {
                                    const active = (t.filters.round ?? []).includes(r);
                                    return (
                                      <Badge
                                        key={r}
                                        variant={active ? "default" : "outline"}
                                        className="cursor-pointer"
                                        onClick={() => toggleArray("round", r)}
                                      >
                                        {FUNDING_ROUND_LABEL[r]}
                                      </Badge>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <Label className="text-xs">Min amount (USD)</Label>
                                  <Input
                                    className="h-8"
                                    type="number"
                                    placeholder="e.g. 1000000"
                                    value={t.filters.amount_min ?? ""}
                                    onChange={(e) =>
                                      setFilter("amount_min", e.target.value ? Number(e.target.value) : undefined)
                                    }
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">Max amount (USD)</Label>
                                  <Input
                                    className="h-8"
                                    type="number"
                                    placeholder="e.g. 50000000"
                                    value={t.filters.amount_max ?? ""}
                                    onChange={(e) =>
                                      setFilter("amount_max", e.target.value ? Number(e.target.value) : undefined)
                                    }
                                  />
                                </div>
                              </div>
                              <div>
                                <Label className="text-xs">Investor name contains</Label>
                                <Input
                                  className="h-8"
                                  placeholder="e.g. Sequoia, a16z"
                                  value={t.filters.investor_name ?? ""}
                                  onChange={(e) => setFilter("investor_name", e.target.value)}
                                />
                              </div>
                            </>
                          )}

                          {/* Hiring + job-changes share most filters */}
                          {(pack.key === "aggressive_hiring" || pack.key === "new_leadership") && (
                            <>
                              <div>
                                <Label className="text-xs">Departments</Label>
                                <div className="flex flex-wrap gap-2 mt-1">
                                  {DEPARTMENTS.map((d) => {
                                    const active = (t.filters.departments ?? []).includes(d);
                                    return (
                                      <Badge
                                        key={d}
                                        variant={active ? "default" : "outline"}
                                        className="cursor-pointer"
                                        onClick={() => toggleArray("departments", d)}
                                      >
                                        {DEPARTMENT_LABEL[d]}
                                      </Badge>
                                    );
                                  })}
                                </div>
                              </div>
                              <div>
                                <Label className="text-xs">Seniority levels</Label>
                                <div className="flex flex-wrap gap-2 mt-1">
                                  {SENIORITIES.map((s) => {
                                    const active = (t.filters.seniorities ?? []).includes(s);
                                    return (
                                      <Badge
                                        key={s}
                                        variant={active ? "default" : "outline"}
                                        className="cursor-pointer"
                                        onClick={() => toggleArray("seniorities", s)}
                                      >
                                        {SENIORITY_LABEL[s]}
                                      </Badge>
                                    );
                                  })}
                                </div>
                              </div>
                              <div>
                                <Label className="text-xs">Positions (exact match)</Label>
                                <div className="flex flex-wrap gap-2 mt-1">
                                  {POSITIONS.map((p) => {
                                    const active = (t.filters.positions ?? []).includes(p);
                                    return (
                                      <Badge
                                        key={p}
                                        variant={active ? "default" : "outline"}
                                        className="cursor-pointer"
                                        onClick={() => toggleArray("positions", p)}
                                      >
                                        {POSITION_LABEL[p]}
                                      </Badge>
                                    );
                                  })}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-1">
                                  These are the exact values SignalBase accepts. Free-text values
                                  like "Sales" or "VP Sales" return no matches.
                                </p>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button variant="cta" disabled={!canNext2} onClick={() => setStep(3)}>
                  Next <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP 3: Limits + name */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Name it &amp; set limits</CardTitle>
              <CardDescription>
                Give the signal a name so you can spot it at a glance. Caps prevent a busy day
                from blowing your channel limits.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="signal-name">Signal name</Label>
                <Input
                  id="signal-name"
                  placeholder={
                    enabledTriggers.length > 0
                      ? `e.g. ${selectedIcp?.name?.split(" ").slice(0, 3).join(" ") ?? "EU Series A"} - ${PACK_CATALOG.find((p) => p.key === enabledTriggers[0])?.label}`
                      : "e.g. EU Series A SaaS"
                  }
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Shown in the sidebar and on the signal list. Optional — defaults to the trigger
                  type if blank.
                </p>
              </div>

              <div className="space-y-2">
                <Label>How often should the agent check for new triggers?</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CADENCE_OPTIONS.map((c) => {
                    const active = form.refresh_cadence === c.value;
                    return (
                      <Card
                        key={c.value}
                        className={`cursor-pointer transition ${
                          active ? "border-primary bg-primary/5" : ""
                        }`}
                        onClick={() => setForm((f) => ({ ...f, refresh_cadence: c.value }))}
                      >
                        <CardContent className="py-3 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <div
                              className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                                active ? "border-primary" : "border-muted-foreground/40"
                              }`}
                            >
                              {active && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                            </div>
                            <span className="font-medium">{c.label}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            {c.description}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Custom interval picker — only visible when Custom card is active. */}
                {form.refresh_cadence === "custom" && (
                  <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                    <Label className="text-xs">Interval</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Every</span>
                      <Input
                        type="number"
                        className="h-8 w-20"
                        min={1}
                        max={(() => {
                          // We render the unit based on whether the stored minutes
                          // round cleanly to days vs hours.
                          const mins = form.refresh_interval_minutes;
                          return mins % (24 * 60) === 0 && mins >= 24 * 60 ? 30 : 23;
                        })()}
                        value={(() => {
                          const mins = form.refresh_interval_minutes;
                          if (mins % (24 * 60) === 0 && mins >= 24 * 60) return mins / (24 * 60);
                          return Math.max(1, Math.round(mins / 60));
                        })()}
                        onChange={(e) => {
                          const n = Math.max(1, parseInt(e.target.value) || 1);
                          const mins = form.refresh_interval_minutes;
                          const isDays = mins % (24 * 60) === 0 && mins >= 24 * 60;
                          setForm((f) => ({
                            ...f,
                            refresh_interval_minutes: isDays ? n * 24 * 60 : n * 60,
                          }));
                        }}
                      />
                      <Select
                        value={(() => {
                          const mins = form.refresh_interval_minutes;
                          return mins % (24 * 60) === 0 && mins >= 24 * 60 ? "days" : "hours";
                        })()}
                        onValueChange={(v) => {
                          const mins = form.refresh_interval_minutes;
                          const wasDays = mins % (24 * 60) === 0 && mins >= 24 * 60;
                          const currentN = wasDays ? mins / (24 * 60) : Math.round(mins / 60);
                          if (v === "days") {
                            // Convert hours-input → days. Floor at 1 day if N hours = 0 days.
                            const days = wasDays ? currentN : Math.max(1, Math.floor(currentN / 24));
                            setForm((f) => ({ ...f, refresh_interval_minutes: days * 24 * 60 }));
                          } else {
                            const hours = wasDays ? currentN * 24 : currentN;
                            // Cap at 23h when switching to hours (use days for >=24h).
                            const capped = Math.min(23, Math.max(1, hours));
                            setForm((f) => ({ ...f, refresh_interval_minutes: capped * 60 }));
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hours">hours</SelectItem>
                          <SelectItem value="days">days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Minimum 1 hour. Tighter than that won't surface new signals any faster
                      and risks rate-limit thrash on your LinkedIn account.
                    </p>
                  </div>
                )}
              </div>

              {/* Summary — signals are just smart segment selectors. Leads land in the
                  auto-created Smart Segment; you route it to any Active Campaign/Sequence
                  via the normal builder, same as any other segment. */}
              <Card className="bg-primary/5 border-primary/30">
                <CardContent className="py-4 space-y-2">
                  <p className="text-xs uppercase tracking-wide text-primary font-medium">
                    Summary
                  </p>
                  <p className="text-sm leading-relaxed">
                    Every{" "}
                    <strong>
                      {form.refresh_cadence === "custom"
                        ? (() => {
                            const m = form.refresh_interval_minutes;
                            if (m % (24 * 60) === 0 && m >= 24 * 60) {
                              const d = m / (24 * 60);
                              return `${d} day${d > 1 ? "s" : ""}`;
                            }
                            const h = Math.max(1, Math.round(m / 60));
                            return `${h} hour${h > 1 ? "s" : ""}`;
                          })()
                        : form.refresh_cadence}
                    </strong>, the agent will watch{" "}
                    <strong>
                      {enabledTriggers.length === 1
                        ? PACK_CATALOG.find((p) => p.key === enabledTriggers[0])?.label
                        : `${enabledTriggers.length} signal types`}
                    </strong>
                    , filter against{" "}
                    <strong>{selectedIcp?.name ?? "your ICP"}</strong>, and fill a{" "}
                    <strong>Smart Segment</strong> with{" "}
                    <strong>{QUALITY_LABELS[form.match_quality].label.toLowerCase()}</strong> leads.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Leads land in a Smart Segment. Attach it to any Active Campaign or Sequence to auto-enroll new matches — same flow as any segment.
                  </p>
                </CardContent>
              </Card>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(2)}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button
                  variant="cta"
                  onClick={submit}
                  disabled={createSignal.isPending || updateSignal.isPending}
                >
                  {(createSignal.isPending || updateSignal.isPending) ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> {isEditMode ? "Saving" : "Turning on"}
                    </>
                  ) : (
                    <>
                      <Activity className="h-4 w-4 mr-2" /> {isEditMode ? "Save changes" : "Turn on signal"}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
