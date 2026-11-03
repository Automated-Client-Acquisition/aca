import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Calculate next run time based on frequency
function calculateNextRun(frequency: string, cronExpression: string | null): string {
  const now = new Date();
  
  switch (frequency) {
    case 'hourly':
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'custom':
      // For custom cron, default to daily (proper cron parsing would require a library)
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  try {
    console.log('[Execute Schedules] Starting execution check');

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date().toISOString();

    // ========================================
    // AUTO-RESET STALE SCRAPE RUNS
    // Reset any runs stuck in RUNNING status for more than 2 hours
    // This handles cases where the Apify webhook was not configured
    // ========================================
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: staleRuns, error: staleError } = await supabase
      .from('research_scrape_runs')
      .update({
        status: 'FAILED',
        completed_at: now,
        error_message: 'Auto-reset: Stuck in RUNNING for over 2 hours. Webhook may not be configured in Apify.',
      })
      .eq('status', 'RUNNING')
      .lt('triggered_at', twoHoursAgo)
      .select('run_id');

    if (staleError) {
      console.error('[Execute Schedules] Error resetting stale runs:', staleError);
    } else if (staleRuns && staleRuns.length > 0) {
      console.log(`[Execute Schedules] Auto-reset ${staleRuns.length} stale scrape runs`);
    }

    // Get all due creator schedules
    const { data: creatorSchedules, error: creatorError } = await supabase
      .from('scrape_schedules')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_at', now);

    if (creatorError) {
      console.error('[Execute Schedules] Error fetching creator schedules:', creatorError);
    }

    // Get all due search term schedules
    const { data: searchSchedules, error: searchError } = await supabase
      .from('search_schedules')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_at', now);

    if (searchError) {
      console.error('[Execute Schedules] Error fetching search schedules:', searchError);
    }

    const totalCreatorSchedules = creatorSchedules?.length || 0;
    const totalSearchSchedules = searchSchedules?.length || 0;

    console.log(`[Execute Schedules] Found ${totalCreatorSchedules} creator schedules, ${totalSearchSchedules} search schedules`);

    let successCount = 0;
    let failureCount = 0;

    // Process creator schedules
    if (creatorSchedules && creatorSchedules.length > 0) {
      for (const schedule of creatorSchedules) {
        try {
          console.log(`[Execute Schedules] Triggering creator ${schedule.creator_id}`);

          // Call trigger-scrape function
          const { data, error } = await supabase.functions.invoke('trigger-scrape', {
            body: {
              type: 'creator',
              targetId: schedule.creator_id,
              options: schedule.scrape_config || {}
            }
          });

          if (error) throw error;

          // Update schedule
          await supabase
            .from('scrape_schedules')
            .update({
              last_run_at: now,
              next_run_at: calculateNextRun(schedule.frequency_type, schedule.cron_expression),
              consecutive_failures: 0,
              updated_at: now
            })
            .eq('id', schedule.id);

          successCount++;
          console.log(`[Execute Schedules] Successfully triggered creator ${schedule.creator_id}`);

        } catch (error) {
          failureCount++;
          console.error(`[Execute Schedules] Failed for creator ${schedule.creator_id}:`, error);
          
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const newFailures = (schedule.consecutive_failures || 0) + 1;
          
          await supabase
            .from('scrape_schedules')
            .update({
              consecutive_failures: newFailures,
              is_active: schedule.auto_pause_on_failure && newFailures >= 3 ? false : true,
              updated_at: now
            })
            .eq('id', schedule.id);
        }
      }
    }

    // Process search term schedules
    if (searchSchedules && searchSchedules.length > 0) {
      for (const schedule of searchSchedules) {
        try {
          console.log(`[Execute Schedules] Triggering search term ${schedule.search_term_id}`);

          // Call trigger-scrape function
          const { data, error } = await supabase.functions.invoke('trigger-scrape', {
            body: {
              type: 'search_term',
              targetId: schedule.search_term_id,
              options: schedule.scrape_config || {}
            }
          });

          if (error) throw error;

          // Update schedule
          await supabase
            .from('search_schedules')
            .update({
              last_run_at: now,
              next_run_at: calculateNextRun(schedule.frequency_type, schedule.cron_expression),
              consecutive_failures: 0,
              updated_at: now
            })
            .eq('id', schedule.id);

          successCount++;
          console.log(`[Execute Schedules] Successfully triggered search term ${schedule.search_term_id}`);

        } catch (error) {
          failureCount++;
          console.error(`[Execute Schedules] Failed for search term ${schedule.search_term_id}:`, error);
          
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const newFailures = (schedule.consecutive_failures || 0) + 1;
          
          await supabase
            .from('search_schedules')
            .update({
              consecutive_failures: newFailures,
              is_active: schedule.auto_pause_on_failure && newFailures >= 3 ? false : true,
              updated_at: now
            })
            .eq('id', schedule.id);
        }
      }
    }

    // ========================================
    // APIFY LEADS IMPORT SCHEDULES
    // ========================================
    const { data: apifyLeadSchedules, error: apifyLeadError } = await supabase
      .from('apify_leads_import_schedules')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_at', now);

    if (apifyLeadError) {
      console.error('[Execute Schedules] Error fetching apify lead schedules:', apifyLeadError);
    }

    let apifyLeadCount = 0;

    if (apifyLeadSchedules && apifyLeadSchedules.length > 0) {
      console.log(`[Execute Schedules] Found ${apifyLeadSchedules.length} apify leads schedules due`);

      for (const schedule of apifyLeadSchedules) {
        try {
          // Resolve or create target list
          let targetListId = schedule.target_list_id;
          if (!targetListId) {
            const { data: newList, error: listError } = await supabase
              .from('lead_lists')
              .insert({
                name: `${schedule.name} - ${new Date().toISOString().split('T')[0]}`,
                source_type: 'apify_leads_finder',
                source_config: {},
                organization_id: schedule.organization_id,
              })
              .select('id')
              .single();

            if (listError || !newList) {
              throw new Error(`Failed to create list: ${listError?.message}`);
            }
            targetListId = newList.id;
          }

          const totalBatches = Math.ceil(schedule.total_requested / schedule.batch_size);

          // Create import job
          const { data: job, error: jobError } = await supabase
            .from('apify_leads_import_jobs')
            .insert({
              organization_id: schedule.organization_id,
              target_list_id: targetListId,
              search_config: schedule.search_config,
              total_requested: schedule.total_requested,
              batch_size: schedule.batch_size,
              total_batches: totalBatches,
              estimated_cost_usd: (schedule.total_requested / 1000) * 1.5,
              schedule_id: schedule.id,
              is_scheduled_run: true,
            })
            .select('id')
            .single();

          if (jobError || !job) {
            throw new Error(`Failed to create job: ${jobError?.message}`);
          }

          // Fire and forget the import function
          await supabase.functions.invoke('apify-leads-import', {
            body: { jobId: job.id },
          });

          // Calculate next run based on frequency
          const frequencyMap: Record<string, number> = {
            daily: 24 * 60 * 60 * 1000,
            weekly: 7 * 24 * 60 * 60 * 1000,
            biweekly: 14 * 24 * 60 * 60 * 1000,
            monthly: 30 * 24 * 60 * 60 * 1000,
          };
          const interval = frequencyMap[schedule.frequency] || frequencyMap.weekly;

          await supabase
            .from('apify_leads_import_schedules')
            .update({
              last_run_at: now,
              last_job_id: job.id,
              next_run_at: new Date(Date.now() + interval).toISOString(),
              updated_at: now,
            })
            .eq('id', schedule.id);

          apifyLeadCount++;
          successCount++;
          console.log(`[Execute Schedules] Triggered apify leads import for schedule ${schedule.name}`);

        } catch (error) {
          failureCount++;
          console.error(`[Execute Schedules] Failed apify leads schedule ${schedule.name}:`, error);
        }
      }
    }

    console.log(`[Execute Schedules] Completed: ${successCount} successful, ${failureCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        executedCreators: totalCreatorSchedules,
        executedSearches: totalSearchSchedules,
        executedApifyLeads: apifyLeadCount,
        successCount,
        failureCount,
        staleRunsReset: staleRuns?.length || 0
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[Execute Schedules] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
