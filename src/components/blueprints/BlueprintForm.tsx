import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PromptEditor } from "@/components/PromptEditor";
import { ModelSelector } from "@/components/ModelSelector";
import { PipelineSelector } from "@/components/blueprints/PipelineSelector";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ColorPicker } from "@/components/ui/color-picker";
import { CAROUSEL_TEMPLATES, DEFAULT_CAROUSEL_TEMPLATE, resolveCarouselTemplateId, type CarouselTemplatePreview } from "@/data/carouselTemplates";
import { CAPTION_STYLE_TEMPLATES } from "@/data/captionStyleTemplates";
import { Loader2, ImageIcon, Package, Users, Palette, Target, Blocks, Info, Lightbulb, ChevronDown, Copy, LayoutGrid, Subtitles, Check, Upload, Trash2, Eye, Video, Film, Variable } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { parseAllPromptSlots } from "@/lib/blueprintUtils";
import { useLibraryStepData } from "@/hooks/useLibraryStepData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import type { BlueprintModelConfig, CreateBlueprintInput, LibraryElementType } from "@/types/blueprint";
import { PIPELINES, MODEL_TYPE_LABELS } from "@/types/pipeline";
import type { PipelineId, ModelType } from "@/types/pipeline";
import { useHeyGenTemplates } from "@/hooks/useHeyGenTemplates";

// Pipelines that require reference images for consistent visual output
const PIPELINES_REQUIRING_REFERENCE_IMAGES = [
  'storyboard_video_longform',
];

// Pipeline-specific prompt guidance — tips, example structure, and key variables
const PIPELINE_PROMPT_GUIDANCE: Partial<Record<PipelineId, {
  tips: string[];
  exampleStructure: string;
  keyVariables: string[];
}>> = {
  rich_article: {
    tips: [
      "Define the output structure explicitly (sections, headings, bullet points)",
      "Specify tone and length — e.g. '800-word professional blog post'",
      "Use {{ai_talking_points}} to inject data-driven content from analyzed ideas",
      "Include formatting instructions: markdown, HTML, or plain text",
    ],
    exampleStructure: `Write a {{length}} article about {{topic}} for {{platform}}.

Tone: {{brand.tone}}
Audience: {{icp.name}} — {{icp.description}}

STRUCTURE:
1. **Hook** — Open with a compelling question or stat
2. **Context** — Why this matters now
3. **Main Points** — Cover these: {{ai_talking_points}}
4. **Actionable Takeaways** — 3 specific things the reader can do
5. **CTA** — {{ai_cta}}

Style: {{brand.style_guidelines}}
Keep paragraphs short (2-3 sentences). Use subheadings for scannability.`,
    keyVariables: ["topic", "brand.tone", "brand.style_guidelines", "icp.name", "ai_talking_points", "ai_cta", "length", "platform"],
  },
  social_media_post: {
    tips: [
      "Write the hook first — it's what shows in the feed preview",
      "Specify the platform (LinkedIn, Instagram, X) for format-appropriate output",
      "Keep the master prompt focused on text; use the Image Prompt field for visual direction",
      "Include CTA guidance — what action should the reader take?",
    ],
    exampleStructure: `Write a {{platform}} post about {{topic}}.

{{ai_talking_points_list}}

STRUCTURE:
1. **HOOK** (First line — shows in feed preview)
   - Pattern interrupt or bold statement
   - Makes people click "see more"

2. **BODY** (3-5 short paragraphs)
   - One idea per paragraph
   - Include a specific story, example, or data point
   - Tone: {{brand.tone}}

3. **TAKEAWAY** — Clear lesson or insight

4. **CTA** — {{ai_cta}}

Keep under 200 words. Add 3-5 relevant hashtags at the end.`,
    keyVariables: ["topic", "platform", "brand.tone", "ai_talking_points_list", "ai_hook", "ai_cta"],
  },
  instagram_carousel: {
    tips: [
      "Focus on the narrative arc — what story do the slides tell?",
      "Control slide text formatting: say \"use bullet points\" or \"use short paragraphs\" or \"headlines only, no body text\"",
      "By default the AI mixes formats (paragraphs, bullets, headline-only) for variety",
      "The system auto-generates slide content from your prompt and renders branded slides",
    ],
    exampleStructure: `Create a {{content_type}} Instagram carousel about {{topic}}.

Target audience: {{icp.name}}
Brand tone: {{brand.tone}}

NARRATIVE ARC:
- Slide 1 (Cover): Hook — grab attention with a bold statement
- Slides 2-4: Deliver value progressively, each building on the last
- Key points to cover: {{ai_talking_points}}
- Final slide: Clear CTA — {{ai_cta}}

SLIDE TEXT FORMAT:
- Use short paragraphs for explanations and bullet points for actionable tips
- Keep text minimal — headlines max 8 words`,
    keyVariables: ["topic", "brand.tone", "brand.color_palette", "character.name", "character.visual_style", "icp.name", "ai_talking_points", "ai_cta"],
  },
  instagram_carousel_ai: {
    tips: [
      "Use the master prompt for the slide story arc and text content",
      "Use the Image Prompt field for deck-wide visual direction: composition, typography, palette, texture, and what must stay consistent",
      "The system generates an image_prompt for every slide from your visual direction",
      "Pick reference image libraries when product, character, or brand visuals need to stay recognizable",
    ],
    exampleStructure: `Create an AI-generated Instagram carousel about {{topic}}.

Target audience: {{icp.name}}
Brand tone: {{brand.tone}}

NARRATIVE ARC:
- Slide 1 (Cover): Pattern interrupt hook based on {{ai_hook}}
- Slides 2-4: Teach these points: {{ai_talking_points}}
- Final slide: Clear CTA — {{ai_cta}}

SLIDE TEXT FORMAT:
- Headlines max 8 words
- Body copy should be short, concrete, and easy to read inside the generated image`,
    keyVariables: ["topic", "brand.tone", "brand.color_palette", "character.visual_style", "product.name", "icp.name", "ai_hook", "ai_talking_points", "ai_cta"],
  },
  storyboard_video_longform: {
    tips: [
      "Define the narrative structure — opening hook, body, climax, closing",
      "Use {{scene_count}} and {{video_duration}} to control pacing automatically",
      "Reference images are required — they ensure visual continuity across all scenes",
      "The system generates scenes, images, motion clips, and voiceover from your prompt",
    ],
    exampleStructure: `Create a {{video_duration_minutes}}-minute video about {{topic}}.

Character: {{character.name}} — {{character.description}}
Tone: {{brand.tone}}

NARRATIVE STRUCTURE:
1. **Opening** (first 2 scenes): {{ai_hook}} — grab attention immediately
2. **Body** ({{scene_count}} scenes total): {{ai_talking_points}}
3. **Climax**: The key insight or transformation
4. **Closing**: {{ai_cta}}

VISUAL DIRECTION:
- Match the reference images for consistent style across all scenes
- Cinematic quality, professional lighting
- 9:16 vertical format

VOICEOVER:
- Conversational, not corporate
- Pace: measured, with pauses for emphasis`,
    keyVariables: ["topic", "video_duration_minutes", "scene_count", "character.name", "character.description", "brand.tone", "ai_hook", "ai_talking_points", "ai_cta"],
  },
  generative_video_oneshot: {
    tips: [
      "Describe the visual scene in detail — lighting, camera angle, motion",
      "Keep prompts concise but vivid — world simulators work best with clear imagery",
      "Specify aspect ratio and duration expectations",
      "Think cinematically: what would a film director describe to a VFX team?",
    ],
    exampleStructure: `Create a cinematic video about {{topic}}.

SCENE DESCRIPTION:
{{ai_talking_points}}

VISUAL STYLE:
- Camera: Slow dolly forward, shallow depth of field
- Lighting: Golden hour, warm tones
- Mood: {{brand.tone}}
- Quality: Photorealistic, 4K cinematic

MOTION:
- Gentle, purposeful movement
- Duration: 5-10 seconds per scene`,
    keyVariables: ["topic", "brand.tone", "ai_talking_points", "ai_hook", "style"],
  },
  video_script: {
    tips: [
      "Specify the script format — dialogue, narration, or mixed",
      "Include stage directions and visual notes for the production team",
      "Define character voices if using multiple speakers",
      "Use {{ai_script_structure}} for a pre-analyzed content structure",
    ],
    exampleStructure: `Write a video script about {{topic}} for {{platform}}.

Character: {{character.name}}
Speaking style: {{character.speaking_style}}
Tone: {{brand.tone}}

SCRIPT STRUCTURE:
{{ai_script_structure}}

FORMAT:
[SCENE 1 — Opening]
VISUAL: [Description of what's on screen]
NARRATION: [What the character says]
TEXT OVERLAY: [Any text shown on screen]

Key talking points to cover: {{ai_talking_points}}
CTA: {{ai_cta}}

Keep total script under 3 minutes when read aloud.`,
    keyVariables: ["topic", "platform", "character.name", "character.speaking_style", "brand.tone", "ai_script_structure", "ai_talking_points", "ai_cta"],
  },
  image_only: {
    tips: [
      "Be extremely specific about visual elements — colors, composition, lighting, style",
      "Include negative instructions: 'NO text, NO watermarks, NO blurry elements'",
      "Specify aspect ratio context: 'square format for Instagram' or 'vertical for Stories'",
      "Reference images strongly guide the output — select them in the library section above",
    ],
    exampleStructure: `{{topic}}

Style: Professional, clean, modern aesthetic
Colors: {{brand.color_palette}}
Composition: Centered subject, clean background
Lighting: Soft studio lighting, subtle shadows

{{character.name}}: {{character.visual_style}}
{{product.name}}: Prominently featured

Format: Square (1:1), high resolution
Quality: Photorealistic, magazine-quality

NO text overlays, NO watermarks, NO blurry elements.`,
    keyVariables: ["topic", "brand.color_palette", "character.name", "character.visual_style", "product.name", "product.description", "style"],
  },
  ugc_heygen: {
    tips: [
      "Write the script as natural speech — HeyGen's avatar will speak it directly",
      "HeyGen handles TTS internally, so voice selection happens on the character, not here",
      "Keep scripts under 5 minutes for best quality — shorter is better for social media",
      "The character must have a HeyGen avatar and voice configured in the Library",
    ],
    exampleStructure: `Write a {{video_duration_minutes}}-minute UGC-style script about {{topic}}.

Character: {{character.name}}
Speaking style: {{character.speaking_style}}
Tone: {{brand.tone}}

TARGET AUDIENCE: {{icp.name}} — {{icp.description}}

SCRIPT STRUCTURE:
1. **Hook** (first 3 seconds): {{ai_hook}} — grab attention immediately
2. **Problem** — What pain point does the audience have?
3. **Solution** — How does {{product.name}} solve it?
4. **Proof** — One specific result, stat, or story
5. **CTA** — {{ai_cta}}

STYLE NOTES:
- Conversational, like talking to a friend
- Short sentences, natural pauses
- No corporate jargon
- Under {{video_duration_minutes}} minutes when read aloud`,
    keyVariables: ["topic", "video_duration_minutes", "character.name", "character.speaking_style", "brand.tone", "icp.name", "product.name", "ai_hook", "ai_cta"],
  },
  ugc_heygen_template: {
    tips: [
      "The LLM generates variable values that fill into a pre-designed HeyGen template",
      "Keep variable values concise — they must fit the template's text slots",
      "Select the HeyGen template ID in the model configuration section",
      "Template variables are returned as JSON — the system parses them automatically",
    ],
    exampleStructure: `Generate template variables for a {{topic}} video.

Product: {{product.name}} — {{product.description}}
Tone: {{brand.tone}}
Audience: {{icp.name}}

Fill in these template variables:
- headline: A bold, attention-grabbing headline (max 8 words)
- subheadline: Supporting detail (max 15 words)
- cta_text: Call to action button text (max 5 words)
- body_text: Key benefit or feature (max 25 words)

Output as JSON with these exact keys.`,
    keyVariables: ["topic", "product.name", "product.description", "brand.tone", "icp.name", "ai_cta"],
  },
};

const blueprintSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  description: z.string().optional(),
  pipeline: z.string().min(1, "Pipeline is required"),
  master_prompt: z.string().optional(), // Optional for image_only pipeline
  image_prompt: z.string().optional(),
  director_prompt: z.string().optional(),
  skip_image_generation: z.boolean().optional(),
  structure: z.object({
    slots: z.array(z.any()),
  }),
  model_config: z.object({}).passthrough(),
  tags: z.array(z.string()).optional(),
  reference_image_libraries: z.array(z.string()).optional(),
}).refine((data) => {
  // For image_only pipeline, image_prompt is required
  if (IMAGE_ONLY_PIPELINES.includes(data.pipeline)) {
    return !!data.image_prompt && data.image_prompt.length > 0;
  }
  // For other pipelines, master_prompt is required
  return !!data.master_prompt && data.master_prompt.length > 0;
}, {
  message: "Prompt is required",
  path: ["master_prompt"], // Show error on master_prompt field by default
}).refine((data) => {
  // Validate that all required models for the selected pipeline are configured
  const selectedPipeline = PIPELINES.find(p => p.id === data.pipeline);
  if (!selectedPipeline) return true;

  const requiredModels = getRequiredModelsForForm(selectedPipeline.requiredModels, data.pipeline, data.skip_image_generation);
  const modelConfig = data.model_config as Record<string, { model_id?: string }>;

  // Check if all required models have a model_id selected
  return requiredModels.every(modelType => {
    const config = modelConfig[modelType];
    return config?.model_id && config.model_id.length > 0;
  });
}, {
  message: "Please select all required models for this pipeline",
  path: ["model_config"],
}).refine((data) => {
  // Reference images required for carousel and storyboard pipelines
  if (PIPELINES_REQUIRING_REFERENCE_IMAGES.includes(data.pipeline)) {
    return data.reference_image_libraries && data.reference_image_libraries.length > 0;
  }
  return true;
}, {
  message: "Reference images are required for this pipeline. Select at least one image library to anchor visual consistency.",
  path: ["reference_image_libraries"],
});

// social_media_post is the only pipeline where image generation is a skippable trailing
// stage rather than the point of the pipeline — matches the backend check in
// dispatch-generation-job (`pipeline === 'social_media_post'`).
const PIPELINES_WITH_SKIPPABLE_IMAGE_GENERATION = ['social_media_post'];

const getRequiredModelsForForm = (requiredModels: ModelType[] | undefined, pipeline: string, skipImageGeneration: boolean | undefined): ModelType[] => {
  const models = requiredModels || [];
  if (PIPELINES_WITH_SKIPPABLE_IMAGE_GENERATION.includes(pipeline) && skipImageGeneration) {
    return models.filter(m => m !== 'image_generator');
  }
  return models;
};

// Helper to get missing required models for display
const getMissingRequiredModels = (pipeline: string, modelConfig: Record<string, { model_id?: string }>, skipImageGeneration?: boolean): ModelType[] => {
  const selectedPipeline = PIPELINES.find(p => p.id === pipeline);
  if (!selectedPipeline) return [];

  const requiredModels = getRequiredModelsForForm(selectedPipeline.requiredModels, pipeline, skipImageGeneration);
  return requiredModels.filter(modelType => {
    const config = modelConfig[modelType];
    return !config?.model_id || config.model_id.length === 0;
  });
};

// Library types available for reference image selection (only libraries with images)
const REFERENCE_IMAGE_LIBRARY_OPTIONS: { value: LibraryElementType; label: string; description: string; icon: typeof Package }[] = [
  { value: 'library_products', label: 'Products', description: 'Product photos & packaging', icon: Package },
  { value: 'library_characters', label: 'People & Faces', description: 'Identity and facial likeness', icon: Users },
  { value: 'library_brand_voices', label: 'Brands', description: 'Brand visuals & logos', icon: Palette },
  { value: 'library_images', label: 'Style & Composition', description: 'Layout, pose, lighting, and mood', icon: ImageIcon },
  { value: 'library_icps', label: 'Target Audiences', description: 'Audience reference images', icon: Target },
  { value: 'library_blocks', label: 'Blocks', description: 'Reusable block images', icon: Blocks },
];

// One reference-image-library option card. Shows real thumbnails from the org's
// saved libraries of this type (when any exist) instead of a bare icon, so
// checking the box visibly shows what will actually be pulled in — no caption
// needed to explain it.
function ReferenceImageLibraryOption({
  option,
  isChecked,
  onToggle,
}: {
  option: (typeof REFERENCE_IMAGE_LIBRARY_OPTIONS)[number];
  isChecked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const Icon = option.icon;
  const { data: items } = useLibraryStepData(option.value);

  const previewImages = (items || [])
    .flatMap((item: any) => item.reference_images || item.images || item.logos || (item.logo ? [item.logo] : []))
    .slice(0, 3);

  return (
    <label
      htmlFor={option.value}
      className={`
        relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 cursor-pointer transition-all
        ${isChecked
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
        }
      `}
    >
      <Checkbox
        id={option.value}
        checked={isChecked}
        onCheckedChange={(checked) => onToggle(!!checked)}
        className="absolute top-2 right-2 h-5 w-5"
      />
      {previewImages.length > 0 ? (
        <div className="flex -space-x-3">
          {previewImages.map((url, i) => (
            <img
              key={i}
              src={url}
              alt=""
              className="h-9 w-9 rounded-lg object-cover border-2 border-background shadow-sm"
            />
          ))}
        </div>
      ) : (
        <div className={`rounded-lg p-2.5 ${isChecked ? 'bg-primary/10' : 'bg-muted'}`}>
          <Icon className={`h-6 w-6 ${isChecked ? 'text-primary' : 'text-muted-foreground'}`} />
        </div>
      )}
      <div className="text-center">
        <div className={`font-medium ${isChecked ? 'text-primary' : ''}`}>
          {option.label}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {option.description}
        </div>
      </div>
    </label>
  );
}

// Pipelines that include image generation stages
const PIPELINES_WITH_IMAGE_GENERATION = [
  'social_media_post',
  'rich_article',
  'instagram_carousel_ai',
  'storyboard_video_longform',
  'image_only',
  'video',
];

const CAROUSEL_PIPELINES: PipelineId[] = ['instagram_carousel', 'instagram_carousel_ai'];

// Pipelines that are image-only (no text generation stages)
const IMAGE_ONLY_PIPELINES = ['image_only'];

// Video pipelines that support burnt-in subtitles
const VIDEO_PIPELINES_WITH_SUBTITLES = [
  'ugc_video', 'storyboard_video_longform', 'ugc_heygen', 'ugc_heygen_template', 'generative_video_oneshot',
  'video',
];

// Video pipelines that support a custom director prompt for creative direction
const VIDEO_PIPELINES_WITH_DIRECTOR = ['presenter_video', 'video_remix', 'video'];

type VideoConfigDefaults = NonNullable<BlueprintModelConfig["video_config_defaults"]>;

type BlueprintFormModelConfig = Omit<BlueprintModelConfig, "video_config_defaults"> & {
  _templateCategory?: string;
  carousel_cta_text?: string;
  heygen_template_id?: string;
  video_config_defaults?: VideoConfigDefaults;
};

function DirectorPromptGuidance() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Lightbulb className="h-3.5 w-3.5" />
        <span>{open ? "Hide" : "Show"} available options reference</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <div className="rounded-md border bg-muted/50 p-3 text-xs space-y-3">
          <div>
            <p className="font-semibold text-foreground mb-1">Layouts</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
              <span><code className="text-[11px] bg-muted px-1 rounded">screenshot_fullscreen</code> — product showcase</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">avatar_pip</code> — avatar picture-in-picture</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">split_left</code> / <code className="text-[11px] bg-muted px-1 rounded">split_right</code> — side-by-side</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">avatar_fullscreen</code> — talking head only</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">text_card</code> — text on animated background</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">stat_card</code> — animated counter</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">quote_card</code> — styled quotation</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">list_reveal</code> — staggered bullet list</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">gradient_title</code> — big gradient title text</span>
            </div>
          </div>

          <div>
            <p className="font-semibold text-foreground mb-1">Camera Moves</p>
            <div className="flex flex-wrap gap-1.5 text-muted-foreground">
              {["ken_burns_slow", "punch_zoom", "pan_down", "pan_up", "pan_left", "pan_right", "zoom_out_reveal", "snap_to", "hold"].map(c => (
                <code key={c} className="text-[11px] bg-muted px-1.5 py-0.5 rounded">{c}</code>
              ))}
            </div>
          </div>

          <div>
            <p className="font-semibold text-foreground mb-1">Text Animations</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
              <span><code className="text-[11px] bg-muted px-1 rounded">spring_fade</code> — smooth fade+scale (default)</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">typewriter</code> — character-by-character typing</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">glitch</code> — scramble that resolves</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">wave</code> — sine wave motion</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">bounce</code> — bouncy entrance</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">gradient_sweep</code> — animated gradient on text</span>
            </div>
          </div>

          <div>
            <p className="font-semibold text-foreground mb-1">Backgrounds <span className="font-normal text-muted-foreground">(text-based layouts only)</span></p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
              <span><code className="text-[11px] bg-muted px-1 rounded">particles</code> — floating particles with parallax depth</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">mesh_gradient</code> — flowing gradient color field</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">gradient_orbs</code> — subtle animated gradient orb</span>
            </div>
            <p className="text-muted-foreground mt-0.5">Set <code className="text-[11px] bg-muted px-1 rounded">intensity</code> 0.3-0.7 to control strength.</p>
          </div>

          <div>
            <p className="font-semibold text-foreground mb-1">Overlays</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
              <span><code className="text-[11px] bg-muted px-1 rounded">vignette</code> — darkens edges, draws eye to center</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">grain</code> — subtle film grain texture</span>
              <span><code className="text-[11px] bg-muted px-1 rounded">letterbox</code> — cinematic top/bottom bars</span>
            </div>
            <p className="text-muted-foreground mt-0.5">Set <code className="text-[11px] bg-muted px-1 rounded">vignette_intensity</code> (0-1) and <code className="text-[11px] bg-muted px-1 rounded">grain_intensity</code> (0-1).</p>
          </div>

          <div>
            <p className="font-semibold text-foreground mb-1">Transitions</p>
            <div className="flex flex-wrap gap-1.5 text-muted-foreground">
              {["cut_hard", "slide_left", "snap_cut", "fade", "whoosh", "slam_zoom"].map(t => (
                <code key={t} className="text-[11px] bg-muted px-1.5 py-0.5 rounded">{t}</code>
              ))}
            </div>
          </div>

          <div>
            <p className="font-semibold text-foreground mb-1">Highlights & Sound Effects</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
              <span>Highlights: <code className="text-[11px] bg-muted px-1 rounded">red_circle</code>, <code className="text-[11px] bg-muted px-1 rounded">underline_draw</code>, <code className="text-[11px] bg-muted px-1 rounded">glow_pulse</code>, <code className="text-[11px] bg-muted px-1 rounded">fake_cursor_click</code></span>
              <span>Sounds: <code className="text-[11px] bg-muted px-1 rounded">whoosh</code>, <code className="text-[11px] bg-muted px-1 rounded">pop</code>, <code className="text-[11px] bg-muted px-1 rounded">click</code>, <code className="text-[11px] bg-muted px-1 rounded">ding</code></span>
            </div>
          </div>

          <div>
            <p className="font-semibold text-foreground mb-1">Caption Styles</p>
            <div className="flex flex-wrap gap-1.5 text-muted-foreground">
              {["tiktok_bounce", "big_center", "karaoke"].map(s => (
                <code key={s} className="text-[11px] bg-muted px-1.5 py-0.5 rounded">{s}</code>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface BlueprintFormProps {
  defaultValues?: Partial<CreateBlueprintInput>;
  onSubmit: (data: CreateBlueprintInput) => void;
  isSubmitting: boolean;
  submitLabel?: string;
}

export function BlueprintForm({ defaultValues, onSubmit, isSubmitting, submitLabel = "Create Blueprint" }: BlueprintFormProps) {
  const { currentOrganization } = useAuth();
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [bgUploading, setBgUploading] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<string | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const ctaInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<CreateBlueprintInput>({
    resolver: zodResolver(blueprintSchema),
    defaultValues: {
      name: "",
      description: "",
      pipeline: "rich_article",
      master_prompt: "",
      image_prompt: "",
      director_prompt: "",
      skip_image_generation: false,
      structure: { slots: [] },
      model_config: {},
      tags: [],
      reference_image_libraries: [],
      ...defaultValues,
    },
  });

  const currentPipeline = form.watch('pipeline') as PipelineId;
  const skipImageGeneration = form.watch('skip_image_generation');
  const generatesImages = PIPELINES_WITH_IMAGE_GENERATION.includes(currentPipeline)
    && !(PIPELINES_WITH_SKIPPABLE_IMAGE_GENERATION.includes(currentPipeline) && skipImageGeneration);
  const guidance = PIPELINE_PROMPT_GUIDANCE[currentPipeline];
  const requiresReferenceImages = PIPELINES_REQUIRING_REFERENCE_IMAGES.includes(currentPipeline);
  const { data: heygenTemplates, isLoading: heygenTemplatesLoading } = useHeyGenTemplates();

  // Auto-initialize carousel defaults for both rendered-template and AI-image carousels
  useEffect(() => {
    if (CAROUSEL_PIPELINES.includes(currentPipeline)) {
      const mc = form.getValues('model_config') as BlueprintFormModelConfig;
      if (!mc.carousel_slide_count || (currentPipeline === 'instagram_carousel' && !mc.carousel_template)) {
        form.setValue('model_config', {
          ...mc,
          ...(currentPipeline === 'instagram_carousel' ? { carousel_template: mc.carousel_template ?? DEFAULT_CAROUSEL_TEMPLATE } : {}),
          carousel_slide_count: mc.carousel_slide_count ?? 5,
        });
      }
    }
  }, [currentPipeline, form]);

  // Clear reference_image_libraries when the pipeline (or the skip-image toggle) means no images are generated
  useEffect(() => {
    if (!generatesImages) {
      const current = form.getValues('reference_image_libraries');
      if (current && current.length > 0) {
        form.setValue('reference_image_libraries', []);
      }
    }
  }, [generatesImages, form]);

  // Reset skip_image_generation when switching to a pipeline that doesn't support it
  useEffect(() => {
    if (!PIPELINES_WITH_SKIPPABLE_IMAGE_GENERATION.includes(currentPipeline) && form.getValues('skip_image_generation')) {
      form.setValue('skip_image_generation', false);
    }
  }, [currentPipeline, form]);

  const handleFormSubmit = (data: CreateBlueprintInput) => {
    // Automatically parse slots from all prompt templates
    const slots = parseAllPromptSlots(data.master_prompt, data.image_prompt, data.director_prompt);
    // Clear reference_image_libraries for pipelines/configs that don't generate images
    const stillGeneratesImages = PIPELINES_WITH_IMAGE_GENERATION.includes(data.pipeline)
      && !(PIPELINES_WITH_SKIPPABLE_IMAGE_GENERATION.includes(data.pipeline) && data.skip_image_generation);
    const refLibs = stillGeneratesImages
      ? data.reference_image_libraries
      : [];
    const dataWithSlots = {
      ...data,
      reference_image_libraries: refLibs,
      structure: {
        slots,
      },
    };
    onSubmit(dataWithSlots);
  };

  // Surface validation failures as a toast — Radix ScrollArea breaks
  // react-hook-form's default focus-on-error, so users can otherwise miss the
  // inline FormMessage below the fold and assume the click did nothing.
  const handleValidationErrors = (errors: Record<string, unknown>) => {
    const messages = Object.values(errors)
      .map((e) => (e as { message?: string } | undefined)?.message)
      .filter((m): m is string => !!m);
    toast.error(messages.length ? messages.join(' • ') : 'Please fix the highlighted fields.');

    const firstField = Object.keys(errors)[0];
    if (!firstField) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[name="${firstField}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const handleUseExample = () => {
    if (!guidance) return;
    const isImageOnly = IMAGE_ONLY_PIPELINES.includes(currentPipeline);
    if (isImageOnly) {
      form.setValue('image_prompt', guidance.exampleStructure);
    } else {
      form.setValue('master_prompt', guidance.exampleStructure);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleFormSubmit, handleValidationErrors)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Blueprint Name</FormLabel>
              <FormControl>
                <Input
                  placeholder="My Content Blueprint"
                  autoComplete="off"
                  className="focus-visible:ring-2 focus-visible:ring-ring"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Describe what this blueprint generates..."
                  autoComplete="off"
                  className="focus-visible:ring-2 focus-visible:ring-ring"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="pipeline"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <PipelineSelector
                  value={field.value as PipelineId}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Pipeline-specific prompt guidance */}
        {guidance && (
          <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
            <Lightbulb className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertDescription className="space-y-3">
              <p className="font-medium text-blue-900 dark:text-blue-100">Prompt Tips for this pipeline</p>
              <ul className="text-sm text-blue-800 dark:text-blue-200 list-disc pl-4 space-y-1">
                {guidance.tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>

              {guidance.keyVariables.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Key variables for this pipeline:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {guidance.keyVariables.map((v) => (
                      <Badge key={v} variant="secondary" className="font-mono text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700">
                        {`{{${v}}}`}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Collapsible open={guidanceOpen} onOpenChange={setGuidanceOpen}>
                <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors">
                  <ChevronDown className={`h-4 w-4 transition-transform ${guidanceOpen ? "rotate-180" : ""}`} />
                  {guidanceOpen ? "Hide example prompt" : "View example prompt"}
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-blue-950/50 p-3">
                    <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-blue-900 dark:text-blue-100">
                      {guidance.exampleStructure}
                    </pre>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 gap-2 text-blue-700 border-blue-300 hover:bg-blue-100 dark:text-blue-300 dark:border-blue-700 dark:hover:bg-blue-900/50"
                      onClick={handleUseExample}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Use this as starting point
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </AlertDescription>
          </Alert>
        )}

        {generatesImages && (
          <FormField
            control={form.control}
            name="reference_image_libraries"
            render={({ field }) => (
              <FormItem className="space-y-4">
                <div>
                  <FormLabel className="flex items-center gap-2 text-base">
                    <ImageIcon className="h-5 w-5 text-primary" />
                    Reference Image Libraries {requiresReferenceImages && <span className="text-destructive">*</span>}
                  </FormLabel>
                  <FormDescription className="mt-1.5">
                    {requiresReferenceImages
                      ? "Required. Reference images anchor the visual style across all generated images."
                      : "Choose one or more reference roles. For example, combine Style & Composition with People & Faces to keep the look of one image and the identity of another."
                    }
                  </FormDescription>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {REFERENCE_IMAGE_LIBRARY_OPTIONS.map((option) => {
                    const isChecked = (field.value || []).includes(option.value);
                    return (
                      <ReferenceImageLibraryOption
                        key={option.value}
                        option={option}
                        isChecked={isChecked}
                        onToggle={(checked) => {
                          const current = field.value || [];
                          if (checked) {
                            field.onChange([...current, option.value]);
                          } else {
                            field.onChange(current.filter((v: string) => v !== option.value));
                          }
                        }}
                      />
                    );
                  })}
                </div>

                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* For image_only pipeline, show Image Prompt as the main prompt */}
        {IMAGE_ONLY_PIPELINES.includes(currentPipeline) ? (
          <FormField
            control={form.control}
            name="image_prompt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Image Prompt Template *</FormLabel>
                <FormControl>
                  <PromptEditor
                    value={field.value || ""}
                    onChange={field.onChange}
                    placeholder="Detailed prompt template for image generation. Use {{idea}}, {{product}}, {{character}}, {{brand}} variables."
                    promptType="image"
                    pipeline={currentPipeline}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground mt-1">
                  This template will be used directly for image generation. Use variables like {"{{idea}}"}, {"{{product_name}}"}, {"{{character_name}}"} to include dynamic content.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <>
            <FormField
              control={form.control}
              name="master_prompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Master Prompt</FormLabel>
                  <FormControl>
                    <PromptEditor
                      value={field.value || ""}
                      onChange={field.onChange}
                      pipeline={currentPipeline}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {PIPELINES_WITH_SKIPPABLE_IMAGE_GENERATION.includes(currentPipeline) && (
              <FormField
                control={form.control}
                name="skip_image_generation"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-primary" />
                        Generate Image
                      </FormLabel>
                      <FormDescription>
                        When off, this blueprint produces text-only posts — no image stage runs, and no image model is required.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={!field.value}
                        onCheckedChange={(checked) => field.onChange(!checked)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            {generatesImages && (
              <FormField
                control={form.control}
                name="image_prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Image Prompt Template</FormLabel>
                    <FormControl>
                      <PromptEditor
                        value={field.value || ""}
                        onChange={field.onChange}
                        placeholder="Detailed prompt template for image generation. Use {{idea}}, {{context}}, {{caption}} variables. Leave empty to auto-generate from caption."
                        promptType="image"
                        pipeline={currentPipeline}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground mt-1">
                      Optional. If provided, this template will be used for all image generation stages instead of auto-generating from the caption.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </>
        )}

        {VIDEO_PIPELINES_WITH_DIRECTOR.includes(currentPipeline) && (
          <FormField
            control={form.control}
            name="director_prompt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Video Director Prompt</FormLabel>
                <FormControl>
                  <PromptEditor
                    value={field.value || ""}
                    onChange={field.onChange}
                    placeholder={`Control the visual creative direction of your video. Leave empty for smart defaults.

Example:
### Structure & Pacing
- HOOK: Open with a bold text_card statement (1.5-2s)
- Target 45-60 seconds, minimum 12 shots, each 2-4 seconds
- Arc: Hook → Context → Walk-through → Insight → CTA

### Layouts
- Cycle through layouts, never repeat more than 2x in a row
- Use text_card sparingly: hook, mid-insight, CTA only

### Camera
- Every screenshot shot MUST have camera movement
- Match camera to content: ken_burns_slow for exploration, punch_zoom for emphasis

### Visual Polish
- Use "particles" or "mesh_gradient" backgrounds on 50%+ of text shots
- Use "typewriter" for hooks, "glitch" for bold statements, "gradient_sweep" for CTAs
- vignette on 60-80% of shots, grain on 30-50%`}
                    promptType="director"
                    pipeline={currentPipeline}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground mt-1">
                  Controls the visual creative direction — structure, pacing, layout variety, camera movement, text animations, backgrounds, and overlays. Leave empty to use built-in defaults.
                </p>
                <DirectorPromptGuidance />
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="model_config"
          render={({ field, fieldState }) => {
            const missingModels = getMissingRequiredModels(
              currentPipeline,
              field.value as Record<string, { model_id?: string }>,
              skipImageGeneration
            );
            return (
              <FormItem>
                <FormLabel>Model Configuration</FormLabel>
                <FormControl>
                  <ModelSelector
                    value={field.value}
                    onChange={field.onChange}
                    pipeline={currentPipeline}
                  />
                </FormControl>
                {fieldState.error && missingModels.length > 0 && (
                  <p className="text-sm font-medium text-amber-500">
                    Missing required models: {missingModels.map(m => MODEL_TYPE_LABELS[m]).join(', ')}
                  </p>
                )}
                <FormMessage />
              </FormItem>
            );
          }}
        />

        {/* HeyGen Template Selector — only for ugc_heygen_template pipeline */}
        {currentPipeline === 'ugc_heygen_template' && (
          <FormField
            control={form.control}
            name="model_config"
            render={({ field }) => {
              const mc = field.value as BlueprintFormModelConfig;
              const selectedTemplateId = mc.heygen_template_id || '';

              const getAspectLabel = (ratio?: string) => {
                if (!ratio) return '16:9';
                if (ratio === '9:16' || ratio === '9/16') return '9:16';
                if (ratio === '1:1' || ratio === '1/1') return '1:1';
                return ratio;
              };

              return (
                <FormItem className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Film className="h-5 w-5 text-cta" />
                    <FormLabel className="text-base font-medium">HeyGen Template</FormLabel>
                  </div>

                  {heygenTemplatesLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-3">
                      <Loader2 className="h-6 w-6 animate-spin text-cta" />
                      <p className="text-sm text-muted-foreground">Loading templates from HeyGen...</p>
                    </div>
                  ) : !heygenTemplates || heygenTemplates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-3 rounded-xl border-2 border-dashed border-border">
                      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                        <Video className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-sm font-medium">No templates found</p>
                        <p className="text-xs text-muted-foreground max-w-xs">
                          Create templates in your HeyGen dashboard first, or check that your HeyGen API key is configured in Settings.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {heygenTemplates.map((tmpl) => {
                          const isSelected = selectedTemplateId === tmpl.template_id;
                          return (
                            <button
                              key={tmpl.template_id}
                              type="button"
                              onClick={() => field.onChange({ ...mc, heygen_template_id: tmpl.template_id })}
                              className={cn(
                                "group relative flex flex-col rounded-xl border-2 transition-all duration-200 cursor-pointer overflow-hidden",
                                isSelected
                                  ? "border-cta ring-2 ring-cta/30 shadow-lg shadow-cta/10"
                                  : "border-border hover:border-cta/50 hover:scale-[1.02] hover:shadow-md"
                              )}
                            >
                              {/* Selected checkmark */}
                              {isSelected && (
                                <div className="absolute top-2 right-2 z-20 h-5 w-5 rounded-full bg-cta flex items-center justify-center shadow-md">
                                  <Check className="h-3 w-3 text-cta-foreground" />
                                </div>
                              )}

                              {/* Thumbnail */}
                              <div className="relative w-full h-40 overflow-hidden bg-muted/50 flex items-center justify-center">
                                {tmpl.thumbnail_image_url ? (
                                  <img
                                    src={tmpl.thumbnail_image_url}
                                    alt={tmpl.name}
                                    className="max-w-full max-h-full object-contain transition-transform duration-300 group-hover:scale-105"
                                  />
                                ) : (
                                  <Video className="h-8 w-8 text-muted-foreground/40" />
                                )}

                                {/* Aspect ratio badge */}
                                <div className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm">
                                  <span className="text-[9px] font-mono font-medium text-white/90">
                                    {getAspectLabel(tmpl.aspect_ratio)}
                                  </span>
                                </div>

                                {/* Play icon overlay on hover */}
                                <div className="absolute inset-0 z-10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                                  <div className="h-8 w-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                    <div className="ml-0.5 w-0 h-0 border-l-[8px] border-l-white/80 border-y-[5px] border-y-transparent" />
                                  </div>
                                </div>
                              </div>

                              {/* Template name */}
                              <div className="px-3 py-2.5 bg-background">
                                <p className="text-xs font-semibold truncate">{tmpl.name}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5 truncate font-mono">
                                  {tmpl.template_id.slice(0, 12)}...
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {!selectedTemplateId && (
                        <p className="text-sm font-medium text-amber-500">Select a template to continue</p>
                      )}
                    </>
                  )}
                </FormItem>
              );
            }}
          />
        )}

        {/* Carousel Configuration */}
        {CAROUSEL_PIPELINES.includes(currentPipeline) && (
          <FormField
            control={form.control}
            name="model_config"
            render={({ field }) => {
              const mc = field.value as BlueprintFormModelConfig;
              const slideCount = mc.carousel_slide_count ?? 5;
              const selectedTemplate = resolveCarouselTemplateId(mc.carousel_template);
              const customPalette = mc.carousel_custom_palette as Record<string, string> | undefined;
              const templateCategory = mc._templateCategory ?? 'all';
              const filteredTemplates = templateCategory === 'all'
                ? CAROUSEL_TEMPLATES
                : CAROUSEL_TEMPLATES.filter(t => t.category === templateCategory);

              // Build tinted preview when custom colors are set
              const tintPreview = (tmpl: typeof CAROUSEL_TEMPLATES[0]) => {
                if (!customPalette) return tmpl.preview;
                const base = tmpl.preview;
                return {
                  ...base,
                  coverBg: base.coverDark
                    ? `linear-gradient(145deg, ${customPalette.primary || '#2563EB'}, ${customPalette.secondary || '#7C3AED'})`
                    : (customPalette.background || base.coverBg),
                  contentBg: customPalette.background || base.contentBg,
                  coverText: base.coverDark ? '#FFFFFF' : (customPalette.text || base.coverText),
                  contentText: customPalette.text || base.contentText,
                  accent: customPalette.accent || base.accent,
                };
              };

              return (
                <FormItem className="space-y-4">
                  <div className="flex items-center gap-2">
                    <LayoutGrid className="h-5 w-5 text-cta" />
                    <FormLabel className="text-base font-medium">Carousel Settings</FormLabel>
                  </div>

                  {/* Slide Count */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      Number of Slides
                      <span className="ml-auto text-sm font-normal text-muted-foreground">
                        {slideCount} slides
                      </span>
                    </Label>
                    <Slider
                      value={[slideCount]}
                      onValueChange={(v) => field.onChange({ ...mc, carousel_slide_count: v[0] })}
                      min={2}
                      max={10}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>2</span>
                      <span>10</span>
                    </div>
                  </div>

                  {/* CTA Button Text */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">CTA Button Text</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 text-xs">
                            <Variable className="h-3 w-3 mr-1" />
                            Insert Variable
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                          <DropdownMenuLabel className="text-xs">AI Insights</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => {
                            const input = ctaInputRef.current;
                            if (!input) return;
                            const start = input.selectionStart || (mc.carousel_cta_text || '').length;
                            const end = input.selectionEnd || start;
                            const current = mc.carousel_cta_text || '';
                            const newVal = current.substring(0, start) + '{{ai_cta}}' + current.substring(end);
                            field.onChange({ ...mc, carousel_cta_text: newVal });
                          }}>
                            <code className="text-xs mr-2">{"{{ai_cta}}"}</code>
                            <span className="text-xs text-muted-foreground">CTA text</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            const current = mc.carousel_cta_text || '';
                            const input = ctaInputRef.current;
                            const start = input?.selectionStart || current.length;
                            const end = input?.selectionEnd || start;
                            const newVal = current.substring(0, start) + '{{ai_ctas}}' + current.substring(end);
                            field.onChange({ ...mc, carousel_cta_text: newVal });
                          }}>
                            <code className="text-xs mr-2">{"{{ai_ctas}}"}</code>
                            <span className="text-xs text-muted-foreground">All CTAs</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs">Library</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => {
                            const current = mc.carousel_cta_text || '';
                            const input = ctaInputRef.current;
                            const start = input?.selectionStart || current.length;
                            const end = input?.selectionEnd || start;
                            const newVal = current.substring(0, start) + '{{block.content}}' + current.substring(end);
                            field.onChange({ ...mc, carousel_cta_text: newVal });
                          }}>
                            <code className="text-xs mr-2">{"{{block.content}}"}</code>
                            <span className="text-xs text-muted-foreground">Block content</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs">Common</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => {
                            const current = mc.carousel_cta_text || '';
                            const input = ctaInputRef.current;
                            const start = input?.selectionStart || current.length;
                            const end = input?.selectionEnd || start;
                            const newVal = current.substring(0, start) + '{{cta}}' + current.substring(end);
                            field.onChange({ ...mc, carousel_cta_text: newVal });
                          }}>
                            <code className="text-xs mr-2">{"{{cta}}"}</code>
                            <span className="text-xs text-muted-foreground">Call to Action</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            const current = mc.carousel_cta_text || '';
                            const input = ctaInputRef.current;
                            const start = input?.selectionStart || current.length;
                            const end = input?.selectionEnd || start;
                            const newVal = current.substring(0, start) + '{{product.name}}' + current.substring(end);
                            field.onChange({ ...mc, carousel_cta_text: newVal });
                          }}>
                            <code className="text-xs mr-2">{"{{product.name}}"}</code>
                            <span className="text-xs text-muted-foreground">Product name</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <Input
                      ref={ctaInputRef}
                      placeholder='e.g. Comment "STRATEGY", Save This, {{ai_cta}}'
                      value={mc.carousel_cta_text || ''}
                      onChange={(e) => field.onChange({ ...mc, carousel_cta_text: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Text displayed on the last slide's button. Use variables or leave empty to let AI decide.
                    </p>
                  </div>

                  {/* Template Picker — category tabs + rich mini-slide previews */}
                  {currentPipeline === 'instagram_carousel' && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Slide Template</Label>
                    <Tabs
                      value={templateCategory}
                      onValueChange={(v) => field.onChange({ ...mc, _templateCategory: v })}
                    >
                      <TabsList className="w-full grid grid-cols-4 h-8">
                        <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                        <TabsTrigger value="light" className="text-xs">Light</TabsTrigger>
                        <TabsTrigger value="dark" className="text-xs">Dark</TabsTrigger>
                        <TabsTrigger value="vibrant" className="text-xs">Vibrant</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <div className="grid grid-cols-2 gap-3">
                      {filteredTemplates.map((tmpl) => {
                        const p = tintPreview(tmpl);
                        const isSelected = selectedTemplate === tmpl.id;
                        return (
                          <button
                            key={tmpl.id}
                            type="button"
                            onClick={() => setPreviewTemplate(tmpl.id)}
                            className={cn(
                              "group relative flex flex-col rounded-xl border-2 transition-all duration-200 cursor-pointer overflow-hidden",
                              isSelected
                                ? "border-cta ring-2 ring-cta/30"
                                : "border-border hover:border-cta/50 hover:scale-[1.02] hover:shadow-md"
                            )}
                          >
                            {/* Selected checkmark */}
                            {isSelected && (
                              <div className="absolute top-2 right-2 z-20 h-5 w-5 rounded-full bg-cta flex items-center justify-center shadow-sm">
                                <Check className="h-3 w-3 text-cta-foreground" />
                              </div>
                            )}

                            {/* Two mini slides side by side */}
                            <div className="flex w-full">
                              {/* Cover slide preview */}
                              <div
                                className="relative flex flex-col justify-between w-1/2 aspect-square p-3 overflow-hidden"
                                style={{ background: p.coverBg }}
                              >
                                {/* Decorations */}
                                {p.decoStyle === 'orb' && (<>
                                  <div
                                    className="absolute -top-4 -right-4 w-16 h-16 rounded-full"
                                    style={{ background: `radial-gradient(circle, ${p.accent}, transparent 65%)`, opacity: 0.35 }}
                                  />
                                  <div
                                    className="absolute -bottom-3 -left-3 w-12 h-12 rounded-full"
                                    style={{ background: `radial-gradient(circle, ${p.accent2 || p.accent}, transparent 65%)`, opacity: 0.25 }}
                                  />
                                </>)}
                                {p.decoStyle === 'diagonal' && (
                                  <div
                                    className="absolute inset-0 opacity-60"
                                    style={{ background: `linear-gradient(135deg, transparent 45%, ${p.accent} 45%)` }}
                                  />
                                )}
                                {p.decoStyle === 'mesh' && (<>
                                  <div
                                    className="absolute -top-3 -right-3 w-14 h-14 rounded-full opacity-40"
                                    style={{ background: `radial-gradient(circle, ${p.accent}, transparent 70%)` }}
                                  />
                                  <div
                                    className="absolute -bottom-2 -left-3 w-12 h-12 rounded-full opacity-35"
                                    style={{ background: `radial-gradient(circle, ${p.accent2 || p.accent}, transparent 70%)` }}
                                  />
                                </>)}
                                {p.decoStyle === 'wave' && (
                                  <div
                                    className="absolute -bottom-6 -left-4 -right-4 h-14 rounded-[50%] opacity-15"
                                    style={{ background: '#FFFFFF' }}
                                  />
                                )}
                                {p.decoStyle === 'block' && (<>
                                  <div className="absolute inset-1 border-2 border-black/15" />
                                  <div
                                    className="absolute -top-1 right-3 w-5 h-5 rotate-12 opacity-50"
                                    style={{ background: p.accent }}
                                  />
                                </>)}
                                {p.decoStyle === 'corner' && (<>
                                  <div
                                    className="absolute top-0 right-0 w-10 h-10 opacity-25"
                                    style={{ background: p.accent }}
                                  />
                                  <div
                                    className="absolute bottom-0 left-0 w-6 h-6 opacity-15"
                                    style={{ background: p.accent }}
                                  />
                                </>)}
                                {/* Pill tag + counter row */}
                                <div className="relative z-10 flex items-center justify-between w-full">
                                  <div
                                    className="px-1.5 py-0.5 rounded-full text-[5px] font-semibold tracking-wider"
                                    style={{
                                      background: p.coverDark ? 'rgba(255,255,255,0.15)' : `${p.accent}18`,
                                      color: p.coverDark ? '#FFFFFF' : p.accent,
                                    }}
                                  >
                                    INSIGHT
                                  </div>
                                  <div className="flex items-baseline gap-0.5">
                                    <span className="text-[6px] font-bold" style={{ color: p.coverDark ? p.accent : p.accent }}>01</span>
                                    <span className="text-[5px] opacity-40" style={{ color: p.coverText }}>/</span>
                                    <span className="text-[5px] opacity-40" style={{ color: p.coverText }}>07</span>
                                  </div>
                                </div>
                                {/* Headline + subtitle */}
                                <div className="relative z-10 mt-auto space-y-0.5">
                                  <div
                                    className="text-[9px] font-extrabold leading-[1.05] tracking-tight"
                                    style={{ color: p.coverText }}
                                  >
                                    5 Ways to Boost Growth
                                  </div>
                                  <div
                                    className="text-[5.5px] leading-tight opacity-75"
                                    style={{ color: p.coverText }}
                                  >
                                    Proven strategies for 2026
                                  </div>
                                </div>
                                {/* Progress bar */}
                                <div className="relative z-10 w-full h-[2px] rounded-full mt-1.5 overflow-hidden" style={{
                                  background: p.coverDark ? 'rgba(255,255,255,0.2)' : `${p.accent}20`,
                                }}>
                                  <div className="h-full rounded-full" style={{
                                    width: '14%',
                                    background: p.coverDark ? '#FFFFFF' : p.accent,
                                  }} />
                                </div>
                              </div>

                              {/* Content slide preview */}
                              <div
                                className="relative flex flex-col justify-between w-1/2 aspect-square p-3 overflow-hidden"
                                style={{ background: p.contentBg }}
                              >
                                {/* Decorations */}
                                {p.decoStyle === 'orb' && p.contentDark && (
                                  <div
                                    className="absolute -bottom-3 -right-3 w-12 h-12 rounded-full opacity-25"
                                    style={{ background: `radial-gradient(circle, ${p.accent}, transparent 65%)` }}
                                  />
                                )}
                                {/* Watermark number */}
                                <div
                                  className="absolute -top-1 right-1 text-[28px] font-extrabold leading-none select-none"
                                  style={{ color: p.contentDark ? p.accent : (p.accent2 || p.accent), opacity: p.contentDark ? 0.08 : 0.07 }}
                                >
                                  03
                                </div>
                                {/* Counter */}
                                <div className="relative z-10 flex items-baseline gap-0.5">
                                  <span className="text-[7px] font-bold" style={{ color: p.contentDark ? p.accent : (p.accent2 || p.accent) }}>03</span>
                                  <span className="text-[5px] opacity-40" style={{ color: p.contentText }}>/</span>
                                  <span className="text-[5px] opacity-40" style={{ color: p.contentText }}>07</span>
                                </div>
                                {/* Content area with headline + bullet points */}
                                <div className="relative z-10 mt-auto">
                                  {p.hasContentCard ? (
                                    <div
                                      className="rounded-md p-1.5 space-y-1"
                                      style={{
                                        background: p.contentDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF',
                                        boxShadow: p.contentDark ? 'none' : '0 1px 6px rgba(0,0,0,0.07)',
                                        borderLeft: `2px solid ${p.contentDark ? `${p.accent}90` : (p.accent2 || p.accent)}`,
                                      }}
                                    >
                                      <div className="text-[7px] font-bold leading-[1.1]" style={{ color: p.contentText }}>
                                        Leverage Data Analytics
                                      </div>
                                      {/* Bullet points */}
                                      <div className="space-y-[2px]">
                                        {['Track key metrics daily', 'A/B test your campaigns', 'Optimize conversion funnels'].map((bullet, i) => (
                                          <div key={i} className="flex items-start gap-1">
                                            <div
                                              className="w-[3px] h-[3px] rounded-full flex-shrink-0 mt-[2.5px]"
                                              style={{ background: p.contentDark ? p.accent : (p.accent2 || p.accent) }}
                                            />
                                            <span className="text-[5px] leading-[1.4] opacity-70" style={{ color: p.contentText }}>
                                              {bullet}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-1">
                                      <div className="text-[7px] font-bold leading-[1.1]" style={{ color: p.contentText }}>
                                        Leverage Data Analytics
                                      </div>
                                      {/* Bullet points */}
                                      <div className="space-y-[2px]">
                                        {['Track key metrics daily', 'A/B test your campaigns', 'Optimize conversion funnels'].map((bullet, i) => (
                                          <div key={i} className="flex items-start gap-1">
                                            <div
                                              className="w-[3px] h-[3px] rounded-full flex-shrink-0 mt-[2.5px]"
                                              style={{ background: p.contentDark ? p.accent : (p.accent2 || p.accent) }}
                                            />
                                            <span className="text-[5px] leading-[1.4] opacity-70" style={{ color: p.contentText }}>
                                              {bullet}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {/* Swipe arrow */}
                                <div className="absolute bottom-2 right-2 z-10 w-4 h-4 rounded flex items-center justify-center"
                                  style={{
                                    background: p.contentDark ? 'rgba(255,255,255,0.08)' : `${p.accent2 || p.accent}10`,
                                    border: `1px solid ${p.contentDark ? 'rgba(255,255,255,0.15)' : `${p.accent2 || p.accent}20`}`,
                                  }}
                                >
                                  <svg width="5" height="5" viewBox="0 0 10 10" fill="none">
                                    <path d="M3 1L7 5L3 9" stroke={p.contentDark ? 'rgba(255,255,255,0.5)' : (p.accent2 || p.accent)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                                {/* Progress bar */}
                                <div className="relative z-10 w-full h-[2px] rounded-full mt-1.5 overflow-hidden" style={{
                                  background: p.contentDark ? 'rgba(255,255,255,0.1)' : `${p.accent2 || p.accent}15`,
                                }}>
                                  <div className="h-full rounded-full" style={{
                                    width: '43%',
                                    background: p.contentDark ? p.accent : (p.accent2 || p.accent),
                                  }} />
                                </div>
                              </div>
                            </div>

                            {/* Template name + description */}
                            <div className="px-3 py-2 bg-background">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold">{tmpl.name}</span>
                                <span
                                  className="px-1.5 py-0.5 rounded text-[9px] font-medium capitalize"
                                  style={{
                                    background: tmpl.category === 'dark' ? '#1a1a2e' : tmpl.category === 'vibrant' ? '#f0e6ff' : '#f0f4ff',
                                    color: tmpl.category === 'dark' ? '#a0a0c0' : tmpl.category === 'vibrant' ? '#7C3AED' : '#2563EB',
                                  }}
                                >
                                  {tmpl.category}
                                </span>
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{tmpl.description}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Enlarged Template Preview Dialog */}
                    {(() => {
                      const previewTmpl = CAROUSEL_TEMPLATES.find(t => t.id === previewTemplate);
                      if (!previewTmpl) return null;
                      const pp = tintPreview(previewTmpl);
                      const isAlreadySelected = selectedTemplate === previewTmpl.id;

                      const renderDecorations = (p: CarouselTemplatePreview, variant: 'cover' | 'content') => {
                        const isDark = variant === 'cover' ? p.coverDark : p.contentDark;
                        if (variant === 'content' && !isDark && p.decoStyle === 'orb') return null;
                        return (<>
                          {p.decoStyle === 'orb' && (<>
                            <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full" style={{ background: `radial-gradient(circle, ${p.accent}, transparent 65%)`, opacity: 0.35 }} />
                            <div className="absolute -bottom-8 -left-8 w-28 h-28 rounded-full" style={{ background: `radial-gradient(circle, ${p.accent2 || p.accent}, transparent 65%)`, opacity: 0.25 }} />
                          </>)}
                          {p.decoStyle === 'diagonal' && (
                            <div className="absolute inset-0 opacity-60" style={{ background: `linear-gradient(135deg, transparent 45%, ${p.accent} 45%)` }} />
                          )}
                          {p.decoStyle === 'mesh' && (<>
                            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-40" style={{ background: `radial-gradient(circle, ${p.accent}, transparent 70%)` }} />
                            <div className="absolute -bottom-6 -left-8 w-28 h-28 rounded-full opacity-35" style={{ background: `radial-gradient(circle, ${p.accent2 || p.accent}, transparent 70%)` }} />
                          </>)}
                          {p.decoStyle === 'wave' && (
                            <div className="absolute -bottom-14 -left-10 -right-10 h-32 rounded-[50%] opacity-15" style={{ background: '#FFFFFF' }} />
                          )}
                          {p.decoStyle === 'block' && (<>
                            <div className="absolute inset-3 border-[3px] border-black/15" />
                            <div className="absolute -top-2 right-8 w-12 h-12 rotate-12 opacity-50" style={{ background: p.accent }} />
                          </>)}
                          {p.decoStyle === 'corner' && (<>
                            <div className="absolute top-0 right-0 w-24 h-24 opacity-25" style={{ background: p.accent }} />
                            <div className="absolute bottom-0 left-0 w-14 h-14 opacity-15" style={{ background: p.accent }} />
                          </>)}
                        </>);
                      };

                      const ProgressBar = ({ current, total, color, track }: { current: number; total: number; color: string; track: string }) => (
                        <div className="relative z-10 w-full h-[3px] rounded-full mt-3 overflow-hidden" style={{ background: track }}>
                          <div className="h-full rounded-full" style={{ width: `${(current / total) * 100}%`, background: color }} />
                        </div>
                      );

                      return (
                        <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
                          <DialogContent className="max-w-4xl p-0 overflow-hidden">
                            <DialogHeader className="px-6 pt-6 pb-0">
                              <div className="flex items-center gap-3">
                                <Eye className="h-5 w-5 text-muted-foreground" />
                                <DialogTitle className="text-lg font-semibold">{previewTmpl.name}</DialogTitle>
                                <span
                                  className="px-2 py-0.5 rounded text-[11px] font-medium capitalize"
                                  style={{
                                    background: previewTmpl.category === 'dark' ? '#1a1a2e' : previewTmpl.category === 'vibrant' ? '#f0e6ff' : '#f0f4ff',
                                    color: previewTmpl.category === 'dark' ? '#a0a0c0' : previewTmpl.category === 'vibrant' ? '#7C3AED' : '#2563EB',
                                  }}
                                >
                                  {previewTmpl.category}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">{previewTmpl.description}</p>
                            </DialogHeader>

                            {/* 3 slide previews */}
                            <div className="grid grid-cols-3 gap-4 px-6 py-5">
                              {/* Cover slide */}
                              <div className="space-y-2">
                                <div
                                  className="relative flex flex-col justify-between aspect-square rounded-lg p-5 overflow-hidden"
                                  style={{ background: pp.coverBg }}
                                >
                                  {renderDecorations(pp, 'cover')}
                                  {/* Pill + counter */}
                                  <div className="relative z-10 flex items-center justify-between w-full">
                                    <div
                                      className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider"
                                      style={{
                                        background: pp.coverDark ? 'rgba(255,255,255,0.15)' : `${pp.accent}18`,
                                        color: pp.coverDark ? '#FFFFFF' : pp.accent,
                                      }}
                                    >
                                      INSIGHT
                                    </div>
                                    <div className="flex items-baseline gap-0.5">
                                      <span className="text-[11px] font-bold" style={{ color: pp.accent }}>01</span>
                                      <span className="text-[9px] opacity-40" style={{ color: pp.coverText }}>/</span>
                                      <span className="text-[9px] opacity-40" style={{ color: pp.coverText }}>07</span>
                                    </div>
                                  </div>
                                  {/* Headline + subtitle */}
                                  <div className="relative z-10 mt-auto space-y-1">
                                    <div className="text-[22px] font-extrabold leading-[1.05] tracking-tight" style={{ color: pp.coverText }}>
                                      5 Ways to Boost Growth
                                    </div>
                                    <div className="text-[12px] leading-tight opacity-75" style={{ color: pp.coverText }}>
                                      Proven strategies for 2026
                                    </div>
                                  </div>
                                  <ProgressBar current={1} total={7} color={pp.coverDark ? '#FFFFFF' : pp.accent} track={pp.coverDark ? 'rgba(255,255,255,0.2)' : `${pp.accent}20`} />
                                </div>
                                <p className="text-xs text-muted-foreground text-center font-medium">Cover</p>
                              </div>

                              {/* Content slide */}
                              <div className="space-y-2">
                                <div
                                  className="relative flex flex-col justify-between aspect-square rounded-lg p-5 overflow-hidden"
                                  style={{ background: pp.contentBg }}
                                >
                                  {pp.contentDark && renderDecorations(pp, 'content')}
                                  {/* Watermark */}
                                  <div
                                    className="absolute -top-2 right-2 text-[72px] font-extrabold leading-none select-none"
                                    style={{ color: pp.contentDark ? pp.accent : (pp.accent2 || pp.accent), opacity: pp.contentDark ? 0.08 : 0.07 }}
                                  >
                                    03
                                  </div>
                                  {/* Counter */}
                                  <div className="relative z-10 flex items-baseline gap-0.5">
                                    <span className="text-[13px] font-bold" style={{ color: pp.contentDark ? pp.accent : (pp.accent2 || pp.accent) }}>03</span>
                                    <span className="text-[9px] opacity-40" style={{ color: pp.contentText }}>/</span>
                                    <span className="text-[9px] opacity-40" style={{ color: pp.contentText }}>07</span>
                                  </div>
                                  {/* Content area */}
                                  <div className="relative z-10 mt-auto">
                                    {pp.hasContentCard ? (
                                      <div
                                        className="rounded-lg p-3.5 space-y-2"
                                        style={{
                                          background: pp.contentDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF',
                                          boxShadow: pp.contentDark ? 'none' : '0 1px 6px rgba(0,0,0,0.07)',
                                          borderLeft: `3px solid ${pp.contentDark ? `${pp.accent}90` : (pp.accent2 || pp.accent)}`,
                                        }}
                                      >
                                        <div className="text-[15px] font-bold leading-[1.1]" style={{ color: pp.contentText }}>
                                          Leverage Data Analytics
                                        </div>
                                        <div className="space-y-1">
                                          {['Track key metrics daily', 'A/B test your campaigns', 'Optimize conversion funnels'].map((bullet, i) => (
                                            <div key={i} className="flex items-start gap-1.5">
                                              <div className="w-[5px] h-[5px] rounded-full flex-shrink-0 mt-[4px]" style={{ background: pp.contentDark ? pp.accent : (pp.accent2 || pp.accent) }} />
                                              <span className="text-[11px] leading-[1.4] opacity-70" style={{ color: pp.contentText }}>{bullet}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="space-y-2">
                                        <div className="text-[15px] font-bold leading-[1.1]" style={{ color: pp.contentText }}>
                                          Leverage Data Analytics
                                        </div>
                                        <div className="space-y-1">
                                          {['Track key metrics daily', 'A/B test your campaigns', 'Optimize conversion funnels'].map((bullet, i) => (
                                            <div key={i} className="flex items-start gap-1.5">
                                              <div className="w-[5px] h-[5px] rounded-full flex-shrink-0 mt-[4px]" style={{ background: pp.contentDark ? pp.accent : (pp.accent2 || pp.accent) }} />
                                              <span className="text-[11px] leading-[1.4] opacity-70" style={{ color: pp.contentText }}>{bullet}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <ProgressBar current={3} total={7} color={pp.contentDark ? pp.accent : (pp.accent2 || pp.accent)} track={pp.contentDark ? 'rgba(255,255,255,0.1)' : `${pp.accent2 || pp.accent}15`} />
                                </div>
                                <p className="text-xs text-muted-foreground text-center font-medium">Content</p>
                              </div>

                              {/* CTA slide */}
                              <div className="space-y-2">
                                <div
                                  className="relative flex flex-col items-center justify-center aspect-square rounded-lg p-5 overflow-hidden text-center"
                                  style={{ background: pp.coverBg }}
                                >
                                  {renderDecorations(pp, 'cover')}
                                  <div className="relative z-10 text-[20px] font-extrabold leading-[1.1] tracking-tight mb-3" style={{ color: pp.coverText }}>
                                    Ready to Transform Your Strategy?
                                  </div>
                                  <div className="relative z-10 text-[11px] leading-tight opacity-75 mb-4 max-w-[85%]" style={{ color: pp.coverText }}>
                                    Save this post and start implementing today
                                  </div>
                                  <div
                                    className="relative z-10 px-5 py-2 rounded-lg text-[12px] font-bold"
                                    style={{ background: `linear-gradient(135deg, ${pp.accent}, ${pp.accent})`, color: pp.coverDark ? '#1a1a1a' : '#FFFFFF' }}
                                  >
                                    Follow for more
                                  </div>
                                  <div className="relative z-10 w-full mt-auto">
                                    <ProgressBar current={7} total={7} color={pp.coverDark ? '#FFFFFF' : pp.accent} track={pp.coverDark ? 'rgba(255,255,255,0.2)' : `${pp.accent}20`} />
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground text-center font-medium">CTA</p>
                              </div>
                            </div>

                            {/* Footer */}
                            <div className="flex items-center justify-end gap-3 px-6 pb-5 pt-0">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setPreviewTemplate(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                variant="cta"
                                onClick={() => {
                                  field.onChange({ ...mc, carousel_template: previewTmpl.id });
                                  setPreviewTemplate(null);
                                }}
                              >
                                {isAlreadySelected ? 'Selected' : 'Use This Template'}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      );
                    })()}
                    </div>
                  )}

                  {currentPipeline === 'instagram_carousel' && (
                    <>
                      {/* Custom Color Override */}
                      <div className="space-y-3 pt-3 border-t border-border/50">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium flex items-center gap-2">
                            <Palette className="h-4 w-4 text-muted-foreground" />
                            Custom Colors
                          </Label>
                          <Switch
                            checked={!!customPalette}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                field.onChange({
                                  ...mc,
                                  carousel_custom_palette: {
                                    primary: '#2563EB',
                                    secondary: '#7C3AED',
                                    background: '#FFFFFF',
                                    text: '#1A1A2E',
                                    accent: '#F59E0B',
                                  },
                                });
                              } else {
                                const { carousel_custom_palette: _, ...rest } = mc;
                                field.onChange(rest);
                              }
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Override brand voice colors for this blueprint
                        </p>
                        {customPalette && (
                          <div className="grid grid-cols-2 gap-3">
                            <ColorPicker
                              label="Primary"
                              value={customPalette.primary || '#2563EB'}
                              onChange={(v) =>
                                field.onChange({
                                  ...mc,
                                  carousel_custom_palette: { ...customPalette, primary: v },
                                })
                              }
                            />
                            <ColorPicker
                              label="Secondary"
                              value={customPalette.secondary || '#7C3AED'}
                              onChange={(v) =>
                                field.onChange({
                                  ...mc,
                                  carousel_custom_palette: { ...customPalette, secondary: v },
                                })
                              }
                            />
                            <ColorPicker
                              label="Background"
                              value={customPalette.background || '#FFFFFF'}
                              onChange={(v) =>
                                field.onChange({
                                  ...mc,
                                  carousel_custom_palette: { ...customPalette, background: v },
                                })
                              }
                            />
                            <ColorPicker
                              label="Text"
                              value={customPalette.text || '#1A1A2E'}
                              onChange={(v) =>
                                field.onChange({
                                  ...mc,
                                  carousel_custom_palette: { ...customPalette, text: v },
                                })
                              }
                            />
                            <ColorPicker
                              label="Accent"
                              value={customPalette.accent || '#F59E0B'}
                              onChange={(v) =>
                                field.onChange({
                                  ...mc,
                                  carousel_custom_palette: { ...customPalette, accent: v },
                                })
                              }
                            />
                          </div>
                        )}
                      </div>

                      {/* Background Image Upload */}
                      <div className="space-y-3 pt-3 border-t border-border/50">
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                          Background Image
                          <span className="text-xs font-normal text-muted-foreground ml-1">(optional)</span>
                        </Label>
                        {mc.carousel_background_image ? (
                          <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                            <img
                              src={mc.carousel_background_image}
                              alt="Background"
                              className="h-14 w-14 rounded object-cover border"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">Background image</p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {mc.carousel_background_image.split('/').pop()}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                const { carousel_background_image: _, ...rest } = mc;
                                field.onChange(rest);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => bgFileInputRef.current?.click()}
                            disabled={bgUploading}
                            className={cn(
                              "w-full flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed transition-colors",
                              bgUploading
                                ? "border-muted cursor-wait opacity-60"
                                : "border-border hover:border-cta/50 cursor-pointer"
                            )}
                          >
                            {bgUploading ? (
                              <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                            ) : (
                              <Upload className="h-6 w-6 text-muted-foreground" />
                            )}
                            <span className="text-xs text-muted-foreground">
                              {bgUploading ? "Uploading..." : "Click to upload"}
                            </span>
                          </button>
                        )}
                        <input
                          ref={bgFileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;

                            if (file.size > 5 * 1024 * 1024) {
                              toast.error("File too large. Maximum size is 5MB.");
                              return;
                            }

                            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                              toast.error("Invalid file type. Use JPG, PNG, or WebP.");
                              return;
                            }

                            try {
                              setBgUploading(true);
                              const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
                              const orgId = currentOrganization?.id || 'unknown';
                              const filePath = `carousel-backgrounds/${orgId}/${nanoid(8)}.${ext}`;

                              const { error: uploadError } = await supabase.storage
                                .from('content-media')
                                .upload(filePath, file, { cacheControl: '3600', upsert: true });

                              if (uploadError) throw uploadError;

                              const { data: { publicUrl } } = supabase.storage
                                .from('content-media')
                                .getPublicUrl(filePath);

                              field.onChange({ ...mc, carousel_background_image: publicUrl });
                              toast.success("Background image uploaded");
                            } catch (err: unknown) {
                              console.error('Background upload failed:', err);
                              toast.error(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                            } finally {
                              setBgUploading(false);
                              if (bgFileInputRef.current) bgFileInputRef.current.value = '';
                            }
                          }}
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Max 5MB. JPG, PNG, or WebP. Applies to all slides with a color overlay.
                        </p>
                      </div>
                    </>
                  )}
                </FormItem>
              );
            }}
          />
        )}

        {/* Subtitle Settings — video pipelines with TTS */}
        {VIDEO_PIPELINES_WITH_SUBTITLES.includes(currentPipeline) && (
          <FormField
            control={form.control}
            name="model_config"
            render={({ field }) => {
              const mc = field.value as BlueprintFormModelConfig;
              const subtitlesEnabled = mc.subtitles_enabled ?? false;
              const selectedTemplate = mc.subtitle_template ?? 'clean_white';
              return (
                <FormItem className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Subtitles className="h-5 w-5 text-cta" />
                    <FormLabel className="text-base font-medium">Subtitle Settings</FormLabel>
                  </div>

                  {/* Enable toggle — styled card */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      field.onChange({
                        ...mc,
                        subtitles_enabled: !subtitlesEnabled,
                        subtitle_template: mc.subtitle_template ?? 'clean_white',
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        field.onChange({
                          ...mc,
                          subtitles_enabled: !subtitlesEnabled,
                          subtitle_template: mc.subtitle_template ?? 'clean_white',
                        });
                      }
                    }}
                    className={cn(
                      "w-full flex items-center gap-4 rounded-xl border-2 p-4 transition-all text-left cursor-pointer",
                      subtitlesEnabled
                        ? "border-cta bg-cta/5"
                        : "border-border hover:border-cta/30"
                    )}
                  >
                    <div className={cn(
                      "shrink-0 h-10 w-10 rounded-lg flex items-center justify-center transition-colors",
                      subtitlesEnabled ? "bg-cta/15" : "bg-muted"
                    )}>
                      <Subtitles className={cn("h-5 w-5", subtitlesEnabled ? "text-cta" : "text-muted-foreground")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">Enable Burnt-In Subtitles</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Auto-transcribe voiceover and burn animated word-by-word captions into the video
                      </div>
                    </div>
                    <Switch
                      checked={subtitlesEnabled}
                      onCheckedChange={(checked) => {
                        field.onChange({
                          ...mc,
                          subtitles_enabled: !!checked,
                          subtitle_template: mc.subtitle_template ?? 'clean_white',
                        });
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  {/* Template picker — shown when subtitles are enabled */}
                  {subtitlesEnabled && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Caption Style</Label>
                        <span className="text-[10px] text-muted-foreground">
                          {CAPTION_STYLE_TEMPLATES.find(t => t.id === selectedTemplate)?.name}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {CAPTION_STYLE_TEMPLATES.map((tmpl) => {
                          const p = tmpl.preview;
                          const isSelected = selectedTemplate === tmpl.id;
                          return (
                            <button
                              key={tmpl.id}
                              type="button"
                              onClick={() => {
                                if (!isSelected) {
                                  field.onChange({ ...mc, subtitle_template: tmpl.id });
                                }
                              }}
                              className={cn(
                                "group relative flex flex-col rounded-xl border-2 transition-all duration-200 cursor-pointer overflow-hidden",
                                isSelected
                                  ? "border-cta ring-2 ring-cta/30 shadow-lg shadow-cta/10"
                                  : "border-border hover:border-cta/50 hover:scale-[1.01] hover:shadow-md"
                              )}
                            >
                              {/* Selected indicator */}
                              {isSelected && (
                                <div className="absolute top-2 right-2 z-20 h-5 w-5 rounded-full bg-cta flex items-center justify-center shadow-md">
                                  <Check className="h-3 w-3 text-cta-foreground" />
                                </div>
                              )}

                              {/* Mini video frame preview — 16:9 simulated video */}
                              <div
                                className="relative flex w-full aspect-video overflow-hidden"
                                style={{ background: p.previewBg }}
                              >
                                {/* Fake video content — diagonal light streak */}
                                <div
                                  className="absolute inset-0 opacity-[0.06]"
                                  style={{
                                    background: `linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.4) 50%, transparent 70%)`,
                                  }}
                                />

                                {/* Fake speaker silhouette — subtle circle */}
                                <div
                                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[55%] w-[45%] aspect-square rounded-full opacity-[0.07]"
                                  style={{ background: 'radial-gradient(circle, white 0%, transparent 70%)' }}
                                />

                                {/* Video duration pill */}
                                <div className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded bg-black/40 backdrop-blur-sm">
                                  <span className="text-[7px] font-mono text-white/80">0:47</span>
                                </div>

                                {/* Play button — always visible, subtle */}
                                <div className="absolute inset-0 z-10 flex items-center justify-center">
                                  <div className={cn(
                                    "h-7 w-7 rounded-full flex items-center justify-center transition-all",
                                    isSelected ? "bg-white/15" : "bg-white/10 group-hover:bg-white/20"
                                  )}>
                                    <div className="ml-0.5 w-0 h-0 border-l-[6px] border-l-white/60 border-y-[4px] border-y-transparent" />
                                  </div>
                                </div>

                                {/* Sample subtitle text — positioned based on template style */}
                                <div
                                  className={cn(
                                    "absolute left-0 right-0 z-10 flex justify-center px-3",
                                    p.position === 'center' ? "top-1/2 -translate-y-1/2 mt-4" : p.position === 'lower-third' ? "bottom-2" : "bottom-3"
                                  )}
                                >
                                  <div className="relative inline-flex items-center gap-[3px]">
                                    {p.hasTextBg && (
                                      <div className="absolute inset-0 -m-1.5 rounded" style={{
                                        background: p.textBgColor,
                                        opacity: 0.75,
                                      }} />
                                    )}
                                    {/* Simulated 5-word subtitle with highlight on active word */}
                                    <span className="relative text-[9px] font-bold tracking-wide" style={{ color: p.textColor }}>
                                      This is
                                    </span>
                                    <span
                                      className={cn(
                                        "relative text-[9px] font-bold tracking-wide rounded-sm",
                                        tmpl.id === 'boxed_yellow' ? "px-1 py-px" : "px-0.5"
                                      )}
                                      style={{
                                        color: p.highlightColor,
                                        background: tmpl.id === 'boxed_yellow' ? p.textBgColor : 'transparent',
                                      }}
                                    >
                                      how it
                                    </span>
                                    <span className="relative text-[9px] font-bold tracking-wide" style={{ color: p.textColor }}>
                                      looks
                                    </span>
                                  </div>
                                </div>

                                {/* Audio waveform decoration — bottom edge */}
                                <div className="absolute bottom-0 left-0 right-0 h-3 flex items-end justify-center gap-[1px] px-6 opacity-[0.15]">
                                  {Array.from({ length: 24 }).map((_, i) => (
                                    <div
                                      key={i}
                                      className="w-[2px] rounded-full bg-white"
                                      style={{ height: `${3 + Math.sin(i * 0.8) * 5 + Math.random() * 4}px` }}
                                    />
                                  ))}
                                </div>
                              </div>

                              {/* Template info bar */}
                              <div className="px-3 py-2.5 bg-background border-t border-border/50">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold truncate">{tmpl.name}</span>
                                  <span
                                    className={cn(
                                      "shrink-0 ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium uppercase tracking-wider",
                                      tmpl.category === 'cinematic' && "bg-indigo-950/80 text-indigo-300",
                                      tmpl.category === 'animated' && "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
                                      tmpl.category === 'bold' && "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
                                      tmpl.category === 'minimal' && "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
                                    )}
                                  >
                                    {tmpl.category}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-1">
                                  <p className="text-[10px] text-muted-foreground truncate">{tmpl.description}</p>
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 shrink-0 opacity-70">
                                    {p.animationLabel}
                                  </Badge>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* How it works — compact info */}
                      <div className="rounded-lg bg-muted/40 border border-border/50 px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            After video assembly, the voiceover is auto-transcribed with Whisper to get word-level
                            timestamps. You can review and edit the transcript before burning captions into the video.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </FormItem>
              );
            }}
          />
        )}

        {/* Unified Video Defaults — video pipeline only */}
        {currentPipeline === 'video' && (
          <FormField
            control={form.control}
            name="model_config"
            render={({ field }) => {
              const mc = field.value as BlueprintFormModelConfig;
              const vcd = mc.video_config_defaults || {};
              const setVcd = (patch: Partial<VideoConfigDefaults>) =>
                field.onChange({ ...mc, video_config_defaults: { ...vcd, ...patch } });

              const source = vcd.source || 'prompt_only';
              const orientation = vcd.orientation || 'portrait';
              const voiceMode = vcd.voiceMode || 'voiceover';
              const imageMode = vcd.imageMode || 'none';
              const targetDuration = vcd.targetDuration || 60;

              const SOURCE_OPTIONS = [
                { value: 'prompt_only', label: 'From Scratch', icon: '✨', desc: 'AI generates everything from ideas' },
                { value: 'url', label: 'From URL', icon: '🌐', desc: 'Capture a webpage and narrate it' },
                { value: 'upload_video', label: 'From Video Upload', icon: '🎬', desc: 'Re-edit an existing video' },
                { value: 'upload_images', label: 'From Images', icon: '🖼️', desc: 'Create video from uploaded images' },
              ] as const;

              const VOICE_OPTIONS = [
                { value: 'voiceover', label: 'AI Voiceover' },
                { value: 'avatar', label: 'AI Avatar' },
                { value: 'none', label: 'No Voice' },
              ] as const;

              return (
                <FormItem className="space-y-5">
                  <div className="flex items-center gap-2">
                    <Film className="h-5 w-5 text-cta" />
                    <FormLabel className="text-base font-medium">Video Defaults</FormLabel>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-3">
                    Pre-fill the wizard config for blueprints using this pipeline.
                  </p>

                  {/* Source */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Source Material</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {SOURCE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setVcd({ source: opt.value })}
                          className={cn(
                            "flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all",
                            source === opt.value
                              ? "border-cta bg-cta/5"
                              : "border-border hover:border-cta/30"
                          )}
                        >
                          <span className="text-lg leading-none">{opt.icon}</span>
                          <span className="text-xs font-semibold">{opt.label}</span>
                          <span className="text-[10px] text-muted-foreground leading-tight">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Orientation */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Orientation</Label>
                    <div className="flex gap-2">
                      {(['portrait', 'landscape'] as const).map((o) => (
                        <button
                          key={o}
                          type="button"
                          onClick={() => setVcd({ orientation: o })}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-2 rounded-lg border-2 py-2.5 transition-all text-sm font-medium",
                            orientation === o
                              ? "border-cta bg-cta/5"
                              : "border-border hover:border-cta/30"
                          )}
                        >
                          <div className={cn(
                            "border-2 rounded-sm",
                            o === 'portrait' ? "w-3 h-4" : "w-4 h-3",
                            orientation === o ? "border-cta" : "border-muted-foreground/40"
                          )} />
                          {o === 'portrait' ? 'Portrait 9:16' : 'Landscape 16:9'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Voice */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Voice</Label>
                    <div className="flex gap-2">
                      {VOICE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setVcd({ voiceMode: opt.value })}
                          className={cn(
                            "flex-1 rounded-lg border-2 py-2.5 text-sm font-medium transition-all",
                            voiceMode === opt.value
                              ? "border-cta bg-cta/5"
                              : "border-border hover:border-cta/30"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* AI Images toggle */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setVcd({ imageMode: imageMode === 'ai_generated' ? 'none' : 'ai_generated' })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setVcd({ imageMode: imageMode === 'ai_generated' ? 'none' : 'ai_generated' });
                      }
                    }}
                    className={cn(
                      "flex items-center gap-4 rounded-xl border-2 p-4 transition-all cursor-pointer",
                      imageMode === 'ai_generated'
                        ? "border-cta bg-cta/5"
                        : "border-border hover:border-cta/30"
                    )}
                  >
                    <div className={cn(
                      "shrink-0 h-10 w-10 rounded-lg flex items-center justify-center transition-colors",
                      imageMode === 'ai_generated' ? "bg-cta/15" : "bg-muted"
                    )}>
                      <ImageIcon className={cn("h-5 w-5", imageMode === 'ai_generated' ? "text-cta" : "text-muted-foreground")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">AI-Generated Scene Images</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Generate images for each shot using the image model
                      </div>
                    </div>
                    <Switch
                      checked={imageMode === 'ai_generated'}
                      onCheckedChange={(checked) => setVcd({ imageMode: checked ? 'ai_generated' : 'none' })}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  {/* Auto-generate Post Caption */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setVcd({ generate_post_caption: !vcd.generate_post_caption })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setVcd({ generate_post_caption: !vcd.generate_post_caption });
                      }
                    }}
                    className={cn(
                      "flex items-center gap-4 rounded-xl border-2 p-4 transition-all cursor-pointer",
                      vcd.generate_post_caption
                        ? "border-cta bg-cta/5"
                        : "border-border hover:border-cta/30"
                    )}
                  >
                    <div className={cn(
                      "shrink-0 h-10 w-10 rounded-lg flex items-center justify-center transition-colors",
                      vcd.generate_post_caption ? "bg-cta/15" : "bg-muted"
                    )}>
                      <Subtitles className={cn("h-5 w-5", vcd.generate_post_caption ? "text-cta" : "text-muted-foreground")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">Auto-generate Post Caption</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Generate a social media caption after video composition. Required for autopilot publishing.
                      </div>
                    </div>
                    <Switch
                      checked={!!vcd.generate_post_caption}
                      onCheckedChange={(checked) => setVcd({ generate_post_caption: checked })}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  {/* Target Duration — only for prompt_only source */}
                  {source === 'prompt_only' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Target Duration</Label>
                        <span className="text-xs text-muted-foreground font-mono">
                          {targetDuration >= 60
                            ? `${Math.floor(targetDuration / 60)}m ${targetDuration % 60 ? `${targetDuration % 60}s` : ''}`
                            : `${targetDuration}s`}
                        </span>
                      </div>
                      <Slider
                        value={[targetDuration]}
                        onValueChange={([v]) => setVcd({ targetDuration: v })}
                        min={15}
                        max={900}
                        step={15}
                        className="py-2"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>15s</span>
                        <span>5m</span>
                        <span>15m</span>
                      </div>
                    </div>
                  )}
                </FormItem>
              );
            }}
          />
        )}

        <Button
          type="submit"
          variant="cta"
          disabled={isSubmitting}
          className="w-full"
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </form>
    </Form>
  );
}
