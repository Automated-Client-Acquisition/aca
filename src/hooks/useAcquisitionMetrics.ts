import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Where signups came from, and what happened to them.
 *
 * The ad platforms report their own conversions, but each only sees its own
 * traffic and none of them know whether the workspace actually built or the
 * subscription stuck. This is the one place the whole funnel is visible in
 * first-party data: click -> signup -> built -> paying.
 *
 * Super-admin only. RLS on playbook_leads and provisioning_jobs already
 * restricts these tables to super admins, so this hook simply returns nothing
 * for anyone else rather than failing loudly.
 */

export type AcquisitionRange = "7d" | "30d" | "90d" | "all";

export interface ChannelRow {
  channel: string;
  campaign: string | null;
  paid: boolean;
  signups: number;
  built: number;
  paying: number;
}

export interface RecentSignup {
  email: string;
  submittedAt: string;
  channel: string;
  campaign: string | null;
  paid: boolean;
  buildStatus: "done" | "running" | "none";
  subscription: string;
}

export interface AcquisitionMetrics {
  totals: { signups: number; built: number; paying: number; paidTraffic: number };
  channels: ChannelRow[];
  recent: RecentSignup[];
}

const RANGE_DAYS: Record<AcquisitionRange, number | null> = {
  "7d": 7, "30d": 30, "90d": 90, all: null,
};

interface Attribution { utm_source?: string; utm_campaign?: string; paid?: boolean }

/**
 * A signup with no UTMs isn't necessarily "direct" - it may have arrived
 * before attribution capture shipped. Label those honestly rather than
 * folding them into organic and overstating it.
 */
const ATTRIBUTION_SHIPPED = Date.parse("2026-08-05T00:00:00Z");

function channelOf(attr: Attribution | null, submittedAt: string): string {
  if (attr?.utm_source) return attr.utm_source;
  if (Date.parse(submittedAt) < ATTRIBUTION_SHIPPED) return "untracked (pre-attribution)";
  return "direct / organic";
}

export function useAcquisitionMetrics(range: AcquisitionRange = "30d") {
  const { isSuperAdmin } = useAuth();

  return useQuery<AcquisitionMetrics>({
    queryKey: ["acquisition-metrics", range],
    enabled: !!isSuperAdmin,
    staleTime: 60_000,
    queryFn: async () => {
      const days = RANGE_DAYS[range];
      const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;

      let leadQuery = supabase
        .from("playbook_leads")
        .select("email, attribution, submitted_at, organization_id")
        .order("submitted_at", { ascending: false })
        .limit(1000);
      if (since) leadQuery = leadQuery.gte("submitted_at", since);
      const { data: leads, error: leadErr } = await leadQuery;
      if (leadErr) throw leadErr;

      const orgIds = [...new Set((leads || []).map((l) => l.organization_id).filter(Boolean))] as string[];

      // Only fetch the orgs and jobs these leads actually point at.
      const [{ data: orgs }, { data: jobs }] = await Promise.all([
        orgIds.length
          ? supabase.from("organizations")
              .select("id, subscription_status, stripe_subscription_id")
              .in("id", orgIds)
          : Promise.resolve({ data: [] as never[] }),
        orgIds.length
          ? supabase.from("provisioning_jobs")
              .select("organization_id, status")
              .in("organization_id", orgIds)
          : Promise.resolve({ data: [] as never[] }),
      ]);

      const orgById = new Map(
        ((orgs || []) as Array<{ id: string; subscription_status: string | null; stripe_subscription_id: string | null }>)
          .map((o) => [o.id, o])
      );
      // An org counts as built if ANY of its jobs completed - a re-run that
      // failed shouldn't erase a workspace that was successfully created.
      const buildByOrg = new Map<string, "done" | "running">();
      for (const j of ((jobs || []) as Array<{ organization_id: string; status: string }>)) {
        const cur = buildByOrg.get(j.organization_id);
        if (cur === "done") continue;
        buildByOrg.set(j.organization_id, j.status === "done" ? "done" : "running");
      }

      const channels = new Map<string, ChannelRow>();
      const recent: RecentSignup[] = [];
      let signups = 0, built = 0, paying = 0, paidTraffic = 0;

      for (const l of (leads || []) as Array<{ email: string; attribution: Attribution | null; submitted_at: string; organization_id: string | null }>) {
        const attr = l.attribution;
        const channel = channelOf(attr, l.submitted_at);
        const campaign = attr?.utm_campaign ?? null;
        const isPaid = attr?.paid === true;
        const org = l.organization_id ? orgById.get(l.organization_id) : undefined;
        const buildStatus = l.organization_id ? (buildByOrg.get(l.organization_id) ?? "none") : "none";
        // Paying = a real Stripe subscription on file. subscription_status
        // alone says "trialing" for everyone, so it cannot stand in for revenue.
        const isPaying = !!org?.stripe_subscription_id || org?.subscription_status === "active";

        signups += 1;
        if (buildStatus === "done") built += 1;
        if (isPaying) paying += 1;
        if (isPaid) paidTraffic += 1;

        const key = `${channel}|||${campaign ?? ""}`;
        const row = channels.get(key) || { channel, campaign, paid: isPaid, signups: 0, built: 0, paying: 0 };
        row.signups += 1;
        if (buildStatus === "done") row.built += 1;
        if (isPaying) row.paying += 1;
        channels.set(key, row);

        if (recent.length < 50) {
          recent.push({
            email: l.email,
            submittedAt: l.submitted_at,
            channel,
            campaign,
            paid: isPaid,
            buildStatus,
            subscription: org?.stripe_subscription_id
              ? "paying"
              : org?.subscription_status || "none",
          });
        }
      }

      return {
        totals: { signups, built, paying, paidTraffic },
        channels: [...channels.values()].sort((a, b) => b.signups - a.signups),
        recent,
      };
    },
  });
}
