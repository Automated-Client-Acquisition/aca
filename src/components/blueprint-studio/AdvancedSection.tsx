import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelector } from "@/components/ModelSelector";
import { QUALITY_TIERS, applyQualityTier, detectQualityTier, type QualityTier } from "@/lib/blueprint-brief";
import type { PipelineId } from "@/types/pipeline";
import { FieldLabel, Segmented } from "./StudioSection";
import { draftFormat, type StudioDraft } from "./draft";
import { PromptPillEditor } from "./PromptPillEditor";

interface AdvancedSectionProps {
  draft: StudioDraft;
  onChange: (draft: StudioDraft) => void;
  onOpenClassic: () => void;
  customModels: boolean;
  onCustomModelsChange: (on: boolean) => void;
}

export function qualitySummary(draft: StudioDraft): string {
  const tier = detectQualityTier(draft.model_config);
  return tier === "custom" ? "Custom models" : QUALITY_TIERS.find((t) => t.id === tier)!.label;
}

export function AdvancedSection({ draft, onChange, onOpenClassic, customModels, onCustomModelsChange }: AdvancedSectionProps) {
  const format = draftFormat(draft);
  const tier = detectQualityTier(draft.model_config);
  const shownTier: QualityTier | "custom" = customModels ? "custom" : tier;
  const makesImages = format === "post" || draft.pipeline === "instagram_carousel_ai";

  return (
    <>
      <div>
        <FieldLabel hint="Models run on your workspace API keys. If a model is withdrawn, the blueprint says so before it fails.">Quality</FieldLabel>
        <Segmented
          ariaLabel="Quality"
          options={[...QUALITY_TIERS.map((t) => ({ id: t.id, label: t.label })), { id: "custom" as const, label: "Custom" }]}
          value={shownTier}
          onChange={(id) => {
            if (id === "custom") return onCustomModelsChange(true);
            onCustomModelsChange(false);
            if (format) onChange({ ...draft, model_config: applyQualityTier(draft.model_config, id, format, draft.pipeline ?? "") });
          }}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {shownTier === "custom" ? "Pick exact models below." : QUALITY_TIERS.find((t) => t.id === shownTier)?.blurb}
        </p>
      </div>

      {shownTier === "custom" && (
        <ModelSelector
          value={draft.model_config as any}
          onChange={(model_config) => onChange({ ...draft, model_config: { ...(model_config as any), quality: undefined } })}
          pipeline={(draft.pipeline ?? undefined) as PipelineId | undefined}
        />
      )}

      {makesImages && (
        <PromptPillEditor
          id="studio-image-prompt"
          label="Image prompt (optional, replaces the image style)"
          value={draft.image_prompt}
          onChange={(image_prompt) => onChange({ ...draft, image_prompt })}
          placeholder="Leave empty: each image is written from the post and the image style. Here, only flat variables work: {{topic}}, {{caption}}, {{brand_visual_style}}."
          minRows={4}
        />
      )}

      {format === "video" && (
        <PromptPillEditor
          id="studio-director-prompt"
          label="Video direction (optional)"
          value={draft.director_prompt}
          onChange={(director_prompt) => onChange({ ...draft, director_prompt })}
          placeholder="Pacing, shot types, on-screen text. Leave empty for smart defaults."
          minRows={5}
        />
      )}

      <div>
        <FieldLabel>Description</FieldLabel>
        <Textarea
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          placeholder="What this blueprint is for, for your team"
          rows={2}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-3 py-2.5">
        <span className="flex-1 min-w-[200px] text-xs text-muted-foreground">
          Every setting, including carousel palettes, backgrounds and HeyGen templates, is in the classic editor.
        </span>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onOpenClassic}>
          <Settings2 className="mr-1 h-3.5 w-3.5" />
          Classic editor
        </Button>
      </div>
    </>
  );
}
