import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { requireFeature } from "../_shared/featureAccess.ts";
import { mergeAutopilotReferenceVariant } from "../_shared/autopilot-reference-merge.ts";
import { varyHook, type HookSource } from "../_shared/hook-variety.ts";
import { IDEA_REPEAT_COOLDOWN, MIX_HISTORY_WINDOW, rankMixEntries } from "../_shared/content-mix.ts";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// Types (copied from process-autopilots for consistency)
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

interface ContentMixItem {
  blueprint_id: string;
  weight: number;
  enabled: boolean;
  idea_tags?: string[];
  library_elements?: AutopilotLibrarySelection;
  video_config?: AutopilotVideoConfig;
  output_config?: AutopilotOutputConfig;
  presenter_config?: AutopilotPresenterConfig;
  media_source?: 'generate' | 'saved_library' | 'mixed';
  media_content_types?: ('image' | 'video')[];
  saved_library_ratio?: number;
  saved_content_tags?: string[];
  hook_rotation?: boolean;
  skip_image_generation?: boolean;
}

interface ResolvedSavedContent {
  items: Array<{ id: string; content_type: string; url: string }>;
  for_carousel: boolean;
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
  destinations: Array<{ account_id: string; platform: string; enabled: boolean; post_type?: string }>;
  evergreen?: {
    enabled: boolean;
    min_age_days: number;
    max_reposts: number;
    variation_mode: 'exact' | 'slight_variation' | 'regenerate';
  };
  pool_mode?: 'tag_based' | 'explicit' | 'hybrid';
  auto_reload_pool?: boolean;
  // Only ideas whose guidelines a person approved (content_ideas.guidelines_approved_at)
  only_approved_ideas?: boolean;
  pool_reload_threshold?: number;
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { autopilot_id } = await req.json();

    if (!autopilot_id) {
      return new Response(
        JSON.stringify({ error: 'autopilot_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🎯 [Manual Trigger] Starting for autopilot: ${autopilot_id}`);

    // Fetch the autopilot first to get organization_id
    const { data: autopilot, error: fetchError } = await supabase
      .from('autopilots')
      .select('*')
      .eq('id', autopilot_id)
      .single();

    if (fetchError || !autopilot) {
      return new Response(
        JSON.stringify({ error: 'Autopilot not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, autopilot.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // Validate feature access - Autopilots requires Pro plan
    await requireFeature(supabase, autopilot.organization_id, "autopilots");

    // Process the autopilot
    const result = await processAutopilot(autopilot as Autopilot, supabase);

    console.log(`✅ [Manual Trigger] Completed for autopilot: ${autopilot_id}`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ [Manual Trigger] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================================================
// Process Single Autopilot (adapted from process-autopilots)
// ============================================================================

async function processAutopilot(
  autopilot: Autopilot,
  supabase: any
): Promise<{ success: boolean; job_id?: string; error?: string; details?: any }> {
  console.log(`🚀 [Manual Trigger] Processing: ${autopilot.name}`);

  // 1. Blueprints in turn order: furthest below its share of recent runs first (content-mix.ts).
  // Runs a pinned slot chose don't count toward the rotation (see process-autopilots).
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
  const ranked = rankMixEntries(autopilot.content_mix, rotationHistory);
  if (ranked.length === 0) {
    const error = 'No enabled blueprints in content mix';
    console.log(`⚠️ [Manual Trigger] ${error}`);
    return { success: false, error };
  }

  // 2-3. The first blueprint with an idea to run (per-blueprint tags only; see process-autopilots).
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
      return { success: false, error: `Blueprint ${mix.blueprint_id} not found` };
    }
    const attempt = await pickUnusedIdea(supabase, autopilot, mix, bp);
    if (attempt.idea) {
      selectedMix = mix;
      blueprint = bp;
      picked = attempt;
      break;
    }
    starved.push(bp.name);
  }

  if (!selectedMix || !blueprint || !picked?.idea) {
    const error = `No unused ideas available for ${starved.length > 1 ? `any blueprint (${starved.join(', ')})` : `blueprint ${starved[0]}`}`;
    console.log(`⚠️ [Manual Trigger] ${error}`);
    await logAutomation(supabase, autopilot.id, null, null, 'no_ideas_available', null, {
      blueprint_id: candidates[0].blueprint_id,
      blueprint_name: starved[0],
      blueprints_tried: starved,
      pool_mode: autopilot.pool_mode || 'tag_based',
      triggered_manually: true
    });
    return { success: false, error };
  }
  const { idea, poolEntryId, poolEntryMetadata } = picked;
  console.log(`📐 [Manual Trigger] Selected blueprint: ${blueprint.name}${starved.length ? ` (after ${starved.length} with no ideas)` : ''}`);

  console.log(`💡 [Manual Trigger] Selected idea: ${idea.title} (pool: ${poolEntryId ? 'yes' : 'no'})`);

  // 3.5. Resolve saved content if media_source is 'saved_library' or 'mixed'
  const savedContent = await resolveSavedContent(supabase, autopilot.organization_id, autopilot.id, selectedMix, idea, blueprint);
  if (savedContent) {
    console.log(`📎 [Manual Trigger] Resolved ${savedContent.items.length} saved content item(s) for media`);
  }

  // 4. Create the generation job
  const job = await createAutopilotJob(supabase, autopilot, blueprint, idea, poolEntryId, selectedMix, savedContent, poolEntryMetadata);
  console.log(`📝 [Manual Trigger] Created job: ${job.id}`);

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
    return { success: false, error: `Failed to dispatch job: ${dispatchError.message}` };
  }

  console.log(`✅ [Manual Trigger] Job dispatched successfully`);

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
    from_pool: !!poolEntryId,
    triggered_manually: true
  });

  // 8. Update autopilot stats (but NOT next_run_at - we don't want to disrupt the schedule)
  await supabase
    .from('autopilots')
    .update({
      last_run_at: new Date().toISOString(),
      total_generated: (autopilot.total_generated || 0) + 1,
      updated_at: new Date().toISOString()
    })
    .eq('id', autopilot.id);

  return {
    success: true,
    job_id: job.id,
    details: {
      blueprint_name: blueprint.name,
      idea_title: idea.title,
      from_pool: !!poolEntryId
    }
  };
}

// ============================================================================
// Helper Functions (copied from process-autopilots)
// ============================================================================

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
      console.log(`🏷️ [Manual Trigger] Filtering by ${tagIds.length} tags: ${tagNamesToFilter.join(', ')}`);
    } else {
      console.log(`⚠️ [Manual Trigger] No matching tags found for: ${tagNamesToFilter.join(', ')}`);
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

  if (tagIds.length > 0) {
    // Query pool entries where the idea has at least one of the required tags
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

      console.log(`🎯 [Manual Trigger] Found ${poolEntries.length} pool entries matching tags (from ${filteredPoolEntries.length} total available)`);
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
      .order('recycle_count', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(10);

    if (!poolError && allPoolEntries) {
      poolEntries = allPoolEntries;
    }
  }

  if (poolEntries.length > 0) {
    const randomIndex = Math.floor(Math.random() * poolEntries.length);
    const selected = poolEntries[randomIndex];
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

    console.log(`🎯 [Manual Trigger] Selected idea from pool: ${idea.title}`);

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

  console.log(`📋 [Manual Trigger] No pool entries matching tags, pulling in new ideas before recycling`);

  // New ideas first: recycling used to run before this sync, so newly tagged
  // ideas never entered a pool that had anything to recycle.
  const { data: syncResult } = await supabase.rpc('sync_autopilot_pool_from_tags', {
    p_autopilot_id: autopilot.id
  });

  if (syncResult?.added > 0) {
    console.log(`📥 [Manual Trigger] Synced ${syncResult.added} new ideas from tags`);
    await logAutomation(supabase, autopilot.id, null, null, 'pool_synced', null, {
      synced_count: syncResult.added,
      ideas_source: syncResult.ideas_source,
      tags_used: syncResult.tags_used,
      triggered_manually: true
    });
    return pickUnusedIdea(supabase, autopilot, mix, blueprint);
  }
  console.log(`📋 [Manual Trigger] No new ideas to sync (${syncResult?.message || 'none matching'})`);

  if (autopilot.auto_reload_pool) {
    console.log(`🔄 [Manual Trigger] Auto-reload enabled, attempting to recycle pool`);

    const { data: recycleResult } = await supabase.rpc('recycle_autopilot_pool', {
      p_autopilot_id: autopilot.id,
      p_include_failed: false,
      // Only ideas idle for a while come back, so a pool with one usable idea
      // (e.g. one approved) skips runs instead of posting it every time.
      p_min_idle: IDEA_REPEAT_COOLDOWN
    });

    if (recycleResult?.recycled > 0) {
      console.log(`♻️ [Manual Trigger] Recycled ${recycleResult.recycled} ideas`);
      await logAutomation(supabase, autopilot.id, null, null, 'pool_recycled', null, {
        recycled_count: recycleResult.recycled,
        triggered_manually: true
      });
      return pickUnusedIdea(supabase, autopilot, mix, blueprint);
    }
  }

  // Not in any pool: the oldest matching idea this autopilot + blueprint has
  // not used (the old in-memory filter only ever saw the 100 oldest ideas).
  console.log(`📊 [Manual Trigger] Using direct idea selection`);
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
    console.log(`⚠️ [Manual Trigger] Every matching idea has been used`);
    return { idea: null, poolEntryId: null, poolEntryMetadata: null };
  }

  console.log(`✅ [Manual Trigger] Next unused idea: ${nextIdea.title}`);
  return { idea: nextIdea, poolEntryId: null, poolEntryMetadata: null };
}

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

async function fetchLibraryElementData(
  supabase: any,
  organizationId: string,
  librarySelections: AutopilotLibrarySelection | undefined
): Promise<{
  libraryElements: Record<string, any>;
  selectedPaths: Record<string, Record<string, { included: boolean; selectedItems?: string[] }>>;
  imageInputs: Record<string, string[]>;
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
      // Combine mode (or single element): pass all elements as array or single object
      const orderedElements = elementIds
        .map(id => elements.find((e: any) => e.id === id))
        .filter(Boolean);

      libraryElements[tableName] = orderedElements.length === 1 ? orderedElements[0] : orderedElements;
      console.log(`📚 [Library] Loaded ${shorthand} (${mode}): ${orderedElements.map((e: any) => e.name || e.id).join(', ')}`);

      const firstElementId = elementIds[0];
      const elementConfig = tableConfig.elements[firstElementId];
      if (elementConfig?.paths && Object.keys(elementConfig.paths).length > 0) {
        selectedPaths[shorthand] = elementConfig.paths;
        console.log(`📋 [Library] Path selections for ${shorthand}:`, Object.keys(elementConfig.paths));
      }
      if (elementConfig?.selected_images && elementConfig.selected_images.length > 0) {
        imageInputs[shorthand] = elementConfig.selected_images;
        console.log(`🖼️ [Library] ${elementConfig.selected_images.length} images selected for ${shorthand}`);
      }
    } else {
      // Separate mode with multiple elements: record variants for explosion
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
// Saved Content Resolution (tag-matched media from library)
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

  // Filter out incompatible content types based on pipeline
  // e.g., social_media_post can only use images, not videos
  if (!isVideoPipeline && !isCarousel) {
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

async function createAutopilotJob(
  supabase: any,
  autopilot: Autopilot,
  blueprint: Blueprint,
  idea: ContentIdea,
  poolEntryId: string | null,
  selectedMix: ContentMixItem,
  savedContent: ResolvedSavedContent | null = null,
  poolEntryMetadata: Record<string, any> | null = null
): Promise<{ id: string }> {
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
    // Get the next hook index from pool entry metadata (sequential rotation)
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
      user_id: autopilot.created_by,
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
        triggered_manually: true,
        // Hook rotation tracking
        ...(selectedMix.hook_rotation && hooks.length > 1 ? {
          hook_rotation: true,
          hook_index: hookIndex,
          total_hooks: hooks.length,
        } : {}),
        ...(hookSource !== 'rotation' ? { hook_source: hookSource } : {}),
        // Pass format configuration from content mix item; fallback to blueprint defaults for video pipeline
        video_config: selectedMix.video_config ?? (blueprint.pipeline === 'video' ? blueprint.model_config?.video_config_defaults : undefined),
        output_config: selectedMix.output_config,
        // Skip image generation for text-only output
        ...(selectedMix.skip_image_generation ? { skip_image_generation: true } : {}),
        // Saved content media (from library, matched by tags)
        saved_content: savedContent,
        // Presenter video config: merge idea metadata URL with content mix settings
        ...(blueprint.pipeline === 'presenter_video' ? (() => {
          const pc = selectedMix.presenter_config || {};
          // Idea metadata URL takes priority over content mix default URL
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
          attempt_count: 0, // Reset so it's picked up again
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
