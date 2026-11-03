import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type DealPipeline, useDeleteDealPipeline, useSetDefaultDealPipeline } from "@/hooks/crm/useDeals";
import {
  useCreateStage,
  useDeleteStage,
  useReorderStages,
  useUpdatePipeline,
} from "@/hooks/crm/usePipeline";

const STAGE_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#ec4899", "#14b8a6", "#6366f1", "#22c55e", "#ef4444", "#64748b"];

interface StageDraft {
  id: string;
  name: string;
  color: string;
  stage_type: "new" | "active" | "won" | "lost";
  win_probability: string;
  expected_days: string;
}

export function PipelineSettingsDialog({
  open,
  onOpenChange,
  pipeline,
  dealCountByStage,
  canDelete,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: DealPipeline | undefined;
  dealCountByStage: Record<string, number>;
  /** False when it's the org's only pipeline. */
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const setDefault = useSetDefaultDealPipeline();
  const deletePipeline = useDeleteDealPipeline();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const updatePipeline = useUpdatePipeline();
  const createStage = useCreateStage();
  const queryClient = useQueryClient();
  const deleteStage = useDeleteStage();
  const reorderStages = useReorderStages();
  const [pipelineName, setPipelineName] = useState("");
  const [drafts, setDrafts] = useState<StageDraft[]>([]);
  const [newStage, setNewStage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !pipeline) return;
    setPipelineName(pipeline.name);
    setDrafts(
      pipeline.stages.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        stage_type: s.stage_type,
        win_probability: s.win_probability != null ? String(s.win_probability) : "",
        expected_days: s.expected_days != null ? String(s.expected_days) : "",
      })),
    );
    setNewStage("");
    // Only reset on open/pipeline switch, not on every refetch (would drop edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pipeline?.id]);

  if (!pipeline) return null;

  const patch = (id: string, change: Partial<StageDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...change } : d)));

  const move = (index: number, dir: -1 | 1) => {
    const next = [...drafts];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item);
    setDrafts(next);
  };

  const handleDelete = (draft: StageDraft) => {
    const count = dealCountByStage[draft.id] ?? 0;
    if (count > 0) {
      toast.error(`Move the ${count} deal${count === 1 ? "" : "s"} out of "${draft.name}" before deleting it.`);
      return;
    }
    deleteStage.mutate({ id: draft.id, pipelineId: pipeline.id });
    setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
  };

  const handleAddStage = async () => {
    if (!newStage.trim()) return;
    // New stages go before Won/Lost.
    const openCount = drafts.filter((d) => d.stage_type !== "won" && d.stage_type !== "lost").length;
    const created = await createStage.mutateAsync({
      pipeline_id: pipeline.id,
      name: newStage.trim(),
      stage_order: openCount + 1,
      stage_type: "active",
      color: STAGE_COLORS[drafts.length % STAGE_COLORS.length],
      win_probability: 50,
    });
    const next = [...drafts];
    next.splice(openCount, 0, {
      id: created.id,
      name: created.name,
      color: created.color,
      stage_type: "active",
      win_probability: "50",
      expected_days: "",
    });
    setDrafts(next);
    setNewStage("");
    await reorderStages.mutateAsync({ pipelineId: pipeline.id, stageIds: next.map((d) => d.id) });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (pipelineName.trim() && pipelineName.trim() !== pipeline.name) {
        await updatePipeline.mutateAsync({ id: pipeline.id, name: pipelineName.trim() });
      }
      // One write per stage, stage_order included, then a single invalidate
      // (useUpdateStage would toast once per stage).
      const results = await Promise.all(
        drafts.map((d, i) => {
          const orig = pipeline.stages.find((s) => s.id === d.id);
          const prob = d.win_probability.trim() === "" ? null : Math.min(100, Math.max(0, Number(d.win_probability)));
          const days = d.expected_days.trim() === "" ? null : Number(d.expected_days);
          const update = {
            name: d.name.trim() || orig?.name || "Stage",
            color: d.color,
            stage_type: d.stage_type,
            win_probability: prob,
            expected_days: days,
            stage_order: i + 1,
          };
          const unchanged =
            orig &&
            orig.name === update.name &&
            orig.color === update.color &&
            orig.stage_type === update.stage_type &&
            (orig.win_probability ?? null) === prob &&
            (orig.expected_days ?? null) === days &&
            orig.stage_order === i + 1;
          if (unchanged) return Promise.resolve({ error: null });
          // win_probability isn't in the generated types yet.
          return (supabase as unknown as SupabaseClient)
            .from("crm_pipeline_stages")
            .update({ ...update, updated_at: new Date().toISOString() })
            .eq("id", d.id);
        }),
      );
      const failed = results.find((r) => r.error);
      queryClient.invalidateQueries({ queryKey: ["crm-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["crm-deal-report"] });
      if (failed?.error) {
        toast.error(failed.error.message);
        return;
      }
      toast.success("Pipeline saved");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Pipeline settings</DialogTitle>
          <DialogDescription>
            Win % is the default confidence for deals in that stage and drives the weighted forecast. Rotting days flag deals
            that sit too long.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="pipeline-name">Pipeline name</Label>
          <Input id="pipeline-name" value={pipelineName} onChange={(e) => setPipelineName(e.target.value)} />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="pipeline-default" className="text-sm font-medium">
              Default pipeline
            </Label>
            <p className="text-xs text-muted-foreground">
              {pipeline.is_default
                ? "Opens first on the board. Make another pipeline the default to change it."
                : "Open this pipeline first on the board."}
            </p>
          </div>
          <Switch
            id="pipeline-default"
            checked={!!pipeline.is_default}
            disabled={!!pipeline.is_default || setDefault.isPending}
            onCheckedChange={(on) => on && setDefault.mutate(pipeline.id)}
          />
        </div>

        <div className="space-y-2">
          <div className="hidden grid-cols-[28px_1fr_110px_70px_70px_64px] gap-2 px-1 text-xs text-muted-foreground sm:grid">
            <span />
            <span>Stage</span>
            <span>Type</span>
            <span>Win %</span>
            <span>Rot days</span>
            <span />
          </div>
          {drafts.map((d, i) => (
            <div key={d.id} className="grid grid-cols-[28px_1fr] items-center gap-2 sm:grid-cols-[28px_1fr_110px_70px_70px_64px]">
              <input
                type="color"
                value={d.color}
                onChange={(e) => patch(d.id, { color: e.target.value })}
                className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label={`${d.name} color`}
              />
              <Input value={d.name} onChange={(e) => patch(d.id, { name: e.target.value })} className="h-8" />
              <Select value={d.stage_type} onValueChange={(v) => patch(d.id, { stage_type: v as StageDraft["stage_type"] })}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="active">Open</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                max={100}
                value={d.win_probability}
                onChange={(e) => patch(d.id, { win_probability: e.target.value })}
                className="h-8"
                aria-label="Win probability"
              />
              <Input
                type="number"
                min={0}
                value={d.expected_days}
                onChange={(e) => patch(d.id, { expected_days: e.target.value })}
                className="h-8"
                placeholder="-"
                aria-label="Rotting days"
              />
              <div className="flex">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={i === drafts.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(d)} aria-label="Delete stage">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Input
              value={newStage}
              onChange={(e) => setNewStage(e.target.value)}
              placeholder="New stage name"
              className="h-8"
              onKeyDown={(e) => e.key === "Enter" && handleAddStage()}
            />
            <Button variant="outline" size="sm" onClick={handleAddStage} disabled={!newStage.trim() || createStage.isPending}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add stage
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Delete pipeline</p>
            <p className="text-xs text-muted-foreground">
              {canDelete ? "Only possible once it has no deals left." : "You need at least one pipeline."}
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={!canDelete || deletePipeline.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{pipeline.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Its stages are removed. If deals are still in it, nothing is deleted and you'll be asked to move them first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  try {
                    await deletePipeline.mutateAsync(pipeline.id);
                  } catch {
                    return; // the hook already showed why
                  }
                  setConfirmDelete(false);
                  onOpenChange(false);
                  onDeleted();
                }}
              >
                Delete pipeline
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
