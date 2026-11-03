import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { VariablePickerDropdown } from "@/components/email/VariablePickerDropdown";
import { SpintaxPickerDropdown } from "@/components/email/SpintaxPickerDropdown";
import {
  EmailRichTextEditor,
  type EmailRichTextEditorHandle,
} from "@/components/email/EmailRichTextEditor";
import { SpamCheckPanel } from "@/components/email/SpamCheckPanel";
import { cn } from "@/lib/utils";
import type { ABVariantDraft } from "@/types/email";
import type { ValidationError } from "@/lib/email-sequence-utils";
import { redistributeABVariantSplit } from "@/lib/email-sequence-utils";

interface ABVariantEditorProps {
  variants: ABVariantDraft[];
  onChange: (variants: ABVariantDraft[]) => void;
  className?: string;
  previousSubject?: string;
  errors?: ValidationError[];
}

const VARIANT_COLORS = [
  "border-blue-500/30 bg-blue-500/5",
  "border-purple-500/30 bg-purple-500/5",
  "border-green-500/30 bg-green-500/5",
  "border-amber-500/30 bg-amber-500/5",
];

const VARIANT_BADGE_COLORS = [
  "bg-blue-500/10 text-blue-600 border-blue-500/20",
  "bg-purple-500/10 text-purple-600 border-purple-500/20",
  "bg-green-500/10 text-green-600 border-green-500/20",
  "bg-amber-500/10 text-amber-600 border-amber-500/20",
];

/** Safely read split_percentage, defaulting NaN/undefined to 0 */
function safeSplit(v: ABVariantDraft): number {
  const n = Number(v.split_percentage);
  return Number.isFinite(n) ? n : 0;
}

export function ABVariantEditor({
  variants,
  onChange,
  className,
  previousSubject,
  errors = [],
}: ABVariantEditorProps) {
  const hasVariantFieldError = (
    variantIndex: number,
    field: "subject" | "body",
  ) => errors.some((e) => e.field === `variant_${variantIndex}_${field}`);
  const bodyEditorRefs = useRef<
    Record<number, EmailRichTextEditorHandle | null>
  >({});
  const [selectedLabel, setSelectedLabel] = useState(
    variants[0]?.variant_label,
  );
  const selectedVariant =
    variants.find((variant) => variant.variant_label === selectedLabel) ||
    variants[0];
  const canAddVariant = variants.length < 4;
  const canRemoveVariant = variants.length > 2;

  const totalSplit = variants.reduce((s, v) => s + safeSplit(v), 0);

  const updateVariant = (index: number, update: Partial<ABVariantDraft>) => {
    const updated = [...variants];
    updated[index] = { ...updated[index], ...update };
    onChange(updated);
  };

  const addVariant = () => {
    if (!canAddVariant) return;
    const labels = ["A", "B", "C", "D"];
    const newLabel = labels.find(
      (label) => !variants.some((variant) => variant.variant_label === label),
    )!;
    setSelectedLabel(newLabel);
    const evenSplit = Math.floor(100 / (variants.length + 1));
    const updated = variants.map((v) => ({
      ...v,
      split_percentage: evenSplit,
    }));
    updated.push({
      id: crypto.randomUUID(),
      variant_label: newLabel,
      subject: "",
      body: "",
      split_percentage: 100 - evenSplit * variants.length,
    });
    onChange(updated);
  };

  const removeVariant = (index: number) => {
    if (!canRemoveVariant) return;
    const updated = variants.filter((_, i) => i !== index);
    const evenSplit = Math.floor(100 / updated.length);
    const redistributed = updated.map((v, i) => ({
      ...v,
      split_percentage:
        i === updated.length - 1
          ? 100 - evenSplit * (updated.length - 1)
          : evenSplit,
    }));
    onChange(redistributed);
  };

  const updateSplit = (index: number, rawValue: string) => {
    const parsed = parseInt(rawValue, 10);
    onChange(redistributeABVariantSplit(variants, index, parsed));
  };

  const insertVariable = (
    index: number,
    variable: string,
    field: "subject" | "body",
  ) => {
    const current = variants[index][field] || "";
    updateVariant(index, { [field]: current + variable });
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Split Overview */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-card border">
        <span className="text-xs font-medium text-muted-foreground">
          Email variants
        </span>
        {variants.map((v, i) => (
          <Button
            key={v.variant_label}
            variant="outline"
            size="sm"
            aria-pressed={selectedVariant?.variant_label === v.variant_label}
            onClick={() => setSelectedLabel(v.variant_label)}
            className={cn(
              "text-xs",
              selectedVariant?.variant_label === v.variant_label &&
                "border-amber-500/40 bg-amber-500/10",
            )}
          >
            Variant {v.variant_label} · {safeSplit(v)}%
            {errors.some((error) =>
              error.field?.startsWith(`variant_${i}_`),
            ) && (
              <span
                className="ml-1 text-destructive"
                aria-label="Needs attention"
              >
                !
              </span>
            )}
          </Button>
        ))}
        {totalSplit !== 100 && (
          <Badge
            variant="outline"
            className="text-xs bg-red-500/10 text-red-600 border-red-500/20"
          >
            Total: {totalSplit}%
          </Badge>
        )}
        {canAddVariant && (
          <Button
            variant="cta"
            size="sm"
            className="text-xs ml-auto"
            onClick={addVariant}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Variant
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground px-1">
        Choose a variant to edit. Adjust its audience percentage to control the
        split.
      </p>

      {/* Split error */}
      {errors.some(
        (e) => e.field === "variants" && e.message.includes("total 100%"),
      ) && (
        <p className="text-xs text-red-500 px-1">
          {
            errors.find(
              (e) => e.field === "variants" && e.message.includes("total 100%"),
            )?.message
          }
        </p>
      )}

      {/* Variant Cards */}
      <div className="space-y-4">
        {variants.map(
          (variant, index) =>
            selectedVariant?.variant_label === variant.variant_label && (
              <Card
                key={variant.variant_label}
                className="rounded-xl border bg-card shadow-sm"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("text-xs", VARIANT_BADGE_COLORS[index])}
                      >
                        Variant {variant.variant_label}
                      </Badge>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Input
                          aria-label={`Traffic percentage for variant ${variant.variant_label}`}
                          type="number"
                          min={0}
                          max={100}
                          value={safeSplit(variant)}
                          onChange={(e) => updateSplit(index, e.target.value)}
                          className="w-16 h-7 text-xs text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                      {canRemoveVariant && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove variant ${variant.variant_label}`}
                          className="h-9 w-9 hover:bg-destructive/10"
                          onClick={() => removeVariant(index)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Subject */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Subject</Label>
                      <div className="flex items-center gap-0.5">
                        <VariablePickerDropdown
                          onInsert={(v) => insertVariable(index, v, "subject")}
                          size="xs"
                        />
                        <SpintaxPickerDropdown
                          onInsert={(v) => insertVariable(index, v, "subject")}
                          size="xs"
                        />
                      </div>
                    </div>
                    <Input
                      aria-label={`Subject for variant ${variant.variant_label}`}
                      value={variant.subject}
                      onChange={(e) =>
                        updateVariant(index, { subject: e.target.value })
                      }
                      placeholder={
                        previousSubject
                          ? `Re: ${previousSubject.replace(/^Re:\s*/i, "")}`
                          : "Subject line..."
                      }
                      className={cn(
                        "text-sm",
                        hasVariantFieldError(index, "subject") &&
                          "border-red-500 focus-visible:ring-red-500",
                      )}
                    />
                    {hasVariantFieldError(index, "subject") && (
                      <p className="text-[11px] text-red-500">
                        Subject is required
                      </p>
                    )}
                    {previousSubject &&
                      !variant.subject &&
                      !hasVariantFieldError(index, "subject") && (
                        <p className="text-[11px] text-muted-foreground">
                          Leave empty to thread as "Re:{" "}
                          {previousSubject.replace(/^Re:\s*/i, "")}"
                        </p>
                      )}
                  </div>

                  {/* Body */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Body</Label>
                      <div className="flex items-center gap-0.5">
                        <VariablePickerDropdown
                          onInsert={(v) =>
                            bodyEditorRefs.current[index]?.insertVariableChip(v)
                          }
                          size="xs"
                        />
                        <SpintaxPickerDropdown
                          onInsert={(v) =>
                            bodyEditorRefs.current[index]?.insertSpintaxChip(v)
                          }
                          size="xs"
                        />
                      </div>
                    </div>
                    <EmailRichTextEditor
                      ref={(handle) => {
                        bodyEditorRefs.current[index] = handle;
                      }}
                      value={variant.body}
                      bodyFormat={variant.body_format}
                      onChange={(html, format) =>
                        updateVariant(index, {
                          body: html,
                          body_format: format,
                        })
                      }
                      placeholder="Email body..."
                      minHeight={260}
                      error={hasVariantFieldError(index, "body")}
                    />
                    {hasVariantFieldError(index, "body") && (
                      <p className="text-[11px] text-red-500">
                        Body is required
                      </p>
                    )}
                    <SpamCheckPanel
                      subject={
                        variant.subject ||
                        (previousSubject
                          ? `Re: ${previousSubject.replace(/^Re:\s*/i, "")}`
                          : "")
                      }
                      body={variant.body || ""}
                      bodyFormat={variant.body_format}
                      isFirstStep={!previousSubject}
                    />
                  </div>
                </CardContent>
              </Card>
            ),
        )}
      </div>
    </div>
  );
}
