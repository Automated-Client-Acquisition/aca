import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  EDITABLE_LAYOUTS,
  convertLayout,
  readSlideFields,
  type EditableLayout,
  type SlideFields,
} from "@/lib/carousel-slide-edit";

const LAYOUT_LABELS: Record<EditableLayout, string> = {
  point: "Point",
  list: "List",
  stat: "Big number",
  compare: "Before & after",
  statement: "Statement",
};

const MAX_ITEMS = 6;
const IDEAL_ITEMS = 4;

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** A field label with an optional soft word limit. Over the limit is allowed: the renderer shrinks text to fit. */
function FieldLabel({ label, value, limit }: { label: string; value?: string; limit?: number }) {
  const n = value !== undefined && limit ? words(value) : 0;
  return (
    <div className="flex items-baseline justify-between">
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      {limit ? (
        <span className={`text-[10px] ${n > limit ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
          {n}/{limit} words{n > limit ? ", will shrink to fit" : ""}
        </span>
      ) : null}
    </div>
  );
}

interface CarouselSlideFieldsProps {
  /** The stored slide from carousel_content (layout, items, stat, compare and CTA fields included). */
  slide: object;
  saving?: boolean;
  saveLabel?: string;
  onSave: (fields: SlideFields) => void;
  onCancel: () => void;
}

/**
 * Layout-aware slide editor: shows the fields the slide actually draws, so an edit
 * never flattens a compare, stat or list slide into a plain paragraph.
 */
export function CarouselSlideFields({ slide, saving, saveLabel = "Save", onSave, onCancel }: CarouselSlideFieldsProps) {
  const [f, setF] = useState<SlideFields>(() => readSlideFields(slide));
  const set = (patch: Partial<SlideFields>) => setF((prev) => ({ ...prev, ...patch }));
  const setItem = (i: number, value: string) => set({ items: f.items.map((item, j) => (j === i ? value : item)) });

  const headlineLimit = f.type === "cover" ? 8 : f.layout === "statement" ? 12 : 7;
  const highlightMissing = f.type === "cover" && f.highlight.trim() !== "" && !f.headline.toLowerCase().includes(f.highlight.trim().toLowerCase());

  return (
    <div className="space-y-2">
      {f.type === "content" && (
        <div>
          <FieldLabel label="Layout" />
          <Select value={f.layout} onValueChange={(v) => setF(convertLayout(f, v as EditableLayout))}>
            <SelectTrigger className="h-7 text-xs" aria-label="Slide layout">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITABLE_LAYOUTS.map((l) => (
                <SelectItem key={l} value={l} className="text-xs">
                  {LAYOUT_LABELS[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(f.type === "cover" || f.type === "cta") && (
        <div>
          <FieldLabel label={f.type === "cover" ? "Label above the headline" : "Recap line"} value={f.kicker} limit={f.type === "cover" ? 3 : 8} />
          <Input
            value={f.kicker}
            onChange={(e) => set({ kicker: e.target.value })}
            className="h-7 text-xs"
            placeholder={f.type === "cover" ? "e.g. FOR B2B SELLERS (optional)" : "e.g. Now you know the 3 signals (optional)"}
          />
        </div>
      )}

      {f.type === "content" && f.layout === "stat" && (
        <div className="grid grid-cols-[96px_1fr] gap-2">
          <div>
            <FieldLabel label="Big number" />
            <Input value={f.stat_value} onChange={(e) => set({ stat_value: e.target.value })} className="h-7 text-xs" placeholder="47%" />
          </div>
          <div>
            <FieldLabel label="Under the number" />
            <Input value={f.stat_label} onChange={(e) => set({ stat_label: e.target.value })} className="h-7 text-xs" placeholder="of stalled deals restart" />
          </div>
        </div>
      )}

      <div>
        <FieldLabel label="Headline" value={f.headline} limit={headlineLimit} />
        <Input value={f.headline} onChange={(e) => set({ headline: e.target.value })} className="h-7 text-xs" placeholder="Slide headline..." />
      </div>

      {f.type === "cover" && (
        <div>
          <FieldLabel label="Words to color" />
          <Input value={f.highlight} onChange={(e) => set({ highlight: e.target.value })} className="h-7 text-xs" placeholder="1 to 3 words from the headline" />
          {highlightMissing && <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">Not in the headline, so nothing will be colored.</p>}
        </div>
      )}

      {f.type === "content" && f.layout === "list" && (
        <>
          <div>
            <FieldLabel label="Lead-in (optional)" value={f.lead} limit={12} />
            <Input value={f.lead} onChange={(e) => set({ lead: e.target.value })} className="h-7 text-xs" placeholder="e.g. Listen for these on the call:" />
          </div>
          <div className="space-y-1">
            <FieldLabel label={`Items (${f.items.length})`} />
            {f.items.map((item, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input value={item} onChange={(e) => setItem(i, e.target.value)} className="h-7 text-xs" placeholder={`Item ${i + 1}`} />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => set({ items: f.items.filter((_, j) => j !== i) })}
                  aria-label={`Remove item ${i + 1}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {f.items.length < MAX_ITEMS && (
              <Button type="button" size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => set({ items: [...f.items, ""] })}>
                <Plus className="mr-1 h-3 w-3" /> Add item
              </Button>
            )}
            {f.items.length > IDEAL_ITEMS && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                {IDEAL_ITEMS} items fit best. More gets cramped, and anything that does not fit is dropped.
              </p>
            )}
            {f.items.some((i) => words(i) > 8) && <p className="text-[10px] text-amber-600 dark:text-amber-400">Items read best at 8 words or fewer.</p>}
          </div>
          <div>
            <FieldLabel label="Closing line (optional)" value={f.footnote} limit={12} />
            <Input value={f.footnote} onChange={(e) => set({ footnote: e.target.value })} className="h-7 text-xs" />
          </div>
        </>
      )}

      {f.type === "content" && f.layout === "compare" && (
        <>
          <div>
            <FieldLabel label="Instead of" value={f.before} limit={14} />
            <Textarea value={f.before} onChange={(e) => set({ before: e.target.value })} className="min-h-[40px] text-xs" placeholder="The old way" />
          </div>
          <div>
            <FieldLabel label="Do this" value={f.after} limit={14} />
            <Textarea value={f.after} onChange={(e) => set({ after: e.target.value })} className="min-h-[40px] text-xs" placeholder="The better way" />
          </div>
        </>
      )}

      {(f.type === "cover" || (f.type === "content" && (f.layout === "point" || f.layout === "stat" || f.layout === "statement"))) && (
        <div>
          <FieldLabel
            label={f.type === "cover" ? "Subline (optional)" : f.layout === "statement" ? "Supporting line (optional)" : "Body"}
            value={f.body}
            limit={f.type === "cover" ? 14 : f.layout === "statement" ? 14 : 30}
          />
          <Textarea value={f.body} onChange={(e) => set({ body: e.target.value })} className="min-h-[50px] text-xs" placeholder="Slide text..." />
        </div>
      )}

      {f.type === "cta" && (
        <>
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <div>
              <FieldLabel label="Keyword" />
              <Input
                value={f.cta_keyword}
                onChange={(e) => set({ cta_keyword: e.target.value.toUpperCase() })}
                className="h-7 text-xs"
                placeholder="GUIDE"
              />
            </div>
            <div>
              <FieldLabel label="Button" value={f.cta_button_text} limit={5} />
              <Input value={f.cta_button_text} onChange={(e) => set({ cta_button_text: e.target.value })} className="h-7 text-xs" placeholder="Comment GUIDE" />
            </div>
          </div>
          <div>
            <FieldLabel label="What they get" value={f.cta_reason} limit={12} />
            <Input value={f.cta_reason} onChange={(e) => set({ cta_reason: e.target.value })} className="h-7 text-xs" placeholder="The 1-page checklist" />
          </div>
        </>
      )}

      <div className="flex gap-1 pt-1">
        <Button size="sm" variant="cta" onClick={() => onSave(f)} disabled={saving || !f.headline.trim()} className="h-7 flex-1 text-xs">
          {saveLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} className="h-7 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
