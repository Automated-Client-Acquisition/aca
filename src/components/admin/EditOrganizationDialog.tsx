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
import { Badge } from "@/components/ui/badge";
import { Loader2, Info, RotateCcw } from "lucide-react";
import { useAdminUpdateOrganization } from "@/hooks/useAdminOrganizations";
import {
  PLAN_LIMITS,
  PLAN_TIERS,
  PlanTier,
  PlanLimits,
  formatLimit,
} from "@/types/admin";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EditOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: {
    id: string;
    name: string;
    plan_tier?: PlanTier | string;
    limits?: Record<string, unknown> | null;
  };
}

export function EditOrganizationDialog({
  open,
  onOpenChange,
  organization,
}: EditOrganizationDialogProps) {
  const [name, setName] = useState(organization.name);
  const [dailyGenerations, setDailyGenerations] = useState<string>("");
  const [monthlyGenerations, setMonthlyGenerations] = useState<string>("");
  const [maxTeamMembers, setMaxTeamMembers] = useState<string>("");
  const [maxConcurrentJobs, setMaxConcurrentJobs] = useState<string>("");
  const [maxWorkspaces, setMaxWorkspaces] = useState<string>("");

  const updateOrg = useAdminUpdateOrganization();

  const planTier = (organization.plan_tier || "free") as PlanTier;
  const planDefaults = PLAN_LIMITS[planTier];
  const planConfig = PLAN_TIERS[planTier];

  // Reset form when dialog opens with new organization
  useEffect(() => {
    if (open) {
      setName(organization.name);
      const limits = organization.limits as Partial<PlanLimits> | null;
      setDailyGenerations(limits?.daily_generations?.toString() || "");
      setMonthlyGenerations(limits?.monthly_generations?.toString() || "");
      setMaxTeamMembers(limits?.max_team_members?.toString() || "");
      setMaxConcurrentJobs(limits?.concurrent_jobs?.toString() || "");
      setMaxWorkspaces(limits?.max_workspaces?.toString() || "");
    }
  }, [open, organization]);

  const handleSubmit = async () => {
    const updates: Record<string, unknown> = {};
    let actionType: "edit_name" | "edit_limits" | "edit_settings" = "edit_settings";

    // Check if name changed
    if (name !== organization.name) {
      updates.name = name;
      actionType = "edit_name";
    }

    // Check if limits changed
    const newLimits: Partial<PlanLimits> = {};
    const currentLimits = organization.limits as Partial<PlanLimits> | null;

    if (dailyGenerations) {
      const val = parseInt(dailyGenerations, 10);
      if (!isNaN(val) && val !== currentLimits?.daily_generations) {
        newLimits.daily_generations = val;
      }
    }

    if (monthlyGenerations) {
      const val = parseInt(monthlyGenerations, 10);
      if (!isNaN(val) && val !== currentLimits?.monthly_generations) {
        newLimits.monthly_generations = val;
      }
    }

    if (maxTeamMembers) {
      const val = parseInt(maxTeamMembers, 10);
      if (!isNaN(val) && val !== currentLimits?.max_team_members) {
        newLimits.max_team_members = val;
      }
    }

    if (maxConcurrentJobs) {
      const val = parseInt(maxConcurrentJobs, 10);
      if (!isNaN(val) && val !== currentLimits?.concurrent_jobs) {
        newLimits.concurrent_jobs = val;
      }
    }

    if (maxWorkspaces !== "") {
      const val = parseInt(maxWorkspaces, 10);
      if (!isNaN(val) && val !== currentLimits?.max_workspaces) {
        newLimits.max_workspaces = val;
      }
    }

    if (Object.keys(newLimits).length > 0) {
      updates.limits = { ...currentLimits, ...newLimits };
      actionType = "edit_limits";
    }

    // Only update if there are changes
    if (Object.keys(updates).length === 0) {
      onOpenChange(false);
      return;
    }

    await updateOrg.mutateAsync({
      orgId: organization.id,
      updates,
      actionType,
    });

    onOpenChange(false);
  };

  const handleResetLimits = async () => {
    // Clear all custom limits to use plan defaults
    await updateOrg.mutateAsync({
      orgId: organization.id,
      updates: { limits: {} },
      actionType: "edit_limits",
    });
    // Reset form fields
    setDailyGenerations("");
    setMonthlyGenerations("");
    setMaxTeamMembers("");
    setMaxConcurrentJobs("");
    setMaxWorkspaces("");
  };

  const currentLimits = organization.limits as Partial<PlanLimits> | null;
  const hasCustomLimits = currentLimits && Object.keys(currentLimits).length > 0;

  const hasChanges =
    name !== organization.name ||
    dailyGenerations !== (currentLimits?.daily_generations?.toString() || "") ||
    monthlyGenerations !== (currentLimits?.monthly_generations?.toString() || "") ||
    maxTeamMembers !== (currentLimits?.max_team_members?.toString() || "") ||
    maxConcurrentJobs !== (currentLimits?.concurrent_jobs?.toString() || "") ||
    maxWorkspaces !== (currentLimits?.max_workspaces?.toString() || "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Organization</DialogTitle>
          <DialogDescription>
            Update settings for <strong>{organization.name}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Organization Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Organization name"
            />
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium">Custom Limits</h4>
                <Badge variant="outline" className={planConfig.color}>
                  {planConfig.label} Plan
                </Badge>
              </div>
              {hasCustomLimits && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleResetLimits}
                      disabled={updateOrg.isPending}
                    >
                      <RotateCcw className="w-4 h-4 mr-1" />
                      Reset to Plan Defaults
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Remove custom limits and use plan defaults
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="dailyGenerations">Daily Generations</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="w-3 h-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Plan default: {formatLimit(planDefaults.daily_generations)}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="dailyGenerations"
                  type="number"
                  value={dailyGenerations}
                  onChange={(e) => setDailyGenerations(e.target.value)}
                  placeholder={formatLimit(planDefaults.daily_generations)}
                  min={-1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="monthlyGenerations">Monthly Generations</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="w-3 h-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Plan default: {formatLimit(planDefaults.monthly_generations)}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="monthlyGenerations"
                  type="number"
                  value={monthlyGenerations}
                  onChange={(e) => setMonthlyGenerations(e.target.value)}
                  placeholder={formatLimit(planDefaults.monthly_generations)}
                  min={-1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="maxTeamMembers">Team Members</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="w-3 h-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Plan default: {formatLimit(planDefaults.max_team_members)}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="maxTeamMembers"
                  type="number"
                  value={maxTeamMembers}
                  onChange={(e) => setMaxTeamMembers(e.target.value)}
                  placeholder={formatLimit(planDefaults.max_team_members)}
                  min={-1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="maxConcurrentJobs">Concurrent Jobs</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="w-3 h-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Plan default: {formatLimit(planDefaults.concurrent_jobs)}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="maxConcurrentJobs"
                  type="number"
                  value={maxConcurrentJobs}
                  onChange={(e) => setMaxConcurrentJobs(e.target.value)}
                  placeholder={formatLimit(planDefaults.concurrent_jobs)}
                  min={-1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label htmlFor="maxWorkspaces">Workspaces/Clients</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="w-3 h-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Plan default: {formatLimit(planDefaults.max_workspaces)}</p>
                      <p className="text-xs mt-1">0 = no agency features</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="maxWorkspaces"
                  type="number"
                  value={maxWorkspaces}
                  onChange={(e) => setMaxWorkspaces(e.target.value)}
                  placeholder={formatLimit(planDefaults.max_workspaces)}
                  min={-1}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              Leave empty to use plan defaults. Set to <code>-1</code> for unlimited, <code>0</code> to disable.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleSubmit}
            disabled={updateOrg.isPending || !hasChanges || !name.trim()}
          >
            {updateOrg.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
