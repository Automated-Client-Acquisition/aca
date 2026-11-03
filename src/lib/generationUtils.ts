import { ManualIdeaRow, GenerationItem, GenerationItemAiInsights, ImageUsageMode } from "@/types/generation";
import { PinnedLibraryElements } from "@/types/blueprint";
import { IdeaAiInsightsMap } from "@/types/wizard";
import type { PipelineId } from "@/types/pipeline";

// HeyGen pipelines that support multi-avatar profile explosion
const HEYGEN_PIPELINES: PipelineId[] = ['ugc_heygen', 'ugc_heygen_template'];

/**
 * Explodes generation items by creating cartesian product of all "separate" mode library selections
 * and AI insight variations (multiple hooks = multiple outputs)
 * @param ideaRows - Array of manual idea rows
 * @param pinnedLibraryElements - Pinned library element configuration with combination modes
 * @param libraryData - Actual library items keyed by table name (e.g., library_characters, library_content_angles)
 * @param ideaAiInsights - Optional map of idea IDs to their selected AI insights
 * @param ideaAiAnalysis - Optional map of idea IDs to their full AI analysis data
 * @param imageUsageMode - Optional image usage mode: 'auto' (default) or 'force_all' to include all selected images
 * @param pipeline - Optional pipeline ID, used for HeyGen avatar profile explosion
 * @returns Array of generation items representing all combinations
 */
export function explodeGenerationItems(
  ideaRows: ManualIdeaRow[],
  pinnedLibraryElements: PinnedLibraryElements,
  libraryData: Record<string, any[]>,
  ideaAiInsights?: IdeaAiInsightsMap,
  ideaAiAnalysis?: Record<string, any>,
  imageUsageMode?: ImageUsageMode,
  pipeline?: PipelineId
): GenerationItem[] {
  // Base: one item per idea, but explode by selected hooks if user chose variations
  let items: GenerationItem[] = [];

  for (const idea of ideaRows) {
    const insightsConfig = ideaAiInsights?.[idea.id];
    const aiAnalysis = ideaAiAnalysis?.[idea.id];

    // Parse AI analysis if it's a string
    const parsedAnalysis = typeof aiAnalysis === 'string'
      ? (() => { try { return JSON.parse(aiAnalysis); } catch { return undefined; } })()
      : aiAnalysis;

    // talking_points is the single source of truth inside ai_analysis
    const keyTalkingPoints = parsedAnalysis?.talking_points;

    // Check if using talking point COMBINE mode (all selected points in one output)
    const useTalkingPointCombine = insightsConfig?.createTalkingPointVariations &&
      insightsConfig.selectedTalkingPointIndices?.length > 0 &&
      (insightsConfig.talkingPointMode === 'combine' || !insightsConfig.talkingPointMode) && // default to combine
      keyTalkingPoints?.length > 0;

    // Check if using hook COMBINE mode (all selected hooks in one output)
    const useHookCombine = insightsConfig?.createVariations &&
      insightsConfig.selectedHookIndices.length > 0 &&
      (insightsConfig.hookMode === 'combine' || !insightsConfig.hookMode) && // default to combine
      parsedAnalysis?.hooks?.length > 0;

    // Check if using CTA COMBINE mode (all selected CTAs in one output)
    const useCtaCombine = insightsConfig?.includeCta &&
      (insightsConfig.selectedCtaIndices?.length || 0) > 0 &&
      (insightsConfig.ctaMode === 'combine' || !insightsConfig.ctaMode) && // default to combine
      parsedAnalysis?.ctas?.length > 0;

    // Build common insight settings (CTA selection, toggles)
    // IMPORTANT: Only include AI insights if the user explicitly configured them
    const buildInsights = (hookIndex?: number, talkingPointIndex?: number): GenerationItemAiInsights | undefined => {
      // If no AI analysis data exists, return nothing
      if (!parsedAnalysis) return undefined;

      // If user didn't configure any AI insights (insightsConfig is undefined/null),
      // don't include ANY AI insights - just use the idea content directly
      if (!insightsConfig) return undefined;

      const insights: GenerationItemAiInsights = {};

      // Handle hooks based on mode
      if (useHookCombine) {
        // COMBINE mode: add ALL selected hooks to single output
        const selectedHooks = insightsConfig.selectedHookIndices
          .filter(idx => idx < (parsedAnalysis.hooks?.length || 0))
          .map(idx => {
            const hook = parsedAnalysis.hooks[idx];
            return { text: hook.text, type: hook.type, index: idx };
          });
        if (selectedHooks.length > 0) {
          insights.hooks = selectedHooks;
          // Also set single hook for backwards compatibility (first selected hook)
          insights.hook = selectedHooks[0];
        }
      } else if (hookIndex !== undefined && parsedAnalysis.hooks?.[hookIndex]) {
        // SEPARATE mode: add single hook for this variation
        const hook = parsedAnalysis.hooks[hookIndex];
        insights.hook = { text: hook.text, type: hook.type, index: hookIndex };
      }

      // Add single talking point if provided (for talking point variations in SEPARATE mode)
      const allTalkingPoints = parsedAnalysis.talking_points || [];
      if (talkingPointIndex !== undefined && allTalkingPoints[talkingPointIndex]) {
        insights.talking_point = { text: allTalkingPoints[talkingPointIndex], index: talkingPointIndex };
      }

      // Add combined talking points (for COMBINE mode - selected points only)
      if (useTalkingPointCombine && insightsConfig?.selectedTalkingPointIndices) {
        const selectedPoints = insightsConfig.selectedTalkingPointIndices
          .filter(idx => idx < allTalkingPoints.length)
          .map(idx => allTalkingPoints[idx]);
        if (selectedPoints.length > 0) {
          insights.talking_points = selectedPoints;
        }
      }

      // Handle CTAs based on mode
      if (useCtaCombine && insightsConfig.selectedCtaIndices) {
        // COMBINE mode: add ALL selected CTAs to single output
        const selectedCtas = insightsConfig.selectedCtaIndices
          .filter(idx => idx < (parsedAnalysis.ctas?.length || 0))
          .map(idx => {
            const cta = parsedAnalysis.ctas[idx];
            return {
              text: cta.text,
              placement: cta.placement,
              type: cta.type || cta.cta_type,
              index: idx
            };
          });
        if (selectedCtas.length > 0) {
          insights.ctas = selectedCtas;
          // Also set single CTA for backwards compatibility (first selected CTA)
          insights.cta = {
            text: selectedCtas[0].text,
            placement: selectedCtas[0].placement,
            type: selectedCtas[0].type
          };
        }
      } else if (insightsConfig.includeCta === true) {
        // SEPARATE mode or single CTA: use selectedCtaIndex (legacy) or first from selectedCtaIndices
        const ctaIndex = insightsConfig.selectedCtaIndices?.[0] ?? insightsConfig.selectedCtaIndex ?? 0;
        if (parsedAnalysis.ctas?.[ctaIndex]) {
          const cta = parsedAnalysis.ctas[ctaIndex];
          insights.cta = { text: cta.text, placement: cta.placement, type: cta.type || cta.cta_type };
        }
      }

      // Add talking points (only if explicitly enabled AND not using talking point variations)
      if (insightsConfig.includeTalkingPoints === true && !insightsConfig.createTalkingPointVariations) {
        if (allTalkingPoints.length > 0) {
          insights.talking_points = allTalkingPoints;
        }
      }

      // Add script structure (only if explicitly enabled)
      if (insightsConfig.includeScriptStructure === true && parsedAnalysis.script_structure) {
        insights.script_structure = parsedAnalysis.script_structure;
      }

      // Add engagement drivers (only if explicitly enabled)
      if (insightsConfig.includeEngagementDrivers === true && parsedAnalysis.engagement_drivers?.length) {
        insights.engagement_drivers = parsedAnalysis.engagement_drivers;
      }

      // Only return if we have any insights
      return Object.keys(insights).length > 0 ? insights : undefined;
    };

    // Determine variation dimensions for SEPARATE mode only
    // In COMBINE mode, we don't create multiple variations - all selected items go into one output
    const useHookSeparateVariations = insightsConfig?.createVariations &&
      insightsConfig.selectedHookIndices.length > 0 &&
      insightsConfig.hookMode === 'separate' &&
      parsedAnalysis?.hooks?.length > 0;

    // Check if using talking point variations in SEPARATE mode (creates multiple outputs)
    const useTalkingPointVariations = insightsConfig?.createTalkingPointVariations &&
      insightsConfig.selectedTalkingPointIndices?.length > 0 &&
      insightsConfig.talkingPointMode === 'separate' &&
      keyTalkingPoints?.length > 0;

    // Build variation indices arrays (default to single undefined for no variation)
    // Only use separate indices when in SEPARATE mode
    const hookIndices: (number | undefined)[] = useHookSeparateVariations
      ? insightsConfig!.selectedHookIndices
      : [undefined];

    // In separate mode, each talking point creates a variation; in combine mode, we use undefined (single output)
    const talkingPointIndices: (number | undefined)[] = useTalkingPointVariations
      ? insightsConfig!.selectedTalkingPointIndices!
      : [undefined];

    // Generate cartesian product of all variation dimensions
    for (const hookIndex of hookIndices) {
      for (const talkingPointIndex of talkingPointIndices) {
        // Build title suffix based on active variations
        const titleParts: string[] = [];
        if (hookIndex !== undefined) {
          titleParts.push(`Hook ${hookIndex + 1}`);
        }
        if (talkingPointIndex !== undefined) {
          titleParts.push(`TP ${talkingPointIndex + 1}`);
        }
        const titleSuffix = titleParts.length > 0 ? ` [${titleParts.join(' / ')}]` : '';

        items.push({
          idea_id: idea.id,
          idea_title: `${idea.context.substring(0, 80) || 'Video'}${titleSuffix}`,
          slot_values: {
            idea: idea.context,
            context: idea.context,
            title: idea.context,
            description: idea.context,
            topic: idea.context,
            // Free text from idea (resolvable as {{idea_text}})
            ...(idea.freeText ? { idea_text: idea.freeText } : {}),
            // Source URLs from idea (resolvable as {{idea_urls}})
            ...(idea.sourceUrls ? { idea_urls: idea.sourceUrls } : {}),
            // video_remix: pass uploaded video URL from idea
            ...(idea.uploadedVideoUrl ? { uploaded_video_url: idea.uploadedVideoUrl } : {}),
            // presenter_video: pass per-idea source data
            ...(idea.sourceType ? { source_type: idea.sourceType } : {}),
            ...(idea.sourceUrl ? { source_url: idea.sourceUrl } : {}),
          },
          library_elements: {},
          image_inputs: {},
          selected_ai_insights: buildInsights(hookIndex, talkingPointIndex),
          // Include raw AI data for backend variable resolution
          idea_ai_analysis: parsedAnalysis,
          // Pass through image usage mode if specified
          image_usage_mode: imageUsageMode,
        });
      }
    }
  }

  // For each library type - handle element combination mode
  for (const [libraryTable, config] of Object.entries(pinnedLibraryElements)) {
    const elementIds = Object.keys(config.elements);
    if (elementIds.length === 0) continue;

    const mode = config.combination_mode;
    const elements = libraryData[libraryTable] || [];

    if (mode === 'combine') {
      // Add all elements to each existing item (merge data)
      items = items.map(item => {
        const selectedElements = elementIds
          .map(id => elements.find(el => el.id === id))
          .filter(Boolean);

        // Collect all selected images from all elements
        const allSelectedImages: string[] = [];
        for (const elementId of elementIds) {
          const selectedImages = config.elements[elementId]?.selected_images || [];
          allSelectedImages.push(...selectedImages);
        }

        const newItem = {
          ...item,
          library_elements: {
            ...item.library_elements,
            [libraryTable]: selectedElements
          }
        };

        // Store images temporarily - will be processed in image explosion phase
        if (allSelectedImages.length > 0) {
          newItem.image_inputs = {
            ...newItem.image_inputs,
            [libraryTable]: allSelectedImages
          };
        }

        return newItem;
      });
    } else {
      // Separate mode: multiply items (cartesian product) by elements
      const newItems: GenerationItem[] = [];

      for (const existingItem of items) {
        for (const elementId of elementIds) {
          const element = elements.find(el => el.id === elementId);
          if (!element) continue;

          // Extract selected images for this element
          const selectedImages = config.elements[elementId].selected_images || [];

          const newItem: GenerationItem = {
            ...existingItem,
            library_elements: {
              ...existingItem.library_elements,
              [libraryTable]: element
            },
            image_inputs: {
              ...existingItem.image_inputs
            }
          };

          // Store images for this element
          if (selectedImages.length > 0) {
            newItem.image_inputs![libraryTable] = selectedImages;
          }

          // Generate descriptive title
          newItem.idea_title = generateItemTitle(
            existingItem.idea_title,
            newItem.library_elements!
          );

          newItems.push(newItem);
        }
      }

      items = newItems;
    }
  }

  // Second pass: Handle per-element image combination mode
  // Each element can have its own image_combination_mode setting
  for (const [libraryTable, config] of Object.entries(pinnedLibraryElements)) {
    const elementIds = Object.keys(config.elements);

    // Collect all elements that have 'separate' image mode with multiple images
    const separateImageElements: { elementId: string; images: string[] }[] = [];

    for (const elementId of elementIds) {
      const elementConfig = config.elements[elementId];
      const imageMode = elementConfig?.image_combination_mode || 'combine';
      const selectedImages = elementConfig?.selected_images || [];

      if (imageMode === 'separate' && selectedImages.length > 1) {
        separateImageElements.push({ elementId, images: selectedImages });
      }
    }

    // If no elements have separate mode, skip this library
    if (separateImageElements.length === 0) continue;

    // Explode items for each separate-mode element's images
    for (const { images } of separateImageElements) {
      const newItems: GenerationItem[] = [];

      for (const existingItem of items) {
        // Check if this item has images from this element
        // We need to match based on whether the item's image_inputs contains these images
        const itemImages = existingItem.image_inputs?.[libraryTable] || [];

        // Check if any of this element's images are in the item's image list
        const hasElementImages = images.some(img => itemImages.includes(img));

        if (!hasElementImages || itemImages.length <= 1) {
          // No explosion needed - keep as is
          newItems.push(existingItem);
        } else {
          // Find which of this element's images are in the item
          const elementImagesInItem = images.filter(img => itemImages.includes(img));
          // Also keep other images not from this element
          const otherImages = itemImages.filter(img => !images.includes(img));

          if (elementImagesInItem.length <= 1) {
            newItems.push(existingItem);
          } else {
            // Create one item per image from this element
            for (let imgIdx = 0; imgIdx < elementImagesInItem.length; imgIdx++) {
              const singleImage = elementImagesInItem[imgIdx];
              const newItem: GenerationItem = {
                ...existingItem,
                image_inputs: {
                  ...existingItem.image_inputs,
                  [libraryTable]: [...otherImages, singleImage] // Keep other images + single from this element
                },
                // Add image indicator to title
                idea_title: `${existingItem.idea_title} [Img ${imgIdx + 1}]`
              };
              newItems.push(newItem);
            }
          }
        }
      }

      items = newItems;
    }
  }

  // Final pass: HeyGen avatar profile explosion
  // For HeyGen pipelines, if a character has multiple avatar profiles, create one item per profile
  // Respects selected_heygen_profiles from pinnedLibraryElements if set
  if (pipeline && HEYGEN_PIPELINES.includes(pipeline)) {
    const newItems: GenerationItem[] = [];
    const characterConfig = pinnedLibraryElements['library_characters'];

    for (const item of items) {
      const character = item.library_elements?.library_characters;
      const avatarProfiles = character?.heygen_avatars;

      if (character && Array.isArray(avatarProfiles) && avatarProfiles.length > 0) {
        // Filter profiles based on user selection (if any)
        const selectedProfileIds = characterConfig?.elements?.[character.id]?.selected_heygen_profiles;
        const filteredProfiles = selectedProfileIds
          ? avatarProfiles.filter((p: any) => selectedProfileIds.includes(p.id || p.avatar_id))
          : avatarProfiles;

        // Use filtered profiles (fall back to all if filter resulted in empty)
        const profilesToUse = filteredProfiles.length > 0 ? filteredProfiles : avatarProfiles;

        if (profilesToUse.length > 1) {
          // Multiple profiles: create one item per profile
          for (const profile of profilesToUse) {
            const charClone = {
              ...character,
              heygen_avatar_id: profile.avatar_id,
              heygen_voice_id: profile.voice_id,
              _heygen_profile_id: profile.id,
              _heygen_profile_name: profile.name,
            };
            const newItem: GenerationItem = {
              ...item,
              library_elements: {
                ...item.library_elements,
                library_characters: charClone,
              },
              idea_title: `${item.idea_title} [${profile.name}]`,
            };
            newItems.push(newItem);
          }
        } else {
          // Single profile: just set the avatar/voice IDs from the profile
          const profile = profilesToUse[0];
          const charClone = {
            ...character,
            heygen_avatar_id: profile.avatar_id,
            heygen_voice_id: profile.voice_id,
            _heygen_profile_id: profile.id,
            _heygen_profile_name: profile.name,
          };
          newItems.push({
            ...item,
            library_elements: {
              ...item.library_elements,
              library_characters: charClone,
            },
          });
        }
      } else {
        // No profiles / no character: pass through
        newItems.push(item);
      }
    }

    items = newItems;
  }

  return items;
}

/**
 * Generates a descriptive title for a generation item based on library elements
 * @param ideaTitle - Base idea title
 * @param libraryElements - Selected library elements
 * @returns Formatted title string
 */
export function generateItemTitle(
  ideaTitle: string,
  libraryElements: Record<string, any>
): string {
  const parts = [ideaTitle.substring(0, 50)];

  // Add character name if present
  if (libraryElements.library_characters?.name) {
    parts.push(`as ${libraryElements.library_characters.name}`);
  }

  // Add ICP name if present
  if (libraryElements.library_icps?.name) {
    parts.push(`for ${libraryElements.library_icps.name}`);
  }

  // Add brand if present
  if (libraryElements.library_brand_voices?.name) {
    parts.push(`[${libraryElements.library_brand_voices.name}]`);
  }

  // Add product if present
  if (libraryElements.library_products?.name) {
    parts.push(`- ${libraryElements.library_products.name}`);
  }

  // Add block if present
  if (libraryElements.library_blocks?.name) {
    parts.push(`(${libraryElements.library_blocks.name})`);
  }

  return parts.join(' ');
}
