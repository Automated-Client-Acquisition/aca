import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ImagePlus, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBrandKit } from "@/hooks/useBrandKit";
import { useLibraryImages } from "@/hooks/useLibraryImages";
import {
  MAX_IMAGES_PER_ROLE,
  maxImagesFor,
  REFERENCE_ROLES,
  ROLE_META,
  elementPhotos,
  getImageReferences,
  newReferenceId,
  referenceMode,
  referencesFromLegacyLibraries,
  uploadReferenceImages,
  type ImageReferenceSpec,
  type ReferenceMode,
  type ReferenceRole,
} from "@/lib/image-references";
import { KIND_ASSETS_TAB, type LibraryKind } from "@/lib/blueprint-context";
import { cn } from "@/lib/utils";
import type { StudioDraft } from "./draft";
import { Segmented } from "./StudioSection";

interface PhotoGroup {
  id: string;
  name: string;
  photos: string[];
}

/** Pick up to `max` photos from one group (a product, a person, a Library Images set). */
export function PhotoPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  groups,
  max = MAX_IMAGES_PER_ROLE,
  emptyHint,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  groups: PhotoGroup[];
  max?: number;
  emptyHint: React.ReactNode;
  onConfirm: (group: PhotoGroup, photos: string[]) => void;
}) {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (g: PhotoGroup, url: string) => {
    if (groupId !== g.id) {
      setGroupId(g.id);
      setPicked([url]);
      return;
    }
    setPicked((p) => (p.includes(url) ? p.filter((u) => u !== url) : p.length >= max ? [...p.slice(1), url] : [...p, url]));
  };

  const withPhotos = groups.filter((g) => g.photos.length > 0);
  const selectedGroup = withPhotos.find((g) => g.id === groupId);

  const close = () => {
    setGroupId(null);
    setPicked([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {withPhotos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <div className="space-y-5">
            {withPhotos.map((g) => (
              <div key={g.id}>
                <div className="mb-2 text-sm font-semibold">{g.name}</div>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {g.photos.map((url) => {
                    const on = groupId === g.id && picked.includes(url);
                    return (
                      <button
                        key={url}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(g, url)}
                        className={cn("relative aspect-square overflow-hidden rounded-md border-2", on ? "border-foreground" : "border-transparent hover:border-muted-foreground/40")}
                      >
                        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        {on && (
                          <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {picked.length > 0 ? `${picked.length} of ${max} photos picked` : `Pick up to ${max} photos from one ${title.toLowerCase().includes("style") ? "set" : "item"}`}
          </span>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="cta"
            disabled={!selectedGroup || picked.length === 0}
            onClick={() => {
              if (selectedGroup) onConfirm(selectedGroup, picked);
              close();
            }}
          >
            Use these photos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function sourceLabel(ref: ImageReferenceSpec): string {
  if (ref.source === "run") return ref.role === "product" ? "Whichever product the run uses" : "Whichever person the run uses";
  if (ref.source === "library") return `${ref.images?.length ?? 0} photo${(ref.images?.length ?? 0) === 1 ? "" : "s"} from the Brand Kit`;
  return `Uploaded · ${ref.images?.length ?? 0} photo${(ref.images?.length ?? 0) === 1 ? "" : "s"}`;
}

interface ReferencesEditorProps {
  draft: StudioDraft;
  onChange: (draft: StudioDraft) => void;
}

export function ReferencesEditor({ draft, onChange }: ReferencesEditorProps) {
  const { lists, resolve } = useBrandKit();
  const { libraryImages } = useLibraryImages();
  const refs = getImageReferences(draft.model_config);
  const legacyLibraries = draft.reference_image_libraries;
  const [picker, setPicker] = useState<{ role: ReferenceRole; source: "brand_kit" | "library_images" } | null>(null);
  // Kept after close so the dialog doesn't swap wording while it animates out.
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = (next: { role: ReferenceRole; source: "brand_kit" | "library_images" }) => {
    setPicker(next);
    setPickerOpen(true);
  };
  const [uploadingRole, setUploadingRole] = useState<ReferenceRole | null>(null);
  const fileInputs = useRef<Partial<Record<ReferenceRole, HTMLInputElement | null>>>({});

  const setRefs = (next: ImageReferenceSpec[]) =>
    onChange({
      ...draft,
      // Explicit references replace the old "whole library" behaviour.
      reference_image_libraries: [],
      model_config: { ...draft.model_config, image_references: next },
    });
  const current = refs ?? [];

  const convertLegacy = () => setRefs(referencesFromLegacyLibraries(legacyLibraries));

  const setMode = (role: ReferenceRole, mode: ReferenceMode) =>
    onChange({
      ...draft,
      model_config: { ...draft.model_config, reference_modes: { ...(draft.model_config.reference_modes ?? {}), [role]: mode } },
    });

  const onUpload = async (role: ReferenceRole, files: FileList | null) => {
    if (!files?.length) return;
    setUploadingRole(role);
    try {
      const urls = await uploadReferenceImages([...files].slice(0, maxImagesFor(role)));
      const label = files[0].name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 40);
      setRefs([...current, { id: newReferenceId(), role, source: "upload", images: urls, label }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingRole(null);
      const input = fileInputs.current[role];
      if (input) input.value = "";
    }
  };

  const pickerGroups: PhotoGroup[] =
    picker?.source === "library_images"
      ? (libraryImages ?? []).map((li) => ({ id: li.id, name: li.name, photos: li.images ?? [] }))
      : picker
        ? lists[ROLE_META[picker.role].kind as LibraryKind].map((el) => ({
            id: el.id,
            name: el.name,
            photos: elementPhotos(ROLE_META[picker.role].kind as LibraryKind, el),
          }))
        : [];

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-semibold text-foreground/80">References</div>
        <div className="text-xs text-muted-foreground">
          Photos the image model works from. Each one is told what it's for, so products and faces stay true.
        </div>
      </div>

      {refs === null && legacyLibraries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <span className="min-w-[200px] flex-1">
            This blueprint sends every photo from whole libraries ({legacyLibraries.map((t) => t.replace("library_", "").replace("_", " ")).join(", ")}), without saying what each is for.
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={convertLegacy}>
            Switch to specific references
          </Button>
        </div>
      )}

      {REFERENCE_ROLES.filter((role) => role !== "style").map((role) => {
        const meta = ROLE_META[role];
        const kind = meta.kind;
        const mine = current.filter((r) => r.role === role);
        const hasRunRef = mine.some((r) => r.source === "run");
        // The run's element: this blueprint's pin, else the Brand Kit default.
        const runEl = kind ? resolve(kind, draft.context?.[kind]?.element_id)?.element : undefined;
        const photosOf = (ref: ImageReferenceSpec) =>
          ref.source === "run" && kind ? elementPhotos(kind, runEl as any).slice(0, maxImagesFor(role)) : (ref.images ?? []).slice(0, maxImagesFor(role));
        const photoCount = new Set(mine.flatMap(photosOf)).size;
        const mode = referenceMode(draft.model_config, role);
        return (
          <div key={role} className="rounded-lg border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">{meta.title}</div>
                <div className="text-xs text-muted-foreground">{meta.tells}</div>
              </div>
              <input
                ref={(el) => {
                  fileInputs.current[role] = el;
                }}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onUpload(role, e.target.files)}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" disabled={uploadingRole === role}>
                    {uploadingRole === role ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                    Add
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {kind && (
                    <>
                      <DropdownMenuItem
                        className="text-xs"
                        disabled={hasRunRef}
                        onClick={() => setRefs([...current, { id: newReferenceId(), role, source: "run" }])}
                      >
                        Whichever {kind} the run uses
                        {runEl ? ` (now ${runEl.name})` : ""}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-xs" onClick={() => openPicker({ role, source: "brand_kit" })}>
                        Photos of a specific {kind}...
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem className="text-xs" onClick={() => openPicker({ role, source: "library_images" })}>
                    From Library Images...
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-xs" onClick={() => fileInputs.current[role]?.click()}>
                    <ImagePlus className="mr-2 h-3.5 w-3.5" />
                    Upload photos...
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {mine.length > 0 && (
              <div className="mt-2.5 space-y-1.5">
                {mine.map((ref) => {
                  const photos = photosOf(ref);
                  return (
                    <div key={ref.id} className="flex items-center gap-2.5 rounded-md border bg-card p-1.5 pr-2">
                      <div className="flex shrink-0 -space-x-2">
                        {photos.length > 0 ? (
                          photos.map((u) => <img key={u} src={u} alt="" className="h-9 w-9 rounded border-2 border-card object-cover" />)
                        ) : (
                          <div className="grid h-9 w-9 place-items-center rounded bg-muted text-[10px] text-muted-foreground">none</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{ref.label || (ref.source === "run" ? runEl?.name ?? "Not set" : meta.title)}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{sourceLabel(ref)}</div>
                        {ref.source === "run" && kind && photos.length === 0 && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-400">
                            {runEl ? `${runEl.name} has no photos yet.` : `No ${kind} in the Brand Kit yet.`}{" "}
                            <Link to={`/assets?tab=${KIND_ASSETS_TAB[kind]}`} className="underline underline-offset-2">
                              Add some
                            </Link>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setRefs(current.filter((r) => r.id !== ref.id))}
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                        aria-label={`Remove ${ref.label || meta.title}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {photoCount >= 2 &&
              (role === "remake" ? (
                <p className="mt-2 text-[11px] text-muted-foreground">Each post recreates one of these {photoCount} images, taking turns.</p>
              ) : (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <Segmented
                    size="sm"
                    ariaLabel={`How posts use these ${role} photos`}
                    options={[
                      { id: "combine", label: "Combine" },
                      { id: "rotate", label: "Rotate" },
                    ]}
                    value={mode}
                    onChange={(m) => setMode(role, m)}
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {mode === "rotate"
                      ? `Each post gets one of these ${photoCount} photos, taking turns.`
                      : `Every post gets ${photoCount === 2 ? "both" : `all ${photoCount}`} photos together.`}
                  </span>
                </div>
              ))}
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">Up to 2 photos per role (1 image to recreate) and 6 in total go to the image model.</p>

      <PhotoPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={
          picker
            ? picker.role === "remake"
              ? "Image to recreate"
              : picker.role === "style"
                ? "Style reference"
                : `Photos of a ${ROLE_META[picker.role].kind}`
            : ""
        }
        description={
          picker?.role === "remake"
            ? "This image is recreated with the post's own text and details. Add a Person reference to swap the face."
            : picker?.role === "style"
              ? "The image will match this look. Its subject won't be copied."
              : picker?.role === "person"
                ? "The person in the image will look like this. Clear, front-facing photos work best."
                : "The image will show this exact object. Plain-background photos work best."
        }
        max={picker ? maxImagesFor(picker.role) : MAX_IMAGES_PER_ROLE}
        groups={pickerGroups}
        emptyHint={
          picker?.source === "library_images" ? (
            <>No Library Images yet. <Link to="/assets?tab=images" className="underline">Add some</Link> or upload directly.</>
          ) : (
            <>Nothing with photos in the Brand Kit yet. <Link to={`/assets?tab=${picker ? KIND_ASSETS_TAB[ROLE_META[picker.role].kind as LibraryKind] : "brands"}`} className="underline">Add photos</Link> or upload directly.</>
          )
        }
        onConfirm={(group, photos) => {
          if (!picker) return;
          setRefs([
            ...current,
            { id: newReferenceId(), role: picker.role, source: picker.source === "library_images" ? "upload" : "library", element_id: group.id, images: photos, label: group.name },
          ]);
        }}
      />
    </div>
  );
}
