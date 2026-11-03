import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBrandKit } from "@/hooks/useBrandKit";
import { parseAllPromptSlots } from "@/lib/blueprintUtils";
import {
  KIND_ADDS,
  KIND_ASSETS_TAB,
  KIND_LABEL,
  KIND_TABLE,
  LIBRARY_KINDS,
  MODE_LABEL,
  type ContextMode,
  type LibraryKind,
} from "@/lib/blueprint-context";
import { cn } from "@/lib/utils";
import { Segmented } from "./StudioSection";
import { isGuided, recompile, type StudioDraft } from "./draft";

const DEFAULT_PICK = "__default__";

interface ContextSectionProps {
  draft: StudioDraft;
  onChange: (draft: StudioDraft) => void;
}

/** Summary for the collapsed section header. */
export function contextSummary(draft: StudioDraft, promptKinds: Map<LibraryKind, ContextMode>): string {
  const parts: string[] = [];
  for (const kind of LIBRARY_KINDS) {
    const mode = isGuided(draft) ? draft.context?.[kind]?.mode : promptKinds.get(kind);
    if (!mode || mode === "off") continue;
    const label = KIND_LABEL[kind].toLowerCase();
    parts.push(mode === "relevant" ? `${label} if relevant` : label);
  }
  if (parts.length === 0) return "Topic only";
  const s = parts.join(", ");
  return s[0].toUpperCase() + s.slice(1);
}

/** Library kinds a hand-written prompt references, and whether each is required. */
export function kindsInPrompt(draft: StudioDraft): Map<LibraryKind, ContextMode> {
  const map = new Map<LibraryKind, ContextMode>();
  const slots = parseAllPromptSlots(draft.master_prompt, draft.image_prompt || undefined, draft.director_prompt || undefined);
  for (const kind of LIBRARY_KINDS) {
    const slot = slots.find((s) => s.library_table === KIND_TABLE[kind]);
    if (slot) map.set(kind, slot.required === false ? "relevant" : "always");
  }
  for (const table of draft.reference_image_libraries) {
    const kind = LIBRARY_KINDS.find((k) => KIND_TABLE[k] === table);
    if (kind && !map.has(kind)) map.set(kind, "always");
  }
  return map;
}

export function ContextSection({ draft, onChange }: ContextSectionProps) {
  const { lists, resolve } = useBrandKit();
  const guided = isGuided(draft);
  const promptKinds = useMemo(() => kindsInPrompt(draft), [draft]);

  const setKind = (kind: LibraryKind, patch: { mode?: ContextMode; element_id?: string | null }) => {
    const current = draft.context?.[kind] ?? { mode: guided ? "off" : promptKinds.get(kind) ?? "always" };
    const context = { ...(draft.context ?? {}), [kind]: { ...current, ...patch } };
    onChange(recompile({ ...draft, context }));
  };

  return (
    <>
      <div className="space-y-2">
        {LIBRARY_KINDS.map((kind) => {
          const entry = draft.context?.[kind];
          const mode: ContextMode | undefined = guided ? entry?.mode ?? "off" : promptKinds.get(kind);
          const list = lists[kind];
          const pinned = entry?.element_id ?? null;
          const fallback = resolve(kind);
          const off = !mode || mode === "off";

          return (
            <div key={kind} className={cn("rounded-lg border bg-background p-3", off && "bg-muted/30")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className={cn("text-[13px] font-semibold", off && "text-muted-foreground")}>{KIND_LABEL[kind]}</div>
                  <div className="text-xs text-muted-foreground">{KIND_ADDS[kind]}</div>
                </div>
                {guided ? (
                  <Segmented
                    size="sm"
                    ariaLabel={`${KIND_LABEL[kind]} usage`}
                    options={(["always", "relevant", "off"] as ContextMode[]).map((id) => ({ id, label: MODE_LABEL[id] }))}
                    value={mode ?? "off"}
                    onChange={(m) => setKind(kind, { mode: m })}
                  />
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {mode ? (mode === "always" ? "Used by the prompt" : "Used when available") : "Not used by this prompt"}
                  </span>
                )}
              </div>

              {!off && (
                <div className="mt-2.5">
                  {list.length === 0 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      The Brand Kit has no {KIND_LABEL[kind].toLowerCase()} yet.{" "}
                      <Link to={`/assets?tab=${KIND_ASSETS_TAB[kind]}`} className="font-semibold underline underline-offset-2">
                        Add one
                      </Link>
                    </p>
                  ) : (
                    <Select
                      value={pinned && list.some((e) => e.id === pinned) ? pinned : DEFAULT_PICK}
                      onValueChange={(v) => setKind(kind, { element_id: v === DEFAULT_PICK ? null : v })}
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label={`${KIND_LABEL[kind]} to use`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_PICK} className="text-xs">
                          {fallback
                            ? `${fallback.element.name} (${fallback.source === "default" ? "workspace default" : "most recently edited"})`
                            : "Workspace default"}
                        </SelectItem>
                        {list.map((e) => (
                          <SelectItem key={e.id} value={e.id} className="text-xs">
                            Always {e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Defaults come from the <Link to="/assets" className="underline underline-offset-2">Brand Kit</Link>. Each run can still swap them.
        {guided && " If relevant means the AI only brings it up when the topic fits."}
      </p>
    </>
  );
}
