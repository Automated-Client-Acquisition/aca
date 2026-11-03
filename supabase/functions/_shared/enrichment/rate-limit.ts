import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

/** Pacing inputs for one provider. Shared so callers can't drift from what the
 * scheduler actually accepts. */
export type ProviderRateLimits = {
  /** Seed rate, and the rate used outright when recordsPerMinute is unset. */
  requestsPerMinute: number;
  dailyCap?: number | null;
  /** Sustainable record spend. Set for providers that meter RECORDS (a
   * lookup that returns data) rather than requests: the scheduler then
   * derives the request rate from the find rate it observes, instead of
   * trusting requestsPerMinute — which is only ever correct at one find
   * rate. requestsPerMinute stays the seed until enough samples land. */
  recordsPerMinute?: number | null;
  /** Hard ceiling so a low find rate can't push the derived rate past the
   * provider's own request limit. */
  maxRequestsPerMinute?: number | null;
};

export type ProviderRequestReservation = {
  status: 'granted' | 'daily_exhausted' | 'rate_wait';
  reservationId: string | null;
  waitMs: number;
  scheduledAt: string | null;
  dailyUsed: number;
  dailyCap: number | null;
  requestsPerMinute: number;
};

type ProviderReservationRow = {
  reservation_status: ProviderRequestReservation['status'];
  reservation_id: string | null;
  wait_ms: number;
  scheduled_at: string | null;
  daily_used: number;
  daily_cap: number | null;
  requests_per_minute: number;
};

export async function reserveEnrichmentProviderRequest(
  supabase: SupabaseClient,
  organizationId: string,
  provider: string,
  limits: ProviderRateLimits,
  maxWaitMs = 110_000,
  listId?: string,
): Promise<ProviderRequestReservation> {
  const { data, error } = await supabase.rpc('reserve_enrichment_provider_request', {
    p_organization_id: organizationId,
    p_provider: provider,
    p_requests_per_minute: limits.requestsPerMinute,
    p_daily_cap: limits.dailyCap ?? null,
    p_max_wait_ms: maxWaitMs,
    p_list_id: listId ?? null,
    p_records_per_minute: limits.recordsPerMinute ?? null,
    p_max_requests_per_minute: limits.maxRequestsPerMinute ?? null,
  });
  if (error) {
    throw new Error(`Could not reserve ${provider} request capacity: ${error.message}`);
  }

  const row = (data as ProviderReservationRow[] | null)?.[0];
  if (!row) throw new Error(`${provider} request scheduler returned no result`);
  if (row.reservation_status === 'granted' && row.wait_ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, row.wait_ms));
  }

  return {
    status: row.reservation_status,
    reservationId: row.reservation_id,
    waitMs: row.wait_ms,
    scheduledAt: row.scheduled_at,
    dailyUsed: row.daily_used,
    dailyCap: row.daily_cap,
    requestsPerMinute: row.requests_per_minute,
  };
}

/**
 * Feed the scheduler the outcome of a completed lookup so it can keep its find
 * rate honest. Only a lookup that returned data spends a record; misses are
 * free, which is exactly why the request rate can't be a constant.
 */
export async function reportEnrichmentProviderRecord(
  supabase: SupabaseClient,
  organizationId: string,
  provider: string,
  consumedRecord: boolean,
): Promise<void> {
  if (!consumedRecord) return;
  const { error } = await supabase.rpc('report_enrichment_provider_record', {
    p_organization_id: organizationId,
    p_provider: provider,
    p_consumed: true,
  });
  // Never fail an enrichment over telemetry; a dropped sample only nudges the
  // estimate conservative (a missed record reads as a miss => slower).
  if (error) console.warn(`Could not report ${provider} record consumption:`, error.message);
}

export async function refundRateLimitedProviderRequest(
  supabase: SupabaseClient,
  reservationId: string | null,
): Promise<void> {
  if (!reservationId) return;
  const { error } = await supabase.rpc('refund_rate_limited_enrichment_request', {
    p_reservation_id: reservationId,
  });
  if (error) console.error('Could not refund rate-limited provider request:', error);
}
