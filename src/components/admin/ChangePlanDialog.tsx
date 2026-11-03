import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { PlanTier, PLAN_TIERS, getPlanTierBadge } from "@/types/admin";
import { useChangeOrganizationPlan } from "@/hooks/useAdminOrganizations";

interface ChangePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: {
    id: string;
    name: string;
    plan_tier: PlanTier | string | null;
  };
}

export function ChangePlanDialog({
  open,
  onOpenChange,
  organization,
}: ChangePlanDialogProps) {
  const currentPlan = (organization.plan_tier || "free") as PlanTier;
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>(currentPlan);
  const [notes, setNotes] = useState("");

  const changePlan = useChangeOrganizationPlan();

  const handleSubmit = async () => {
    if (selectedPlan === currentPlan) {
      onOpenChange(false);
      return;
    }

    await changePlan.mutateAsync({
      orgId: organization.id,
      newPlan: selectedPlan,
      notes: notes || undefined,
    });

    setNotes("");
    onOpenChange(false);
  };

  const currentPlanBadge = getPlanTierBadge(currentPlan);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Plan</DialogTitle>
          <DialogDescription>
            Update the plan for <strong>{organization.name}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Current plan:</span>
            <Badge variant="outline" className={currentPlanBadge.color}>
              {currentPlanBadge.label}
            </Badge>
          </div>

          <div className="space-y-3">
            <Label>Select new plan</Label>
            <RadioGroup
              value={selectedPlan}
              onValueChange={(value) => setSelectedPlan(value as PlanTier)}
              className="space-y-2"
            >
              {(Object.entries(PLAN_TIERS) as [PlanTier, typeof PLAN_TIERS.free][]).map(
                ([tier, config]) => (
                  <div
                    key={tier}
                    className={`flex items-center space-x-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      selectedPlan === tier
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedPlan(tier)}
                  >
                    <RadioGroupItem value={tier} id={tier} />
                    <div className="flex-1">
                      <Label htmlFor={tier} className="font-medium cursor-pointer">
                        <Badge variant="outline" className={config.color}>
                          {config.label}
                        </Badge>
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {config.description}
                      </p>
                    </div>
                  </div>
                )
              )}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Reason for plan change..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleSubmit}
            disabled={changePlan.isPending || selectedPlan === currentPlan}
          >
            {changePlan.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {selectedPlan === currentPlan ? "No Change" : "Update Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
