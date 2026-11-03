import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Pencil, Gift, Loader2, ArrowRight, MessageSquare, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useFollowupRules,
  useCreateFollowupRule,
  useUpdateFollowupRule,
  useDeleteFollowupRule,
  useToggleFollowupRule,
} from "@/hooks/useFollowupRules";
import { useActiveEmailSequenceOptions } from "@/hooks/useEmailSequences";
import { LEAD_INTENT_LABELS, type LeadIntent, type FollowupRule } from "@/types/classification";
import { AddFollowupRuleDialog } from "@/components/email/AddFollowupRuleDialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";

interface FollowupRulesPanelProps {
  sequenceId?: string;
  campaignId?: string;
  leadMagnetCampaignId?: string;
}

export function FollowupRulesPanel({ sequenceId, campaignId, leadMagnetCampaignId }: FollowupRulesPanelProps) {
  const { data: rules, isLoading, isError, refetch, isFetching } = useFollowupRules(sequenceId, campaignId, leadMagnetCampaignId);
  const deleteRule = useDeleteFollowupRule();
  const toggleRule = useToggleFollowupRule();
  const createRule = useCreateFollowupRule();
  const updateRule = useUpdateFollowupRule();
  const { data: activeEmailSequences = [], isLoading: sequencesLoading } =
    useActiveEmailSequenceOptions(!!sequenceId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deletingRule, setDeletingRule] = useState<FollowupRule | null>(null);
  const [editingRule, setEditingRule] = useState<FollowupRule | null>(null);

  const leadMagnetRule = sequenceId
    ? rules?.find((rule) => rule.trigger_type === "lead_magnet_delivery")
    : undefined;
  const standardRules = rules?.filter((rule) => rule.trigger_type !== "lead_magnet_delivery") || [];
  const targetOptions = activeEmailSequences.filter((sequence) => sequence.id !== sequenceId);
  const currentTargetIsUnavailable = !!leadMagnetRule &&
    !targetOptions.some((sequence) => sequence.id === leadMagnetRule.target_sequence_id);
  const isSavingLeadMagnetRule =
    createRule.isPending || updateRule.isPending || toggleRule.isPending || deleteRule.isPending;

  const setLeadMagnetTarget = (targetSequenceId: string) => {
    if (!sequenceId) return;
    if (targetSequenceId === "__none__") {
      if (leadMagnetRule) {
        deleteRule.mutate({ id: leadMagnetRule.id, sequence_id: sequenceId });
      }
      return;
    }
    if (leadMagnetRule) {
      updateRule.mutate({
        id: leadMagnetRule.id,
        sequence_id: sequenceId,
        target_sequence_id: targetSequenceId,
        is_active: true,
      });
      return;
    }
    createRule.mutate({
      sequence_id: sequenceId,
      name: "Lead magnet delivered",
      trigger_type: "lead_magnet_delivery",
      trigger_config: {},
      target_sequence_id: targetSequenceId,
      delay_hours: 48,
    });
  };

  const setLeadMagnetDelay = (delayHours: string) => {
    if (!leadMagnetRule || !sequenceId) return;
    updateRule.mutate({
      id: leadMagnetRule.id,
      sequence_id: sequenceId,
      delay_hours: Number(delayHours),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
        <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Follow-up rules could not be loaded</p>
          <p className="text-xs text-muted-foreground">Try again to view and manage your reply routes.</p>
        </div>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sequenceId && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <Gift className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Lead magnet recovery</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    After a lead replies and receives the promised lead magnet, enroll them in a recovery sequence.
                  </p>
                </div>
                {leadMagnetRule && (
                  <Switch
                    checked={leadMagnetRule.is_active}
                    disabled={isSavingLeadMagnetRule}
                    aria-label="Enable lead magnet recovery"
                    onCheckedChange={(checked) =>
                      toggleRule.mutate({
                        id: leadMagnetRule.id,
                        sequence_id: sequenceId,
                        is_active: checked,
                      })
                    }
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium">Recovery sequence</p>
                <Select
                  value={leadMagnetRule?.target_sequence_id || "__none__"}
                  onValueChange={setLeadMagnetTarget}
                  disabled={sequencesLoading || isSavingLeadMagnetRule}
                >
                  <SelectTrigger className="h-9 bg-background" aria-label="Recovery sequence for this campaign">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No recovery sequence</SelectItem>
                    {currentTargetIsUnavailable && (
                      <SelectItem value={leadMagnetRule!.target_sequence_id} disabled>
                        {leadMagnetRule!.target_sequence_name || "Current sequence"} (unavailable)
                      </SelectItem>
                    )}
                    {targetOptions.map((sequence) => (
                      <SelectItem key={sequence.id} value={sequence.id}>
                        {sequence.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {targetOptions.length === 0 && !leadMagnetRule && (
                  <p className="text-xs text-muted-foreground">
                    Create and activate an email-first follow-up sequence to add a route.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">First follow-up</span>
                <Select
                  value={String(leadMagnetRule?.delay_hours || 48)}
                  onValueChange={setLeadMagnetDelay}
                  disabled={!leadMagnetRule || isSavingLeadMagnetRule}
                >
                  <SelectTrigger className="h-8 w-[132px] bg-background text-xs" aria-label="Lead magnet recovery delay">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">after 1 day</SelectItem>
                    <SelectItem value="48">after 2 days</SelectItem>
                    <SelectItem value="72">after 3 days</SelectItem>
                    <SelectItem value="120">after 5 days</SelectItem>
                    <SelectItem value="168">after 7 days</SelectItem>
                  </SelectContent>
                </Select>
                {isSavingLeadMagnetRule && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Reply automation</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Choose what happens after a reply or a period of silence.
            </p>
          </div>
          <Button
            variant="cta"
            size="sm"
            disabled={isSavingLeadMagnetRule}
            onClick={() => {
              setEditingRule(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add reply rule
          </Button>
        </div>

        {standardRules.length > 0 ? (
          <div className="space-y-3">
            {standardRules.map((rule) => {
              const isIntent = rule.trigger_type === "intent_match";
              const config = rule.trigger_config as { intents?: LeadIntent[]; confidence_min?: number; timeout_days?: number };
              const isPending =
                (toggleRule.isPending && toggleRule.variables?.id === rule.id) ||
                (deleteRule.isPending && deleteRule.variables?.id === rule.id);
              const trigger = isIntent
                ? (config.intents as string[] || []).map((intent) => LEAD_INTENT_LABELS[intent as LeadIntent] || intent).join(", ")
                : `No reply for ${config.timeout_days || 7} days`;

              return (
                <div
                  key={rule.id}
                  className={cn("rounded-xl border p-4 transition-colors", rule.is_active ? "bg-background" : "bg-muted/20")}
                  aria-busy={isPending}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold">{rule.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={cn("text-xs", rule.is_active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                          {rule.is_active ? "Enabled" : "Paused"}
                        </span>
                        {rule.total_triggered > 0 && <Badge variant="secondary" className="text-[10px]">{rule.total_triggered} triggered</Badge>}
                        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Saving rule" />}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={rule.is_active}
                        disabled={isSavingLeadMagnetRule}
                        aria-label={`Enable ${rule.name}`}
                        onCheckedChange={(checked) => toggleRule.mutate({
                          id: rule.id,
                          sequence_id: sequenceId,
                          campaign_id: campaignId,
                          lead_magnet_campaign_id: leadMagnetCampaignId,
                          is_active: checked,
                        })}
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`Edit ${rule.name}`} disabled={isSavingLeadMagnetRule} onClick={() => {
                        setEditingRule(rule);
                        setDialogOpen(true);
                      }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`Delete ${rule.name}`} disabled={isSavingLeadMagnetRule} onClick={() => setDeletingRule(rule)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 rounded-lg bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.7fr)_auto_minmax(0,1fr)] sm:items-center">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">When</p>
                      <p className="mt-1 break-words text-xs">{trigger || "Reply intent match"}</p>
                      {isIntent && !!config.confidence_min && <p className="mt-1 text-[11px] text-muted-foreground">At least {Math.round(config.confidence_min * 100)}% confidence</p>}
                    </div>
                    <ArrowRight className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Wait</p>
                      <p className="mt-1 text-xs">{rule.delay_hours > 0 ? `${rule.delay_hours} hours` : "Start immediately"}</p>
                    </div>
                    <ArrowRight className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Enroll in</p>
                      <p className="mt-1 break-words text-xs font-medium">{rule.target_sequence_name || "Unknown sequence"}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/10 px-5 py-6 text-center">
            <MessageSquare className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">Every reply can have a next step</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Add a rule to send interested leads to a new sequence, or follow up when a lead goes quiet.
            </p>
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={!!deletingRule}
        onOpenChange={(open) => { if (!open) setDeletingRule(null); }}
        itemName={deletingRule?.name || ""}
        itemType="reply rule"
        description={`Delete "${deletingRule?.name || "this rule"}"? Leads will no longer be routed by this rule. Existing enrollments will remain in their sequences.`}
        onConfirm={() => {
          if (!deletingRule || isSavingLeadMagnetRule) return;
          deleteRule.mutate({
            id: deletingRule.id,
            sequence_id: sequenceId,
            campaign_id: campaignId,
            lead_magnet_campaign_id: leadMagnetCampaignId,
          });
        }}
      />

      <AddFollowupRuleDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setEditingRule(null);
        }}
        sequenceId={sequenceId}
        campaignId={campaignId}
        leadMagnetCampaignId={leadMagnetCampaignId}
        editingRule={editingRule}
      />
    </div>
  );
}
