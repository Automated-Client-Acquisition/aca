import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowRight } from "lucide-react";
import { useCreateFollowupRule, useUpdateFollowupRule } from "@/hooks/useFollowupRules";
import { useEmailSequences } from "@/hooks/useEmailSequences";
import {
  LEAD_INTENT_LABELS,
  type LeadIntent,
  type FollowupTriggerType,
  type FollowupRule,
} from "@/types/classification";

interface AddFollowupRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sequenceId?: string;
  campaignId?: string;
  leadMagnetCampaignId?: string;
  editingRule?: FollowupRule | null;
}

const INTENT_OPTIONS: LeadIntent[] = [
  "interested",
  "meeting_booked",
  "not_interested",
  "out_of_office",
  "neutral",
  "unsubscribe",
  "do_not_contact",
];

export function AddFollowupRuleDialog({
  open,
  onOpenChange,
  sequenceId,
  campaignId,
  leadMagnetCampaignId,
  editingRule,
}: AddFollowupRuleDialogProps) {
  const createRule = useCreateFollowupRule();
  const updateRule = useUpdateFollowupRule();
  const { data: sequences, isLoading: sequencesLoading, isError: sequencesError, refetch: refetchSequences, isFetching: sequencesFetching } = useEmailSequences();
  const isSaving = createRule.isPending || updateRule.isPending;
  const isEditing = !!editingRule;

  // Form state
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<FollowupTriggerType>("intent_match");
  const [selectedIntents, setSelectedIntents] = useState<LeadIntent[]>(["interested"]);
  const [confidenceMin, setConfidenceMin] = useState(0.7);
  const [timeoutDays, setTimeoutDays] = useState(7);
  const [targetSequenceId, setTargetSequenceId] = useState("");
  const [delayHours, setDelayHours] = useState(0);

  // Populate form when editing
  useEffect(() => {
    if (editingRule && open) {
      setName(editingRule.name);
      setTriggerType(editingRule.trigger_type);
      const config = editingRule.trigger_config as { intents?: LeadIntent[]; confidence_min?: number; timeout_days?: number };
      if (editingRule.trigger_type === "intent_match") {
        setSelectedIntents(config.intents || ["interested"]);
        setConfidenceMin(config.confidence_min ?? 0.7);
      } else if (editingRule.trigger_type === "no_reply_timeout") {
        setTimeoutDays(config.timeout_days ?? 7);
      }
      setTargetSequenceId(editingRule.target_sequence_id);
      setDelayHours(editingRule.delay_hours || 0);
    }
  }, [editingRule, open]);

  // Filter out current sequence from target options
  const targetOptions = (sequences || []).filter(
    (s) => s.id !== sequenceId && s.status === "active"
  );

  const toggleIntent = (intent: LeadIntent) => {
    setSelectedIntents((prev) =>
      prev.includes(intent)
        ? prev.filter((i) => i !== intent)
        : [...prev, intent]
    );
  };

  const canSubmit =
    name.trim() &&
    targetSequenceId &&
    (triggerType !== "intent_match" || selectedIntents.length > 0);

  const handleSubmit = () => {
    if (!canSubmit || isSaving) return;

    const triggerConfig =
      triggerType === "intent_match"
        ? { intents: selectedIntents, confidence_min: confidenceMin }
        : triggerType === "no_reply_timeout"
          ? { timeout_days: timeoutDays }
          : {};

    if (isEditing) {
      updateRule.mutate(
        {
          id: editingRule!.id,
          sequence_id: sequenceId,
          campaign_id: campaignId,
          lead_magnet_campaign_id: leadMagnetCampaignId,
          name: name.trim(),
          trigger_type: triggerType,
          trigger_config: triggerConfig,
          target_sequence_id: targetSequenceId,
          delay_hours: delayHours,
        },
        {
          onSuccess: () => {
            handleReset();
            onOpenChange(false);
          },
        }
      );
    } else {
      createRule.mutate(
        {
          sequence_id: sequenceId,
          campaign_id: campaignId,
          lead_magnet_campaign_id: leadMagnetCampaignId,
          name: name.trim(),
          trigger_type: triggerType,
          trigger_config: triggerConfig,
          target_sequence_id: targetSequenceId,
          delay_hours: delayHours,
        },
        {
          onSuccess: () => {
            handleReset();
            onOpenChange(false);
          },
        }
      );
    }
  };

  const handleReset = () => {
    setName("");
    setTriggerType("intent_match");
    setSelectedIntents(["interested"]);
    setConfidenceMin(0.7);
    setTimeoutDays(7);
    setTargetSequenceId("");
    setDelayHours(0);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (isSaving) return;
        if (!v) handleReset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-5 py-5 text-left sm:px-6">
          <DialogTitle>{isEditing ? "Edit reply rule" : "Add reply rule"}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            Route leads into another sequence when their reply matches your criteria or they stop responding.
          </DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}>
          <fieldset disabled={isSaving} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 disabled:opacity-70 sm:px-6">
            <div className="space-y-2">
              <Label htmlFor="followup-rule-name">Rule name</Label>
              <Input id="followup-rule-name" autoFocus required placeholder="e.g. Interested leads → Demo follow-up" value={name} onChange={(event) => setName(event.target.value)} />
            </div>

            <section className="space-y-4 rounded-xl border p-4">
              <div>
                <h3 className="text-sm font-semibold">1. Choose a trigger</h3>
                <p className="mt-1 text-xs text-muted-foreground">Decide when this rule should run.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="followup-rule-trigger">Trigger type</Label>
                <Select disabled={isSaving} value={triggerType} onValueChange={(value) => setTriggerType(value as FollowupTriggerType)}>
                  <SelectTrigger id="followup-rule-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="intent_match">Reply matches an intent</SelectItem>
                    <SelectItem value="no_reply_timeout">No reply after a set time</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {triggerType === "intent_match" && (
                <>
                  <div className="space-y-2">
                    <p id="followup-intents-label" className="text-sm font-medium">Match any of these intents</p>
                    <div role="group" aria-labelledby="followup-intents-label" className="grid gap-2 sm:grid-cols-2">
                      {INTENT_OPTIONS.map((intent) => (
                        <label key={intent} className="flex cursor-pointer items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-xs transition-colors hover:bg-muted/40">
                          <Checkbox disabled={isSaving} checked={selectedIntents.includes(intent)} onCheckedChange={() => toggleIntent(intent)} />
                          {LEAD_INTENT_LABELS[intent]}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="followup-rule-confidence">Minimum AI confidence</Label>
                      <span className="text-xs font-semibold tabular-nums">{Math.round(confidenceMin * 100)}%</span>
                    </div>
                    <Slider id="followup-rule-confidence" aria-label="Minimum AI confidence" disabled={isSaving} min={50} max={100} step={5} value={[Math.round(confidenceMin * 100)]} onValueChange={([value]) => setConfidenceMin(value / 100)} />
                    <p className="text-xs leading-relaxed text-muted-foreground">Only run when the AI is at least this confident about the reply intent.</p>
                  </div>
                </>
              )}

              {triggerType === "no_reply_timeout" && (
                <div className="space-y-2">
                  <Label htmlFor="followup-rule-timeout">Days without a reply</Label>
                  <Input id="followup-rule-timeout" type="number" min={1} max={90} value={timeoutDays} onChange={(event) => setTimeoutDays(parseInt(event.target.value) || 7)} className="w-28" aria-describedby="followup-timeout-help" />
                  <p id="followup-timeout-help" className="text-xs leading-relaxed text-muted-foreground">Applies to completed or replied enrollments without positive intent after this many days of silence.</p>
                </div>
              )}
            </section>

            <section className="space-y-4 rounded-xl border p-4">
              <div>
                <h3 className="text-sm font-semibold">2. Set the next step</h3>
                <p className="mt-1 text-xs text-muted-foreground">Choose where to send the lead and when to begin.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="followup-rule-destination">Destination sequence</Label>
                <Select disabled={sequencesLoading || sequencesError || isSaving} value={targetSequenceId} onValueChange={setTargetSequenceId}>
                  <SelectTrigger id="followup-rule-destination"><SelectValue placeholder={sequencesLoading ? "Loading sequences…" : "Choose an active sequence"} /></SelectTrigger>
                  <SelectContent>
                    {editingRule && !targetOptions.some((sequence) => sequence.id === editingRule.target_sequence_id) && (
                      <SelectItem value={editingRule.target_sequence_id} disabled>{editingRule.target_sequence_name || "Current sequence"} (unavailable)</SelectItem>
                    )}
                    {targetOptions.length === 0 ? <SelectItem value="__none" disabled>No other active sequences</SelectItem> : targetOptions.map((sequence) => <SelectItem key={sequence.id} value={sequence.id}>{sequence.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {sequencesError ? (
                  <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                    <span>Sequences could not be loaded.</span>
                    <Button type="button" variant="outline" size="sm" disabled={sequencesFetching || isSaving} onClick={() => void refetchSequences()}>Try again</Button>
                  </div>
                ) : !sequencesLoading && targetOptions.length === 0 && <p className="text-xs text-muted-foreground">Activate another sequence to make it available here.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="followup-rule-delay">Wait before enrolling</Label>
                <div className="flex items-center gap-3">
                  <Input id="followup-rule-delay" type="number" min={0} max={168} value={delayHours} onChange={(event) => setDelayHours(parseInt(event.target.value) || 0)} className="w-28" aria-describedby="followup-delay-help" />
                  <span className="text-sm text-muted-foreground">hours</span>
                </div>
                <p id="followup-delay-help" className="text-xs text-muted-foreground">Use 0 to enroll immediately, or wait up to 7 days.</p>
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground" aria-label="Rule summary">
              <span>{triggerType === "intent_match" ? "Matching reply" : `${timeoutDays} days without reply`}</span>
              <ArrowRight className="h-3.5 w-3.5" />
              <span>{delayHours ? `Wait ${delayHours}h` : "Immediately"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">{targetOptions.find((sequence) => sequence.id === targetSequenceId)?.name || editingRule?.target_sequence_name || "Choose a sequence"}</span>
            </div>
          </fieldset>

          <DialogFooter className="border-t px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" disabled={isSaving} onClick={() => { handleReset(); onOpenChange(false); }}>Cancel</Button>
            <Button type="submit" variant="cta" disabled={!canSubmit || isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSaving ? (isEditing ? "Saving…" : "Creating…") : (isEditing ? "Save changes" : "Create reply rule")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
