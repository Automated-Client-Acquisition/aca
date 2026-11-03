import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedIn } from "@/hooks/crm/useContacts";
import type {
  EmailAggregatedStats,
  EmailDailyTrend,
  EmailMailboxDailyStats,
  EmailReplyLead,
  EmailSequencePerformance,
  StepStats,
  EmailSequenceStep,
} from "@/types/email";
import type { LeadIntent } from "@/types/classification";

export type TimeRange = "7d" | "30d" | "90d" | "all" | "custom";
export type Granularity = "day" | "week" | "month";
export type CountingMode = "emails" | "leads";

export interface EmailStatsFilters {
  sequenceId?: string | null;
  mailboxId?: string | null;
  customStart?: Date | null;
  customEnd?: Date | null;
}

function getDateRange(range: TimeRange, filters?: EmailStatsFilters): { start: Date | null; end: Date } {
  if (range === "custom") {
    if (filters?.customStart && filters?.customEnd) {
      // Normalize to start-of-day / end-of-day to avoid timezone edge issues
      const start = new Date(filters.customStart);
      start.setHours(0, 0, 0, 0);
      const end = new Date(filters.customEnd);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    // Custom selected but dates not chosen yet — default to last 30 days
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start, end };
  }
  const end = new Date();
  if (range === "all") return { start: null, end };

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { start, end };
}

function getPreviousDateRange(range: TimeRange, filters?: EmailStatsFilters): { start: Date; end: Date } {
  const { start, end } = getDateRange(range, filters);
  if (!start) {
    // "all" range: compare last 90 days vs previous 90 days
    const prevEnd = new Date();
    prevEnd.setDate(prevEnd.getDate() - 90);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - 90);
    return { start: prevStart, end: prevEnd };
  }

  const duration = end.getTime() - start.getTime();
  const prevEnd = new Date(start);
  const prevStart = new Date(prevEnd.getTime() - duration);
  return { start: prevStart, end: prevEnd };
}

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().split("T")[0];
}

function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7); // "YYYY-MM"
}

// ============================================================================
// Shared helpers for unique-lead aggregation (Smartlead/Instantly model)
// ============================================================================

// "blocked" is a receiver refusing OUR domain's reputation, not a bad address:
// it ranks below every delivery outcome and is neither delivered nor bounced.
const STATUS_RANK: Record<string, number> = {
  blocked: 0, sent: 1, delivered: 2, auto_replied: 2, opened: 3, clicked: 4, replied: 5, bounced: 6, spam: 7,
};

const EXCLUDED_STATUSES = '("queued","sending","filtered","skipped","failed")';

// PostgREST caps every response at db-max-rows (1000 on this project), so a
// page requested larger than the cap silently comes back truncated. Keep
// PAGE_SIZE at the cap so a full page always returns exactly PAGE_SIZE rows and
// the loop never mistakes a capped page for the final short page.
const PAGE_SIZE = 1000;

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Fetch all matching rows from a query that may exceed the 1000-row PostgREST default.
 * Uses paginated fetching in chunks of PAGE_SIZE.
 */
async function fetchAllSendLogRows(
  orgId: string,
  selectCols: string,
  opts: {
    sequenceId?: string | null;
    mailboxId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  },
): Promise<{ rows: any[]; totalCount: number }> {
  // First: get exact count without transferring rows
  let countQuery = supabase
    .from("email_send_log")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .not("status", "in", EXCLUDED_STATUSES);

  if (opts.sequenceId) countQuery = countQuery.eq("sequence_id", opts.sequenceId);
  if (opts.mailboxId) countQuery = countQuery.eq("mailbox_id", opts.mailboxId);
  if (opts.startDate) countQuery = countQuery.gte("created_at", opts.startDate);
  if (opts.endDate) countQuery = countQuery.lte("created_at", opts.endDate);

  const { count, error: countError } = await countQuery;
  if (countError) throw countError;

  const totalCount = count || 0;
  if (totalCount === 0) return { rows: [], totalCount: 0 };

  // Fetch rows in pages
  const allRows: any[] = [];
  let from = 0;

  while (from < totalCount) {
    let query = supabase
      .from("email_send_log")
      .select(selectCols)
      .eq("organization_id", orgId)
      .not("status", "in", EXCLUDED_STATUSES);

    if (opts.sequenceId) query = query.eq("sequence_id", opts.sequenceId);
    if (opts.mailboxId) query = query.eq("mailbox_id", opts.mailboxId);
    if (opts.startDate) query = query.gte("created_at", opts.startDate);
    if (opts.endDate) query = query.lte("created_at", opts.endDate);

    // Deterministic order is required for offset paging — without it Postgres
    // may return rows in a different order per page, skipping/duplicating rows.
    query = query.order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    const { data, error } = await query;
    if (error) throw error;

    // Stop when the server returns nothing (true end, or rows removed since the
    // count). Advance by the actual rows returned rather than assuming a page
    // came back at the requested size, so a server-side row cap can't truncate.
    if (!data || data.length === 0) break;
    allRows.push(...data);
    from += data.length;
  }

  return { rows: allRows, totalCount };
}

/**
 * Aggregate email stats using unique-lead counting for rates.
 *
 * Matches Smartlead/Instantly analytics model:
 * - "Sent" = total individual emails sent
 * - "Opened" = unique leads who opened at least one email
 * - Open/Click/Reply rates = unique leads / total unique leads emailed
 * - Bounce rate stays per-email (industry standard)
 */
function aggregateStats(
  entries: any[],
  totalCount?: number,
  tracking: { open: boolean; click: boolean } = { open: true, click: true },
) {
  const totalSent = totalCount ?? entries.length;

  // Group by lead_id, keep most advanced status per lead
  const leadBest = new Map<string, string>();
  for (const e of entries) {
    const key = e.lead_id || e.id;
    const prev = leadBest.get(key);
    if (!prev || (STATUS_RANK[e.status] ?? -1) > (STATUS_RANK[prev] ?? -1)) {
      leadBest.set(key, e.status);
    }
  }

  const uniqueStatuses = Array.from(leadBest.values());
  const leadsEmailed = uniqueStatuses.length;
  const delivered = uniqueStatuses.filter((s) => !["bounced", "blocked", "spam"].includes(s)).length;
  // A literal "opened"/"clicked" status only ever gets set when tracking
  // actually fired; "replied" implying opened/clicked is an inference that
  // only holds when this sequence had that tracking type turned on.
  const opened = uniqueStatuses.filter(
    (s) => s === "opened" || s === "clicked" || (s === "replied" && tracking.open)
  ).length;
  const clicked = uniqueStatuses.filter(
    (s) => s === "clicked" || (s === "replied" && tracking.click)
  ).length;
  const replied = uniqueStatuses.filter((s) => s === "replied").length;
  const bounced = uniqueStatuses.filter((s) => s === "bounced").length;

  return { sent: totalSent, unique_leads: leadsEmailed, delivered, opened, clicked, replied, bounced, leadsEmailed };
}

// ============================================================================
// Aggregated Stats
// ============================================================================

export function useEmailStats(timeRange: TimeRange = "30d", filters?: EmailStatsFilters) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-stats", currentOrganization?.id, timeRange, filters?.sequenceId, filters?.mailboxId, filters?.customStart?.toISOString(), filters?.customEnd?.toISOString()],
    queryFn: async (): Promise<EmailAggregatedStats> => {
      if (!currentOrganization) {
        return {
          sent: 0, unique_leads: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0,
          open_rate: 0, click_rate: 0, reply_rate: 0, bounce_rate: 0,
        };
      }

      const { start } = getDateRange(timeRange, filters);
      // "All time" has no earlier period of the same length, so it gets no
      // comparison (the server skips the prev aggregate when both bounds are null).
      const hasPrev = timeRange !== "all";
      const prevRange = hasPrev ? getPreviousDateRange(timeRange, filters) : null;

      // Server-side aggregation (get_email_analytics_stats) — one round trip
      // for both periods instead of paginating every send-log row into the
      // browser. The SQL mirrors aggregateStats() exactly (unique-lead
      // best-status counting).
      const { data: raw, error } = await supabase.rpc("get_email_analytics_stats", {
        p_org: currentOrganization.id,
        p_start: start?.toISOString() ?? null,
        p_end: timeRange === "custom" && filters?.customEnd ? filters.customEnd.toISOString() : null,
        p_prev_start: prevRange ? prevRange.start.toISOString() : null,
        p_prev_end: prevRange ? prevRange.end.toISOString() : null,
        p_sequence_id: filters?.sequenceId ?? null,
        p_mailbox_id: filters?.mailboxId ?? null,
      });
      if (error) throw error;

      type PeriodAgg = {
        sent: number; unique_leads: number; delivered: number;
        opened: number; clicked: number; replied: number; bounced: number; blocked: number;
        positive: number; meetings: number; out_of_office: number; auto_replied: number;
        intents?: Record<string, number>;
      };
      const data = raw as { curr?: Partial<PeriodAgg>; prev?: Partial<PeriodAgg> | null; filtered?: Record<string, number> } | null;
      const empty: PeriodAgg = {
        sent: 0, unique_leads: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, blocked: 0,
        positive: 0, meetings: 0, out_of_office: 0, auto_replied: 0,
      };
      const curr: PeriodAgg = { ...empty, ...(data?.curr ?? {}) };
      const previous: PeriodAgg | null = data?.prev ? { ...empty, ...data.prev } : null;

      // Rates are unique-lead based (Smartlead/Instantly model): the numerators
      // (opened/clicked/replied/bounced) are counts of unique LEADS, so the
      // denominators must be leads too — NOT curr.sent, which is total EMAILS
      // and ~2x the lead count, halving every rate. Engagement is measured
      // against delivered leads (you can only open a delivered email); bounce is
      // measured against all leads emailed. Past the reply, each step is a
      // funnel conversion from the step before it: positive / replies,
      // meetings / positive.
      const perDelivered = (n: number) => (curr.delivered > 0 ? (n / curr.delivered) * 100 : 0);
      const pct = (n: number, base: number) => (base > 0 ? (n / base) * 100 : 0);
      return {
        ...curr,
        intents: curr.intents ?? {},
        filtered: data?.filtered ?? {},
        open_rate: perDelivered(curr.opened),
        click_rate: perDelivered(curr.clicked),
        reply_rate: perDelivered(curr.replied),
        positive_rate: pct(curr.positive, curr.replied),
        meeting_rate: pct(curr.meetings, curr.positive),
        bounce_rate: curr.unique_leads > 0 ? (curr.bounced / curr.unique_leads) * 100 : 0,
        has_prev: !!previous,
        prev_sent: previous?.sent,
        prev_unique_leads: previous?.unique_leads,
        prev_delivered: previous?.delivered,
        prev_opened: previous?.opened,
        prev_clicked: previous?.clicked,
        prev_replied: previous?.replied,
        prev_bounced: previous?.bounced,
        prev_positive: previous?.positive,
        prev_meetings: previous?.meetings,
      };
    },
    enabled: !!currentOrganization,
    // Keep the last numbers on screen while a new range/filter loads instead
    // of blanking the page back to skeletons.
    placeholderData: keepPreviousData,
  });
}

// ============================================================================
// Per-campaign (sequence) performance
// ============================================================================

export function useEmailSequencePerformance(timeRange: TimeRange = "30d", filters?: EmailStatsFilters) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-sequence-performance", currentOrganization?.id, timeRange, filters?.mailboxId, filters?.customStart?.toISOString(), filters?.customEnd?.toISOString()],
    queryFn: async (): Promise<EmailSequencePerformance[]> => {
      if (!currentOrganization) return [];

      const { start } = getDateRange(timeRange, filters);
      const { data, error } = await supabase.rpc("get_email_sequence_performance", {
        p_org: currentOrganization.id,
        p_start: start?.toISOString() ?? null,
        p_end: timeRange === "custom" && filters?.customEnd ? filters.customEnd.toISOString() : null,
        p_mailbox_id: filters?.mailboxId ?? null,
      });
      if (error) throw error;

      // Same model as the headline: reply rate per delivered lead, then funnel
      // steps (positive / replies, meetings / positive), bounce per lead emailed.
      return (data || []).map((row) => {
        const delivered = Number(row.delivered);
        const leads = Number(row.unique_leads);
        const replied = Number(row.replied);
        const positive = Number(row.positive);
        const meetings = Number(row.meetings);
        const pct = (n: number, base: number) => (base > 0 ? (n / base) * 100 : 0);
        return {
          sequence_id: row.sequence_id,
          sequence_name: row.sequence_name || "Deleted sequence",
          sequence_status: row.sequence_status,
          sent: Number(row.sent),
          unique_leads: leads,
          delivered,
          replied,
          positive,
          meetings,
          bounced: Number(row.bounced),
          blocked: Number(row.blocked ?? 0),
          auto_replies: Number(row.auto_replies ?? 0),
          last_sent_at: row.last_sent_at,
          reply_rate: pct(replied, delivered),
          positive_rate: pct(positive, replied),
          meeting_rate: pct(meetings, positive),
          positive_per_lead: pct(positive, delivered),
          bounce_rate: leads > 0 ? (Number(row.bounced) / leads) * 100 : 0,
        };
      });
    },
    enabled: !!currentOrganization,
    placeholderData: keepPreviousData,
  });
}

// ============================================================================
// Reply drill-down (Replies / Positive / Meetings)
// ============================================================================

/** Genuine reply kinds, or "auto": the segregated out-of-office / auto-reply leads. */
export type ReplyLeadKind = "replied" | "positive" | "meetings" | "auto";

export function useEmailReplyLeads(
  kind: ReplyLeadKind | null,
  timeRange: TimeRange = "30d",
  filters?: EmailStatsFilters,
) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-reply-leads", currentOrganization?.id, kind, timeRange, filters?.sequenceId, filters?.mailboxId, filters?.customStart?.toISOString(), filters?.customEnd?.toISOString()],
    queryFn: async (): Promise<EmailReplyLead[]> => {
      if (!currentOrganization || !kind) return [];

      const { start } = getDateRange(timeRange, filters);
      const { data, error } = await supabase.rpc("get_email_reply_leads", {
        p_org: currentOrganization.id,
        p_start: start?.toISOString() ?? null,
        p_end: timeRange === "custom" && filters?.customEnd ? filters.customEnd.toISOString() : null,
        p_sequence_id: filters?.sequenceId ?? null,
        p_mailbox_id: filters?.mailboxId ?? null,
        p_kind: kind,
        p_limit: 500,
      });
      if (error) throw error;
      return (data || []) as EmailReplyLead[];
    },
    enabled: !!currentOrganization && !!kind,
  });
}

// ============================================================================
// Daily Trend
// ============================================================================

export function useEmailDailyTrend(timeRange: TimeRange = "30d", filters?: EmailStatsFilters, granularity: Granularity = "day") {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-daily-trend", currentOrganization?.id, timeRange, filters?.sequenceId, filters?.mailboxId, filters?.customStart?.toISOString(), filters?.customEnd?.toISOString(), granularity],
    queryFn: async (): Promise<EmailDailyTrend[]> => {
      if (!currentOrganization) return [];

      const { start } = getDateRange(timeRange, filters);

      // Server-side aggregation (get_email_analytics_daily_trend) — the SQL
      // groups by day + lead with best-status counting, matching the old
      // client-side logic. Days are bucketed in the browser's timezone.
      const { data, error } = await supabase.rpc("get_email_analytics_daily_trend", {
        p_org: currentOrganization.id,
        p_start: start?.toISOString() ?? null,
        p_end: timeRange === "custom" && filters?.customEnd ? filters.customEnd.toISOString() : null,
        p_sequence_id: filters?.sequenceId ?? null,
        p_mailbox_id: filters?.mailboxId ?? null,
        p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      if (error) throw error;

      const dailyMap: Record<string, EmailDailyTrend> = {};
      (data || []).forEach((row: any) => {
        dailyMap[row.day] = {
          date: row.day,
          sent: Number(row.sent),
          unique_leads: Number(row.unique_leads),
          delivered: Number(row.delivered),
          opened: Number(row.opened),
          clicked: Number(row.clicked),
          replied: Number(row.replied),
          bounced: Number(row.bounced),
        };
      });

      // Fill missing dates
      const dailyResult: EmailDailyTrend[] = [];
      const now = timeRange === "custom" && filters?.customEnd ? new Date(filters.customEnd) : new Date();
      const cursor = start ? new Date(start) : new Date(now.getTime() - 90 * 86400000);

      while (cursor <= now) {
        const dateStr = toLocalDateStr(cursor);
        dailyResult.push(
          dailyMap[dateStr] || {
            date: dateStr,
            sent: 0,
            unique_leads: 0,
            delivered: 0,
            opened: 0,
            clicked: 0,
            replied: 0,
            bounced: 0,
          }
        );
        cursor.setDate(cursor.getDate() + 1);
      }

      if (granularity === "day") return dailyResult;

      // Aggregate into week or month buckets
      const bucketMap: Record<string, EmailDailyTrend> = {};
      for (const day of dailyResult) {
        const bucketKey = granularity === "week" ? getWeekKey(day.date) : getMonthKey(day.date);
        if (!bucketMap[bucketKey]) {
          bucketMap[bucketKey] = { date: bucketKey, sent: 0, unique_leads: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
        }
        bucketMap[bucketKey].sent += day.sent;
        bucketMap[bucketKey].unique_leads += day.unique_leads;
        bucketMap[bucketKey].delivered += day.delivered;
        bucketMap[bucketKey].opened += day.opened;
        bucketMap[bucketKey].clicked += day.clicked;
        bucketMap[bucketKey].replied += day.replied;
        bucketMap[bucketKey].bounced += day.bounced;
      }

      return Object.values(bucketMap).sort((a, b) => a.date.localeCompare(b.date));
    },
    enabled: !!currentOrganization,
    placeholderData: keepPreviousData,
  });
}

// ============================================================================
// Per-Mailbox Daily Stats
// ============================================================================

export function useMailboxDailyStats(
  mailboxId: string | undefined,
  timeRange: TimeRange = "30d"
) {
  return useQuery({
    queryKey: ["email-mailbox-daily-stats", mailboxId, timeRange],
    queryFn: async (): Promise<EmailMailboxDailyStats[]> => {
      if (!mailboxId) return [];

      const { start } = getDateRange(timeRange);

      let query = supabase
        .from("email_mailbox_daily_stats")
        .select("*")
        .eq("mailbox_id", mailboxId)
        .order("stat_date", { ascending: true });

      if (start) {
        query = query.gte("stat_date", start.toISOString().split("T")[0]);
      }

      const { data, error } = await query;
      if (error) throw error;

      return data as unknown as EmailMailboxDailyStats[];
    },
    enabled: !!mailboxId,
  });
}

// ============================================================================
// Filtered Leads (per-sequence)
// ============================================================================

export interface FilteredLeadEntry {
  id: string;
  lead_id: string | null;
  recipient_email: string;
  error_message: string | null;
  sequence_step: number | null;
  created_at: string;
  lead_name?: string;
  lead_email?: string;
}

export function useFilteredLeads(sequenceId: string | undefined) {
  return useQuery({
    queryKey: ["email-filtered-leads", sequenceId],
    queryFn: async (): Promise<FilteredLeadEntry[]> => {
      if (!sequenceId) return [];

      const { data, error } = await supabase
        .from("email_send_log")
        .select("id, lead_id, recipient_email, error_message, sequence_step, created_at")
        .eq("sequence_id", sequenceId)
        .eq("status", "filtered")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const entries = (data || []) as unknown as FilteredLeadEntry[];
      if (entries.length === 0) return entries;

      // Fetch contact details (same pattern as useEmailEnrollments)
      const leadIds = [...new Set(entries.map((e) => e.lead_id).filter(Boolean))] as string[];
      let contactMap = new Map<string, { name: string; email: string | null }>();
      if (leadIds.length > 0) {
        const contacts = await chunkedIn(leadIds, (chunk) =>
          supabase
            .from("crm_contacts")
            .select("id, display_name, primary_email")
            .in("id", chunk)
        );
        contactMap = new Map(
          contacts.map((c: { id: string; display_name: string; primary_email: string | null }) => [
            c.id,
            { name: c.display_name, email: c.primary_email },
          ])
        );
      }

      return entries.map((e) => {
        const contact = e.lead_id ? contactMap.get(e.lead_id) : undefined;
        return {
          ...e,
          lead_name: contact?.name || undefined,
          lead_email: contact?.email || undefined,
        };
      });
    },
    enabled: !!sequenceId,
  });
}

// ============================================================================
// Leads by Status (drill-down from stat cards)
// ============================================================================

export type DrillDownStatus = "sent" | "delivered" | "opened" | "clicked" | "replied" | "bounced" | "blocked" | "spam";

export interface LeadStatusEntry {
  lead_id: string | null;
  recipient_email: string;
  subject: string | null;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  created_at: string;
  error_message?: string | null;
  error_category?: string | null;
  lead_name?: string;
  lead_email?: string;
}

export interface MailboxDeliveryEvidence {
  attempted: number;
  confirmedRecipientBounces: number;
  unclassifiedFailures: number;
  senderReputationBlocks: number;
}

/**
 * Keeps recipient-list evidence separate from a mailbox's connection and health
 * fields. A generic provider failure is visible for review, but cannot inflate
 * recipient bounce performance.
 */
export function useMailboxDeliveryEvidence(mailboxId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["mailbox-delivery-evidence", currentOrganization?.id, mailboxId],
    queryFn: async (): Promise<MailboxDeliveryEvidence> => {
      if (!currentOrganization || !mailboxId) {
        return {
          attempted: 0,
          confirmedRecipientBounces: 0,
          unclassifiedFailures: 0,
          senderReputationBlocks: 0,
        };
      }

      const since = new Date();
      since.setDate(since.getDate() - 30);
      const base = () =>
        supabase
          .from("email_send_log")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", currentOrganization.id)
          .eq("mailbox_id", mailboxId)
          .gte("created_at", since.toISOString());

      const [attempted, confirmedRecipientBounces, unclassifiedFailures, senderReputationBlocks] = await Promise.all([
        base().not("status", "in", EXCLUDED_STATUSES),
        base().eq("status", "bounced"),
        base().eq("status", "failed").eq("error_category", "unknown"),
        base().eq("error_category", "reputation_block"),
      ]);

      const errors = [
        attempted.error,
        confirmedRecipientBounces.error,
        unclassifiedFailures.error,
        senderReputationBlocks.error,
      ].filter(Boolean);
      if (errors.length > 0) throw errors[0];

      return {
        attempted: attempted.count || 0,
        confirmedRecipientBounces: confirmedRecipientBounces.count || 0,
        unclassifiedFailures: unclassifiedFailures.count || 0,
        senderReputationBlocks: senderReputationBlocks.count || 0,
      };
    },
    enabled: !!currentOrganization && !!mailboxId,
  });
}

const STATUS_INCLUDES: Record<DrillDownStatus, string[]> = {
  sent: ["sent", "delivered", "opened", "clicked", "replied"],
  delivered: ["delivered", "opened", "clicked", "replied"],
  opened: ["opened", "clicked", "replied"],
  clicked: ["clicked", "replied"],
  replied: ["replied"],
  bounced: ["bounced"],
  blocked: ["blocked"],
  spam: ["spam"],
};

export function useLeadsByStatus(
  drillStatus: DrillDownStatus | null,
  timeRange: TimeRange = "30d",
  filters?: EmailStatsFilters,
  /** Override which send statuses count for this drill-down (defaults to STATUS_INCLUDES). */
  statuses?: string[],
) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-leads-by-status", currentOrganization?.id, drillStatus, timeRange, filters?.sequenceId, filters?.mailboxId, filters?.customStart?.toISOString(), filters?.customEnd?.toISOString(), statuses?.join(",")],
    queryFn: async (): Promise<LeadStatusEntry[]> => {
      if (!currentOrganization || !drillStatus) return [];

      const { start } = getDateRange(timeRange, filters);
      const matchStatuses = statuses ?? STATUS_INCLUDES[drillStatus];

      let query = supabase
        .from("email_send_log")
        .select("lead_id, recipient_email, subject, status, sent_at, opened_at, clicked_at, replied_at, bounced_at, created_at, error_message, error_category")
        .eq("organization_id", currentOrganization.id)
        .in("status", matchStatuses)
        .order("created_at", { ascending: false })
        .limit(200);

      if (filters?.sequenceId) {
        query = query.eq("sequence_id", filters.sequenceId);
      }
      if (filters?.mailboxId) {
        query = query.eq("mailbox_id", filters.mailboxId);
      }
      if (start) {
        query = query.gte("created_at", start.toISOString());
      }
      if (timeRange === "custom" && filters?.customEnd) {
        query = query.lte("created_at", filters.customEnd.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      const entries = (data || []) as unknown as LeadStatusEntry[];
      if (entries.length === 0) return entries;

      // Deduplicate: keep highest-status row per lead
      const leadBest = new Map<string, LeadStatusEntry>();
      for (const e of entries) {
        const key = e.lead_id || e.recipient_email;
        const prev = leadBest.get(key);
        if (!prev || (STATUS_RANK[e.status] ?? -1) > (STATUS_RANK[prev.status] ?? -1)) {
          leadBest.set(key, e);
        }
      }
      const dedupedEntries = Array.from(leadBest.values());

      // Fetch contact details
      const leadIds = [...new Set(dedupedEntries.map((e) => e.lead_id).filter(Boolean))] as string[];
      let contactMap = new Map<string, { name: string; email: string | null }>();
      if (leadIds.length > 0) {
        const contacts = await chunkedIn(leadIds, (chunk) =>
          supabase
            .from("crm_contacts")
            .select("id, display_name, primary_email")
            .in("id", chunk)
        );
        contactMap = new Map(
          contacts.map((c: { id: string; display_name: string; primary_email: string | null }) => [
            c.id,
            { name: c.display_name, email: c.primary_email },
          ])
        );
      }

      return dedupedEntries.map((e) => {
        const contact = e.lead_id ? contactMap.get(e.lead_id) : undefined;
        return {
          ...e,
          lead_name: contact?.name || undefined,
          lead_email: contact?.email || undefined,
        };
      });
    },
    enabled: !!currentOrganization && !!drillStatus,
  });
}

// ============================================================================
// Per-Step Stats (for sequence analytics)
// ============================================================================

export function useSequenceStepStats(sequenceId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-step-stats", currentOrganization?.id, sequenceId],
    queryFn: async (): Promise<StepStats[]> => {
      if (!currentOrganization || !sequenceId) return [];

      // Fetch sequence steps for subject lines, and tracking settings — a
      // sequence with tracking off can't have a real opened/clicked value,
      // only one inferred from replies (see aggregateStats).
      const { data: seqData } = await supabase
        .from("email_sequences")
        .select("steps, settings")
        .eq("id", sequenceId)
        .single();

      const steps: EmailSequenceStep[] = (seqData?.steps as unknown as EmailSequenceStep[]) || [];
      const settings = seqData?.settings as { open_tracking?: boolean; click_tracking?: boolean } | null;
      const tracking = {
        open: settings?.open_tracking !== false,
        click: settings?.click_tracking !== false,
      };

      // Fetch all send log rows for this sequence
      const { rows } = await fetchAllSendLogRows(
        currentOrganization.id,
        "id, status, lead_id, sequence_step",
        { sequenceId },
      );

      if (rows.length === 0) return [];

      // Group by sequence_step
      const stepGroups = new Map<number, any[]>();
      for (const row of rows) {
        const step = row.sequence_step ?? 0;
        if (!stepGroups.has(step)) stepGroups.set(step, []);
        stepGroups.get(step)!.push(row);
      }

      // Build per-step stats
      const result: StepStats[] = [];
      const sortedSteps = [...stepGroups.keys()].sort((a, b) => a - b);

      for (const stepNum of sortedSteps) {
        const entries = stepGroups.get(stepNum)!;
        const agg = aggregateStats(entries, undefined, tracking);
        const stepDef = steps.find((s) => s.order === stepNum);
        const subject = stepDef?.subject || `Step ${stepNum + 1}`;

        result.push({
          step: stepNum,
          subject,
          sent: agg.sent,
          unique_leads: agg.unique_leads,
          delivered: agg.delivered,
          opened: agg.opened,
          clicked: agg.clicked,
          replied: agg.replied,
          bounced: agg.bounced,
          open_rate: agg.sent > 0 ? (agg.opened / agg.sent) * 100 : 0,
          click_rate: agg.sent > 0 ? (agg.clicked / agg.sent) * 100 : 0,
          reply_rate: agg.sent > 0 ? (agg.replied / agg.sent) * 100 : 0,
        });
      }

      return result;
    },
    enabled: !!currentOrganization && !!sequenceId,
  });
}

// ============================================================================
// Reply Sentiment Stats
// ============================================================================

export interface SentimentStats {
  /** Unique leads that replied (same count as the Replies metric). */
  total_replies: number;
  /** Replies by the intent the inbox classifier gave them; "unclassified" when it hasn't. */
  by_intent: Partial<Record<LeadIntent | "unclassified", number>>;
  /** Leads whose only responses were out-of-office: segregated, not counted as replies. */
  out_of_office: number;
  /** Leads whose only responses were other auto-replies: segregated, not counted as replies. */
  auto_replied: number;
}

/**
 * Reply breakdown for one sequence/mailbox/range. Reads the same server-side
 * aggregate as the Replies metric, so the breakdown always sums to it. (It used
 * to count crm_conversations by updated_at — a different population — and, with
 * a sequence filter, only matched the first 1000 send-log rows.)
 */
export function useReplySentimentStats(
  timeRange: TimeRange = "30d",
  filters?: EmailStatsFilters,
) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: [
      "email-reply-sentiment",
      currentOrganization?.id,
      timeRange,
      filters?.sequenceId,
      filters?.mailboxId,
      filters?.customStart?.toISOString(),
      filters?.customEnd?.toISOString(),
    ],
    queryFn: async (): Promise<SentimentStats> => {
      if (!currentOrganization) return { total_replies: 0, by_intent: {}, out_of_office: 0, auto_replied: 0 };

      const { start } = getDateRange(timeRange, filters);
      const { data: raw, error } = await supabase.rpc("get_email_analytics_stats", {
        p_org: currentOrganization.id,
        p_start: start?.toISOString() ?? null,
        p_end: timeRange === "custom" && filters?.customEnd ? filters.customEnd.toISOString() : null,
        p_prev_start: null,
        p_prev_end: null,
        p_sequence_id: filters?.sequenceId ?? null,
        p_mailbox_id: filters?.mailboxId ?? null,
      });
      if (error) throw error;

      const curr = (raw as {
        curr?: { replied?: number; out_of_office?: number; auto_replied?: number; intents?: Record<string, number> };
      } | null)?.curr;
      return {
        total_replies: Number(curr?.replied ?? 0),
        by_intent: curr?.intents ?? {},
        out_of_office: Number(curr?.out_of_office ?? 0),
        auto_replied: Number(curr?.auto_replied ?? 0),
      };
    },
    enabled: !!currentOrganization,
  });
}

// ============================================================================
// Sequence Mailbox Allocation
// ============================================================================

/**
 * Mailbox ids actually allocated to a sequence: its pinned settings.mailbox_ids
 * (manual mode) unioned with every mailbox that has actually sent from it
 * (auto pool-selection mode, where there's no static list up front). Returns
 * an empty set when no sequence is selected — callers should treat that as "no filter".
 */
export function useSequenceMailboxIds(sequenceId: string | null | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-sequence-mailbox-ids", currentOrganization?.id, sequenceId],
    queryFn: async (): Promise<Set<string>> => {
      if (!currentOrganization || !sequenceId) return new Set();

      // Distinct server-side: reading send-log rows here was capped at 1000
      // by PostgREST, so big sequences listed only some of their mailboxes.
      const [{ data: seq, error: seqError }, { data: usedIds, error: usedError }] =
        await Promise.all([
          supabase
            .from("email_sequences")
            .select("settings")
            .eq("id", sequenceId)
            .single(),
          supabase.rpc("get_email_sequence_mailbox_ids", {
            p_org: currentOrganization.id,
            p_sequence_id: sequenceId,
          }),
        ]);
      if (seqError) throw seqError;
      if (usedError) throw usedError;

      const pinned = (seq?.settings as { mailbox_ids?: string[] } | null)?.mailbox_ids || [];
      return new Set([...pinned, ...((usedIds as string[] | null) || [])]);
    },
    enabled: !!currentOrganization && !!sequenceId,
  });
}
