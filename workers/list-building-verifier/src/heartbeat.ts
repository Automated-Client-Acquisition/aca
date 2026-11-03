import type { SupabaseClient } from '@supabase/supabase-js';

export interface HeartbeatStats {
  kind: string;
  current_job_id: string | null;
  in_flight_items: number;
  throughput_per_sec: number;
}

export function startHeartbeat(
  supabase: SupabaseClient,
  workerId: string,
  getStats: () => HeartbeatStats,
  intervalMs = 5_000,
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const s = getStats();
      await supabase.from('lb_worker_heartbeats').upsert({
        worker_id: workerId,
        kind: s.kind,
        last_seen_at: new Date().toISOString(),
        current_job_id: s.current_job_id,
        in_flight_items: s.in_flight_items,
        throughput_per_sec: s.throughput_per_sec,
      });
    } catch (err) {
      console.warn('[heartbeat] upsert failed', err);
    }
  };
  void tick();
  const t = setInterval(tick, intervalMs);
  if (t.unref) t.unref();
  return () => {
    stopped = true;
    clearInterval(t);
  };
}
