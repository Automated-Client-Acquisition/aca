import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { FeatureGate } from "@/components/UpgradePrompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useRule,
  useUpdateRule,
  useRuleLogs,
  getTriggerTypeLabel,
  getActionTypeLabel,
  getConditionFieldLabel,
  getConditionOperatorLabel,
  createEmptyCondition,
  createEmptyAction,
  type RuleTriggerType,
  type RuleActionType,
  type RuleCondition,
  type RuleConditionGroup,
  type RuleAction,
} from "@/hooks/crm";
import {
  ArrowLeft,
  Save,
  Zap,
  Settings,
  BarChart3,
  Plus,
  Trash2,
  X,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function RuleDetail() {
  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <FeatureGate feature="messaging">
        <RuleDetailContent />
      </FeatureGate>
    </AppLayout>
  );
}

function RuleDetailContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("builder");
  const [hasChanges, setHasChanges] = useState(false);

  const { data: rule, isLoading } = useRule(id);
  const { data: logs } = useRuleLogs({ ruleId: id || "", limit: 50 });
  const updateMutation = useUpdateRule();

  // Local state for editing
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<RuleTriggerType>("message_received");
  const [isActive, setIsActive] = useState(false);
  const [conditions, setConditions] = useState<RuleConditionGroup | null>(null);
  const [actions, setActions] = useState<RuleAction[]>([]);
  const [priority, setPriority] = useState(0);
  const [maxTriggers, setMaxTriggers] = useState<number | null>(null);
  const [cooldownHours, setCooldownHours] = useState<number | null>(null);

  // Initialize form when rule loads
  useEffect(() => {
    if (rule && !hasChanges) {
      setName(rule.name);
      setDescription(rule.description || "");
      setTriggerType(rule.trigger_type);
      setIsActive(rule.is_active);
      setConditions(rule.conditions);
      setActions(rule.actions);
      setPriority(rule.priority);
      setMaxTriggers(rule.max_triggers_per_contact);
      setCooldownHours(rule.cooldown_hours);
    }
  }, [rule]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = () => {
    if (!id || !conditions) return;

    updateMutation.mutate(
      {
        ruleId: id,
        input: {
          name,
          description: description || undefined,
          trigger_type: triggerType,
          is_active: isActive,
          conditions,
          actions,
          priority,
          max_triggers_per_contact: maxTriggers,
          cooldown_hours: cooldownHours,
        },
      },
      {
        onSuccess: () => {
          setHasChanges(false);
          toast.success("Rule saved successfully");
        },
      }
    );
  };

  const markChanged = () => setHasChanges(true);

  const addCondition = () => {
    if (!conditions) return;
    const newConditions = { ...conditions };
    newConditions.conditions = [...newConditions.conditions, createEmptyCondition()];
    setConditions(newConditions);
    markChanged();
  };

  const updateCondition = (index: number, updates: Partial<RuleCondition>) => {
    if (!conditions) return;
    const newConditions = { ...conditions };
    newConditions.conditions = newConditions.conditions.map((c, i) =>
      i === index ? { ...c, ...updates } : c
    );
    setConditions(newConditions);
    markChanged();
  };

  const removeCondition = (index: number) => {
    if (!conditions) return;
    const newConditions = { ...conditions };
    newConditions.conditions = newConditions.conditions.filter((_, i) => i !== index);
    setConditions(newConditions);
    markChanged();
  };

  const addAction = () => {
    setActions([...actions, createEmptyAction("send_message")]);
    markChanged();
  };

  const updateAction = (index: number, updates: Partial<RuleAction>) => {
    setActions(
      actions.map((a, i) => (i === index ? { ...a, ...updates } : a))
    );
    markChanged();
  };

  const removeAction = (index: number) => {
    setActions(actions.filter((_, i) => i !== index));
    markChanged();
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold mb-2">Rule not found</h3>
            <Button onClick={() => navigate("/rules")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Rules
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/rules")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  markChanged();
                }}
                className="text-xl font-bold border-none p-0 h-auto focus-visible:ring-0"
              />
              <Badge variant="secondary" className={isActive ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-100" : ""}>
                {isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Trigger: {getTriggerTypeLabel(triggerType)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-4">
            <Label htmlFor="active-toggle" className="text-sm">
              Active
            </Label>
            <Switch
              id="active-toggle"
              checked={isActive}
              onCheckedChange={(checked) => {
                setIsActive(checked);
                markChanged();
              }}
            />
          </div>
          <Button
            variant="cta"
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {hasChanges && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
          <span className="text-sm">You have unsaved changes</span>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="builder">
            <Zap className="h-4 w-4 mr-2" />
            Builder
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="logs">
            <BarChart3 className="h-4 w-4 mr-2" />
            Logs ({logs?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="builder" className="mt-6 space-y-6">
          {/* Trigger */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trigger</CardTitle>
              <CardDescription>When should this rule run?</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={triggerType}
                onValueChange={(v) => {
                  setTriggerType(v as RuleTriggerType);
                  markChanged();
                }}
              >
                <SelectTrigger className="w-[300px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="message_received">Message Received</SelectItem>
                  <SelectItem value="message_sent">Message Sent</SelectItem>
                  <SelectItem value="lead_captured">Lead Captured</SelectItem>
                  <SelectItem value="stage_changed">Stage Changed</SelectItem>
                  <SelectItem value="tag_added">Tag Added</SelectItem>
                  <SelectItem value="tag_removed">Tag Removed</SelectItem>
                  <SelectItem value="score_changed">Score Changed</SelectItem>
                  <SelectItem value="enrollment_completed">Sequence Completed</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Conditions */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Conditions</CardTitle>
                  <CardDescription>
                    Filter when this rule should trigger
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={addCondition}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Condition
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {conditions && conditions.conditions.length > 1 && (
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm text-muted-foreground">Match</span>
                  <Select
                    value={conditions.logic}
                    onValueChange={(v) => {
                      setConditions({ ...conditions, logic: v as "and" | "or" });
                      markChanged();
                    }}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="and">ALL</SelectItem>
                      <SelectItem value="or">ANY</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">of the following conditions</span>
                </div>
              )}
              {conditions?.conditions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No conditions - rule will trigger for all events
                </p>
              ) : (
                <div className="space-y-3">
                  {conditions?.conditions.map((condition, index) => (
                    <div
                      key={condition.id}
                      className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50"
                    >
                      {index > 0 && (
                        <Badge variant="outline" className="mr-2">
                          {conditions.logic.toUpperCase()}
                        </Badge>
                      )}
                      <Select
                        value={condition.field}
                        onValueChange={(v) =>
                          updateCondition(index, { field: v as any })
                        }
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="message_content">Message Content</SelectItem>
                          <SelectItem value="message_channel">Channel</SelectItem>
                          <SelectItem value="contact_stage">Stage</SelectItem>
                          <SelectItem value="contact_score">Score</SelectItem>
                          <SelectItem value="contact_tags">Tags</SelectItem>
                          <SelectItem value="contact_source">Source</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={condition.operator}
                        onValueChange={(v) =>
                          updateCondition(index, { operator: v as any })
                        }
                      >
                        <SelectTrigger className="w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="equals">equals</SelectItem>
                          <SelectItem value="not_equals">not equals</SelectItem>
                          <SelectItem value="contains">contains</SelectItem>
                          <SelectItem value="not_contains">not contains</SelectItem>
                          <SelectItem value="greater_than">greater than</SelectItem>
                          <SelectItem value="less_than">less than</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={condition.value as string}
                        onChange={(e) =>
                          updateCondition(index, { value: e.target.value })
                        }
                        placeholder="Value"
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeCondition(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Actions</CardTitle>
                  <CardDescription>What should happen when triggered?</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={addAction}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Action
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {actions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No actions configured
                </p>
              ) : (
                <div className="space-y-3">
                  {actions.map((action, index) => (
                    <div
                      key={action.id}
                      className="flex items-start gap-2 p-3 rounded-lg border bg-muted/50"
                    >
                      <div className="flex-1 space-y-3">
                        <Select
                          value={action.type}
                          onValueChange={(v) =>
                            updateAction(index, { type: v as RuleActionType })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="send_message">Send Message</SelectItem>
                            <SelectItem value="add_tag">Add Tag</SelectItem>
                            <SelectItem value="remove_tag">Remove Tag</SelectItem>
                            <SelectItem value="change_stage">Change Stage</SelectItem>
                            <SelectItem value="update_score">Update Score</SelectItem>
                            <SelectItem value="enroll_in_sequence">
                              Enroll in Sequence
                            </SelectItem>
                            <SelectItem value="assign_to_user">Assign to User</SelectItem>
                            <SelectItem value="set_ai_handling">Set AI Handling</SelectItem>
                            <SelectItem value="trigger_webhook">Trigger Webhook</SelectItem>
                            <SelectItem value="send_notification">
                              Send Notification
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        {action.type === "send_message" && (
                          <Textarea
                            value={(action.config as any).content || ""}
                            onChange={(e) =>
                              updateAction(index, {
                                config: { ...action.config, content: e.target.value },
                              })
                            }
                            placeholder="Message content..."
                            rows={2}
                          />
                        )}

                        {action.type === "trigger_webhook" && (
                          <Input
                            value={(action.config as any).url || ""}
                            onChange={(e) =>
                              updateAction(index, {
                                config: { ...action.config, url: e.target.value },
                              })
                            }
                            placeholder="Webhook URL"
                          />
                        )}

                        {(action.type === "add_tag" || action.type === "remove_tag") && (
                          <Input
                            value={(action.config as any).tag_name || ""}
                            onChange={(e) =>
                              updateAction(index, {
                                config: { ...action.config, tag_name: e.target.value },
                              })
                            }
                            placeholder="Tag name"
                          />
                        )}

                        {action.type === "update_score" && (
                          <Input
                            type="number"
                            value={(action.config as any).score_delta || 0}
                            onChange={(e) =>
                              updateAction(index, {
                                config: {
                                  ...action.config,
                                  score_delta: parseInt(e.target.value) || 0,
                                },
                              })
                            }
                            placeholder="Score change (+/-)"
                          />
                        )}

                        {action.type === "change_stage" && (
                          <Input
                            value={(action.config as any).stage_id || ""}
                            onChange={(e) =>
                              updateAction(index, {
                                config: { ...action.config, stage_id: e.target.value },
                              })
                            }
                            placeholder="Pipeline stage ID"
                          />
                        )}

                        {action.type === "assign_to_user" && (
                          <Input
                            value={(action.config as any).user_id || ""}
                            onChange={(e) =>
                              updateAction(index, {
                                config: { ...action.config, user_id: e.target.value },
                              })
                            }
                            placeholder="User ID to assign"
                          />
                        )}

                        {action.type === "set_ai_handling" && (
                          <Select
                            value={(action.config as any).enabled === false ? "false" : "true"}
                            onValueChange={(v) =>
                              updateAction(index, {
                                config: { ...action.config, enabled: v === "true" },
                              })
                            }
                          >
                            <SelectTrigger className="w-[200px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Enable AI</SelectItem>
                              <SelectItem value="false">Disable AI (Handoff)</SelectItem>
                            </SelectContent>
                          </Select>
                        )}

                        {action.type === "enroll_in_sequence" && (
                          <Input
                            value={(action.config as any).sequence_id || ""}
                            onChange={(e) =>
                              updateAction(index, {
                                config: { ...action.config, sequence_id: e.target.value },
                              })
                            }
                            placeholder="Sequence ID"
                          />
                        )}

                        {action.type === "send_notification" && (
                          <Input
                            value={(action.config as any).message || ""}
                            onChange={(e) =>
                              updateAction(index, {
                                config: { ...action.config, message: e.target.value },
                              })
                            }
                            placeholder="Notification message"
                          />
                        )}

                        {action.type === "add_note" && (
                          <Textarea
                            value={(action.config as any).content || ""}
                            onChange={(e) =>
                              updateAction(index, {
                                config: { ...action.config, content: e.target.value },
                              })
                            }
                            placeholder="Note content..."
                            rows={2}
                          />
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeAction(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rule Settings</CardTitle>
              <CardDescription>Configure rule behavior and limits</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    markChanged();
                  }}
                  placeholder="Describe what this rule does..."
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Input
                    type="number"
                    value={priority}
                    onChange={(e) => {
                      setPriority(parseInt(e.target.value) || 0);
                      markChanged();
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Higher priority rules run first
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Max Triggers Per Contact</Label>
                  <Input
                    type="number"
                    value={maxTriggers || ""}
                    onChange={(e) => {
                      setMaxTriggers(e.target.value ? parseInt(e.target.value) : null);
                      markChanged();
                    }}
                    placeholder="Unlimited"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty for unlimited
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Cooldown (hours)</Label>
                  <Input
                    type="number"
                    value={cooldownHours || ""}
                    onChange={(e) => {
                      setCooldownHours(e.target.value ? parseInt(e.target.value) : null);
                      markChanged();
                    }}
                    placeholder="None"
                  />
                  <p className="text-xs text-muted-foreground">
                    Time between triggers for same contact
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {logs?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No logs yet</h3>
                  <p className="text-muted-foreground">
                    Rule execution logs will appear here
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="divide-y">
                    {logs?.map((log) => (
                      <div key={log.id} className="flex items-center gap-4 p-4">
                        <div
                          className={cn(
                            "p-2 rounded-full",
                            log.execution_status === "success"
                              ? "bg-green-500/10"
                              : log.execution_status === "partial"
                              ? "bg-yellow-500/10"
                              : "bg-red-500/10"
                          )}
                        >
                          {log.execution_status === "success" ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : log.execution_status === "partial" ? (
                            <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {log.contact?.display_name || "Unknown"}
                            </span>
                            <Badge variant="outline">
                              {log.conditions_matched ? "Matched" : "Not Matched"}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {log.actions_executed.length} action(s) executed
                          </p>
                          {log.error_message && (
                            <p className="text-sm text-red-500">{log.error_message}</p>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(log.created_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
