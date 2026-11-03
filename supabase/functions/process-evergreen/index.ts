import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// Types
// ============================================================================

interface Autopilot {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  scheduling_mode: string;
  timezone: string;
  scheduled_times?: string[];
  destinations: Array<{ account_id: string; platform: string; enabled: boolean }>;
  evergreen: {
    enabled: boolean;
    min_age_days: number;
    max_reposts: number;
    variation_mode: 'exact' | 'slight_variation' | 'regenerate';
  };
}

interface ContentPublication {
  id: string;
  autopilot_id: string;
  output_id: string;
  account_id: string;
  platform: string;
  published_at: string;
  repost_count: number;
  last_reposted_at?: string;
  evergreen_eligible: boolean;
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('🌿 [Evergreen] Starting processing run...');

    // Get autopilots with evergreen enabled
    const { data: autopilots, error: autopilotError } = await supabase
      .from('autopilots')
      .select('*')
      .eq('status', 'active')
      .not('evergreen', 'is', null);

    if (autopilotError) {
      throw new Error(`Failed to fetch autopilots: ${autopilotError.message}`);
    }

    // Filter to those with evergreen.enabled = true
    const evergreenAutopilots = (autopilots || []).filter(
      (a: Autopilot) => a.evergreen?.enabled
    );

    if (evergreenAutopilots.length === 0) {
      console.log('✅ [Evergreen] No autopilots with evergreen enabled');
      return new Response(
        JSON.stringify({ success: true, message: 'No evergreen autopilots', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 [Evergreen] Found ${evergreenAutopilots.length} autopilots with evergreen`);

    let queuedCount = 0;
    let errorCount = 0;

    for (const autopilot of evergreenAutopilots as Autopilot[]) {
      try {
        const queued = await processAutopilotEvergreen(autopilot, supabase);
        queuedCount += queued;
      } catch (error) {
        console.error(`❌ [Evergreen ${autopilot.id}] Error:`, error);
        errorCount++;
      }
    }

    console.log(`✅ [Evergreen] Completed: ${queuedCount} reposts queued, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        queued: queuedCount,
        errors: errorCount
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ [Evergreen] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================================================
// Process Single Autopilot's Evergreen Content
// ============================================================================

async function processAutopilotEvergreen(
  autopilot: Autopilot,
  supabase: any
): Promise<number> {
  const { min_age_days, max_reposts, variation_mode } = autopilot.evergreen;

  // Calculate minimum age date
  const minAgeDate = new Date();
  minAgeDate.setDate(minAgeDate.getDate() - min_age_days);

  console.log(`🌿 [Evergreen ${autopilot.id}] Config: min_age=${min_age_days}d, max_reposts=${max_reposts}, mode=${variation_mode}`);
  console.log(`🌿 [Evergreen ${autopilot.id}] Looking for content older than ${minAgeDate.toISOString()}`);

  // First, get total publications count for diagnostics
  const { count: totalPubs } = await supabase
    .from('content_publications')
    .select('*', { count: 'exact', head: true })
    .eq('autopilot_id', autopilot.id);

  console.log(`📊 [Evergreen ${autopilot.id}] Total publications: ${totalPubs || 0}`);

  if (!totalPubs || totalPubs === 0) {
    console.log(`⚠️ [Evergreen ${autopilot.id}] No publications yet - autopilot needs to publish content first`);
    return 0;
  }

  // Get count of evergreen-eligible publications
  const { count: eligibleCount } = await supabase
    .from('content_publications')
    .select('*', { count: 'exact', head: true })
    .eq('autopilot_id', autopilot.id)
    .eq('evergreen_eligible', true);

  console.log(`📊 [Evergreen ${autopilot.id}] Evergreen-eligible: ${eligibleCount || 0}`);

  // Get count of publications that meet age requirement
  const { count: oldEnoughCount } = await supabase
    .from('content_publications')
    .select('*', { count: 'exact', head: true })
    .eq('autopilot_id', autopilot.id)
    .eq('evergreen_eligible', true)
    .lt('published_at', minAgeDate.toISOString());

  console.log(`📊 [Evergreen ${autopilot.id}] Old enough (>${min_age_days}d): ${oldEnoughCount || 0}`);

  // Get count under max reposts
  const { count: underMaxRepostsCount } = await supabase
    .from('content_publications')
    .select('*', { count: 'exact', head: true })
    .eq('autopilot_id', autopilot.id)
    .eq('evergreen_eligible', true)
    .lt('published_at', minAgeDate.toISOString())
    .lt('repost_count', max_reposts);

  console.log(`📊 [Evergreen ${autopilot.id}] Under max reposts (<${max_reposts}): ${underMaxRepostsCount || 0}`);

  // Find eligible publications
  const { data: eligible, error: eligibleError } = await supabase
    .from('content_publications')
    .select('*, content_outputs(*)')
    .eq('autopilot_id', autopilot.id)
    .eq('evergreen_eligible', true)
    .lt('repost_count', max_reposts)
    .lt('published_at', minAgeDate.toISOString())
    .order('last_reposted_at', { ascending: true, nullsFirst: true })
    .limit(5); // Don't flood the queue

  if (eligibleError) {
    throw new Error(`Failed to fetch eligible content: ${eligibleError.message}`);
  }

  if (!eligible || eligible.length === 0) {
    if (totalPubs > 0 && eligibleCount === 0) {
      console.log(`⚠️ [Evergreen ${autopilot.id}] All publications are reposts (not evergreen-eligible)`);
    } else if (eligibleCount > 0 && oldEnoughCount === 0) {
      console.log(`⚠️ [Evergreen ${autopilot.id}] Content exists but none old enough yet (need ${min_age_days}+ days)`);
    } else if (oldEnoughCount > 0 && underMaxRepostsCount === 0) {
      console.log(`⚠️ [Evergreen ${autopilot.id}] All eligible content has reached max reposts (${max_reposts})`);
    } else {
      console.log(`✅ [Evergreen ${autopilot.id}] No eligible content for repost`);
    }
    return 0;
  }

  console.log(`📋 [Evergreen ${autopilot.id}] Found ${eligible.length} eligible publications`);

  let queuedCount = 0;

  for (const publication of eligible as (ContentPublication & { content_outputs: any })[]) {
    // Get enabled destinations
    const enabledDestinations = autopilot.destinations.filter(d => d.enabled);

    // Only repost to the same account it was originally published to
    // (to avoid duplicating to accounts that didn't have this content)
    const targetDestination = enabledDestinations.find(
      d => d.account_id === publication.account_id
    );

    if (!targetDestination) {
      console.log(`⚠️ [Evergreen ${autopilot.id}] Account ${publication.account_id} no longer enabled, skipping`);
      continue;
    }

    // Calculate optimal time for repost
    const scheduledFor = calculateOptimalTime(
      autopilot.scheduling_mode,
      autopilot.timezone,
      autopilot.scheduled_times
    );

    // Check if there's already a pending repost for this publication
    const { count: existingCount } = await supabase
      .from('publish_queue')
      .select('*', { count: 'exact', head: true })
      .eq('source_publication_id', publication.id)
      .eq('status', 'pending');

    if (existingCount && existingCount > 0) {
      console.log(`⚠️ [Evergreen ${autopilot.id}] Publication ${publication.id} already has pending repost`);
      continue;
    }

    const variationMode = autopilot.evergreen.variation_mode || 'exact';

    // Handle regenerate mode - create new content from the original idea
    if (variationMode === 'regenerate') {
      const regenerated = await handleRegenerateMode(
        supabase,
        autopilot,
        publication,
        scheduledFor
      );
      if (regenerated) {
        queuedCount++;
      }
      continue;
    }

    // For exact and slight_variation modes, queue the repost
    const { error: queueError } = await supabase.from('publish_queue').insert({
      autopilot_id: autopilot.id,
      output_id: publication.output_id,
      account_id: publication.account_id,
      platform: publication.platform,
      scheduled_for: scheduledFor.toISOString(),
      status: 'pending',
      is_repost: true,
      source_publication_id: publication.id,
      variation_mode: variationMode
    });

    if (queueError) {
      console.error(`❌ [Evergreen ${autopilot.id}] Failed to queue repost:`, queueError);
      continue;
    }

    console.log(`✅ [Evergreen ${autopilot.id}] Queued repost of ${publication.output_id} for ${scheduledFor.toISOString()} (mode: ${variationMode})`);

    // Log the event
    await logAutomation(supabase, autopilot.id, publication.output_id, null, 'evergreen_queued', null, {
      publication_id: publication.id,
      account_id: publication.account_id,
      repost_number: publication.repost_count + 1,
      scheduled_for: scheduledFor.toISOString(),
      variation_mode: variationMode
    });

    queuedCount++;
  }

  return queuedCount;
}

// ============================================================================
// Regenerate Mode Handler
// ============================================================================

/**
 * Handle regenerate mode - creates new content from the original idea
 * instead of reposting the same content
 */
async function handleRegenerateMode(
  supabase: any,
  autopilot: Autopilot,
  publication: ContentPublication & { content_outputs: any },
  scheduledFor: Date
): Promise<boolean> {
  console.log(`🔄 [Evergreen ${autopilot.id}] Regenerating content for publication ${publication.id}`);

  // Get the original content output to find the idea and blueprint
  const output = publication.content_outputs;
  if (!output) {
    console.error(`❌ [Evergreen ${autopilot.id}] Content output not found for publication ${publication.id}`);
    return false;
  }

  const ideaId = output.idea_id;
  const blueprintId = output.blueprint_id;

  if (!ideaId || !blueprintId) {
    console.error(`❌ [Evergreen ${autopilot.id}] Missing idea_id or blueprint_id in output ${output.id}`);
    return false;
  }

  // Fetch the idea
  const { data: idea, error: ideaError } = await supabase
    .from('content_ideas')
    .select('*')
    .eq('id', ideaId)
    .single();

  if (ideaError || !idea) {
    console.error(`❌ [Evergreen ${autopilot.id}] Idea ${ideaId} not found:`, ideaError?.message);
    return false;
  }

  // Fetch the blueprint
  const { data: blueprint, error: bpError } = await supabase
    .from('blueprints')
    .select('*')
    .eq('id', blueprintId)
    .single();

  if (bpError || !blueprint) {
    console.error(`❌ [Evergreen ${autopilot.id}] Blueprint ${blueprintId} not found:`, bpError?.message);
    return false;
  }

  // Create a generation job for the regenerated content
  const jobItem = {
    idea_id: idea.id,
    idea_title: idea.title,
    slot_values: {
      idea: idea.title,
      topic: idea.title,
      context: idea.title,
      title: idea.title,
      ...(idea.keywords ? { keywords: idea.keywords.join(', ') } : {}),
      ...(idea.content_framework ? { content_framework: idea.content_framework } : {})
    },
    library_elements: idea.library_elements || {},
    idea_ai_analysis: idea.ai_analysis || null,
    selected_ai_insights: idea.ai_analysis ? {
      talking_points: idea.ai_analysis.talking_points || [],
      hook: idea.ai_analysis.hooks?.[0] || null,
      cta: idea.ai_analysis.ctas?.[0] || null,
      engagement_drivers: idea.ai_analysis.engagement_drivers || idea.emotional_triggers || [],
      script_structure: idea.ai_analysis.script_structure || null
    } : null
  };

  const { data: job, error: jobError } = await supabase
    .from('content_generation_jobs')
    .insert({
      organization_id: autopilot.organization_id,
      user_id: autopilot.created_by,
      blueprint_id: blueprint.id,
      autopilot_id: autopilot.id,
      pipeline: blueprint.pipeline || 'text',
      name: `Evergreen Regen: ${idea.title.substring(0, 40)}`,
      status: 'queued',
      items: [jobItem],
      configuration: {
        pipeline: blueprint.pipeline || 'text',
        model_config: blueprint.model_config,
        is_autopilot: true,
        is_evergreen_regenerate: true,
        source_publication_id: publication.id,
        target_account_id: publication.account_id,
        target_platform: publication.platform,
        scheduled_for: scheduledFor.toISOString()
      },
      progress: {
        total: 1,
        completed: 0,
        failed: 0
      }
    })
    .select('id')
    .single();

  if (jobError || !job) {
    console.error(`❌ [Evergreen ${autopilot.id}] Failed to create regeneration job:`, jobError?.message);
    return false;
  }

  console.log(`📝 [Evergreen ${autopilot.id}] Created regeneration job: ${job.id}`);

  // Dispatch the job
  const { error: dispatchError } = await supabase.functions.invoke('dispatch-generation-job', {
    body: { job_id: job.id }
  });

  if (dispatchError) {
    console.error(`❌ [Evergreen ${autopilot.id}] Failed to dispatch regeneration job:`, dispatchError.message);
    // Clean up the failed job
    await supabase.from('content_generation_jobs').delete().eq('id', job.id);
    return false;
  }

  console.log(`✅ [Evergreen ${autopilot.id}] Dispatched regeneration job ${job.id} for idea: ${idea.title}`);

  // Log the event
  await logAutomation(supabase, autopilot.id, null, job.id, 'evergreen_regenerate_started', null, {
    publication_id: publication.id,
    idea_id: idea.id,
    idea_title: idea.title,
    blueprint_id: blueprint.id,
    account_id: publication.account_id,
    repost_number: publication.repost_count + 1,
    scheduled_for: scheduledFor.toISOString()
  });

  // Update the source publication's repost count
  await supabase.from('content_publications')
    .update({
      repost_count: publication.repost_count + 1,
      last_reposted_at: new Date().toISOString()
    })
    .eq('id', publication.id);

  return true;
}

// ============================================================================
// Helper Functions (shared with approve-stage)
// ============================================================================

/**
 * Calculate optimal publish time based on autopilot settings
 */
function calculateOptimalTime(
  mode: string,
  timezone: string,
  scheduledTimes?: string[]
): Date {
  const now = new Date();

  if (mode === 'immediate') {
    return now;
  }

  if (mode === 'scheduled' && scheduledTimes?.length) {
    return getNextScheduledTime(scheduledTimes, timezone);
  }

  // Optimal mode: find next good slot
  const OPTIMAL_HOURS = [9, 12, 14, 17, 19];
  const tzOffset = getTimezoneOffset(timezone);
  const localHour = (now.getUTCHours() + tzOffset + 24) % 24;

  for (const hour of OPTIMAL_HOURS) {
    if (hour > localHour) {
      const scheduledDate = new Date(now);
      scheduledDate.setUTCHours(hour - tzOffset, 0, 0, 0);
      return scheduledDate;
    }
  }

  // Tomorrow's first slot
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setUTCHours(OPTIMAL_HOURS[0] - tzOffset, 0, 0, 0);
  return tomorrow;
}

function getNextScheduledTime(scheduledTimes: string[], timezone: string): Date {
  const now = new Date();
  const tzOffset = getTimezoneOffset(timezone);

  const times = scheduledTimes.map(t => {
    const [hours, minutes] = t.split(':').map(Number);
    return { hours, minutes };
  }).sort((a, b) => a.hours * 60 + a.minutes - (b.hours * 60 + b.minutes));

  const localHour = (now.getUTCHours() + tzOffset + 24) % 24;
  const localMinute = now.getUTCMinutes();
  const localTimeInMinutes = localHour * 60 + localMinute;

  for (const time of times) {
    const slotInMinutes = time.hours * 60 + time.minutes;
    if (slotInMinutes > localTimeInMinutes) {
      const scheduledDate = new Date(now);
      scheduledDate.setUTCHours(time.hours - tzOffset, time.minutes, 0, 0);
      return scheduledDate;
    }
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setUTCHours(times[0].hours - tzOffset, times[0].minutes, 0, 0);
  return tomorrow;
}

function getTimezoneOffset(timezone: string): number {
  try {
    const now = new Date();
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    return (tzDate.getTime() - utcDate.getTime()) / (60 * 60 * 1000);
  } catch {
    return 0; // Fallback to UTC for invalid timezones
  }
}

/**
 * Log an automation event
 */
async function logAutomation(
  supabase: any,
  autopilotId: string,
  outputId: string | null,
  jobId: string | null,
  eventType: string,
  stageId: string | null,
  details: any
): Promise<void> {
  try {
    await supabase.from('automation_logs').insert({
      autopilot_id: autopilotId,
      output_id: outputId,
      job_id: jobId,
      event_type: eventType,
      stage_id: stageId,
      details
    });
  } catch (error) {
    console.error('Failed to log automation event:', error);
  }
}
