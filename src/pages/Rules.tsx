import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { FeatureGate } from "@/components/UpgradePrompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useRules,
  useCreateRule,
  useDeleteRule,
  useToggleRuleStatus,
  useDuplicateRule,
  getTriggerTypeLabel,
  createEmptyConditionGroup,
  createEmptyAction,
  type RuleTriggerType,
  type CrmAutomationRule,
} from "@/hooks/crm";
import {
  Plus,
  Search,
  MoreVertical,
  Play,
  Copy,
  Trash2,
  Edit,
  Filter,
  Users,
  ArrowRight,
  Clock,
  UserCheck,
  Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

export default function Rules() {
  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <FeatureGate feature="messaging">
        <RulesContent />
      </FeatureGate>
    </AppLayout>
  );
}

function RulesContent() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [triggerFilter, setTriggerFilter] = useState<RuleTriggerType | "all">("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);

  const { data: rules, isLoading: rulesLoading } = useRules({
    triggerType: triggerFilter === "all" ? undefined : triggerFilter,
  });

  const deleteMutation = useDeleteRule();
  const toggleStatusMutation = useToggleRuleStatus();
  const duplicateMutation = useDuplicateRule();

  const filteredRules = rules?.filter((rule) =>
    rule.name.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    totalRules: rules?.length || 0,
    activeRules: rules?.filter((r) => r.is_active).length || 0,
  };

  return (
    <div className="flex-1 p-8">
      <div className="max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <PageHeader
        icon={UserCheck}
        title="Automation Rules"
        description="Automate actions based on events in your conversations and CRM"
        actions={
          <Button variant="cta" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Rule
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-primary/10">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Rules</p>
                <p className="text-2xl font-bold">{stats.totalRules}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Play className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Rules</p>
                <p className="text-2xl font-bold">{stats.activeRules}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search rules..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={triggerFilter}
          onValueChange={(v) => setTriggerFilter(v as RuleTriggerType | "all")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Trigger type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Triggers</SelectItem>
            <SelectItem value="message_received">Message Received</SelectItem>
            <SelectItem value="message_sent">Message Sent</SelectItem>
            <SelectItem value="lead_captured">Lead Captured</SelectItem>
            <SelectItem value="stage_changed">Stage Changed</SelectItem>
            <SelectItem value="tag_added">Tag Added</SelectItem>
            <SelectItem value="score_changed">Score Changed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Rules List */}
      {rulesLoading ? (
        <div className="grid gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-72" />
                  </div>
                  <Skeleton className="h-9 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredRules?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Zap className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No rules found</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              {search
                ? "No rules match your search. Try a different term."
                : "Create your first rule to start automating actions."}
            </p>
            {!search && (
              <Button variant="cta" onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Rule
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredRules?.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={() =>
                toggleStatusMutation.mutate({
                  ruleId: rule.id,
                  isActive: !rule.is_active,
                })
              }
              onEdit={() => navigate(`/rules/${rule.id}`)}
              onDuplicate={() => duplicateMutation.mutate(rule.id)}
              onDelete={() => setDeleteRuleId(rule.id)}
            />
          ))}
        </div>
      )}

      {/* Create Rule Dialog */}
      <CreateRuleDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />

      {/* Delete Rule Confirmation */}
      <Dialog open={!!deleteRuleId} onOpenChange={() => setDeleteRuleId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Rule</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this rule? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRuleId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteRuleId) {
                  deleteMutation.mutate(deleteRuleId, {
                    onSuccess: () => setDeleteRuleId(null),
                  });
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

// Rule Card Component
interface RuleCardProps {
  rule: CrmAutomationRule;
  onToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function RuleCard({ rule, onToggle, onEdit, onDuplicate, onDelete }: RuleCardProps) {
  return (
    <Card className={cn(!rule.is_active && "opacity-60")}>
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          {/* Status toggle */}
          <Switch checked={rule.is_active} onCheckedChange={onToggle} />

          {/* Icon */}
          <div
            className={cn(
              "p-3 rounded-lg",
              rule.is_active ? "bg-primary/10" : "bg-muted"
            )}
          >
            <Zap
              className={cn(
                "h-5 w-5",
                rule.is_active ? "text-primary" : "text-muted-foreground"
              )}
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">{rule.name}</h3>
              <Badge variant="outline">
                {getTriggerTypeLabel(rule.trigger_type)}
              </Badge>
              {rule.priority > 0 && (
                <Badge variant="secondary">Priority: {rule.priority}</Badge>
              )}
            </div>
            {rule.description && (
              <p className="text-sm text-muted-foreground truncate">
                {rule.description}
              </p>
            )}
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <ArrowRight className="h-3 w-3" />
                {rule.actions.length} action{rule.actions.length !== 1 ? "s" : ""}
              </span>
              {rule.max_triggers_per_contact && (
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  Max {rule.max_triggers_per_contact} per contact
                </span>
              )}
              {rule.cooldown_hours && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {rule.cooldown_hours}h cooldown
                </span>
              )}
              <span>
                Updated{" "}
                {formatDistanceToNow(new Date(rule.updated_at), {
                  addSuffix: true,
                })}
              </span>
            </div>
          </div>

          {/* Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

// Create Rule Dialog
interface CreateRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateRuleDialog({ open, onOpenChange }: CreateRuleDialogProps) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<RuleTriggerType>("message_received");

  const createMutation = useCreateRule();

  const handleCreate = () => {
    if (!name.trim()) return;

    createMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        trigger_type: triggerType,
        conditions: createEmptyConditionGroup(),
        actions: [createEmptyAction("send_message")],
      },
      {
        onSuccess: (data) => {
          onOpenChange(false);
          setName("");
          setDescription("");
          setTriggerType("message_received");
          navigate(`/rules/${data.id}`);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Rule</DialogTitle>
          <DialogDescription>
            Create an automation rule that triggers actions based on events.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              placeholder="e.g., Auto-reply to new leads"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea
              placeholder="Describe what this rule does..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Trigger</Label>
            <Select
              value={triggerType}
              onValueChange={(v) => setTriggerType(v as RuleTriggerType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="message_received">When message is received</SelectItem>
                <SelectItem value="message_sent">When message is sent</SelectItem>
                <SelectItem value="lead_captured">When lead is captured</SelectItem>
                <SelectItem value="stage_changed">When stage changes</SelectItem>
                <SelectItem value="tag_added">When tag is added</SelectItem>
                <SelectItem value="tag_removed">When tag is removed</SelectItem>
                <SelectItem value="score_changed">When score changes</SelectItem>
                <SelectItem value="enrollment_completed">When sequence completes</SelectItem>
                <SelectItem value="handoff_requested">When handoff requested</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleCreate}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating..." : "Create Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

