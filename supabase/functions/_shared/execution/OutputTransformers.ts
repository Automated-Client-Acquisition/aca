
import { ExecutionContext } from './types.ts';
import { OpenRouterProvider } from '../providers/OpenRouterProvider.ts';

// Camera move constants used by parseScenesWithCamera
const VALID_CAMERA_MOVES = new Set([
    'ken_burns_slow',
    'punch_zoom',
    'pan_left',
    'pan_right',
    'pan_down',
    'zoom_out_reveal',
    'shake',
    'hold',
]);

const DEFAULT_CAMERA_MOVES: string[] = [
    'ken_burns_slow',
    'pan_right',
    'punch_zoom',
    'pan_left',
    'zoom_out_reveal',
    'ken_burns_slow',
    'pan_down',
    'shake',
];

/**
 * Attempt to salvage individual shot objects from truncated JSON.
 *
 * When the LLM output is cut off mid-JSON (due to maxTokens), the outer
 * object is invalid but individual shot objects within the "shots" array
 * may be complete. This function extracts them one by one.
 */
function salvageTruncatedShots(text: string): any[] {
    if (!text) return [];

    // Find the start of the shots array
    const shotsStart = text.indexOf('"shots"');
    if (shotsStart === -1) return [];

    const arrayStart = text.indexOf('[', shotsStart);
    if (arrayStart === -1) return [];

    const arrayContent = text.slice(arrayStart + 1);

    // Extract individual shot objects by matching balanced braces
    const shots: any[] = [];
    let depth = 0;
    let objectStart = -1;

    for (let i = 0; i < arrayContent.length; i++) {
        const ch = arrayContent[i];

        // Skip string contents to avoid false brace matches
        if (ch === '"') {
            i++;
            while (i < arrayContent.length) {
                if (arrayContent[i] === '\\') { i++; } // skip escaped char
                else if (arrayContent[i] === '"') break;
                i++;
            }
            continue;
        }

        if (ch === '{') {
            if (depth === 0) objectStart = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && objectStart !== -1) {
                const objectStr = arrayContent.slice(objectStart, i + 1);
                try {
                    const shot = JSON.parse(objectStr);
                    // Basic validation: a shot must have duration or narration
                    if (shot.duration || shot.narration || shot.layout) {
                        shots.push(shot);
                    }
                } catch {
                    // This individual object was malformed, skip it
                }
                objectStart = -1;
            }
        }
    }

    return shots;
}

/**
 * Output transformation functions registry.
 */
export const OUTPUT_TRANSFORMS: Record<string, (raw: any, context?: ExecutionContext) => any> = {
    /**
     * Parse carousel content JSON from LLM response.
     * Supports both direct array (legacy) and object with metadata (new).
     */
    parseCarouselContent: (raw: any) => {
        const text = typeof raw === 'string' ? raw : raw.content || raw.text;

        try {
            const parsed = OpenRouterProvider.parseJsonResponse(text);

            // Handle legacy array format
            if (Array.isArray(parsed)) {
                return {
                    slides: parsed,
                    visual_story_summary: '', // No summary in legacy format
                    raw_text: text,
                };
            }

            // Handle new object format
            return {
                slides: Array.isArray(parsed.slides) ? parsed.slides : [],
                visual_story_summary: parsed.visual_story_summary || '',
                raw_text: text,
            };
        } catch (error) {
            console.error('[parseCarouselContent] Failed to parse JSON:', error);
            return {
                slides: [],
                visual_story_summary: '',
                raw_text: text,
                parse_error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },

    /**
     * Parse script content JSON from LLM response.
     * Supports both direct array (legacy) and object with metadata (new).
     */
    parseScriptContent: (raw: any) => {
        const text = typeof raw === 'string' ? raw : raw.content || raw.text;

        try {
            const parsed = OpenRouterProvider.parseJsonResponse(text);

            // Handle legacy array format
            if (Array.isArray(parsed)) {
                return {
                    scenes: parsed,
                    visual_story_summary: '', // No summary in legacy format
                    raw_text: text,
                };
            }

            // Handle new object format
            return {
                scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
                visual_story_summary: parsed.visual_story_summary || '',
                raw_text: text,
            };
        } catch (error) {
            console.error('[parseScriptContent] Failed to parse JSON:', error);
            return {
                scenes: [],
                visual_story_summary: '',
                raw_text: text,
                parse_error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },

    /**
     * Parse blog article outline JSON from LLM response.
     */
    parseOutlineContent: (raw: any) => {
        const text = typeof raw === 'string' ? raw : raw.content || raw.text;

        try {
            const outline = OpenRouterProvider.parseJsonResponse(text);
            const sections = Array.isArray(outline.sections) ? outline.sections : [];

            if (sections.length === 0) {
                throw new Error('Outline JSON parsed but contains no sections');
            }

            return {
                title: outline.title || '',
                hook: outline.hook || '',
                total_duration_seconds: outline.total_duration_seconds || 0,
                meta_description: outline.meta_description || '',
                sections,
                raw_text: text,
            };
        } catch (error) {
            console.error('[parseOutlineContent] Failed to parse structured outline:', error);
            // Throw instead of returning empty — outline with 0 sections is unusable
            // and will cause downstream stages (voiceover, scenes) to produce bad output
            throw new Error(
                `Outline stage failed to produce structured JSON with sections. ` +
                `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
                `Raw text (first 200 chars): ${(text || '').substring(0, 200)}`
            );
        }
    },

    /**
     * Parse director output JSON from the presenter_video director stage.
     *
     * The director LLM returns a JSON object with a "shots" array containing
     * the full shot list for the video, plus total_duration, full_script, etc.
     *
     * Handles:
     * 1. Complete JSON — parsed directly
     * 2. Truncated JSON — attempts to salvage partial shots from incomplete output
     * 3. Full script absent — concatenated from shot narrations (fallback)
     */
    parseDirectorOutput: (raw: any, _context?: ExecutionContext) => {
        const text = typeof raw === 'string' ? raw : raw.content || raw.text;

        try {
            const parsed = OpenRouterProvider.parseJsonResponse(text);

            const shots = Array.isArray(parsed.shots) ? parsed.shots : [];

            // If we parsed something but got zero shots, the JSON may have been
            // truncated and the regex matched an inner object. Try salvage.
            if (shots.length === 0 && text && text.includes('"shots"')) {
                const salvaged = salvageTruncatedShots(text);
                if (salvaged.length > 0) {
                    console.warn(`[parseDirectorOutput] Primary parse returned 0 shots but salvaged ${salvaged.length} from truncated JSON`);
                    const fullScript = salvaged.map((s: any) => s.narration || '').filter(Boolean).join(' ');
                    const totalDuration = salvaged.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);
                    return {
                        shots: salvaged,
                        total_duration: totalDuration,
                        full_script: fullScript,
                        shot_count: salvaged.length,
                        template_type: parsed.template_type || '',
                        raw_text: text,
                        truncated: true,
                    };
                }
            }

            // Concatenate narration from all shots into full_script if not present
            const fullScript: string =
                parsed.full_script ||
                shots.map((s: any) => s.narration || '').filter(Boolean).join(' ');

            // Calculate total_duration from shots if not present
            const totalDuration: number =
                parsed.total_duration ||
                shots.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);

            return {
                shots,
                total_duration: totalDuration,
                full_script: fullScript,
                shot_count: shots.length,
                template_type: parsed.template_type || '',
                raw_text: text,
            };
        } catch (error) {
            // Primary parse failed entirely — try salvaging partial shots
            const salvaged = salvageTruncatedShots(text);
            if (salvaged.length > 0) {
                console.warn(`[parseDirectorOutput] Parse failed but salvaged ${salvaged.length} shots from truncated JSON`);
                const fullScript = salvaged.map((s: any) => s.narration || '').filter(Boolean).join(' ');
                const totalDuration = salvaged.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);
                return {
                    shots: salvaged,
                    total_duration: totalDuration,
                    full_script: fullScript,
                    shot_count: salvaged.length,
                    template_type: '',
                    raw_text: text,
                    truncated: true,
                };
            }

            console.error('[parseDirectorOutput] Failed to parse JSON:', error);
            return {
                shots: [],
                total_duration: 0,
                full_script: '',
                shot_count: 0,
                template_type: '',
                raw_text: text,
                parse_error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },

    /**
     * Parse remix director output — edit segments with time ranges.
     *
     * Unlike parseDirectorOutput which expects shots with screenshot_index,
     * this expects segments with source_start/source_end time ranges.
     */
    parseRemixDirectorOutput: (raw: any, _context?: ExecutionContext) => {
        const text = typeof raw === 'string' ? raw : raw.content || raw.text;

        function salvageTruncatedSegments(jsonText: string): any[] {
            if (!jsonText) return [];
            const segStart = jsonText.indexOf('"segments"');
            if (segStart === -1) return [];
            const arrStart = jsonText.indexOf('[', segStart);
            if (arrStart === -1) return [];
            const arrContent = jsonText.slice(arrStart + 1);
            const result: any[] = [];
            let depth = 0;
            let objStart = -1;
            for (let i = 0; i < arrContent.length; i++) {
                const ch = arrContent[i];
                if (ch === '"') {
                    i++;
                    while (i < arrContent.length) {
                        if (arrContent[i] === '\\') { i++; }
                        else if (arrContent[i] === '"') break;
                        i++;
                    }
                    continue;
                }
                if (ch === '{') {
                    if (depth === 0) objStart = i;
                    depth++;
                } else if (ch === '}') {
                    depth--;
                    if (depth === 0 && objStart !== -1) {
                        try {
                            const seg = JSON.parse(arrContent.slice(objStart, i + 1));
                            if (seg.type && seg.narration !== undefined) result.push(seg);
                        } catch { /* skip */ }
                        objStart = -1;
                    }
                }
            }
            return result;
        }

        function normalize(seg: any, idx: number): any {
            const t = seg.type || 'video';
            const speed = Math.max(0.5, Math.min(2.0, seg.speed || 1.0));
            return {
                id: seg.id || `seg_${String(idx + 1).padStart(3, '0')}`,
                type: t,
                source_start: seg.source_start || 0,
                source_end: seg.source_end || 0,
                speed,
                transition_in: seg.transition_in || 'cut_hard',
                narration: seg.narration || '',
                caption_emphasis: Array.isArray(seg.caption_emphasis) ? seg.caption_emphasis : [],
                caption_style: seg.caption_style || null,
                text_overlay: seg.text_overlay || null,
                text_style: seg.text_style || null,
                sound_effect: seg.sound_effect || null,
                card_text: seg.card_text || null,
                card_subtitle: seg.card_subtitle || null,
                b_roll_keywords: Array.isArray(seg.b_roll_keywords) ? seg.b_roll_keywords : null,
                duration: t === 'video'
                    ? ((seg.source_end || 0) - (seg.source_start || 0)) / speed
                    : (seg.duration || 3),
            };
        }

        function build(segments: any[], tmpl: string, truncated: boolean) {
            const normed = segments.map(normalize);
            return {
                segments: normed,
                // Alias as `shots` so the frontend UI (which reads director.shots) works
                // for both presenter_video and video_remix pipelines
                shots: normed,
                total_duration: normed.reduce((s: number, seg: any) => s + (seg.duration || 0), 0),
                full_script: normed.map((s: any) => s.narration).filter(Boolean).join(' '),
                segment_count: normed.length,
                shot_count: normed.length,
                template_type: tmpl,
                raw_text: text,
                ...(truncated ? { truncated: true } : {}),
            };
        }

        try {
            const parsed = OpenRouterProvider.parseJsonResponse(text);
            const segments = Array.isArray(parsed.segments) ? parsed.segments : [];

            if (segments.length === 0 && text?.includes('"segments"')) {
                const salvaged = salvageTruncatedSegments(text);
                if (salvaged.length > 0) {
                    console.warn(`[parseRemixDirectorOutput] Salvaged ${salvaged.length} segments from truncated JSON`);
                    return build(salvaged, parsed.template_type || '', true);
                }
            }

            return build(segments, parsed.template_type || '', false);
        } catch (error) {
            const salvaged = salvageTruncatedSegments(text);
            if (salvaged.length > 0) {
                console.warn(`[parseRemixDirectorOutput] Parse failed, salvaged ${salvaged.length} segments`);
                return build(salvaged, '', true);
            }
            console.error('[parseRemixDirectorOutput] Failed:', error);
            return {
                segments: [],
                shots: [],
                total_duration: 0,
                full_script: '',
                segment_count: 0,
                shot_count: 0,
                template_type: '',
                raw_text: text,
                parse_error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },

    /**
     * Parse unified director output — handles all source types (screenshots, video clips,
     * scene images, prompt-only) in a single normalized format.
     *
     * Normalizes shots to UnifiedShot schema:
     * - For video_clip shots: validates source_start < source_end
     * - For screenshot shots: validates screenshot_index presence
     * - For scene_image shots with ai_generated mode: validates image_prompt presence
     * - Concatenates full_script from shot narrations
     * - Returns { shots, total_duration, full_script, shot_count }
     */
    parseUnifiedDirectorOutput: (raw: any, _context?: ExecutionContext) => {
        const text = typeof raw === 'string' ? raw : raw.content || raw.text;

        function normalizeShot(shot: any, idx: number): any {
            const layout = shot.layout || 'text_card';

            // Validate video_clip shots
            if (layout === 'video_clip') {
                const sourceStart = shot.source_start ?? 0;
                const sourceEnd = shot.source_end ?? 0;
                if (sourceStart >= sourceEnd && sourceEnd > 0) {
                    console.warn(`[parseUnifiedDirectorOutput] Shot ${idx}: source_start (${sourceStart}) >= source_end (${sourceEnd}), swapping`);
                    shot.source_start = sourceEnd;
                    shot.source_end = sourceStart;
                }
                // Clamp speed
                shot.speed = Math.max(0.5, Math.min(2.0, shot.speed || 1.0));
            }

            // Validate screenshot_index for screenshot layouts
            if (layout === 'screenshot_fullscreen' && shot.screenshot_index == null) {
                console.warn(`[parseUnifiedDirectorOutput] Shot ${idx}: screenshot_fullscreen layout missing screenshot_index, defaulting to 0`);
                shot.screenshot_index = 0;
            }

            // Ensure all unified fields are present (with defaults)
            return {
                ...shot,
                layout,
                duration: shot.duration || 3,
                screenshot_index: shot.screenshot_index ?? null,
                screenshot_description: shot.screenshot_description || null,
                source_start: shot.source_start ?? null,
                source_end: shot.source_end ?? null,
                speed: shot.speed ?? null,
                scene_image_url: shot.scene_image_url || null,
                image_prompt: shot.image_prompt || null,
                camera: shot.camera || { move: 'hold' },
                narration: shot.narration || '',
                caption_emphasis: Array.isArray(shot.caption_emphasis) ? shot.caption_emphasis : [],
                caption_style: shot.caption_style || null,
                highlight: shot.highlight || null,
                text_overlay: shot.text_overlay || null,
                text_style: shot.text_style || null,
                transition_in: shot.transition_in || 'cut_hard',
                sound_effect: shot.sound_effect || null,
                text_animation: shot.text_animation || null,
                background: shot.background || null,
                overlay_config: shot.overlay_config || null,
                b_roll_keywords: Array.isArray(shot.b_roll_keywords) ? shot.b_roll_keywords : null,
            };
        }

        function build(shots: any[], tmpl: string, truncated: boolean) {
            const normalized = shots.map(normalizeShot);
            const fullScript = normalized.map((s: any) => s.narration).filter(Boolean).join(' ');
            const totalDuration = normalized.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);

            return {
                shots: normalized,
                total_duration: totalDuration,
                full_script: fullScript,
                shot_count: normalized.length,
                template_type: tmpl,
                raw_text: text,
                ...(truncated ? { truncated: true } : {}),
            };
        }

        try {
            const parsed = OpenRouterProvider.parseJsonResponse(text);
            const shots = Array.isArray(parsed.shots) ? parsed.shots : [];

            // Try salvage if primary parse found 0 shots
            if (shots.length === 0 && text && text.includes('"shots"')) {
                const salvaged = salvageTruncatedShots(text);
                if (salvaged.length > 0) {
                    console.warn(`[parseUnifiedDirectorOutput] Primary parse returned 0 shots but salvaged ${salvaged.length} from truncated JSON`);
                    return build(salvaged, parsed.template_type || '', true);
                }
            }

            return build(shots, parsed.template_type || '', false);
        } catch (error) {
            const salvaged = salvageTruncatedShots(text);
            if (salvaged.length > 0) {
                console.warn(`[parseUnifiedDirectorOutput] Parse failed but salvaged ${salvaged.length} shots from truncated JSON`);
                return build(salvaged, '', true);
            }
            console.error('[parseUnifiedDirectorOutput] Failed to parse JSON:', error);
            return {
                shots: [],
                total_duration: 0,
                full_script: '',
                shot_count: 0,
                template_type: '',
                raw_text: text,
                parse_error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },

    /**
     * Parse scenes output from the storyboard_video_longform scenes stage.
     *
     * Extended from parseScriptContent to also extract the camera_move field per
     * scene, which is used by the Remotion renderer to animate storyboard images
     * with ken burns, zoom, pan, etc.
     *
     * Assigns a default camera move (cycling through DEFAULT_CAMERA_MOVES) when
     * a scene's camera_move is missing or contains an unrecognised value.
     */
    parseScenesWithCamera: (raw: any) => {
        const text = typeof raw === 'string' ? raw : raw.content || raw.text;

        try {
            const parsed = OpenRouterProvider.parseJsonResponse(text);

            // Handle legacy array format (no camera_move field)
            if (Array.isArray(parsed)) {
                return {
                    scenes: parsed.map((scene: any, i: number) => ({
                        ...scene,
                        camera_move: VALID_CAMERA_MOVES.has(scene.camera_move)
                            ? scene.camera_move
                            : DEFAULT_CAMERA_MOVES[i % DEFAULT_CAMERA_MOVES.length],
                    })),
                    visual_story_summary: '',
                    raw_text: text,
                };
            }

            // Handle new object format with visual_story_summary
            const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
            return {
                scenes: scenes.map((scene: any, i: number) => ({
                    ...scene,
                    camera_move: VALID_CAMERA_MOVES.has(scene.camera_move)
                        ? scene.camera_move
                        : DEFAULT_CAMERA_MOVES[i % DEFAULT_CAMERA_MOVES.length],
                })),
                visual_story_summary: parsed.visual_story_summary || '',
                raw_text: text,
            };
        } catch (error) {
            console.error('[parseScenesWithCamera] Failed to parse JSON:', error);
            return {
                scenes: [],
                visual_story_summary: '',
                raw_text: text,
                parse_error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },
};
