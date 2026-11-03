import { useState, useMemo, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FlaskConical,
  Search,
  Loader2,
  CheckCircle2,
  Circle,
  Clock,
  GitBranch,
  UserPlus,
  MessageSquare,
  Mail,
  Send,
  Eye,
  Heart,
  UserCheck,
  Zap,
  MessageCircle,
  XCircle,
  SkipForward,
  Trash2,
  RotateCcw,
  ChevronsRight,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  useStartTestContact,
  useAdvanceTestContact,
  useCleanupTestContact,
  useCampaignTestProgress,
  useTestContactActionLogs,
} from "@/hooks/useCampaignTestContact";
import { NODE_TYPE_CONFIGS, getOrderedExecutionPath } from "@/lib/sequence-utils";
import type { SequenceNodeType } from "@/lib/sequence-utils";
import type { CampaignActionLog } from "@/hooks/useCampaignProgress";

interface TestContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  campaign: {
    lead_list_id: string | null;
    sender_account_ids: string[];
    sender_accounts?: Record<string, string[]>;
    sequence_nodes: any[];
    sequence_edges: any[];
  };
}

const NODE_ICONS: Record<string, typeof Mail> = {
  connectionRequest: UserPlus,
  message: MessageSquare,
  inmail: Mail,
  email: Mail,
  delay: Clock,
  conditionConnection: GitBranch,
  conditionReplyReceived: GitBranch,
  conditionChannelAvailable: GitBranch,
  routeByChannel: GitBranch,
  conditionEmailOpened: Eye,
  conditionEmailClicked: Eye,
  switchChannel: Zap,
  whatsappMessage: MessageCircle,
  instagramDm: MessageCircle,
  telegramMessage: Send,
  viewProfile: Eye,
  follow: UserCheck,
  likePost: Heart,
  warmupEngagement: Heart,
  sendToSmartlead: Send,
  sendToInstantly: Send,
  sendToLeadConnector: Send,
  sendToZapMail: Send,
  scheduleMeeting: Clock,
  findEmail: Mail,
  createNotionPage: Send,
};

const CONDITION_NODES_WITH_BRANCHES: Record<string, { branches: { value: string; label: string }[] }> = {
  conditionConnection: {
    branches: [
      { value: "accepted", label: "Accepted" },
      { value: "notAccepted", label: "Not Accepted" },
    ],
  },
  conditionReplyReceived: {
    branches: [
      { value: "replied", label: "Replied" },
      { value: "noReply", label: "No Reply" },
    ],
  },
  conditionChannelAvailable: {
    branches: [
      { value: "available", label: "Available" },
      { value: "notAvailable", label: "Not Available" },
    ],
  },
  conditionEmailOpened: {
    branches: [
      { value: "opened", label: "Opened" },
      { value: "notOpened", label: "Not Opened" },
    ],
  },
  conditionEmailClicked: {
    branches: [
      { value: "clicked", label: "Clicked" },
      { value: "notClicked", label: "Not Clicked" },
    ],
  },
};

function getDelayLabel(node: any): string {
  const data = node.data || {};
  const parts: string[] = [];
  if (data.days) parts.push(`${data.days}d`);
  if (data.hours) parts.push(`${data.hours}h`);
  if (data.minutes) parts.push(`${data.minutes}m`);
  return parts.length > 0 ? parts.join(" ") : "1d";
}

function contactName(c: any): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.display_name || "Unknown";
}

export function TestContactDialog({
  open,
  onOpenChange,
  campaignId,
  campaign,
}: TestContactDialogProps) {
  const { currentOrganization } = useAuth();

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedSenderAccountId, setSelectedSenderAccountId] = useState<string | null>(null);
  const [contactFilter, setContactFilter] = useState("");
  const [phase, setPhase] = useState<"setup" | "running">("setup");

  const startTest = useStartTestContact();
  const advanceTest = useAdvanceTestContact();
  const cleanupTest = useCleanupTestContact();

  const { data: testProgress, refetch: refetchProgress } = useCampaignTestProgress(
    phase === "running" ? campaignId : undefined
  );
  const { data: actionLogs, refetch: refetchLogs } = useTestContactActionLogs(
    testProgress?.id
  );

  // Fetch contacts from the campaign's lead list
  const { data: listMembers, isLoading: membersLoading } = useQuery({
    queryKey: ["test-contact-list-members", campaign.lead_list_id, currentOrganization?.id],
    queryFn: async () => {
      if (!campaign.lead_list_id) return [];
      const { data, error } = await supabase
        .from("lead_list_members")
        .select(`
          id,
          contact_id,
          contact:crm_contacts(id, first_name, last_name, display_name, company, job_title, avatar_url)
        `)
        .eq("list_id", campaign.lead_list_id)
        .order("added_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentOrganization && !!campaign.lead_list_id && open,
  });

  // Filter contacts by search term
  const filteredContacts = useMemo(() => {
    if (!listMembers) return [];
    if (!contactFilter) return listMembers;
    const term = contactFilter.toLowerCase();
    return listMembers.filter((m: any) => {
      const c = m.contact;
      if (!c) return false;
      const name = contactName(c).toLowerCase();
      const company = (c.company || "").toLowerCase();
      const title = (c.job_title || "").toLowerCase();
      return name.includes(term) || company.includes(term) || title.includes(term);
    });
  }, [listMembers, contactFilter]);

  const selectedContact = useMemo(() => {
    if (!selectedContactId || !listMembers) return null;
    const member = listMembers.find((m: any) => m.contact_id === selectedContactId);
    return member?.contact || null;
  }, [selectedContactId, listMembers]);

  // Sender accounts
  const allSenderIds = useMemo(() => {
    const ids = new Set<string>();
    (campaign.sender_account_ids || []).forEach((id: string) => ids.add(id));
    if (campaign.sender_accounts) {
      Object.values(campaign.sender_accounts).forEach((arr: string[]) => {
        arr.forEach((id: string) => ids.add(id));
      });
    }
    return Array.from(ids);
  }, [campaign.sender_account_ids, campaign.sender_accounts]);

  const { data: senderAccounts } = useQuery({
    queryKey: ["sender-accounts-test", allSenderIds],
    queryFn: async () => {
      if (allSenderIds.length === 0) return [];
      const { data } = await supabase
        .from("unipile_accounts")
        .select("id, display_name, provider, status")
        .in("id", allSenderIds);
      return data || [];
    },
    enabled: allSenderIds.length > 0 && open,
  });

  // Auto-select first sender if only one available
  const resolvedSenderId = selectedSenderAccountId || (senderAccounts?.length === 1 ? senderAccounts[0].id : null);

  const orderedNodes = useMemo(() => {
    const logNodeIds = new Set<string>();
    for (const log of actionLogs || []) {
      logNodeIds.add(log.node_id);
    }
    return getOrderedExecutionPath(
      campaign.sequence_nodes || [],
      campaign.sequence_edges || [],
      { actionLogNodeIds: logNodeIds, currentNodeId: testProgress?.current_node_id }
    );
  }, [campaign.sequence_nodes, campaign.sequence_edges, actionLogs, testProgress?.current_node_id]);

  const logByNodeId = useMemo(() => {
    const map = new Map<string, CampaignActionLog>();
    for (const log of actionLogs || []) {
      map.set(log.node_id, log);
    }
    return map;
  }, [actionLogs]);

  const currentConditionNode = useMemo(() => {
    if (!testProgress?.current_node_id) return null;
    const node = orderedNodes.find((n: any) => n.id === testProgress.current_node_id);
    if (!node) return null;
    const branchConfig = CONDITION_NODES_WITH_BRANCHES[node.type];
    if (!branchConfig) return null;
    const isWaitingOrPending = testProgress.status === "waiting" || testProgress.status === "pending";
    if (!isWaitingOrPending) return null;
    return { node, ...branchConfig };
  }, [testProgress, orderedNodes]);

  const isProcessing = startTest.isPending || advanceTest.isPending;

  const handleStartTest = useCallback(async () => {
    if (!selectedContactId || !resolvedSenderId) return;
    setPhase("running");
    await startTest.mutateAsync({
      campaignId,
      contactId: selectedContactId,
      senderAccountId: resolvedSenderId,
    });
    refetchProgress();
    refetchLogs();
  }, [campaignId, selectedContactId, resolvedSenderId, startTest, refetchProgress, refetchLogs]);

  const handleAdvance = useCallback(async (conditionOverride?: { type: string; branch: string }) => {
    if (!testProgress?.id) return;
    await advanceTest.mutateAsync({
      campaignId,
      progressId: testProgress.id,
      conditionOverride,
    });
    refetchProgress();
    refetchLogs();
  }, [campaignId, testProgress?.id, advanceTest, refetchProgress, refetchLogs]);

  const handleCleanup = useCallback(async () => {
    await cleanupTest.mutateAsync({ campaignId });
    setPhase("setup");
    setSelectedContactId(null);
    setSelectedSenderAccountId(null);
    setContactFilter("");
  }, [campaignId, cleanupTest]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg w-full flex flex-col">
        <SheetHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
              <FlaskConical className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <SheetTitle className="text-base">Test Automation</SheetTitle>
              <SheetDescription className="text-xs">
                Run the full sequence on a single contact to verify everything works.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <Separator />

        {phase === "setup" && (
          <div className="flex flex-col flex-1 min-h-0 pt-4 gap-4">
            {/* Contact picker from lead list */}
            <div className="flex flex-col flex-1 min-h-0 gap-2">
              <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <Users className="h-3.5 w-3.5" />
                Select a contact from your lead list
              </Label>

              {/* Search filter */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter by name, company, or title..."
                  value={contactFilter}
                  onChange={(e) => setContactFilter(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>

              {/* Contact list */}
              <ScrollArea className="flex-1 min-h-0 rounded-md border">
                {membersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : !campaign.lead_list_id ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No lead list assigned to this campaign.
                  </div>
                ) : filteredContacts.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    {contactFilter ? "No matching contacts." : "No contacts in list."}
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredContacts.map((member: any) => {
                      const c = member.contact;
                      if (!c) return null;
                      const name = contactName(c);
                      const isSelected = selectedContactId === c.id;
                      return (
                        <button
                          key={member.id}
                          onClick={() => setSelectedContactId(isSelected ? null : c.id)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                            isSelected && "bg-primary/5 ring-1 ring-inset ring-primary/20"
                          )}
                        >
                          {c.avatar_url ? (
                            <img src={c.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium flex-shrink-0">
                              {(c.first_name?.[0] || "") + (c.last_name?.[0] || "")}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{name}</p>
                            {(c.job_title || c.company) && (
                              <p className="text-xs text-muted-foreground truncate">
                                {[c.job_title, c.company].filter(Boolean).join(" at ")}
                              </p>
                            )}
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Sender picker */}
            {senderAccounts && senderAccounts.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Sender Account
                </Label>
                <Select
                  value={selectedSenderAccountId || ""}
                  onValueChange={setSelectedSenderAccountId}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select sender..." />
                  </SelectTrigger>
                  <SelectContent>
                    {senderAccounts.map((acc: any) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        <span className="text-sm">{acc.display_name || acc.id}</span>
                        <Badge variant="outline" className="text-[10px] h-4 ml-2">{acc.provider}</Badge>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Start button */}
            <Button
              variant="cta"
              className="w-full"
              disabled={!selectedContactId || !resolvedSenderId || isProcessing}
              onClick={handleStartTest}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <FlaskConical className="h-4 w-4 mr-2" />
                  Run Test
                  {selectedContact && (
                    <span className="ml-1 opacity-70">with {contactName(selectedContact)}</span>
                  )}
                </>
              )}
            </Button>
          </div>
        )}

        {phase === "running" && (
          <div className="flex flex-col flex-1 min-h-0 pt-4">
            {/* Test contact header */}
            {testProgress && (
              <div className="flex items-center gap-2.5 pb-3">
                <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/10" variant="outline">
                  TEST
                </Badge>
                {testProgress.contact?.avatar_url ? (
                  <img src={testProgress.contact.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium">
                    {(testProgress.contact?.first_name?.[0] || "") + (testProgress.contact?.last_name?.[0] || "")}
                  </div>
                )}
                <span className="text-sm font-medium truncate">
                  {testProgress.contact?.first_name || ""} {testProgress.contact?.last_name || ""}
                </span>
                <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                  via {testProgress.sender_account?.display_name || "—"}
                </span>
              </div>
            )}

            <Separator />

            {/* Sequence timeline */}
            <ScrollArea className="flex-1 min-h-0 mt-3 pr-2">
              <div className="space-y-1 pb-2">
                {orderedNodes.map((node: any, index: number) => {
                  const nodeType = node.type as SequenceNodeType;
                  const config = NODE_TYPE_CONFIGS[nodeType];
                  const NodeIcon = NODE_ICONS[nodeType] || Circle;
                  const actionLog = logByNodeId.get(node.id);

                  const isCurrent = testProgress?.current_node_id === node.id;
                  const isCompleted = actionLog?.status === "success";
                  const isFailed = actionLog?.status === "failed";
                  const isSkipped = actionLog?.status === "skipped";
                  const isFuture = !actionLog && !isCurrent;
                  const isDelay = nodeType === "delay";

                  return (
                    <div key={node.id}>
                      {index > 0 && (
                        <div className="flex items-center pl-5 py-0">
                          <div className={cn("w-px h-3", isCompleted || isCurrent ? "bg-primary/40" : "bg-border")} />
                        </div>
                      )}

                      <div
                        className={cn(
                          "rounded-lg border p-3 transition-colors",
                          isCurrent && "border-primary bg-primary/5 ring-1 ring-primary/20",
                          isCompleted && "border-muted bg-muted/30",
                          isFailed && "border-destructive/50 bg-destructive/5",
                          isSkipped && "border-muted bg-muted/20 opacity-60",
                          isFuture && "border-border opacity-50"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              "flex h-6 w-6 items-center justify-center rounded-full flex-shrink-0",
                              isCurrent ? "bg-primary text-primary-foreground"
                                : isCompleted ? "bg-primary/20 text-primary"
                                : isFailed ? "bg-destructive/20 text-destructive"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {isCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : <NodeIcon className="h-3.5 w-3.5" />}
                          </div>

                          <span className="text-xs font-medium flex-1">
                            {isDelay ? `Wait ${getDelayLabel(node)}` : config?.label || nodeType}
                          </span>

                          {isCurrent && isProcessing && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                          {isCurrent && !isProcessing && (
                            <Badge variant="outline" className="text-[10px] h-5 bg-primary/10 text-primary border-primary/20">Current</Badge>
                          )}
                          {isCompleted && actionLog?.executed_at && (
                            <span className="text-[10px] text-muted-foreground">{format(new Date(actionLog.executed_at), "h:mm:ss a")}</span>
                          )}
                          {isFailed && <Badge variant="outline" className="text-[10px] h-5 text-destructive border-destructive/20">Failed</Badge>}
                          {isSkipped && (
                            <Badge variant="outline" className={cn(
                              "text-[10px] h-5",
                              actionLog?.error_message
                                ? "text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10"
                                : "text-muted-foreground"
                            )}>
                              {actionLog?.error_message ? "Failed (continued)" : "Skipped"}
                            </Badge>
                          )}
                        </div>

                        {/* Delay skip note */}
                        {isDelay && isCompleted && (
                          <p className="ml-8 mt-1 text-xs text-muted-foreground italic">
                            <SkipForward className="h-3 w-3 inline mr-1" />
                            Skipped in test mode ({getDelayLabel(node)})
                          </p>
                        )}

                        {/* Message content */}
                        {actionLog?.message_content && (
                          <div className="ml-8 mt-1.5">
                            <div className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed max-h-40 overflow-y-auto rounded bg-muted/40 p-2">
                              {actionLog.message_content}
                            </div>
                          </div>
                        )}

                        {/* Error */}
                        {(isFailed || isSkipped) && actionLog?.error_message && (
                          <p className={cn(
                            "ml-8 mt-1 text-[10px]",
                            isFailed ? "text-destructive" : "text-amber-600 dark:text-amber-400"
                          )}>{actionLog.error_message}</p>
                        )}

                        {/* Condition branch selector */}
                        {isCurrent && currentConditionNode?.node.id === node.id && !isProcessing && (
                          <div className="ml-8 mt-2 space-y-1.5">
                            <p className="text-xs text-muted-foreground">Choose how to proceed:</p>
                            <div className="flex flex-wrap gap-1.5">
                              {currentConditionNode.branches.map((branch) => (
                                <Button
                                  key={branch.value}
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => handleAdvance({ type: currentConditionNode.node.type, branch: branch.value })}
                                  disabled={isProcessing}
                                >
                                  <ChevronsRight className="h-3 w-3 mr-1" />
                                  {branch.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Advance button for non-condition current nodes */}
                        {isCurrent && !currentConditionNode && !isProcessing && !isDelay &&
                         testProgress?.status !== "completed" && testProgress?.status !== "failed" && (
                          <div className="ml-8 mt-2">
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleAdvance()} disabled={isProcessing}>
                              <ChevronsRight className="h-3 w-3 mr-1" />
                              Process this step
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {testProgress?.status === "completed" && (
                  <div className="flex items-center gap-2 pt-3">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-600">Test completed successfully</span>
                  </div>
                )}

                {testProgress?.status === "failed" && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2.5 mt-3">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span className="text-sm font-medium text-destructive">Test failed</span>
                    </div>
                    {testProgress.error_message && (
                      <p className="text-xs text-destructive mt-1">{testProgress.error_message}</p>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>

            <Separator className="mt-2" />

            {/* Footer actions */}
            <div className="flex items-center gap-2 pt-3">
              <Button variant="outline" size="sm" onClick={handleCleanup} disabled={cleanupTest.isPending}>
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Test Another
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCleanup} disabled={cleanupTest.isPending} className="text-muted-foreground">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Remove Test Data
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
