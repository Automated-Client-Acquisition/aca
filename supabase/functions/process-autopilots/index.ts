import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { calculateNextRun, slotForRun } from "./schedule.ts";
import { IDEA_REPEAT_COOLDOWN, MIX_HISTORY_WINDOW, rankMixEntries } from "../_shared/content-mix.ts";
import { mergeAutopilotReferenceVariant } from "../_shared/autopilot-reference-merge.ts";
import { varyHook, type HookSource } from "../_shared/hook-variety.ts";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// Types
// ============================================================================

interface AutopilotLibraryPathSelection {
  included: boolean;
  selectedItems?: string[];
}

interface AutopilotLibraryElementConfig {
  paths?: Record<string, AutopilotLibraryPathSelection>;
  selected_images?: string[];
}

interface AutopilotLibrarySelection {
  [libraryTable: string]: {
    combination_mode?: 'combine' | 'separate';
    elements: Record<string, AutopilotLibraryElementConfig>;
  }
}

interface AutopilotVideoConfig {
  totalDuration: number;
  sceneDuration: 4 | 6 | 8 | 12;
  sceneCount: number;
  aspectRatio: 'landscape' | 'portrait' | 'square';
}

interface AutopilotOutputConfig {
  aspectRatio: 'landscape' | 'portrait' | 'square';
  slideCount?: number;
}

interface AutopilotPresenterConfig {
  url?: string;
  brief?: string;
  templateType?: string;
  avatarType?: string;
  avatarPhotoUrl?: string;
  heygenAvatarId?: string;
  characterId?: string;
  voiceId?: string;
  lipSyncProvider?: string;
  subtitleStyle?: string;
  orientation?: string;
  maxScreenshots?: number;
  backgroundMusicUrl?: string;
}

interface ResolvedSavedContent {
  items: Array<{ id: string; content_type: string; url: string }>;
  for_carousel: boolean;
}

interface ContentMixItem {
  blueprint_id: string;
  weight: number;
  enabled: boolean;
  idea_tags?: string[]; // Optional: filter ideas by tags for this blueprint
  library_elements?: AutopilotLibrarySelection; // Optional: library elements for this blueprint
  video_config?: AutopilotVideoConfig; // Optional: video format settings
  output_config?: AutopilotOutputConfig; // Optional: output format settings
  presenter_config?: AutopilotPresenterConfig; // Optional: presenter video settings
  media_source?: 'generate' | 'saved_library' | 'mixed'; // Optional: where media comes from
  media_content_types?: ('image' | 'video')[]; // Optional: which saved content types to match
  saved_library_ratio?: number; // Optional: 0-100, for 'mixed' mode — % chance of using saved content
  saved_content_tags?: string[]; // Optional: explicit tags to match against library_saved_content.tags (overrides idea tags)
  hook_rotation?: boolean; // Optional: rotate through AI-generated hooks
  skip_image_generation?: boolean; // Optional: skip image generation for text-only output
  destination_account_ids?: string[]; // Optional: only post this blueprint to these accounts (approve-stage)
}

interface Autopilot {
  id: string;
  organization_id: string;
  name: string;
  status: 'active' | 'paused' | 'archived';
  content_mix: ContentMixItem[];
  ideas_source: 'per_blueprint' | 'shared';
  shared_idea_tags?: string[];
  frequency: { amount: number; unit: 'hour' | 'day' | 'week' };
  scheduling_mode: 'immediate' | 'optimal' | 'scheduled';
  timezone: string;
  scheduled_times?: string[];
  scheduled_days?: number[] | null;
  // "Plan each day": {day, time, blueprint_id?} slots; a slot can pin a blueprint
  schedule_slots?: Array<{ day: number; time: string; blueprint_id?: string | null }> | null;
  destinations: Array<{ account_id: string; platform: string; enabled: boolean; post_type?: string }>;
  evergreen?: {
    enabled: boolean;
    min_age_days: number;
    max_reposts: number;
    variation_mode: 'exact' | 'slight_variation' | 'regenerate';
  };
  // Pool configuration
  pool_mode?: 'tag_based' | 'explicit' | 'hybrid';
  auto_reload_pool?: boolean;
  pool_reload_threshold?: number;
  // Only ideas whose guidelines a person approved (content_ideas.guidelines_approved_at)
  only_approved_ideas?: boolean;
  // Tracking
  last_run_at?: string;
  next_run_at?: string;
  total_generated: number;
  total_published: number;
  created_by?: string;
}

interface Blueprint {
  id: string;
  name: string;
  organization_id: string;
  master_prompt: string;
  image_prompt?: string;
  structure: any;
  model_config: any;
  pipeline?: string;
  tags?: string[];
}

interface ContentIdea {
  id: string;
  title: string;
  keywords?: string[];
  metadata?: any;
  library_elements?: any;
  ai_analysis?: {
    talking_points?: string[];
    hooks?: Array<{ text: string; type?: string }>;
    ctas?: Array<{ text: string; type?: string; placement?: string }>;
    engagement_drivers?: string[];
    script_structure?: any;
    [key: string]: any;
  };
  content_framework?: string;
  emotional_triggers?: string[];
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
    console.log('🤖 [Autopilot Scheduler] Starting processing run...');

    // Get autopilots due to run
    const now = new Date().toISOString();
    const { data: dueAutopilots, error: fetchError } = await supabase
      .from('autopilots')
      .select('*')
      .eq('status', 'active')
      .lte('next_run_at', now);

    if (fetchError) {
      throw new Error(`Failed to fetch autopilots: ${fetchError.message}`);
    }

    if (!dueAutopilots || dueAutopilots.length === 0) {
      console.log('✅ [Autopilot Scheduler] No autopilots due to run');
      return new Response(
        JSON.stringify({ success: true, message: 'No autopilots due', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 [Autopilot Scheduler] Found ${dueAutopilots.length} autopilots due to run`);

    let processedCount = 0;
    let errorCount = 0;

    for (const autopilot of dueAutopilots as Autopilot[]) {
      try {
        await processAutopilot(autopilot, supabase, supabaseUrl);
        processedCount++;
      } catch (error) {
        console.error(`❌ [Autopilot ${autopilot.id}] Error:`, error);
        errorCount++;

        // Log the error
        await logAutomation(supabase, autopilot.id, null, null, 'processing_error', null, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log(`✅ [Autopilot Scheduler] Completed: ${processedCount} processed, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        errors: errorCount
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ [Autopilot Scheduler] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================================================
// Process Single Autopilot
// ============================================================================

async function processAutopilot(
  autopilot: Autopilot,
  supabase: any,
  supabaseUrl: string
): Promise<void> {
  console.log(`🚀 [Autopilot ${autopilot.id}] Processing: ${autopilot.name}`);

  // The weekly slot this run is for (scheduled mode): when the piece posts, and
  // maybe a blueprint pinned to it. Runs start an hour before their slot.
  const slot = autopilot.scheduling_mode === 'scheduled' && autopilot.next_run_at
    ? slotForRun(autopilot, new Date(autopilot.next_run_at))
    : null;
  const slotAt = slot?.at ?? null;

  // 1. Blueprints in turn order: furthest below its share of recent runs first (content-mix.ts).
  // Runs that a slot pinned don't count toward the rotation's shares.
  const { data: recentJobs } = await supabase
    .from('content_generation_jobs')
    .select('blueprint_id, pinned:configuration->>slot_pinned')
    .eq('autopilot_id', autopilot.id)
    .order('created_at', { ascending: false })
    .limit(MIX_HISTORY_WINDOW * 2);
  const rotationHistory = (recentJobs || [])
    .filter((j: any) => j.pinned !== 'true')
    .map((j: any) => j.blueprint_id)
    .filter(Boolean)
    .slice(0, MIX_HISTORY_WINDOW);
  let ranked = rankMixEntries(autopilot.content_mix, rotationHistory);
  // A pinned slot runs its blueprint; the rotation fills in when that one has no ideas left.
  const pinnedId = slot?.blueprint_id ?? null;
  const pinnedEntries = pinnedId
    ? (autopilot.content_mix || []).filter((m) => m?.enabled && m.blueprint_id === pinnedId)
    : [];
  if (pinnedEntries.length > 0) {
    ranked = [...pinnedEntries, ...ranked.filter((m) => m.blueprint_id !== pinnedId)];
  } else if (pinnedId) {
    console.log(`⚠️ [Autopilot ${autopilot.id}] Slot pinned to ${pinnedId}, which is no longer in the mix; using the rotation`);
  }
  if (ranked.length === 0) {
    console.log(`⚠️ [Autopilot ${autopilot.id}] No enabled blueprints in content mix`);
    await updateNextRun(supabase, autopilot, slotAt);
    return;
  }

  // 2-3. The first blueprint that has an idea to run. With per-blueprint idea
  // tags a starved blueprint hands its turn on: a run with no idea creates no
  // job, so the history never moves and it would be picked again every run.
  // Shared tags give every blueprint the same ideas, so only the first is tried.
  const candidates = autopilot.ideas_source === 'shared' ? ranked.slice(0, 1) : ranked;
  let selectedMix: ContentMixItem | null = null;
  let blueprint: Blueprint | null = null;
  let picked: Awaited<ReturnType<typeof pickUnusedIdea>> | null = null;
  const starved: string[] = [];
  for (const mix of candidates) {
    const { data: bp, error: bpError } = await supabase
      .from('blueprints')
      .select('*')
      .eq('id', mix.blueprint_id)
      .single();
    if (bpError || !bp) {
      throw new Error(`Blueprint ${mix.blueprint_id} not found: ${bpError?.message}`);
    }

    // Preflight: don't queue a job we already know will fail. An autopilot
    // used to keep firing into a revoked key (158 failed runs in 4 days).
    const pauseReason = await autopilotPauseReason(supabase, autopilot, bp);
    if (pauseReason) {
      await pauseAutopilot(supabase, autopilot, pauseReason);
      return;
    }

    const attempt = await pickUnusedIdea(supabase, autopilot, mix, bp);
    if (attempt.idea) {
      selectedMix = mix;
      blueprint = bp;
      picked = attempt;
      break;
    }
    starved.push(bp.name);
    console.log(`⚠️ [Autopilot ${autopilot.id}] No unused ideas for blueprint ${bp.name}; trying the next one`);
  }

  if (!selectedMix || !blueprint || !picked?.idea) {
    console.log(`⚠️ [Autopilot ${autopilot.id}] No unused ideas available for any blueprint (${starved.join(', ')})`);
    await logAutomation(supabase, autopilot.id, null, null, 'no_ideas_available', null, {
      blueprint_id: candidates[0].blueprint_id,
      blueprint_name: starved[0],
      blueprints_tried: starved,
      pool_mode: autopilot.pool_mode || 'tag_based',
      only_approved_ideas: !!autopilot.only_approved_ideas
    });
    await updateNextRun(supabase, autopilot, slotAt);
    return;
  }
  const { idea, poolEntryId, poolEntryMetadata } = picked;
  console.log(`📐 [Autopilot ${autopilot.id}] Selected blueprint: ${blueprint.name}${starved.length ? ` (after ${starved.length} with no ideas)` : ''}`);

  console.log(`💡 [Autopilot ${autopilot.id}] Selected idea: ${idea.title} (pool: ${poolEntryId ? 'yes' : 'no'})`);

  // 4. Resolve saved content if media_source is 'saved_library' or 'mixed'
  const savedContent = await resolveSavedContent(supabase, autopilot.organization_id, autopilot.id, selectedMix, idea, blueprint);
  if (savedContent) {
    console.log(`📎 [Autopilot ${autopilot.id}] Resolved ${savedContent.items.length} saved content item(s) for media`);
  }

  // 5. Create the generation job (passing selectedMix for library element injection)
  const slotPinned = !!pinnedId && selectedMix.blueprint_id === pinnedId;
  const job = await createAutopilotJob(supabase, autopilot, blueprint, idea, poolEntryId, selectedMix, savedContent, poolEntryMetadata, {
    publishAt: slotAt ? slotAt.toISOString() : null,
    slotPinned,
  });
  console.log(`📝 [Autopilot ${autopilot.id}] Created job: ${job.id}`);

  // 5. Dispatch the job
  const { error: dispatchError } = await supabase.functions.invoke('dispatch-generation-job', {
    body: { job_id: job.id }
  });

  if (dispatchError) {
    // If dispatch fails, revert the pool entry status
    if (poolEntryId) {
      await supabase
        .from('autopilot_idea_pools')
        .update({
          status: 'failed',
          error_message: `Dispatch failed: ${dispatchError.message}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', poolEntryId);
    }
    throw new Error(`Failed to dispatch job: ${dispatchError.message}`);
  }

  console.log(`✅ [Autopilot ${autopilot.id}] Job dispatched successfully`);

  // 6. Update pool entry with job reference (if using pool)
  if (poolEntryId) {
    await supabase
      .from('autopilot_idea_pools')
      .update({
        job_id: job.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', poolEntryId);
  }

  // 7. Log the generation
  await logAutomation(supabase, autopilot.id, null, job.id, 'generation_started', null, {
    blueprint_id: blueprint.id,
    blueprint_name: blueprint.name,
    idea_id: idea.id,
    idea_title: idea.title,
    pool_entry_id: poolEntryId,
    from_pool: !!poolEntryId
  });

  // 8. Update autopilot stats and next_run_at
  await updateAutopilotAfterGeneration(supabase, autopilot, slotAt);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Pick an unused idea for this autopilot using the pool system
 * Falls back to legacy tag-based selection if pool is empty
 *
 * IMPORTANT: When ideas_source is 'per_blueprint', we filter pool entries
 * by the selected blueprint's idea_tags to ensure correct pipeline matching.
 */
async function pickUnusedIdea(
  supabase: any,
  autopilot: Autopilot,
  mix: ContentMixItem,
  blueprint: Blueprint
): Promise<{ idea: ContentIdea | null; poolEntryId: string | null; poolEntryMetadata: Record<string, any> | null }> {
  // Determine which tags to filter by based on ideas_source mode
  const tagNamesToFilter = autopilot.ideas_source === 'shared' && autopilot.shared_idea_tags?.length
    ? autopilot.shared_idea_tags
    : mix.idea_tags;

  // Get tag IDs if we have tags to filter by (for per_blueprint mode)
  let tagIds: string[] = [];
  if (tagNamesToFilter && tagNamesToFilter.length > 0) {
    const { data: tags, error: tagsError } = await supabase
      .from('idea_tags')
      .select('id, name')
      .eq('organization_id', autopilot.organization_id)
      .in('name', tagNamesToFilter);

    if (!tagsError && tags && tags.length > 0) {
      tagIds = tags.map((t: any) => t.id);
      console.log(`🏷️ [Autopilot ${autopilot.id}] Filtering by ${tagIds.length} tags: ${tagNamesToFilter.join(', ')}`);
    } else {
      console.log(`⚠️ [Autopilot ${autopilot.id}] No matching tags found for: ${tagNamesToFilter.join(', ')}`);
    }
  }

  // First, try to get an idea from the explicit pool
  // If we have tag filters, we need to filter pool entries by ideas that have matching tags
  let poolEntries: any[] = [];

  // "Only post approved ideas": an inner join drops pool entries whose idea's
  // guidelines nobody approved. next_unused_idea applies the same rule.
  const approvedOnly = !!autopilot.only_approved_ideas;
  const ideaEmbed = approvedOnly ? 'content_ideas:idea_id!inner' : 'content_ideas:idea_id';
  const onlyApproved = (query: any) =>
    approvedOnly ? query.not('content_ideas.guidelines_approved_at', 'is', null) : query;
  if (approvedOnly) console.log(`✅ [Autopilot ${autopilot.id}] Only approved ideas`);

  if (tagIds.length > 0) {
    // Query pool entries where the idea has at least one of the required tags
    // We need to join through idea_tag_assignments to filter by tags
    const { data: filteredPoolEntries, error: poolError } = await onlyApproved(supabase
      .from('autopilot_idea_pools')
      .select(`
        id,
        idea_id,
        attempt_count,
        recycle_count,
        metadata,
        created_at,
        ${ideaEmbed} (
          id,
          title,
          keywords,
          metadata,
          library_elements,
          ai_analysis,
          content_framework,
          emotional_triggers,
          idea_tag_assignments!inner(tag_id)
        )
      `))
      .eq('autopilot_id', autopilot.id)
      .eq('status', 'available')
      // Least-recently-used first: never-attempted ideas (NULL) lead, then the
      // idea idle the longest. This rotates across idea categories instead of
      // re-serving whichever entry Postgres happens to return first when
      // recycle_count/created_at are tied (bulk-inserted pools share both).
      .order('last_attempt_at', { ascending: true, nullsFirst: true })
      .order('recycle_count', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(50);

    if (!poolError && filteredPoolEntries) {
      // Filter entries where the idea has at least one matching tag
      poolEntries = filteredPoolEntries.filter((entry: any) => {
        const idea = entry.content_ideas;
        if (!idea || !idea.idea_tag_assignments) return false;
        return idea.idea_tag_assignments.some((assignment: any) =>
          tagIds.includes(assignment.tag_id)
        );
      }).slice(0, 10); // Limit to 10 after filtering

      console.log(`🎯 [Autopilot ${autopilot.id}] Found ${poolEntries.length} pool entries matching tags (from ${filteredPoolEntries.length} total available)`);
    }
  } else {
    // No tag filter - get any available pool entry
    const { data: allPoolEntries, error: poolError } = await onlyApproved(supabase
      .from('autopilot_idea_pools')
      .select(`
        id,
        idea_id,
        attempt_count,
        recycle_count,
        metadata,
        created_at,
        ${ideaEmbed} (
          id,
          title,
          keywords,
          metadata,
          library_elements,
          ai_analysis,
          content_framework,
          emotional_triggers
        )
      `))
      .eq('autopilot_id', autopilot.id)
      .eq('status', 'available')
      // Least-recently-used first (see tag-filtered branch above) so ideas
      // rotate instead of repeating when recycle_count/created_at are tied.
      .order('last_attempt_at', { ascending: true, nullsFirst: true })
      .order('recycle_count', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(10);

    if (!poolError && allPoolEntries) {
      poolEntries = allPoolEntries;
    }
  }

  if (poolEntries.length > 0) {
    // Use the first available pool entry (ordered by recycle_count, then created_at)
    const selected = poolEntries[0];
    // Clean up the idea object - remove the tag assignments from the response
    const ideaRaw = selected.content_ideas;
    const idea: ContentIdea = {
      id: ideaRaw.id,
      title: ideaRaw.title,
      keywords: ideaRaw.keywords,
      metadata: ideaRaw.metadata,
      library_elements: ideaRaw.library_elements,
      ai_analysis: ideaRaw.ai_analysis,
      content_framework: ideaRaw.content_framework,
      emotional_triggers: ideaRaw.emotional_triggers
    };

    console.log(`🎯 [Autopilot ${autopilot.id}] Selected idea from pool: ${idea.title}`);

    // Mark as in_progress
    await supabase
      .from('autopilot_idea_pools')
      .update({
        status: 'in_progress',
        last_attempt_at: new Date().toISOString(),
        attempt_count: (selected.attempt_count || 0) + 1,
        blueprint_id: blueprint.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', selected.id);

    return { idea, poolEntryId: selected.id, poolEntryMetadata: selected.metadata || {} };
  }

  console.log(`📋 [Autopilot ${autopilot.id}] No pool entries matching tags, pulling in new ideas before recycling`);

  // New ideas first. Recycling used to run before this sync, so a pool with
  // anything to recycle never picked up newly tagged ideas: MYC (98144906)
  // repeated old posts while 31 matching ideas sat outside its pool.
  const { data: syncResult } = await supabase.rpc('sync_autopilot_pool_from_tags', {
    p_autopilot_id: autopilot.id
  });

  if (syncResult?.added > 0) {
    console.log(`📥 [Autopilot ${autopilot.id}] Synced ${syncResult.added} new ideas from tags`);
    await logAutomation(supabase, autopilot.id, null, null, 'pool_synced', null, {
      synced_count: syncResult.added,
      ideas_source: syncResult.ideas_source,
      tags_used: syncResult.tags_used
    });
    return pickUnusedIdea(supabase, autopilot, mix, blueprint);
  }
  console.log(`📋 [Autopilot ${autopilot.id}] No new ideas to sync (${syncResult?.message || 'none matching'})`);

  if (autopilot.auto_reload_pool) {
    console.log(`🔄 [Autopilot ${autopilot.id}] Auto-reload enabled, attempting to recycle pool`);

    // Include failed ideas: transient failures (can_recycle=true) re-enter
    // circulation, while chronically-broken ideas parked by the stuck-pool reaper
    // (can_recycle=false) stay excluded.
    const { data: recycleResult } = await supabase.rpc('recycle_autopilot_pool', {
      p_autopilot_id: autopilot.id,
      p_include_failed: true,
      // Only ideas idle for a while come back, so a pool with one usable idea
      // (e.g. one approved) skips runs instead of posting it every time.
      p_min_idle: IDEA_REPEAT_COOLDOWN
    });

    if (recycleResult?.recycled > 0) {
      console.log(`♻️ [Autopilot ${autopilot.id}] Recycled ${recycleResult.recycled} ideas`);
      await logAutomation(supabase, autopilot.id, null, null, 'pool_recycled', null, {
        recycled_count: recycleResult.recycled
      });
      return pickUnusedIdea(supabase, autopilot, mix, blueprint);
    }
  }

  // Not in any pool: the oldest matching idea this autopilot + blueprint has
  // not used. This used to load the 100 oldest ideas and filter in memory, so
  // an autopilot that had used those 100 stopped for good (a5a82b80, 174 ideas).
  console.log(`📊 [Autopilot ${autopilot.id}] Using direct idea selection`);
  const { data: nextIdeas, error: nextError } = await supabase.rpc('next_unused_idea', {
    p_autopilot_id: autopilot.id,
    p_blueprint_id: mix.blueprint_id,
    p_tag_ids: tagIds.length > 0 ? tagIds : null
  });

  if (nextError) {
    console.error(`Error picking the next unused idea:`, nextError);
    return { idea: null, poolEntryId: null, poolEntryMetadata: null };
  }

  const nextIdea = (nextIdeas || [])[0] as ContentIdea | undefined;
  if (!nextIdea) {
    console.log(`⚠️ [Autopilot ${autopilot.id}] Every matching idea has been used`);
    return { idea: null, poolEntryId: null, poolEntryMetadata: null };
  }

  console.log(`✅ [Autopilot ${autopilot.id}] Next unused idea: ${nextIdea.title}`);
  return { idea: nextIdea, poolEntryId: null, poolEntryMetadata: null };
}

// Table name to shorthand mapping for dispatch-generation-job compatibility
const TABLE_TO_SHORTHAND: Record<string, string> = {
  'library_products': 'product',
  'library_brand_voices': 'brand',
  'library_characters': 'character',
  'library_icps': 'icp',
  'library_blocks': 'block',
  'library_identities': 'identity',
  // 'images' (not 'library_images') to match the imageInputs?.images fallback
  // that execute-stage's extractReferenceImages() checks.
  'library_images': 'images'
};

/**
 * Fetch library element data based on autopilot selections
 * Returns data in format compatible with dispatch-generation-job
 */
async function fetchLibraryElementData(
  supabase: any,
  organizationId: string,
  librarySelections: AutopilotLibrarySelection | undefined
): Promise<{
  libraryElements: Record<string, any>;
  selectedPaths: Record<string, Record<string, { included: boolean; selectedItems?: string[] }>>;
  imageInputs: Record<string, string[]>;
  // Separate-mode variants: array of per-table element variants to explode into multiple job items
  separateVariants: Array<{ tableName: string; shorthand: string; element: any; paths: any; images: string[] }>;
}> {
  if (!librarySelections || Object.keys(librarySelections).length === 0) {
    return { libraryElements: {}, selectedPaths: {}, imageInputs: {}, separateVariants: [] };
  }

  const libraryElements: Record<string, any> = {};
  const selectedPaths: Record<string, Record<string, { included: boolean; selectedItems?: string[] }>> = {};
  const imageInputs: Record<string, string[]> = {};
  const separateVariants: Array<{ tableName: string; shorthand: string; element: any; paths: any; images: string[] }> = [];

  for (const [tableName, tableConfig] of Object.entries(librarySelections)) {
    const elementIds = Object.keys(tableConfig.elements);
    if (elementIds.length === 0) continue;

    // Fetch elements from database
    const { data: elements, error } = await supabase
      .from(tableName)
      .select('*')
      .eq('organization_id', organizationId)
      .in('id', elementIds);

    if (error) {
      console.error(`❌ Error fetching ${tableName}:`, error);
      continue;
    }

    if (!elements || elements.length === 0) {
      console.warn(`⚠️ No elements found in ${tableName} for IDs: ${elementIds.join(', ')}`);
      continue;
    }

    const shorthand = TABLE_TO_SHORTHAND[tableName];
    if (!shorthand) {
      console.warn(`⚠️ Unknown library table: ${tableName}`);
      continue;
    }

    const mode = tableConfig.combination_mode || 'separate';

    if (mode === 'combine' || elementIds.length === 1) {
      // Combine mode (or single element): pass all elements as an array (or single)
      // dispatch-generation-job handles arrays by using the first element for prompt resolution
      const orderedElements = elementIds
        .map(id => elements.find((e: any) => e.id === id))
        .filter(Boolean);

      libraryElements[tableName] = orderedElements.length === 1 ? orderedElements[0] : orderedElements;
      console.log(`📚 [Library] Loaded ${shorthand} (${mode}): ${orderedElements.map((e: any) => e.name || e.id).join(', ')}`);

      // Use path selections from first element for combined mode
      const firstElementId = elementIds[0];
      const elementConfig = tableConfig.elements[firstElementId];
      if (elementConfig?.paths && Object.keys(elementConfig.paths).length > 0) {
        selectedPaths[shorthand] = elementConfig.paths;
      }
      if (elementConfig?.selected_images && elementConfig.selected_images.length > 0) {
        imageInputs[shorthand] = elementConfig.selected_images;
      }
    } else {
      // Separate mode with multiple elements: record variants for explosion into multiple job items
      for (const elementId of elementIds) {
        const element = elements.find((e: any) => e.id === elementId);
        if (!element) continue;
        const elementConfig = tableConfig.elements[elementId];
        separateVariants.push({
          tableName,
          shorthand,
          element,
          paths: elementConfig?.paths || {},
          images: elementConfig?.selected_images || [],
        });
      }
      console.log(`📚 [Library] Separate mode for ${shorthand}: ${elementIds.length} variants will create multiple job items`);
    }
  }

  return { libraryElements, selectedPaths, imageInputs, separateVariants };
}

// ============================================================================
// Saved Content Resolution
// ============================================================================

const VIDEO_PIPELINE_LIST = ['ugc_video', 'generative_video_oneshot', 'storyboard_video_longform', 'ugc_heygen', 'ugc_heygen_template'];

async function resolveSavedContent(
  supabase: any,
  organizationId: string,
  autopilotId: string,
  selectedMix: ContentMixItem,
  idea: ContentIdea,
  blueprint: Blueprint
): Promise<ResolvedSavedContent | null> {
  const { media_source, media_content_types, saved_library_ratio } = selectedMix;

  // 1. Skip if generate mode (default)
  if (!media_source || media_source === 'generate') {
    return null;
  }

  // 2. Mixed mode: use ratio-tracking instead of random roll for deterministic convergence
  if (media_source === 'mixed') {
    const ratio = saved_library_ratio ?? 50;

    // Query recent jobs to check actual saved content usage ratio
    const { data: recentJobs } = await supabase
      .from('content_generation_jobs')
      .select('configuration')
      .eq('autopilot_id', autopilotId)
      .order('created_at', { ascending: false })
      .limit(20);

    const recentCount = recentJobs?.length || 0;
    const savedCount = (recentJobs || []).filter(
      (j: any) => j.configuration?.saved_content?.items?.length > 0
    ).length;

    const actualRatio = recentCount > 0 ? (savedCount / recentCount) * 100 : 0;

    // Use saved content if actual ratio is below target; generate if at or above target
    // For the first few jobs (< 3), always try saved content to bootstrap the ratio
    if (actualRatio >= ratio && recentCount >= 3) {
      console.log(`🎲 [Saved Content] Mixed mode: actual ratio ${actualRatio.toFixed(0)}% >= ${ratio}% target (${savedCount}/${recentCount} recent), using generation`);
      return null;
    }
    console.log(`🎲 [Saved Content] Mixed mode: actual ratio ${actualRatio.toFixed(0)}% < ${ratio}% target (${savedCount}/${recentCount} recent), using saved content`);
  }

  // 3. Resolve tags for matching against saved content
  // Prefer explicit saved_content_tags from content mix config; fall back to idea tags
  const explicitTags: string[] = selectedMix.saved_content_tags || [];

  let matchTags: string[];
  if (explicitTags.length > 0) {
    // Use explicit saved content tags (with case variants for case-insensitive matching)
    matchTags = [...new Set([
      ...explicitTags,
      ...explicitTags.map(t => t.toLowerCase()),
      ...explicitTags.map(t => t.toUpperCase()),
    ])];
    console.log(`🏷️ [Saved Content] Using ${explicitTags.length} explicit saved_content_tags (${matchTags.length} variants): ${matchTags.join(', ')}`);
  } else {
    // Fall back to idea tags
    const { data: ideaTags } = await supabase
      .from('idea_tag_assignments')
      .select('idea_tags:tag_id(name)')
      .eq('idea_id', idea.id);

    const tagNamesRaw: string[] = (ideaTags || [])
      .map((row: any) => row.idea_tags?.name)
      .filter(Boolean);

    matchTags = [...new Set([
      ...tagNamesRaw,
      ...tagNamesRaw.map(t => t.toLowerCase()),
      ...tagNamesRaw.map(t => t.toUpperCase()),
    ])];
    console.log(`🏷️ [Saved Content] No saved_content_tags set — falling back to ${tagNamesRaw.length} idea tags (${matchTags.length} variants): ${matchTags.join(', ') || 'none'}`);
  }

  // 4. Determine needed content types based on pipeline
  const pipeline = blueprint.pipeline || '';
  const isCarousel = pipeline === 'instagram_carousel';
  const isVideoPipeline = VIDEO_PIPELINE_LIST.includes(pipeline);

  let resolvedTypes: string[];
  if (media_content_types && media_content_types.length > 0) {
    resolvedTypes = [...media_content_types];
  } else if (isVideoPipeline) {
    resolvedTypes = ['video'];
  } else {
    resolvedTypes = ['image'];
  }

  // Filter out incompatible content types based on pipeline.
  // Video is supported by dedicated video pipelines and by social_media_post
  // (native video attachment — published as a reel/video post via push-to-ghl).
  // Carousels and other image/text pipelines can't carry a video.
  const supportsSavedVideo = isVideoPipeline || pipeline === 'social_media_post';
  if (!supportsSavedVideo && !isCarousel) {
    resolvedTypes = resolvedTypes.filter(t => t !== 'video');
  }
  if (resolvedTypes.length === 0) {
    resolvedTypes = ['image']; // Fallback
  }

  // 5. Determine how many items we need
  const limit = isCarousel ? (selectedMix.output_config?.slideCount || 5) : 1;

  // 6. Query saved content with tag overlap
  let query = supabase
    .from('library_saved_content')
    .select('id, content_type, content, tags, usage_count')
    .eq('organization_id', organizationId)
    .in('content_type', resolvedTypes);

  // Only filter by tags if we have tags to match
  if (matchTags.length > 0) {
    query = query.overlaps('tags', matchTags);
  }

  const { data: savedItems, error: savedError } = await query
    .order('usage_count', { ascending: true })
    .limit(limit * 3); // Fetch extra for randomization

  if (savedError) {
    console.error(`❌ [Saved Content] Query error:`, savedError);
    return null;
  }

  if (!savedItems || savedItems.length === 0) {
    console.log(`📭 [Saved Content] No matching content found — falling back to generation`);
    return null;
  }

  // For carousel: need at least the full slideCount
  if (isCarousel && savedItems.length < limit) {
    console.log(`📭 [Saved Content] Only ${savedItems.length} images but need ${limit} for carousel — falling back to generation`);
    return null;
  }

  // 7. Shuffle and pick the needed amount
  const shuffled = savedItems.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, limit);

  // 8. Extract URLs and increment usage counts
  const items: Array<{ id: string; content_type: string; url: string }> = [];
  for (const item of selected) {
    const content = item.content as any;
    const url = content?.url || content?.image_url || content?.video_url;
    if (!url) {
      console.warn(`⚠️ [Saved Content] Item ${item.id} has no URL, skipping`);
      continue;
    }
    items.push({ id: item.id, content_type: item.content_type, url });

    // Increment usage_count
    await supabase
      .from('library_saved_content')
      .update({ usage_count: (item.usage_count || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', item.id);
  }

  if (items.length === 0) {
    console.log(`📭 [Saved Content] No usable URLs found — falling back to generation`);
    return null;
  }

  // For carousel: must have enough
  if (isCarousel && items.length < limit) {
    console.log(`📭 [Saved Content] Only ${items.length} usable items but need ${limit} — falling back to generation`);
    return null;
  }

  console.log(`✅ [Saved Content] Resolved ${items.length} item(s): ${items.map(i => i.content_type).join(', ')}`);

  return {
    items,
    for_carousel: isCarousel,
  };
}

/**
 * Create a generation job for the autopilot
 */
async function createAutopilotJob(
  supabase: any,
  autopilot: Autopilot,
  blueprint: Blueprint,
  idea: ContentIdea,
  poolEntryId: string | null,
  selectedMix: ContentMixItem,
  savedContent: ResolvedSavedContent | null = null,
  poolEntryMetadata: Record<string, any> | null = null,
  slot: { publishAt: string | null; slotPinned: boolean } = { publishAt: null, slotPinned: false }
): Promise<{ id: string }> {
  // Fetch library element data from autopilot's content mix selections
  const { libraryElements, selectedPaths, imageInputs, separateVariants } = await fetchLibraryElementData(
    supabase,
    autopilot.organization_id,
    selectedMix.library_elements
  );

  // Determine which hook to use based on hook_rotation setting
  const hooks = idea.ai_analysis?.hooks || [];
  let selectedHook = hooks[0] || null;
  let hookIndex = 0;

  if (selectedMix.hook_rotation && hooks.length > 1 && poolEntryId) {
    hookIndex = (poolEntryMetadata?.hook_index ?? 0) % hooks.length;
    selectedHook = hooks[hookIndex];
    console.log(`🔄 [Hook Rotation] Using hook ${hookIndex + 1}/${hooks.length}: "${selectedHook?.text?.substring(0, 50)}..."`);
  }

  // Don't open like the account's last posts: skip stored hooks that repeat
  // the feed, or write a fresh one (hook-variety.ts). Rotation only: that's
  // when the same ideas and hooks come back.
  let hookSource: HookSource = 'rotation';
  if (selectedMix.hook_rotation && poolEntryId) {
    const varied = await varyHook({
      supabase,
      autopilotId: autopilot.id,
      organizationId: autopilot.organization_id,
      blueprint,
      hooks,
      selected: selectedHook,
      selectedIndex: hookIndex,
      idea,
    });
    selectedHook = varied.hook ?? selectedHook;
    hookSource = varied.source;
  }

  const baseSlotValues = {
    idea: idea.title,
    topic: idea.title,
    context: idea.title,
    title: idea.title,
    ...(idea.keywords ? { keywords: idea.keywords.join(', ') } : {}),
    ...(idea.content_framework ? { content_framework: idea.content_framework } : {}),
    ...((idea.metadata?.url || idea.metadata?.presenter_url) ? { url: idea.metadata.url || idea.metadata.presenter_url } : {}),
    ...(selectedHook ? { hook: selectedHook.text } : {}),
  };

  const baseAiInsights = idea.ai_analysis ? {
    talking_points: idea.ai_analysis.talking_points || [],
    hook: selectedHook,
    cta: idea.ai_analysis.ctas?.[0] || null,
    engagement_drivers: idea.ai_analysis.engagement_drivers || idea.emotional_triggers || [],
    script_structure: idea.ai_analysis.script_structure || null
  } : null;

  // Build job items - one per separate-mode variant (content explosion), or a single item otherwise
  let jobItems: any[];

  if (separateVariants.length > 0) {
    // Separate mode explosion: one item per variant element
    jobItems = separateVariants.map(variant => {
      const mergedReferences = mergeAutopilotReferenceVariant(selectedPaths, imageInputs, variant);
      return {
        idea_id: idea.id,
        idea_title: `${idea.title} [${variant.element.name || variant.shorthand}]`,
        slot_values: baseSlotValues,
        library_elements: {
          ...(idea.library_elements || {}),
          ...libraryElements,
          [variant.tableName]: variant.element,
        },
        selected_paths: mergedReferences.selectedPaths,
        image_inputs: mergedReferences.imageInputs,
        idea_ai_analysis: idea.ai_analysis || null,
        selected_ai_insights: baseAiInsights,
      };
    });
    console.log(`💥 [Library Explosion] Creating ${separateVariants.length} items for separate-mode library variants`);
  } else {
    // Single item (combine mode or no multi-element selection)
    jobItems = [{
      idea_id: idea.id,
      idea_title: idea.title,
      slot_values: baseSlotValues,
      library_elements: {
        ...(idea.library_elements || {}),
        ...libraryElements
      },
      selected_paths: selectedPaths,
      image_inputs: imageInputs,
      idea_ai_analysis: idea.ai_analysis || null,
      selected_ai_insights: baseAiInsights,
    }];
  }

  const { data: job, error: jobError } = await supabase
    .from('content_generation_jobs')
    .insert({
      organization_id: autopilot.organization_id,
      user_id: autopilot.created_by, // Use autopilot creator as job owner
      blueprint_id: blueprint.id,
      autopilot_id: autopilot.id,
      pipeline: blueprint.pipeline || 'text',
      name: `Autopilot: ${autopilot.name} - ${idea.title.substring(0, 30)}`,
      status: 'queued',
      items: jobItems,
      configuration: {
        pipeline: blueprint.pipeline || 'text',
        model_config: blueprint.model_config,
        is_autopilot: true,
        pool_entry_id: poolEntryId,
        // Scheduled mode: post at the slot this run was made for (approve-stage), and
        // keep runs a pinned slot chose out of the rotation's history.
        ...(slot.publishAt ? { publish_at: slot.publishAt } : {}),
        ...(slot.slotPinned ? { slot_pinned: true } : {}),
        // Hook rotation tracking
        ...(selectedMix.hook_rotation && hooks.length > 1 ? {
          hook_rotation: true,
          hook_index: hookIndex,
          total_hooks: hooks.length,
        } : {}),
        ...(hookSource !== 'rotation' ? { hook_source: hookSource } : {}),
        // Pass format configuration: merge autopilot default (captions on) + blueprint defaults + content mix overrides
        video_config: blueprint.pipeline === 'video' ? {
          generate_post_caption: true,
          ...blueprint.model_config?.video_config_defaults,
          ...selectedMix.video_config,
        } : undefined,
        output_config: selectedMix.output_config,
        // Skip image generation for text-only output
        ...(selectedMix.skip_image_generation ? { skip_image_generation: true } : {}),
        // Saved content from library (resolved via resolveSavedContent)
        saved_content: savedContent,
        // Presenter video config: merge idea metadata URL with content mix settings
        ...(blueprint.pipeline === 'presenter_video' ? (() => {
          const pc = selectedMix.presenter_config || {};
          const ideaUrl = idea.metadata?.url || idea.metadata?.presenter_url;
          return {
            url: ideaUrl || pc.url || '',
            brief: pc.brief,
            template_type: pc.templateType,
            avatar_type: pc.avatarType,
            avatar_photo_url: pc.avatarPhotoUrl,
            heygen_avatar_id: pc.heygenAvatarId,
            character_id: pc.characterId,
            voice_id: pc.voiceId,
            lip_sync_provider: pc.lipSyncProvider,
            subtitle_style: pc.subtitleStyle,
            orientation: pc.orientation,
            max_screenshots: pc.maxScreenshots,
            background_music_url: pc.backgroundMusicUrl,
          };
        })() : {}),
      },
      progress: {
        total: jobItems.length,
        completed: 0,
        failed: 0
      }
    })
    .select('id')
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to create job: ${jobError?.message}`);
  }

  // Update pool entry metadata with hook rotation state
  if (poolEntryId && selectedMix.hook_rotation && hooks.length > 1) {
    const nextHookIndex = hookIndex + 1;
    const allHooksUsed = nextHookIndex >= hooks.length;

    await supabase
      .from('autopilot_idea_pools')
      .update({
        metadata: {
          ...(poolEntryMetadata || {}),
          hook_index: nextHookIndex,
          total_hooks: hooks.length,
          hooks_exhausted: allHooksUsed,
        },
        // If more hooks remain, set back to 'available' so the idea is picked again
        ...(allHooksUsed ? {} : {
          status: 'available',
          attempt_count: 0,
        }),
        updated_at: new Date().toISOString()
      })
      .eq('id', poolEntryId);

    if (!allHooksUsed) {
      console.log(`🔄 [Hook Rotation] Hook ${hookIndex + 1}/${hooks.length} used, idea stays in pool for next hook`);
    } else {
      console.log(`✅ [Hook Rotation] All ${hooks.length} hooks used, idea will be marked as produced on completion`);
    }
  }

  return job;
}

/**
 * Update autopilot after successful generation
 */
async function updateAutopilotAfterGeneration(supabase: any, autopilot: Autopilot, slotAt: Date | null = null): Promise<void> {
  const nextRun = calculateNextRun(autopilot, new Date(), slotAt);

  await supabase
    .from('autopilots')
    .update({
      last_run_at: new Date().toISOString(),
      next_run_at: nextRun.toISOString(),
      total_generated: (autopilot.total_generated || 0) + 1,
      updated_at: new Date().toISOString()
    })
    .eq('id', autopilot.id);

  console.log(`📅 [Autopilot ${autopilot.id}] Next run scheduled for: ${nextRun.toISOString()} (mode: ${autopilot.scheduling_mode})`);
}

// Same key rules as dispatch-generation-job's pre-checks, so a run we skip is
// one dispatch would have rejected anyway.
const DISPATCH_VIDEO_PIPELINES = new Set(['ugc_video', 'ugc_heygen', 'ugc_heygen_template', 'generative_video_oneshot', 'storyboard_video_longform', 'presenter_video', 'video_remix', 'video']);
const DISPATCH_TEXT_PIPELINES = new Set(['social_media_post', 'instagram_carousel', 'instagram_carousel_ai', 'video_script', 'rich_article']);
const CONSECUTIVE_FAILURES_BEFORE_PAUSE = 2;
// Every one of an autopilot's last posts failed (at least this many, or two per
// account): its accounts can't take posts, so making more only spends credits.
const PUBLISH_FAILURES_BEFORE_PAUSE = 6;
// Runs before the auto-pause rule shipped don't count: many of them failed on
// the withdrawn free fallback model, fixed in the same release.
const AUTO_PAUSE_COUNTS_FROM = '2026-09-25T15:50:00Z';

function needsOpenRouterKey(blueprint: Blueprint): boolean {
  const pipeline = (blueprint as any).pipeline as string | undefined;
  if (!pipeline) return false;
  const text = (blueprint as any).model_config?.text_llm || {};
  const textOnOllama = text.provider === 'ollama' || String(text.model_id || '').startsWith('ollama:');
  if (DISPATCH_VIDEO_PIPELINES.has(pipeline) || DISPATCH_TEXT_PIPELINES.has(pipeline)) {
    return !(textOnOllama && DISPATCH_TEXT_PIPELINES.has(pipeline));
  }
  return pipeline === 'image_only';
}

/**
 * Why this autopilot should stop instead of running, or null to run.
 * - the OpenRouter key the pipeline needs is missing or flagged invalid
 * - its last CONSECUTIVE_FAILURES_BEFORE_PAUSE runs since it was last
 *   auto-paused (or since the rule shipped) all failed, so resuming gives it
 *   a clean slate
 */
async function autopilotPauseReason(supabase: any, autopilot: Autopilot, blueprint: Blueprint): Promise<string | null> {
  if (needsOpenRouterKey(blueprint)) {
    const { data: key } = await supabase
      .from('api_keys')
      .select('is_valid, last_validated')
      .eq('organization_id', autopilot.organization_id)
      .eq('provider', 'openrouter')
      .maybeSingle();
    if (!key) {
      return 'No OpenRouter API key. Add one in Settings > Integrations, then resume this autopilot.';
    }
    if (key.is_valid === false) {
      const when = key.last_validated ? ` on ${String(key.last_validated).slice(0, 10)}` : '';
      return `OpenRouter rejected your API key${when}. Update it in Settings > Integrations, then resume this autopilot.`;
    }
  }

  // Every destination is an X account that can't post (credits depleted or
  // auth revoked, flagged by publish-to-twitter), so the content would only
  // pile up as failed publishes. Mixed destinations still run.
  const destinations = (autopilot.destinations || []).filter((d) => d.enabled);
  const xDestinations = destinations.filter((d) => ['twitter', 'x'].includes((d.platform || '').toLowerCase()));
  if (destinations.length > 0 && xDestinations.length === destinations.length) {
    const xAccountIds = [...new Set(xDestinations.map((d) => d.account_id))];
    const { data: accounts } = await supabase
      .from('twitter_accounts')
      .select('name, twitter_handle, is_valid, error_message')
      .in('id', xAccountIds);
    if (accounts?.length === xAccountIds.length && accounts.every((a: any) => a.is_valid === false)) {
      const handles = accounts.map((a: any) => a.twitter_handle ? `@${a.twitter_handle}` : a.name).join(', ');
      const why = String(accounts[0].error_message || 'Account flagged invalid').trim().replace(/\.?$/, '.');
      return `Can't post to X (${handles}): ${why} Then test the account in Settings > Integrations and resume this autopilot.`;
    }
  }

  const { data: lastPause } = await supabase
    .from('automation_logs')
    .select('created_at')
    .eq('autopilot_id', autopilot.id)
    .eq('event_type', 'auto_paused')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Posting keeps failing everywhere (a GHL location that is no longer active,
  // a revoked token): Digital Helper made a post a day for days with none of
  // them going out. Counted since its last auto-pause, so resuming starts fresh.
  if (destinations.length > 0) {
    const sample = Math.max(PUBLISH_FAILURES_BEFORE_PAUSE, destinations.length * 2);
    let postsQuery = supabase
      .from('publish_queue')
      .select('status, last_error')
      .eq('autopilot_id', autopilot.id)
      .in('status', ['published', 'failed'])
      .order('created_at', { ascending: false })
      .limit(sample);
    if (lastPause?.created_at) postsQuery = postsQuery.gt('created_at', lastPause.created_at);
    const { data: posts } = await postsQuery;
    if (posts && posts.length === sample && posts.every((p: any) => p.status === 'failed')) {
      const lastError = String(posts[0].last_error || 'the platform rejected it').replace(/\s+/g, ' ').slice(0, 220).replace(/\.?$/, '.');
      return `Paused because its last ${sample} posts all failed: ${lastError} Reconnect the account in Settings > Integrations, then resume this autopilot.`;
    }
  }

  let recentQuery = supabase
    .from('content_generation_jobs')
    .select('status, error')
    .eq('autopilot_id', autopilot.id)
    .in('status', ['completed', 'failed'])
    .order('created_at', { ascending: false })
    .limit(CONSECUTIVE_FAILURES_BEFORE_PAUSE);
  const countFrom = lastPause?.created_at && Date.parse(lastPause.created_at) > Date.parse(AUTO_PAUSE_COUNTS_FROM)
    ? lastPause.created_at
    : AUTO_PAUSE_COUNTS_FROM;
  recentQuery = recentQuery.gt('created_at', countFrom);
  const { data: recent } = await recentQuery;

  if (recent && recent.length === CONSECUTIVE_FAILURES_BEFORE_PAUSE && recent.every((j: any) => j.status === 'failed')) {
    const lastError = String(recent[0].error || 'unknown error').replace(/\s+/g, ' ').slice(0, 220);
    return `Paused after ${CONSECUTIVE_FAILURES_BEFORE_PAUSE} failed runs in a row. Last error: ${lastError}`;
  }

  return null;
}

async function pauseAutopilot(supabase: any, autopilot: Autopilot, reason: string): Promise<void> {
  console.warn(`⏸️ [Autopilot ${autopilot.id}] Pausing: ${reason}`);
  await supabase
    .from('autopilots')
    .update({
      status: 'paused',
      paused_reason: reason,
      paused_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', autopilot.id)
    .eq('status', 'active');
  await logAutomation(supabase, autopilot.id, null, null, 'auto_paused', null, { reason });
}

/**
 * Update next run without incrementing generation count (for skipped runs)
 */
async function updateNextRun(supabase: any, autopilot: Autopilot, slotAt: Date | null = null): Promise<void> {
  const nextRun = calculateNextRun(autopilot, new Date(), slotAt);

  await supabase
    .from('autopilots')
    .update({
      next_run_at: nextRun.toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', autopilot.id);
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
