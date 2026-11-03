import { useState } from "react";
import { Link } from "react-router-dom";
import {
  MoreVertical,
  Trash2,
  CheckCircle,
  RefreshCw,
  Clock,
  Tag,
  ArrowRight,
  UserPlus,
  ExternalLink,
  BellOff,
  Bell,
  Bot,
  ListPlus,
  Megaphone,
  Reply,
  Sun,
  Palmtree,
  Upload,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PushToLeadConnectorDialog } from "./PushToLeadConnectorDialog";
import {
  type ConversationWithContact,
  useCloseConversation,
  useReopenConversation,
  useSnoozeConversation,
  useDeleteConversation,
  useToggleConversationAI,
} from "@/hooks/crm/useConversations";
import { useUpdateContact, useAddContactTag } from "@/hooks/crm/useContacts";
import { usePipelines } from "@/hooks/crm/usePipeline";
import { useToggleMute, useConversationPreference } from "@/hooks/crm/useConversationPreferences";

interface QuickActionsMenuProps {
  conversation: ConversationWithContact;
  className?: string;
  triggerClassName?: string;
  onDeleted?: () => void;
}

export function QuickActionsMenu({
  conversation,
  className,
  triggerClassName,
  onDeleted,
}: QuickActionsMenuProps) {
  const [addTagDialogOpen, setAddTagDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pushToGhlDialogOpen, setPushToGhlDialogOpen] = useState(false);
  const [newTag, setNewTag] = useState("");

  // Hooks
  const closeConversation = useCloseConversation();
  const reopenConversation = useReopenConversation();
  const snoozeConversation = useSnoozeConversation();
  const deleteConversation = useDeleteConversation();
  const updateContact = useUpdateContact();
  const addContactTag = useAddContactTag();
  const { data: pipelines } = usePipelines();
  const { data: preferences } = useConversationPreference(conversation.id);
  const toggleMute = useToggleMute();
  const toggleAI = useToggleConversationAI();

  const contact = conversation.contact;
  const isMuted = preferences?.is_muted ?? false;

  const handleMoveToStage = async (stageId: string) => {
    if (!contact) return;

    try {
      await updateContact.mutateAsync({
        id: contact.id,
        stage_id: stageId,
      });
    } catch (error) {
      // Error is handled by the hook
    }
  };

  const handleAddTag = async () => {
    if (!contact || !newTag.trim()) return;

    try {
      await addContactTag.mutateAsync({
        contactId: contact.id,
        tag: newTag.trim(),
      });
      setNewTag("");
      setAddTagDialogOpen(false);
    } catch (error) {
      // Error is handled by the hook
    }
  };

  const handleSnooze = (hours: number) => {
    const until = new Date(Date.now() + hours * 3600000).toISOString();
    snoozeConversation.mutate({ conversationId: conversation.id, until });
  };

  const handleSnoozeUntilTomorrow = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    snoozeConversation.mutate({ conversationId: conversation.id, until: tomorrow.toISOString() });
  };

  const handleSnoozeUntilNextWeek = () => {
    const nextMonday = new Date();
    nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
    nextMonday.setHours(9, 0, 0, 0);
    snoozeConversation.mutate({ conversationId: conversation.id, until: nextMonday.toISOString() });
  };

  const handleToggleMute = () => {
    toggleMute.mutate({ conversationId: conversation.id });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", triggerClassName)}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={cn("w-56", className)}>
          {/* Conversation Status */}
          {conversation.status === "open" ? (
            <DropdownMenuItem
              onClick={() => closeConversation.mutate(conversation.id)}
              disabled={closeConversation.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Close conversation
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => reopenConversation.mutate(conversation.id)}
              disabled={reopenConversation.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Reopen conversation
            </DropdownMenuItem>
          )}

          {/* Snooze */}
          {conversation.status === "snoozed" ? (
            <DropdownMenuItem
              onClick={() => reopenConversation.mutate(conversation.id)}
              disabled={reopenConversation.isPending}
            >
              <Clock className="h-4 w-4 mr-2" />
              Unsnooze
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Clock className="h-4 w-4 mr-2" />
                Snooze
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleSnooze(1)}>
                    1 hour
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSnooze(3)}>
                    3 hours
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSnoozeUntilTomorrow}>
                    Tomorrow at 9am
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSnoozeUntilNextWeek}>
                    Next Monday at 9am
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => {
                    snoozeConversation.mutate({
                      conversationId: conversation.id,
                      snoozeType: 'until_reply',
                    });
                  }}>
                    <Reply className="h-4 w-4 mr-2" />
                    Until they reply
                  </DropdownMenuItem>
                  {conversation.lead_intent === 'out_of_office' && (conversation as any).snooze_context?.parsed_return_date && (
                    <DropdownMenuItem onClick={() => {
                      const returnDate = (conversation as any).snooze_context?.parsed_return_date;
                      snoozeConversation.mutate({
                        conversationId: conversation.id,
                        until: new Date(returnDate).toISOString(),
                        snoozeType: 'until_ooo_ends',
                        snoozeContext: { parsed_return_date: returnDate },
                      });
                    }}>
                      <Palmtree className="h-4 w-4 mr-2" />
                      Until OOO ends
                    </DropdownMenuItem>
                  )}
                  {(() => {
                    const enrichment = (conversation.contact as any)?.enrichment_data;
                    const tz = enrichment?.timezone;
                    if (!tz) return null;
                    return (
                      <DropdownMenuItem onClick={() => {
                        // Compute next 9am in contact's timezone
                        const now = new Date();
                        const formatter = new Intl.DateTimeFormat('en-US', {
                          timeZone: tz,
                          hour: 'numeric',
                          hour12: false,
                        });
                        const contactHour = parseInt(formatter.format(now), 10);
                        const hoursUntil9am = contactHour >= 9
                          ? (24 - contactHour + 9)
                          : (9 - contactHour);
                        const target = new Date(now.getTime() + hoursUntil9am * 3600000);
                        target.setMinutes(0, 0, 0);
                        snoozeConversation.mutate({
                          conversationId: conversation.id,
                          until: target.toISOString(),
                          snoozeType: 'until_timezone_morning',
                          snoozeContext: { timezone: tz, target_time: '09:00' },
                        });
                      }}>
                        <Sun className="h-4 w-4 mr-2" />
                        Until their morning
                      </DropdownMenuItem>
                    );
                  })()}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

          {/* Mute/Unmute */}
          <DropdownMenuItem onClick={handleToggleMute}>
            {isMuted ? (
              <>
                <Bell className="h-4 w-4 mr-2" />
                Unmute notifications
              </>
            ) : (
              <>
                <BellOff className="h-4 w-4 mr-2" />
                Mute notifications
              </>
            )}
          </DropdownMenuItem>

          {/* Toggle AI Agent */}
          {conversation.ai_enabled ? (
            <DropdownMenuItem
              onClick={() => toggleAI.mutate({ conversationId: conversation.id, enabled: false })}
              disabled={toggleAI.isPending}
            >
              <Bot className="h-4 w-4 mr-2" />
              Deactivate AI agent
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => toggleAI.mutate({ conversationId: conversation.id, enabled: true })}
              disabled={toggleAI.isPending}
            >
              <Bot className="h-4 w-4 mr-2" />
              Enable AI agent
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          {/* Move to Pipeline Stage */}
          {contact && pipelines && pipelines.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRight className="h-4 w-4 mr-2" />
                Move to stage
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {pipelines.map((pipeline) => (
                    <DropdownMenuSub key={pipeline.id}>
                      <DropdownMenuSubTrigger>
                        <span
                          className="w-2 h-2 rounded-full mr-2"
                          style={{ backgroundColor: pipeline.color }}
                        />
                        {pipeline.name}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          {pipeline.stages.map((stage) => (
                            <DropdownMenuItem
                              key={stage.id}
                              onClick={() => handleMoveToStage(stage.id)}
                              disabled={updateContact.isPending}
                            >
                              <span
                                className="w-2 h-2 rounded-full mr-2"
                                style={{ backgroundColor: stage.color }}
                              />
                              {stage.name}
                              {contact.stage_id === stage.id && (
                                <CheckCircle className="h-3 w-3 ml-auto text-green-500" />
                              )}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

          {/* Add Tag */}
          <DropdownMenuItem onClick={() => setAddTagDialogOpen(true)}>
            <Tag className="h-4 w-4 mr-2" />
            Add tag
          </DropdownMenuItem>

          {/* Add to Lead List */}
          <DropdownMenuItem disabled>
            <ListPlus className="h-4 w-4 mr-2" />
            Add to list
          </DropdownMenuItem>

          {/* Push to Lead Connector */}
          <DropdownMenuItem onClick={() => setPushToGhlDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Push to Lead Connector
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* View Contact Profile */}
          {contact && (
            <DropdownMenuItem asChild>
              <Link to={`/people/${contact.id}`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View contact profile
              </Link>
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          {/* Delete */}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete conversation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete conversation</DialogTitle>
            <DialogDescription>
              This will permanently delete this conversation with{" "}
              {contact?.display_name || "this contact"} and all its messages.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await deleteConversation.mutateAsync(conversation.id);
                setDeleteDialogOpen(false);
                onDeleted?.();
              }}
              disabled={deleteConversation.isPending}
            >
              {deleteConversation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Push to Lead Connector Dialog */}
      <PushToLeadConnectorDialog
        open={pushToGhlDialogOpen}
        onOpenChange={setPushToGhlDialogOpen}
        conversation={conversation}
      />

      {/* Add Tag Dialog */}
      <Dialog open={addTagDialogOpen} onOpenChange={setAddTagDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tag</DialogTitle>
            <DialogDescription>
              Add a tag to {contact?.display_name || "this contact"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Enter tag name..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAddTag();
                }
              }}
            />
            {contact?.tags && contact.tags.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Current tags:</p>
                <div className="flex flex-wrap gap-1">
                  {contact.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddTagDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleAddTag}
              disabled={!newTag.trim() || addContactTag.isPending}
            >
              Add Tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
