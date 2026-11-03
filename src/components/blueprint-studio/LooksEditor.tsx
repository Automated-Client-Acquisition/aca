import { useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useLibraryImages } from "@/hooks/useLibraryImages";
import type { ImageStyleId } from "@/lib/blueprint-brief";
import { getImageReferences, referencesFromLegacyLibraries, uploadReferenceImages } from "@/lib/image-references";
import {
  LOOK_SWATCH,
  MAX_LOOK_IMAGES,
  MAX_LOOKS,
  PRESET_STYLES,
  describeLook,
  effectiveLooks,
  lookMode,
  newLookId,
  presetLook,
  withLooks,
  type ImageLook,
  type LookMode,
} from "@/lib/image-looks";
import { cn } from "@/lib/utils";
import { PhotoPickerDialog } from "./ReferencesEditor";
import { FieldLabel, Segmented } from "./StudioSection";
import { recompile, type StudioDraft } from "./draft";

/** A look's picture: its reference images, or its preset's swatch. */
export function LookThumb({ look, size = "md" }: { look: Pick<ImageLook, "kind" | "images" | "preset">; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-6 w-6" : "h-9 w-9";
  if (look.kind === "reference" && look.images?.length) {
    return (
      <div className="flex shrink-0 -space-x-2">
        {look.images.slice(0, MAX_LOOK_IMAGES).map((u) => (
          <img key={u} src={u} alt="" className={cn(box, "rounded border-2 border-card object-cover")} />
        ))}
      </div>
    );
  }
  return <div className={cn(box, "shrink-0 rounded border")} style={{ background: LOOK_SWATCH[look.preset ?? "auto"] ?? LOOK_SWATCH.auto }} />;
}

interface LooksEditorProps {
  draft: StudioDraft;
  onChange: (draft: StudioDraft) => void;
  /** Written presets only reach the image writer of posts and single images. */
  allowPresets: boolean;
}

export function LooksEditor({ draft, onChange, allowPresets }: LooksEditorProps) {
  const { currentOrganization } = useAuth();
  const { libraryImages } = useLibraryImages();
  // Descriptions arrive after other edits may have happened: always build on the latest draft.
  const latest = useRef(draft);
  latest.current = draft;
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [describing, setDescribing] = useState<Record<string, boolean>>({});

  const mc = draft.model_config;
  const looks = effectiveLooks(mc);
  const mode = lookMode(mc);
  const fixedId = mode === "fixed" ? (looks.find((l) => l.id === mc.look_fixed_id) ?? looks[0])?.id : null;
  const presetsLeft = PRESET_STYLES.filter((s) => !looks.some((l) => l.kind === "preset" && l.preset === s.id));

  const commit = (nextLooks: ImageLook[], patch: { look_mode?: LookMode; look_fixed_id?: string | null } = {}) => {
    const d = latest.current;
    let next: StudioDraft = { ...d, model_config: withLooks(d.model_config, nextLooks, patch) };
    // A look made from images switches the blueprint to explicit references;
    // keep what the old "every library photo" setting sent as run references.
    if (nextLooks.some((l) => l.kind === "reference") && getImageReferences(d.model_config) === null && d.reference_image_libraries.length > 0) {
      next = {
        ...next,
        reference_image_libraries: [],
        model_config: { ...next.model_config, image_references: referencesFromLegacyLibraries(d.reference_image_libraries) },
      };
    }
    const compiled = recompile(next);
    latest.current = compiled;
    onChange(compiled);
  };
  const current = () => effectiveLooks(latest.current.model_config);
  const patchLook = (id: string, patch: Partial<ImageLook>) => commit(current().map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const describe = async (look: ImageLook) => {
    if (!currentOrganization || !look.images?.length) return;
    setDescribing((s) => ({ ...s, [look.id]: true }));
    try {
      const text = await describeLook(currentOrganization.id, look.images);
      if (current().some((l) => l.id === look.id)) patchLook(look.id, { description: text });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't describe this look");
    } finally {
      setDescribing((s) => ({ ...s, [look.id]: false }));
    }
  };

  const addReference = (images: string[], label: string) => {
    const look: ImageLook = { id: newLookId(), label: label || "Look", kind: "reference", images: images.slice(0, MAX_LOOK_IMAGES) };
    commit([...current(), look]);
    void describe(look);
  };

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls = await uploadReferenceImages([...files].slice(0, MAX_LOOK_IMAGES));
      addReference(urls, files[0].name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 40));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const chooseLook = (id: string) => commit(current(), { look_mode: "fixed", look_fixed_id: id });
  const setMode = (m: LookMode) => commit(current(), { look_mode: m, ...(m === "fixed" && !mc.look_fixed_id ? { look_fixed_id: looks[0]?.id } : {}) });

  return (
    <div className="space-y-3">
      <FieldLabel hint="Each post uses one look. Brand, products and people stay the same in every look.">Looks</FieldLabel>

      {looks.length >= 2 && (
        <Segmented
          ariaLabel="How posts get a look"
          options={[
            { id: "rotate", label: "Take turns" },
            { id: "fixed", label: "One look" },
          ]}
          value={mode}
          onChange={setMode}
        />
      )}

      {looks.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
          No look set, so each image follows its post. Add two or more looks and posts take them in turn.
        </div>
      ) : (
        <div className="space-y-1.5">
          {looks.map((look, i) => {
            const inUse = fixedId === look.id;
            const busy = !!describing[look.id];
            return (
              <div key={look.id} className={cn("rounded-lg border bg-background p-2", inUse && looks.length > 1 && "border-foreground ring-1 ring-foreground")}>
                <div className="flex items-center gap-2.5">
                  <LookThumb look={look} />
                  <div className="min-w-0 flex-1">
                    <input
                      value={look.label}
                      onChange={(e) => patchLook(look.id, { label: e.target.value.slice(0, 60) })}
                      className="w-full truncate bg-transparent text-xs font-medium outline-none focus:underline"
                      aria-label="Look name"
                    />
                    <div className="truncate text-[11px] text-muted-foreground">
                      {look.kind === "preset"
                        ? "Written style"
                        : `${look.images?.length ?? 0} image${look.images?.length === 1 ? "" : "s"} · its style, not its subject`}
                    </div>
                  </div>
                  {mode === "fixed" && looks.length > 1 ? (
                    inUse ? (
                      <span className="shrink-0 text-[11px] font-medium">In use</span>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => chooseLook(look.id)}>
                        Use
                      </Button>
                    )
                  ) : looks.length > 1 ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" title="Turn order">
                      {i + 1}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => commit(current().filter((l) => l.id !== look.id))}
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label={`Remove ${look.label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {look.kind === "reference" && (
                  <div className="mt-2">
                    <Textarea
                      rows={2}
                      value={look.description ?? ""}
                      disabled={busy}
                      placeholder={busy ? "Describing the look..." : "The look in words, sent with the images. Leave empty to describe it on every run."}
                      onChange={(e) => patchLook(look.id, { description: e.target.value })}
                      className="min-h-0 resize-none text-xs"
                      aria-label={`How ${look.label} is described`}
                    />
                    <div className="mt-1 flex justify-end">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void describe(look)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        {look.description ? "Describe again" : "Describe it"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {looks.length < MAX_LOOKS && (
        <div className="flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={uploading}>
                {uploading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                Look from images
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuItem className="text-xs" onClick={() => fileInput.current?.click()}>
                <ImagePlus className="mr-2 h-3.5 w-3.5" />
                Upload 1 or 2 images...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs" onClick={() => setPickerOpen(true)}>
                From Library Images...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {allowPresets && presetsLeft.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Preset look
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {presetsLeft.map((s) => (
                  <DropdownMenuItem key={s.id} className="gap-2 text-xs" onClick={() => commit([...current(), presetLook(s.id as ImageStyleId)])}>
                    <LookThumb look={{ kind: "preset", preset: s.id }} size="sm" />
                    {s.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {looks.length >= 2 && mode === "rotate"
          ? `Posts use the looks in this order, then start again. Each autopilot keeps its own turn. Up to ${MAX_LOOKS} looks.`
          : `A look from images copies their style (medium, light, colours, type), never their subject. Up to ${MAX_LOOKS} looks.`}
      </p>

      <PhotoPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Style reference"
        description="Pick 1 or 2 images of the same style. The posts will match this look, not copy its subject."
        max={MAX_LOOK_IMAGES}
        groups={(libraryImages ?? []).map((li) => ({ id: li.id, name: li.name, photos: li.images ?? [] }))}
        emptyHint="No Library Images yet. Upload images instead."
        onConfirm={(group, photos) => addReference(photos, group.name)}
      />
    </div>
  );
}
