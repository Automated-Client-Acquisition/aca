import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

/**
 * Wake the idempotent signal exporter after a verification result lands.
 * The cron remains as a recovery path, while this removes the normal
 * five-minute polling delay from the lead's hot path.
 */
export function triggerSignalExport(
  supabase: SupabaseClient,
  companyId?: string,
): void {
  void supabase.functions.invoke('list-building-signal-export', {
    body: companyId ? { company_id: companyId } : {},
  }).then(({ error }) => {
    if (error) console.warn('[signal-export-trigger] invoke failed', error.message);
  }).catch((error) => {
    console.warn('[signal-export-trigger] invoke threw', error);
  });
}
