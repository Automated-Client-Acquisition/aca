import { useState, useCallback } from "react";
import { useVideoEditor } from "./context/VideoEditorContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Settings2, Type, Image, Clock, ArrowRightLeft, Braces, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TransitionType } from "@/types/videoEditor";

// ── Skill Composition Props Editor ─────────────────────────────────

function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function isColorValue(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value);
}

function PropField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (newValue: unknown) => void;
}) {
  if (typeof value === "string") {
    if (isColorValue(value)) {
      return (
        <div className="flex items-center gap-2">
          <Input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 w-10 p-0.5 cursor-pointer flex-shrink-0"
          />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 text-[10px] font-mono flex-1"
          />
        </div>
      );
    }
    // Multiline for long strings
    if (value.length > 40) {
      return (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="text-xs min-h-[40px]"
        />
      );
    }
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
      />
    );
  }

  if (typeof value === "number") {
    return (
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 text-xs w-20"
      />
    );
  }

  if (typeof value === "boolean") {
    return (
      <button
        onClick={() => onChange(!value)}
        className={cn(
          "h-7 px-2 rounded text-xs border",
          value ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400" : "bg-muted border-border text-muted-foreground"
        )}
      >
        {value ? "Yes" : "No"}
      </button>
    );
  }

  return null;
}

function ArrayItemEditor({
  item,
  index,
  onUpdate,
  onDelete,
}: {
  item: Record<string, unknown>;
  index: number;
  onUpdate: (updated: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Use the first string field as the summary label
  const summaryField = Object.entries(item).find(([, v]) => typeof v === "string");
  const summary = summaryField ? String(summaryField[1]) : `Item ${index + 1}`;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        )}
        <span className="text-[10px] font-medium flex-1 truncate">{summary}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-1.5 border-t border-border/50 pt-1.5">
          {Object.entries(item).map(([key, val]) => (
            <div key={key} className="space-y-0.5">
              <span className="text-[9px] text-muted-foreground font-medium">{humanize(key)}</span>
              <PropField
                label={key}
                value={val}
                onChange={(newVal) => onUpdate({ ...item, [key]: newVal })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillPropsEditor({
  sceneId,
  props,
  onUpdate,
}: {
  sceneId: string;
  props: Record<string, unknown>;
  onUpdate: (newProps: Record<string, unknown>) => void;
}) {
  const handlePropChange = useCallback(
    (key: string, value: unknown) => {
      onUpdate({ ...props, [key]: value });
    },
    [props, onUpdate]
  );

  return (
    <div className="space-y-3">
      {Object.entries(props).map(([key, value]) => {
        // Array of objects
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-medium text-muted-foreground">{humanize(key)}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[9px]"
                  onClick={() => {
                    // Clone the last item as a template for new items
                    const template = value.length > 0
                      ? Object.fromEntries(Object.entries(value[0] as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? "" : v]))
                      : {};
                    handlePropChange(key, [...value, template]);
                  }}
                >
                  <Plus className="h-2.5 w-2.5 mr-0.5" />
                  Add
                </Button>
              </div>
              <div className="space-y-1">
                {(value as Record<string, unknown>[]).map((item, i) => (
                  <ArrayItemEditor
                    key={i}
                    item={item as Record<string, unknown>}
                    index={i}
                    onUpdate={(updated) => {
                      const newArr = [...value];
                      newArr[i] = updated;
                      handlePropChange(key, newArr);
                    }}
                    onDelete={() => {
                      handlePropChange(key, value.filter((_, j) => j !== i));
                    }}
                  />
                ))}
              </div>
            </div>
          );
        }

        // Primitive fields
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          return (
            <div key={key} className="space-y-1">
              <Label className="text-[10px] font-medium text-muted-foreground">{humanize(key)}</Label>
              <PropField
                label={key}
                value={value}
                onChange={(newVal) => handlePropChange(key, newVal)}
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

// ── Main PropertyEditor ────────────────────────────────────────────

export function PropertyEditor() {
  const { selectedScene, updateScene, state, updateSettings } = useVideoEditor();

  if (!selectedScene) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
        <Settings2 className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-sm text-center">Select a scene to edit its properties</p>
      </div>
    );
  }

  const sceneIndex =
    [...state.project.scenes]
      .sort((a, b) => a.order - b.order)
      .findIndex((s) => s.id === selectedScene.id) + 1;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Scene {sceneIndex}</span>
      </div>

      <div className="p-3 space-y-5">
        {/* Duration */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs">
            <Clock className="h-3.5 w-3.5" />
            Duration
          </Label>
          <div className="flex items-center gap-2">
            <Slider
              value={[selectedScene.duration]}
              min={1}
              max={30}
              step={0.5}
              onValueChange={([val]) =>
                updateScene(selectedScene.id, { duration: val })
              }
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground min-w-[32px] text-right">
              {selectedScene.duration}s
            </span>
          </div>
        </div>

        {/* Transition */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs">
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Transition
          </Label>
          <Select
            value={selectedScene.transition}
            onValueChange={(val: TransitionType) =>
              updateScene(selectedScene.id, { transition: val })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fade">Fade</SelectItem>
              <SelectItem value="slide">Slide</SelectItem>
              <SelectItem value="wipe">Wipe</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Media info */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs">
            <Image className="h-3.5 w-3.5" />
            Media
          </Label>
          <div className="rounded-md bg-muted p-2">
            <div className="text-xs text-muted-foreground capitalize">
              {selectedScene.media.type} &middot; {selectedScene.media.source.replace("_", " ")}
            </div>
            {selectedScene.media.url && selectedScene.media.type !== "color" && (
              <div className="mt-1.5 rounded overflow-hidden">
                {selectedScene.media.type === "image" ? (
                  <img
                    src={selectedScene.media.thumbnail_url || selectedScene.media.url}
                    alt=""
                    className="w-full h-24 object-cover"
                  />
                ) : (
                  <video
                    src={selectedScene.media.url}
                    className="w-full h-24 object-cover"
                    muted
                  />
                )}
              </div>
            )}
            {selectedScene.media.type === "color" && (
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  type="color"
                  value={selectedScene.media.url || "#1a1a2e"}
                  onChange={(e) =>
                    updateScene(selectedScene.id, {
                      media: { ...selectedScene.media, url: e.target.value },
                    })
                  }
                  className="h-8 w-12 p-0.5 cursor-pointer"
                />
                <span className="text-xs text-muted-foreground">
                  {selectedScene.media.url || "#1a1a2e"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Skill composition props */}
        {selectedScene.skill_composition && selectedScene.skill_composition.props && Object.keys(selectedScene.skill_composition.props).length > 0 && (
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs">
              <Braces className="h-3.5 w-3.5" />
              Props
            </Label>
            <SkillPropsEditor
              sceneId={selectedScene.id}
              props={selectedScene.skill_composition.props}
              onUpdate={(newProps) =>
                updateScene(selectedScene.id, {
                  skill_composition: {
                    ...selectedScene.skill_composition!,
                    props: newProps,
                  },
                })
              }
            />
          </div>
        )}

        {/* Text overlay */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-xs">
            <Type className="h-3.5 w-3.5" />
            Text Overlay
          </Label>
          <Textarea
            placeholder="Add text overlay..."
            value={selectedScene.text?.content ?? ""}
            onChange={(e) =>
              updateScene(selectedScene.id, {
                text: {
                  content: e.target.value,
                  position: selectedScene.text?.position ?? "bottom",
                  fontSize: selectedScene.text?.fontSize ?? 48,
                  color: selectedScene.text?.color ?? "#FFFFFF",
                  backgroundColor: selectedScene.text?.backgroundColor,
                },
              })
            }
            className="text-xs min-h-[60px]"
          />
          {selectedScene.text?.content && (
            <div className="flex items-center gap-2">
              <Select
                value={selectedScene.text.position}
                onValueChange={(val: "top" | "center" | "bottom") =>
                  updateScene(selectedScene.id, {
                    text: { ...selectedScene.text!, position: val },
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">Top</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="bottom">Bottom</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="color"
                value={selectedScene.text.color}
                onChange={(e) =>
                  updateScene(selectedScene.id, {
                    text: { ...selectedScene.text!, color: e.target.value },
                  })
                }
                className="h-7 w-10 p-0.5 cursor-pointer"
              />
              <Input
                type="number"
                value={selectedScene.text.fontSize}
                onChange={(e) =>
                  updateScene(selectedScene.id, {
                    text: {
                      ...selectedScene.text!,
                      fontSize: Number(e.target.value),
                    },
                  })
                }
                className="h-7 w-16 text-xs"
                min={12}
                max={120}
              />
            </div>
          )}
        </div>

        {/* Aspect Ratio */}
        <div className="space-y-2">
          <Label className="text-xs">Aspect Ratio</Label>
          <Select
            value={state.project.settings.aspect_ratio}
            onValueChange={(val: "portrait" | "landscape" | "square") =>
              updateSettings({ aspect_ratio: val })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="portrait">Portrait (9:16)</SelectItem>
              <SelectItem value="landscape">Landscape (16:9)</SelectItem>
              <SelectItem value="square">Square (1:1)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
