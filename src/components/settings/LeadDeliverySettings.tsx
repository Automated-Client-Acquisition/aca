import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger as TabsTrig,
} from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactAvatar } from "@/components/inbox/ContactAvatar";
import {
  useHandoffTriggers,
  useCreateHandoffTrigger,
  useUpdateHandoffTrigger,
  useDeleteHandoffTrigger,
  useToggleHandoffTriggerStatus,
  useDuplicateHandoffTrigger,
  useHandoffLogs,
  getHandoffTriggerTypeLabel,
  type HandoffTrigger,
  type HandoffLog,
  type CreateHandoffTriggerInput,
} from "@/hooks/crm";
import { useGHLAccounts } from "@/hooks/useGHLAccounts";
import { useGHLCustomFields, type GHLCustomField } from "@/hooks/useGHLCustomFields";
import { exportToCSV, type ExportColumn } from "@/lib/exportUtils";
import {
  Plus,
  Search,
  MoreVertical,
  Copy,
  Trash2,
  Edit,
  Shield,
  Bell,
  Zap,
  Send,
  Webhook,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  User,
  Download,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";

// ============================================================================
// Main Component
// ============================================================================

export function LeadDeliverySettings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Lead Delivery</h2>
        <p className="text-muted-foreground">
          Configure triggers that automatically deliver qualified leads to your
          clients via GHL, webhooks, or team notifications.
        </p>
      </div>

      <Tabs defaultValue="triggers">
        <TabsList>
          <TabsTrig value="triggers">Triggers</TabsTrig>
          <TabsTrig value="leads">Handoff Leads</TabsTrig>
        </TabsList>

        <TabsContent value="triggers" className="mt-6">
          <TriggersTab />
        </TabsContent>

        <TabsContent value="leads" className="mt-6">
          <HandoffLeadsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Triggers Tab (original content)
// ============================================================================

function TriggersTab() {
  const [search, setSearch] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editTrigger, setEditTrigger] = useState<HandoffTrigger | null>(null);
  const [deleteTriggerId, setDeleteTriggerId] = useState<string | null>(null);

  const { data: triggers, isLoading } = useHandoffTriggers();
  const toggleMutation = useToggleHandoffTriggerStatus();
  const duplicateMutation = useDuplicateHandoffTrigger();

  const filtered = triggers?.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search triggers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="cta" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Trigger
        </Button>
      </div>

      {/* Trigger list */}
      {isLoading ? (
        <div className="grid gap-4">
          {[...Array(2)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Send className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No delivery triggers</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              {search
                ? "No triggers match your search."
                : "Create a trigger to automatically deliver leads to your clients when specific conditions are met."}
            </p>
            {!search && (
              <Button variant="cta" onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Trigger
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filtered?.map((trigger) => (
            <TriggerCard
              key={trigger.id}
              trigger={trigger}
              onToggle={() =>
                toggleMutation.mutate({
                  triggerId: trigger.id,
                  isActive: !trigger.is_active,
                })
              }
              onEdit={() => setEditTrigger(trigger)}
              onDuplicate={() => duplicateMutation.mutate(trigger.id)}
              onDelete={() => setDeleteTriggerId(trigger.id)}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <TriggerDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        trigger={null}
      />

      {/* Edit Dialog */}
      <TriggerDialog
        open={!!editTrigger}
        onOpenChange={(open) => !open && setEditTrigger(null)}
        trigger={editTrigger}
      />

      {/* Delete Confirmation */}
      <DeleteTriggerDialog
        triggerId={deleteTriggerId}
        onClose={() => setDeleteTriggerId(null)}
      />
    </div>
  );
}

// ============================================================================
// Handoff Leads Tab
// ============================================================================

const handoffExportColumns: ExportColumn[] = [
  { key: "contact.display_name", label: "Contact Name" },
  { key: "trigger.name", label: "Trigger Name" },
  { key: "trigger_type", label: "Trigger Type", exportFormat: (v: string) => getHandoffTriggerTypeLabel(v as any) },
  { key: "trigger_reason", label: "Reason" },
  {
    key: "resolved_at",
    label: "Status",
    exportFormat: (v: string | null) => (v ? "Resolved" : "Open"),
  },
  {
    key: "created_at",
    label: "Date",
    exportFormat: (v: string) => format(new Date(v), "yyyy-MM-dd HH:mm"),
  },
  {
    key: "resolved_at",
    label: "Resolved At",
    exportFormat: (v: string | null) =>
      v ? format(new Date(v), "yyyy-MM-dd HH:mm") : "",
  },
];

function HandoffLeadsTab() {
  const [search, setSearch] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">("all");

  const { data: triggers } = useHandoffTriggers();
  const { data: logs, isLoading } = useHandoffLogs({ status: statusFilter === "all" ? undefined : statusFilter });

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    return logs.filter((log) => {
      // Search filter
      if (search) {
        const q = search.toLowerCase();
        const nameMatch = log.contact?.display_name?.toLowerCase().includes(q);
        const reasonMatch = log.trigger_reason?.toLowerCase().includes(q);
        if (!nameMatch && !reasonMatch) return false;
      }
      // Trigger filter
      if (triggerFilter === "manual") {
        if (log.trigger_id) return false;
      } else if (triggerFilter !== "all") {
        if (log.trigger_id !== triggerFilter) return false;
      }
      return true;
    });
  }, [logs, search, triggerFilter]);

  const handleExport = () => {
    if (!filteredLogs.length) return;
    const dateStr = format(new Date(), "yyyy-MM-dd");
    exportToCSV(filteredLogs, handoffExportColumns, `handoff-leads-${dateStr}.csv`);
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={triggerFilter} onValueChange={setTriggerFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Triggers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Triggers</SelectItem>
            <SelectItem value="manual">Manual Handoff</SelectItem>
            {triggers?.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={!filteredLogs.length}
          className="ml-auto"
        >
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Leads list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : filteredLogs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-muted mb-4">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No handoff leads</h3>
            <p className="text-muted-foreground text-center max-w-md">
              {search || triggerFilter !== "all" || statusFilter !== "all"
                ? "No leads match your filters. Try adjusting your search."
                : "Leads will appear here when they are handed off via triggers or manually from the inbox."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center gap-3 py-3 px-4 hover:bg-muted/50 transition-colors"
                >
                  <ContactAvatar
                    contactId={log.contact?.id}
                    avatarUrl={log.contact?.avatar_url || null}
                    initials={
                      log.contact?.display_name
                        ?.split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2) || "?"
                    }
                    className="h-8 w-8"
                    fallbackClassName="text-[10px]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {log.contact?.display_name || "Unknown Contact"}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">
                        {log.trigger?.name || "Manual handoff"}
                      </span>
                      {log.trigger_reason && (
                        <>
                          <span className="shrink-0">-</span>
                          <span className="truncate">{log.trigger_reason}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {log.resolved_at ? (
                      <Badge variant="outline" className="text-[10px] h-5">
                        Resolved
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-5 bg-yellow-500/10 text-yellow-600"
                      >
                        Open
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(log.created_at), "MMM d, HH:mm")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Trigger Card
// ============================================================================

const priorityColors: Record<string, string> = {
  low: "bg-gray-500/10 text-gray-500",
  medium: "bg-yellow-500/10 text-yellow-500",
  high: "bg-[hsl(var(--status-warning))]/10 text-[hsl(var(--status-warning))]",
  urgent: "bg-red-500/10 text-red-500",
};

function TriggerCard({
  trigger,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  trigger: HandoffTrigger;
  onToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const actions = (trigger.actions || []) as Array<{ type: string; config?: Record<string, unknown> }>;
  const hasGHL = actions.some((a) => a.type === "push_to_ghl");
  const hasWebhook = actions.some((a) => a.type === "webhook");
  const hasNotify = actions.some((a) => a.type === "notify_team");

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className={cn(!trigger.is_active && "opacity-60")}>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Switch checked={trigger.is_active} onCheckedChange={onToggle} />

            <div className={cn("p-3 rounded-lg", priorityColors[trigger.priority] || priorityColors.medium)}>
              <Shield className="h-5 w-5" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold truncate">{trigger.name}</h3>
                <Badge variant="outline">
                  {getHandoffTriggerTypeLabel(trigger.trigger_type)}
                </Badge>
                <Badge className={priorityColors[trigger.priority] || priorityColors.medium}>
                  {trigger.priority}
                </Badge>
              </div>
              {trigger.description && (
                <p className="text-sm text-muted-foreground truncate mt-1">
                  {trigger.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                {hasGHL && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <ExternalLink className="h-3 w-3" />
                    GHL
                  </Badge>
                )}
                {hasWebhook && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Webhook className="h-3 w-3" />
                    Webhook
                  </Badge>
                )}
                {hasNotify && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Bell className="h-3 w-3" />
                    Notify
                  </Badge>
                )}
                {!hasGHL && !hasWebhook && !hasNotify && (
                  <span className="text-yellow-500 flex items-center gap-1">
                    No delivery actions configured
                  </span>
                )}
                {trigger.total_triggered > 0 && (
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                      <Zap className="h-3 w-3" />
                      Triggered {trigger.total_triggered}x
                      {expanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                )}
                <span>
                  Updated{" "}
                  {formatDistanceToNow(new Date(trigger.updated_at), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            </div>

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

        <CollapsibleContent>
          <TriggerLeadsLog triggerId={trigger.id} />
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ============================================================================
// Leads Log (expandable per trigger)
// ============================================================================

function TriggerLeadsLog({ triggerId }: { triggerId: string }) {
  const { data: logs, isLoading } = useHandoffLogs({ triggerId, limit: 25 });

  return (
    <div className="border-t px-6 py-4 space-y-3">
      <h4 className="text-sm font-medium text-muted-foreground">
        Recent handoff leads
      </h4>
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !logs?.length ? (
        <p className="text-sm text-muted-foreground py-2">
          No leads have triggered this handoff yet.
        </p>
      ) : (
        <div className="space-y-1">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/50 transition-colors"
            >
              <ContactAvatar
                contactId={log.contact?.id}
                avatarUrl={log.contact?.avatar_url || null}
                initials={
                  log.contact?.display_name
                    ?.split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2) || "?"
                }
                className="h-7 w-7"
                fallbackClassName="text-[9px]"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {log.contact?.display_name || "Unknown Contact"}
                </p>
                {log.trigger_reason && (
                  <p className="text-xs text-muted-foreground truncate">
                    {log.trigger_reason}
                  </p>
                )}
              </div>
              <div className="text-xs text-muted-foreground shrink-0 flex items-center gap-2">
                {log.resolved_at ? (
                  <Badge variant="outline" className="text-[10px] h-5">
                    Resolved
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] h-5 bg-yellow-500/10 text-yellow-600">
                    Open
                  </Badge>
                )}
                <span>
                  {format(new Date(log.created_at), "MMM d, HH:mm")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Create/Edit Dialog
// ============================================================================

function TriggerDialog({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: HandoffTrigger | null;
}) {
  const isEdit = !!trigger;
  const [name, setName] = useState(trigger?.name || "");
  const [description, setDescription] = useState(trigger?.description || "");
  const [triggerType, setTriggerType] = useState<HandoffTrigger["trigger_type"]>(
    trigger?.trigger_type || "keyword"
  );
  const [priority, setPriority] = useState<HandoffTrigger["priority"]>(
    trigger?.priority || "medium"
  );
  const [keywords, setKeywords] = useState(
    ((trigger?.config?.keywords as string[]) || []).join(", ")
  );

  // Delivery actions
  const existingActions = (trigger?.actions || []) as Array<{ type: string; config?: Record<string, unknown> }>;
  const ghlAction = existingActions.find((a) => a.type === "push_to_ghl");
  const webhookAction = existingActions.find((a) => a.type === "webhook");
  const notifyAction = existingActions.find((a) => a.type === "notify_team");

  const [enableGHL, setEnableGHL] = useState(!!ghlAction);
  const [ghlTag, setGhlTag] = useState((ghlAction?.config?.tag as string) || "");
  const [ghlFieldMappings, setGhlFieldMappings] = useState<
    Array<{ ghl_field_id: string; value_source: string }>
  >(
    (ghlAction?.config?.field_mappings as Array<{ ghl_field_id: string; value_source: string }>) || []
  );
  const [enableWebhook, setEnableWebhook] = useState(!!webhookAction);
  const [webhookUrl, setWebhookUrl] = useState(
    (webhookAction?.config?.url as string) || ""
  );
  const [enableNotify, setEnableNotify] = useState(!!notifyAction);

  const { data: ghlData } = useGHLAccounts();
  const { data: ghlCustomFields } = useGHLCustomFields();
  const createMutation = useCreateHandoffTrigger();
  const updateMutation = useUpdateHandoffTrigger();

  // Reset form when trigger changes
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setName("");
      setDescription("");
      setTriggerType("keyword");
      setPriority("medium");
      setKeywords("");
      setEnableGHL(false);
      setGhlTag("");
      setGhlFieldMappings([]);
      setEnableWebhook(false);
      setWebhookUrl("");
      setEnableNotify(false);
    }
    onOpenChange(isOpen);
  };

  const buildActions = () => {
    const actions: Array<{ type: string; config: Record<string, unknown> }> = [];
    if (enableGHL && ghlData?.locationId) {
      const ghlConfig: Record<string, unknown> = {
        location_id: ghlData.locationId,
      };
      if (ghlTag.trim()) ghlConfig.tag = ghlTag.trim();
      const validMappings = ghlFieldMappings.filter(
        (m) => m.ghl_field_id && m.value_source
      );
      if (validMappings.length > 0) ghlConfig.field_mappings = validMappings;
      actions.push({ type: "push_to_ghl", config: ghlConfig });
    }
    if (enableWebhook && webhookUrl.trim()) {
      actions.push({
        type: "webhook",
        config: { url: webhookUrl.trim() },
      });
    }
    if (enableNotify) {
      actions.push({
        type: "notify_team",
        config: {},
      });
    }
    return actions;
  };

  const handleSubmit = () => {
    if (!name.trim()) return;

    const config: Record<string, unknown> = {};
    if (triggerType === "keyword" && keywords) {
      config.keywords = keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
    }

    const actions = buildActions();

    if (isEdit && trigger) {
      updateMutation.mutate(
        {
          triggerId: trigger.id,
          input: {
            name: name.trim(),
            description: description.trim() || undefined,
            trigger_type: triggerType,
            config,
            actions,
            priority,
          },
        },
        { onSuccess: () => handleOpenChange(false) }
      );
    } else {
      const input: CreateHandoffTriggerInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        trigger_type: triggerType,
        config,
        actions,
        priority,
      };
      createMutation.mutate(input, {
        onSuccess: () => handleOpenChange(false),
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Delivery Trigger" : "Add Delivery Trigger"}
          </DialogTitle>
          <DialogDescription>
            Configure when and how leads get delivered to your clients.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 max-h-[60vh] overflow-y-auto pr-1">
          {/* Basic info */}
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              placeholder="e.g., Hot lead delivery"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea
              placeholder="When should this trigger activate?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Trigger config */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Trigger Type</Label>
              <Select
                value={triggerType}
                onValueChange={(v) =>
                  setTriggerType(v as HandoffTrigger["trigger_type"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keyword">Keyword Match</SelectItem>
                  <SelectItem value="sentiment">Negative Sentiment</SelectItem>
                  <SelectItem value="request">Human Request</SelectItem>
                  <SelectItem value="escalation">Escalation</SelectItem>
                  <SelectItem value="score_threshold">Score Threshold</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) =>
                  setPriority(v as HandoffTrigger["priority"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {triggerType === "keyword" && (
            <div className="space-y-2">
              <Label>Keywords (comma-separated)</Label>
              <Input
                placeholder="urgent, help, human, support"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
            </div>
          )}

          {/* Delivery Actions */}
          <div className="space-y-1">
            <Label className="text-base font-semibold">Delivery Actions</Label>
            <p className="text-sm text-muted-foreground">
              What happens when this trigger fires.
            </p>
          </div>

          {/* Push to GHL */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">Push to GoHighLevel</p>
                    <p className="text-xs text-muted-foreground">
                      {ghlData?.locationId
                        ? "Create a contact in your connected GHL account"
                        : "Connect GHL in Integrations first"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={enableGHL}
                  onCheckedChange={setEnableGHL}
                  disabled={!ghlData?.locationId}
                />
              </div>
              {enableGHL && ghlData?.locationId && (
                <div className="space-y-3 pl-7 border-l-2 border-muted ml-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">GHL Tag</Label>
                    <Input
                      placeholder="e.g., hot-lead"
                      value={ghlTag}
                      onChange={(e) => setGhlTag(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Tag applied to the contact in GHL
                    </p>
                  </div>

                  {/* Dynamic field mappings */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Custom Field Mappings</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={() =>
                          setGhlFieldMappings((prev) => [
                            ...prev,
                            { ghl_field_id: "", value_source: "" },
                          ])
                        }
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add field
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Map data from the conversation to GHL custom fields
                    </p>
                  </div>

                  {ghlFieldMappings.map((mapping, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="flex-1 space-y-1">
                        <Select
                          value={mapping.value_source || "__none__"}
                          onValueChange={(v) => {
                            const next = [...ghlFieldMappings];
                            next[idx] = { ...next[idx], value_source: v === "__none__" ? "" : v };
                            setGhlFieldMappings(next);
                          }}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Value source..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select source...</SelectItem>
                            <SelectItem value="conversation_thread">Conversation Thread</SelectItem>
                            <SelectItem value="lead_source">Lead Source (channel)</SelectItem>
                            <SelectItem value="contact_name">Contact Name</SelectItem>
                            <SelectItem value="contact_email">Contact Email</SelectItem>
                            <SelectItem value="contact_phone">Contact Phone</SelectItem>
                            <SelectItem value="contact_company">Contact Company</SelectItem>
                            <SelectItem value="contact_job_title">Contact Job Title</SelectItem>
                            <SelectItem value="contact_linkedin">Contact LinkedIn URL</SelectItem>
                            <SelectItem value="contact_website">Company Website</SelectItem>
                            <SelectItem value="company_niche">Company Niche (AI)</SelectItem>
                            <SelectItem value="company_offering">Company Offering (AI)</SelectItem>
                            <SelectItem value="company_target">Target Audience (AI)</SelectItem>
                            <SelectItem value="primary_need">Primary Need (AI)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <span className="text-xs text-muted-foreground mt-2 shrink-0">&rarr;</span>
                      <div className="flex-1 space-y-1">
                        <Select
                          value={mapping.ghl_field_id || "__none__"}
                          onValueChange={(v) => {
                            const next = [...ghlFieldMappings];
                            next[idx] = { ...next[idx], ghl_field_id: v === "__none__" ? "" : v };
                            setGhlFieldMappings(next);
                          }}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="GHL field..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select GHL field...</SelectItem>
                            {ghlCustomFields?.map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setGhlFieldMappings((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Webhook */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Webhook className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">Fire Webhook</p>
                    <p className="text-xs text-muted-foreground">
                      Send lead data to an external URL (n8n, Zapier, etc.)
                    </p>
                  </div>
                </div>
                <Switch
                  checked={enableWebhook}
                  onCheckedChange={setEnableWebhook}
                />
              </div>
              {enableWebhook && (
                <Input
                  placeholder="https://hooks.example.com/lead-delivery"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              )}
            </CardContent>
          </Card>

          {/* Notify Team */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">Notify Team</p>
                    <p className="text-xs text-muted-foreground">
                      Send an in-app notification to team members
                    </p>
                  </div>
                </div>
                <Switch
                  checked={enableNotify}
                  onCheckedChange={setEnableNotify}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleSubmit}
            disabled={!name.trim() || isPending}
          >
            {isPending
              ? isEdit
                ? "Saving..."
                : "Creating..."
              : isEdit
              ? "Save"
              : "Create Trigger"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Delete Dialog
// ============================================================================

function DeleteTriggerDialog({
  triggerId,
  onClose,
}: {
  triggerId: string | null;
  onClose: () => void;
}) {
  const deleteMutation = useDeleteHandoffTrigger();

  return (
    <Dialog open={!!triggerId} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Delivery Trigger</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this trigger? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (triggerId) {
                deleteMutation.mutate(triggerId, { onSuccess: onClose });
              }
            }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
