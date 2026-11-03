import { FileText, GalleryHorizontalEnd, Image as ImageIcon, MessagesSquare, Newspaper, Clapperboard } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { FORMATS, FORMAT_ORDER, type BlueprintFormat } from "@/lib/blueprint-brief";
import { cn } from "@/lib/utils";
import { ChoiceChips, FieldLabel, Segmented } from "./StudioSection";
import { changeFormat, draftFormat, recompile, withFormatDefaults, type StudioDraft } from "./draft";

export const FORMAT_ICON: Record<BlueprintFormat, React.ElementType> = {
  post: FileText,
  carousel: GalleryHorizontalEnd,
  article: Newspaper,
  thread: MessagesSquare,
  video: Clapperboard,
  image: ImageIcon,
};

export function FormatTiles({ value, onPick }: { value: BlueprintFormat | null; onPick: (f: BlueprintFormat) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Format">
      {FORMAT_ORDER.map((f) => {
        const Icon = FORMAT_ICON[f];
        const selected = value === f;
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(f)}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
              selected ? "border-foreground bg-card ring-1 ring-foreground" : "bg-background hover:border-foreground/40",
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[13px] font-semibold">{FORMATS[f].label}</span>
            <span className="text-[11px] leading-tight text-muted-foreground">{FORMATS[f].hint}</span>
          </button>
        );
      })}
    </div>
  );
}

interface FormatSectionProps {
  draft: StudioDraft;
  onChange: (draft: StudioDraft) => void;
}

export function FormatSection({ draft, onChange }: FormatSectionProps) {
  const format = draftFormat(draft);

  return (
    <>
      <FormatTiles value={format} onPick={(f) => onChange(changeFormat(draft, f))} />

      {!format && draft.pipeline && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          This blueprint uses a format the Studio doesn't edit yet. Its settings live in the classic editor (Advanced).
        </p>
      )}

      {format && draft.brief && FORMATS[format].platforms.length > 1 && (
        <div>
          <FieldLabel>{format === "article" ? "Kind" : "Platform"}</FieldLabel>
          <ChoiceChips
            ariaLabel="Platform"
            options={FORMATS[format].platforms}
            value={draft.brief.platform}
            onChange={(platform) => onChange(recompile({ ...draft, brief: { ...draft.brief!, platform } }))}
          />
        </div>
      )}

      {format === "post" && (
        <label className="flex items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">Add an image</span>
            <span className="block text-xs text-muted-foreground">Off makes a text-only post and needs no image model.</span>
          </span>
          <Switch
            checked={!draft.skip_image_generation}
            onCheckedChange={(on) => onChange({ ...draft, skip_image_generation: !on })}
            aria-label="Add an image"
          />
        </label>
      )}

      {format === "carousel" && (
        <div>
          <FieldLabel hint="Branded slides are fast and use your brand colours. AI images look richer and cost more.">Slide style</FieldLabel>
          <Segmented
            ariaLabel="Slide style"
            options={[
              { id: "instagram_carousel", label: "Branded template" },
              { id: "instagram_carousel_ai", label: "AI images" },
            ]}
            value={draft.pipeline === "instagram_carousel_ai" ? "instagram_carousel_ai" : "instagram_carousel"}
            onChange={(pipeline) => onChange(recompile(withFormatDefaults({ ...draft, pipeline }, "carousel")))}
          />
        </div>
      )}
    </>
  );
}
