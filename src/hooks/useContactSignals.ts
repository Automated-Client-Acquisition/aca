import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { CrmContact } from "@/hooks/crm/useContacts";

export interface ContactSignal {
  id: number;
  signalType: string;
  detail: string | null;
  icpScore: number | null;
  outcome: string | null;
  createdAt: string;
  /** Date the event actually happened — falls back to when we logged it */
  signalDate: string | null;
  companyName: string | null;
  amountUsd: number | null;
  roundInfo: string | null;
  sourceName: string | null;
  evidenceUrl: string | null;
}

/** "https://www.acme.com/careers" → "acme.com" */
export function normalizeDomain(value?: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return cleaned && cleaned.includes(".") ? cleaned : undefined;
}

/** The company domain we can match signals on, from the best source available */
export function contactDomain(contact?: CrmContact | null): string | undefined {
  if (!contact) return undefined;
  const enrichment = (contact.enrichment_data as Record<string, unknown> | null) || {};
  return (
    normalizeDomain(contact.company_website) ||
    normalizeDomain(enrichment.company_domain as string) ||
    normalizeDomain((contact.primary_email || contact.email || "").split("@")[1])
  );
}

/**
 * Buying signals for a contact's company.
 *
 * `signal_activity_log.contact_id` is never written and `contact_id_resolved`
 * is only set on a few hundred rows, so the domain in `data` is what actually
 * ties a signal to a lead — it matches ~62k contacts where the id join matches
 * 287. We query on both and dedupe.
 */
export function useContactSignals(contact?: CrmContact | null) {
  const { currentOrganization } = useAuth();
  const domain = contactDomain(contact);

  return useQuery({
    queryKey: ["contact-signals", currentOrganization?.id, contact?.id, domain],
    queryFn: async (): Promise<ContactSignal[]> => {
      const metadata = (contact?.discovery_metadata as Record<string, unknown> | null) || {};
      const directDetail = typeof metadata.signal_detail === "string" ? metadata.signal_detail : null;
      const directType = typeof metadata.signal_type === "string" ? metadata.signal_type : null;
      const directDate = typeof metadata.signal_date === "string" ? metadata.signal_date : null;
      const directSource = typeof metadata.signal_source_url === "string" ? metadata.signal_source_url : null;
      const directSignal: ContactSignal | null = directType && (directDetail || directSource)
        ? {
            id: -1,
            signalType: directType,
            detail: directDetail,
            icpScore: null,
            outcome: "materialized",
            createdAt: directDate || contact!.created_at,
            signalDate: directDate,
            companyName: contact!.company,
            amountUsd: Number.isFinite(Number(metadata.signal_amount_usd))
              ? Number(metadata.signal_amount_usd)
              : null,
            roundInfo: null,
            sourceName: "ACA Native",
            evidenceUrl: directSource,
          }
        : null;

      let query = supabase
        .from("signal_activity_log")
        .select("id, signal_type, signal_detail, icp_score, outcome, created_at, data")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false })
        .limit(25);

      query = domain
        ? query.or(`contact_id_resolved.eq.${contact!.id},data->>domain.eq.${domain}`)
        : query.eq("contact_id_resolved", contact!.id);

      const { data, error } = await query;
      if (error) {
        if (directSignal) return [directSignal];
        throw error;
      }

      // One event can log several rows (per destination, per supporting source).
      // Collapse on the cluster key so the profile shows events, not writes.
      const seen = new Set<string>();
      const signals: ContactSignal[] = directSignal ? [directSignal] : [];
      if (directSignal) {
        seen.add(String(metadata.signal_event_id ?? `${directType}|${directDate}|${directDetail}`));
      }

      for (const row of data || []) {
        const payload = (row.data as Record<string, unknown> | null) || {};
        const clusterKey =
          (payload.event_cluster_key as string) ||
          (payload.signal_dedup_key as string) ||
          `${row.signal_type}|${row.signal_detail}`;
        const eventKey = String(payload.signal_event_id ?? clusterKey);
        if (seen.has(eventKey) || seen.has(clusterKey)) continue;
        seen.add(eventKey);

        const amount = Number(payload.amount_usd);
        signals.push({
          id: row.id,
          signalType: row.signal_type,
          detail: row.signal_detail,
          icpScore: row.icp_score,
          outcome: row.outcome,
          createdAt: row.created_at,
          signalDate: (payload.signal_date as string) || null,
          companyName: (payload.company_name as string) || null,
          amountUsd: Number.isFinite(amount) && amount > 0 ? amount : null,
          roundInfo: (payload.round_info as string) || null,
          sourceName: (payload.source_name as string) || null,
          evidenceUrl: (payload.evidence_url as string) || null,
        });
      }

      return signals;
    },
    enabled: !!currentOrganization && !!contact?.id,
  });
}
