import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBulkUpdateMailboxes } from "@/hooks/useEmailMailboxes";
import { useTrackingDomains } from "@/hooks/useTrackingDomains";

interface BulkMailboxEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
}

interface BulkField {
  key: string;
  label: string;
  group: string;
  type: "number" | "switch" | "text" | "tracking_domain_select";
  defaultValue: number | boolean | string;
  min?: number;
  max?: number;
  hint?: string;
  isMetadata?: boolean;
}

const BULK_FIELDS: BulkField[] = [
  // Sending
  {
    key: "daily_limit",
    label: "Messages Per Day",
    group: "Sending",
    type: "number",
    defaultValue: 30,
    min: 1,
    max: 200,
  },
  {
    key: "min_time_gap_minutes",
    label: "Minimum Time Gap (min)",
    group: "Sending",
    type: "number",
    defaultValue: 3,
    min: 1,
    max: 60,
    isMetadata: true,
  },
  // Tracking
  {
    key: "custom_tracking_enabled",
    label: "Use Custom Tracking Domain",
    group: "Tracking",
    type: "switch",
    defaultValue: false,
    isMetadata: true,
  },
  {
    key: "custom_tracking_domain",
    label: "Tracking Domain",
    group: "Tracking",
    type: "tracking_domain_select",
    defaultValue: "",
    isMetadata: true,
  },
];

export function BulkMailboxEditDialog({
  open,
  onOpenChange,
  selectedIds,
}: BulkMailboxEditDialogProps) {
  const [enabledFields, setEnabledFields] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const f of BULK_FIELDS) {
      initial[f.key] = f.defaultValue;
    }
    return initial;
  });
  const bulkUpdate = useBulkUpdateMailboxes();
  const { data: trackingDomains } = useTrackingDomains();

  const toggleField = (key: string) => {
    setEnabledFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleApply = () => {
    if (enabledFields.size === 0) return;

    const columnUpdates: Record<string, unknown> = {};
    const metadataUpdates: Record<string, unknown> = {};

    for (const key of enabledFields) {
      const field = BULK_FIELDS.find((f) => f.key === key);
      if (!field) continue;
      // Skip tracking_domain — it's handled as part of the tracking switch below
      if (key === "custom_tracking_domain") continue;
      let val = values[key];
      // Normalize empty strings to null for metadata text fields
      if (
        field.isMetadata &&
        (field.type === "text" || field.type === "tracking_domain_select") &&
        val === ""
      ) {
        val = null;
      }
      if (field.isMetadata) {
        metadataUpdates[key] = val;
      } else {
        columnUpdates[key] = val;
      }
    }

    // When tracking switch is enabled, also include the tracking domain value
    if (enabledFields.has("custom_tracking_enabled")) {
      const trackingDomain = values.custom_tracking_domain as string;
      metadataUpdates.custom_tracking_domain = trackingDomain || null;
    }

    bulkUpdate.mutate(
      { ids: selectedIds, columnUpdates, metadataUpdates },
      {
        onSuccess: () => {
          setEnabledFields(new Set());
          onOpenChange(false);
        },
      }
    );
  };

  const handleClose = () => {
    setEnabledFields(new Set());
    onOpenChange(false);
  };

  // Group fields for rendering
  const groups = Array.from(new Set(BULK_FIELDS.map((f) => f.group)));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Bulk Edit Mailboxes</DialogTitle>
          <DialogDescription>
            Apply settings to {selectedIds.length} selected mailbox
            {selectedIds.length !== 1 ? "es" : ""}. Check the fields you want
            to change.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[400px]">
          <div className="space-y-4 px-1 pb-2">
            {groups.map((group, gi) => (
              <div key={group}>
                {gi > 0 && <Separator className="mb-4" />}
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  {group}
                </p>
                <div className="space-y-3">
                  {BULK_FIELDS.filter((f) => f.group === group).map((field) => {
                    const enabled = enabledFields.has(field.key);

                    // Tracking domain select is a child of the tracking switch —
                    // show it indented beneath the switch when tracking is enabled
                    if (field.key === "custom_tracking_domain") {
                      const trackingEnabled = enabledFields.has("custom_tracking_enabled") && values.custom_tracking_enabled === true;
                      if (!trackingEnabled) return null;
                      return (
                        <div key={field.key} className="space-y-2 pl-7 pt-1">
                          <Label className="text-foreground text-sm">
                            {field.label}
                          </Label>
                          <Select
                            value={values[field.key] as string}
                            onValueChange={(val) =>
                              setValues((p) => ({
                                ...p,
                                [field.key]: val,
                              }))
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select domain" />
                            </SelectTrigger>
                            <SelectContent>
                              {trackingDomains && trackingDomains.length > 0 ? (
                                trackingDomains.map((d) => (
                                  <SelectItem key={d.id} value={d.domain}>
                                    {d.domain}
                                    {d.is_default ? " (default)" : ""}
                                  </SelectItem>
                                ))
                              ) : (
                                <SelectItem value="__none" disabled>
                                  No domains configured
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    }

                    // Switch fields: the toggle itself acts as the enable checkbox
                    if (field.type === "switch") {
                      return (
                        <div
                          key={field.key}
                          className="flex items-center gap-3"
                        >
                          <div className="flex-1 flex items-center justify-between gap-2 min-w-0">
                            <Label
                              className={
                                enabled && (values[field.key] as boolean)
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                              }
                            >
                              {field.label}
                            </Label>
                            <Switch
                              checked={enabled && (values[field.key] as boolean)}
                              onCheckedChange={(checked) => {
                                setValues((p) => ({ ...p, [field.key]: checked }));
                                setEnabledFields((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(field.key);
                                  else next.delete(field.key);
                                  return next;
                                });
                              }}
                            />
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={field.key}
                        className="flex items-center gap-3"
                      >
                        <Checkbox
                          checked={enabled}
                          onCheckedChange={() => toggleField(field.key)}
                        />
                        <div className="flex-1 flex items-center justify-between gap-2 min-w-0">
                          <Label
                            className={
                              enabled
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }
                          >
                            {field.label}
                          </Label>
                          {field.type === "number" && (
                            <Input
                              type="number"
                              min={field.min}
                              max={field.max}
                              disabled={!enabled}
                              value={values[field.key] as number}
                              onChange={(e) =>
                                setValues((p) => ({
                                  ...p,
                                  [field.key]:
                                    parseInt(e.target.value) ||
                                    field.defaultValue,
                                }))
                              }
                              className="w-24"
                            />
                          )}
                          {field.type === "text" && (
                            <Input
                              disabled={!enabled}
                              value={values[field.key] as string}
                              onChange={(e) =>
                                setValues((p) => ({
                                  ...p,
                                  [field.key]: e.target.value,
                                }))
                              }
                              className="w-48"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleApply}
            disabled={enabledFields.size === 0 || bulkUpdate.isPending}
          >
            {bulkUpdate.isPending && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            Apply to {selectedIds.length} Mailbox
            {selectedIds.length !== 1 ? "es" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
