import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CAROUSEL_TEMPLATES, resolveCarouselTemplateId } from "@/data/carouselTemplates";
import { cn } from "@/lib/utils";
import { FieldLabel, Segmented } from "./StudioSection";
import { draftFormat, recompile, type StudioDraft } from "./draft";
import { ReferencesEditor } from "./ReferencesEditor";
import { LooksEditor } from "./LooksEditor";
import { ImageTemplateChooser } from "./ImageTemplateChooser";
import { getImageReferences } from "@/lib/image-references";
import { effectiveLooks, lookMode } from "@/lib/image-looks";


const SUBTITLE_STYLES = [
  { id: "tiktok_bounce", label: "Bounce" },
  { id: "big_center", label: "Big centre" },
  { id: "karaoke", label: "Karaoke" },
  { id: "minimal", label: "Minimal" },
];

/** Carousels are 4:5 unless the blueprint explicitly chose square. */
function carouselShape(mc: { output_config_defaults?: { aspectRatio?: string } }): "portrait" | "square" {
  const ar = mc.output_config_defaults?.aspectRatio;
  return ar === "square" || ar === "1:1" ? "square" : "portrait";
}

/** Does this draft have anything to set in Look? */
export function hasLook(draft: StudioDraft): boolean {
  const f = draftFormat(draft);
  return f === "image" || f === "carousel" || f === "video" || (f === "post" && !draft.skip_image_generation);
}

export function lookSummary(draft: StudioDraft): string {
  const f = draftFormat(draft);
  const mc = draft.model_config;
  if (f === "carousel" && draft.pipeline === "instagram_carousel") {
    const t = CAROUSEL_TEMPLATES.find((x) => x.id === resolveCarouselTemplateId(mc.carousel_template));
    const shape = carouselShape(mc) === "square" ? "square" : "4:5";
    return `${t?.name ?? "Template"} · ${mc.carousel_slide_count ?? 5} slides · ${shape}`;
  }
  if (f === "carousel") {
    return `${mc.carousel_slide_count ?? 5} slides · ${carouselShape(mc) === "square" ? "square" : "4:5"}`;
  }
  if (f === "video") {
    const v = mc.video_config_defaults ?? {};
    return `${v.orientation === "landscape" ? "Landscape" : "Vertical"} · ${v.voiceMode === "none" ? "no voice" : "voiceover"} · captions`;
  }
  if ((f === "post" || f === "image") && mc.image_template_name) {
    return `${String(mc.image_template_name).replace(/^Infographic:\s*/, "")} · ${mc.output_config_defaults?.aspectRatio ?? "square"}`;
  }
  const looks = effectiveLooks(mc);
  const fixed = lookMode(mc) === "fixed" ? looks.find((l) => l.id === mc.look_fixed_id) ?? looks[0] : null;
  const look =
    looks.length === 0 ? "Match the post" : looks.length === 1 ? looks[0].label : fixed ? fixed.label : `${looks.length} looks, taking turns`;
  const shape = mc.output_config_defaults?.aspectRatio ?? "square";
  const refs = (getImageReferences(mc) ?? []).filter((r) => r.role !== "style").length;
  return `${look} · ${shape}${refs ? ` · ${refs} reference${refs === 1 ? "" : "s"}` : ""}`;
}

interface LookSectionProps {
  draft: StudioDraft;
  onChange: (draft: StudioDraft) => void;
}

export function LookSection({ draft, onChange }: LookSectionProps) {
  const f = draftFormat(draft);
  const mc = draft.model_config;
  const setMc = (patch: Record<string, unknown>) => onChange(recompile({ ...draft, model_config: { ...mc, ...patch } }));
  const vcd = mc.video_config_defaults ?? {};
  const setVideo = (patch: Record<string, unknown>) => setMc({ video_config_defaults: { ...vcd, ...patch } });

  const makesAiImages = f === "image" || (f === "post" && !draft.skip_image_generation) || draft.pipeline === "instagram_carousel_ai";

  return (
    <>
      {f === "carousel" && (
        <div>
          <FieldLabel>Slides</FieldLabel>
          <Segmented
            ariaLabel="Slide count"
            options={[5, 7, 10].map((n) => ({ id: String(n), label: String(n) }))}
            value={String(mc.carousel_slide_count ?? 5)}
            onChange={(n) => setMc({ carousel_slide_count: Number(n) })}
          />
        </div>
      )}

      {f === "carousel" && draft.pipeline === "instagram_carousel" && (
        <div>
          <FieldLabel hint="Your brand voice colours are used when it has them. Layouts follow each slide's content.">Template</FieldLabel>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {CAROUSEL_TEMPLATES.map((t) => {
              const selected = resolveCarouselTemplateId(mc.carousel_template) === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMc({ carousel_template: t.id })}
                  className={cn(
                    "overflow-hidden rounded-lg border text-left transition-colors",
                    selected ? "border-foreground ring-1 ring-foreground" : "hover:border-foreground/40",
                  )}
                  title={t.description}
                >
                  <div className="flex h-14">
                    <div className="flex-1" style={{ background: t.preview.coverBg }} />
                    <div className="flex-1" style={{ background: t.preview.contentBg }} />
                  </div>
                  <div className="truncate px-2 py-1.5 text-[11px] font-medium">{t.name}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {f === "carousel" && (
        <div>
          <FieldLabel hint="Portrait 4:5 is the tallest a feed carousel can be on Instagram and LinkedIn. Autopilots use this shape too.">Shape</FieldLabel>
          <Segmented
            ariaLabel="Slide shape"
            options={[
              { id: "portrait", label: "Portrait 4:5" },
              { id: "square", label: "Square 1:1" },
            ]}
            value={carouselShape(mc)}
            onChange={(aspectRatio) => setMc({ output_config_defaults: { ...(mc.output_config_defaults ?? {}), aspectRatio } })}
          />
        </div>
      )}

      {f === "carousel" && draft.pipeline === "instagram_carousel" && (
        <>
          <div>
            <FieldLabel hint="Shown under your brand name in the header of every slide. Leave empty to show the name only.">Handle shown on slides</FieldLabel>
            <Input
              value={mc.carousel_handle ?? ""}
              onChange={(e) => setMc({ carousel_handle: e.target.value.replace(/\s/g, "") })}
              placeholder="@yourhandle"
              aria-label="Handle shown on slides"
              className="max-w-xs"
            />
          </div>
        </>
      )}

      {f === "post" && makesAiImages && <ImageTemplateChooser draft={draft} onChange={onChange} />}

      {(makesAiImages || f === "video") && !(f === "post" && mc.image_template_id) && (
        <LooksEditor draft={draft} onChange={onChange} allowPresets={f === "post" || f === "image"} />
      )}

      {(f === "post" || f === "image") && (
        <div>
          <FieldLabel>Shape</FieldLabel>
          <Segmented
            ariaLabel="Image shape"
            options={[
              { id: "square", label: "Square 1:1" },
              { id: "portrait", label: "Tall 9:16" },
              { id: "landscape", label: "Wide 16:9" },
            ]}
            value={mc.output_config_defaults?.aspectRatio ?? "square"}
            onChange={(aspectRatio) => setMc({ output_config_defaults: { ...(mc.output_config_defaults ?? {}), aspectRatio } })}
          />
        </div>
      )}

      {(makesAiImages || f === "video") && <ReferencesEditor draft={draft} onChange={onChange} />}

      {f === "video" && (
        <>
          <div>
            <FieldLabel>Orientation</FieldLabel>
            <Segmented
              ariaLabel="Orientation"
              options={[
                { id: "portrait", label: "Vertical 9:16" },
                { id: "landscape", label: "Wide 16:9" },
              ]}
              value={vcd.orientation ?? "portrait"}
              onChange={(orientation) => setVideo({ orientation })}
            />
          </div>
          <div>
            <FieldLabel hint="Voices come from the person in Context, or a library voice.">Voice</FieldLabel>
            <Segmented
              ariaLabel="Voice"
              options={[
                { id: "voiceover", label: "Voiceover" },
                { id: "avatar", label: "Talking avatar" },
                { id: "none", label: "No voice" },
              ]}
              value={vcd.voiceMode ?? "voiceover"}
              onChange={(voiceMode) => setVideo({ voiceMode })}
            />
          </div>
          <div>
            <FieldLabel>Visuals</FieldLabel>
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2">
                <span className="text-[13px]">AI-generated scenes</span>
                <Switch
                  checked={(vcd.imageMode ?? "ai_generated") === "ai_generated"}
                  onCheckedChange={(on) => setVideo({ imageMode: on ? "ai_generated" : "none" })}
                  aria-label="AI-generated scenes"
                />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2">
                <span className="text-[13px]">Stock B-roll between scenes</span>
                <Switch checked={!!vcd.bRollEnabled} onCheckedChange={(bRollEnabled) => setVideo({ bRollEnabled })} aria-label="B-roll" />
              </label>
            </div>
          </div>
          <div>
            <FieldLabel>Captions</FieldLabel>
            <Segmented
              ariaLabel="Caption style"
              options={SUBTITLE_STYLES}
              value={vcd.subtitleStyle ?? "tiktok_bounce"}
              onChange={(subtitleStyle) => setVideo({ subtitleStyle })}
            />
          </div>
        </>
      )}
    </>
  );
}
