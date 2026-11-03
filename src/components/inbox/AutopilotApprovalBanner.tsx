import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  useConversationAutopilotItems,
  useApproveAutopilotItem,
  type AutopilotQueueItem,
} from "@/hooks/crm/useAutopilotQueue";
import { Bot, Check, Edit2, Loader2, ShieldAlert, X } from "lucide-react";

interface AutopilotApprovalBannerProps {
  conversationId: string;
  onOpenAgentPanel?: () => void;
}

export function AutopilotApprovalBanner({
  conversationId,
  onOpenAgentPanel,
}: AutopilotApprovalBannerProps) {
  const { data: items } = useConversationAutopilotItems(conversationId);

  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <ApprovalItem key={item.id} item={item} onOpenAgentPanel={onOpenAgentPanel} />
      ))}
    </div>
  );
}

function ApprovalItem({ item, onOpenAgentPanel }: { item: AutopilotQueueItem; onOpenAgentPanel?: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedMessage, setEditedMessage] = useState(item.draft_message);
  const approveMutation = useApproveAutopilotItem();

  const isProcessing = approveMutation.isPending;
  const isEscalated = !!(item.metadata as Record<string, unknown>)?.escalated;
  const escalationReason = (item.metadata as Record<string, unknown>)?.escalation_reason as string | undefined;
  const confidence = (item.metadata as Record<string, unknown>)?.confidence as number | undefined;

  // Format the trigger intent for display
  const intentLabel = item.trigger_intent
    ?.replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown";

  // Format escalation reason for display
  const formatReason = (reason: string) => {
    if (reason.startsWith("low_confidence:")) return "AI confidence too low to reply automatically";
    if (reason.startsWith("max_turns_reached:")) return "Maximum conversation turns reached";
    if (reason.startsWith("hostile_sentiment:")) return "Negative sentiment detected";
    if (reason.startsWith("explicit_request:")) return "Contact asked to speak with a person";
    if (reason.startsWith("custom_keyword:")) return `Keyword detected: "${reason.split(":")[1]}"`;
    if (reason.startsWith("rule_match:")) return `Autopilot rule triggered`;
    return "Autopilot paused — reply manually";
  };

  const handleApprove = () => {
    approveMutation.mutate({
      queueItemId: item.id,
      action: "approve",
      editedMessage: isEditing ? editedMessage : undefined,
    });
  };

  const handleReject = () => {
    approveMutation.mutate({
      queueItemId: item.id,
      action: "reject",
    });
  };

  const handleDismiss = () => {
    approveMutation.mutate({
      queueItemId: item.id,
      action: "reject",
    });
  };

  const handleToggleEdit = () => {
    if (isEditing) {
      setEditedMessage(item.draft_message);
    }
    setIsEditing(!isEditing);
  };

  // Escalated items: notification only, no draft to send
  if (isEscalated) {
    return (
      <div className="border rounded-lg p-3 mx-4 mt-3 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800">
        <div className="flex items-center gap-2 flex-wrap">
          <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
          <span className="text-sm font-medium text-red-800 dark:text-red-300">
            Needs your attention
          </span>
          <Badge variant="outline" className="h-5 text-[10px] border-red-300 dark:border-red-700 text-red-700 dark:text-red-400">
            {intentLabel}
          </Badge>
          {confidence != null && (
            <Badge
              variant="outline"
              className={cn(
                "h-5 text-[10px]",
                confidence >= 0.7
                  ? "border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400"
                  : confidence >= 0.4
                    ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                    : "border-red-300 dark:border-red-700 text-red-700 dark:text-red-400"
              )}
            >
              {Math.round(confidence * 100)}% confidence
            </Badge>
          )}
        </div>
        {escalationReason && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">
            {formatReason(escalationReason)}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
            onClick={handleDismiss}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <X className="h-3 w-3 mr-1" />
            )}
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  // Normal draft approval flow
  return (
    <div className="border rounded-lg p-3 mx-4 mt-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
          AI Draft Ready
        </span>
        <Badge
          variant="outline"
          className="h-5 text-[10px] border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
        >
          {intentLabel}
        </Badge>
        {confidence != null && (
          <Badge
            variant="outline"
            className={cn(
              "h-5 text-[10px]",
              confidence >= 0.7
                ? "border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400"
                : confidence >= 0.4
                  ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                  : "border-red-300 dark:border-red-700 text-red-700 dark:text-red-400"
            )}
          >
            {Math.round(confidence * 100)}% confidence
          </Badge>
        )}
      </div>

      {/* Draft preview or edit area */}
      {isEditing ? (
        <Textarea
          value={editedMessage}
          onChange={(e) => setEditedMessage(e.target.value)}
          className="mb-3 text-sm min-h-[80px] bg-white dark:bg-amber-950/50 border-amber-300 dark:border-amber-700"
          placeholder="Edit your message..."
        />
      ) : (
        <button
          type="button"
          onClick={onOpenAgentPanel}
          className={cn(
            "text-sm mb-3 whitespace-pre-wrap text-left w-full rounded-md p-2 -mx-1 transition-colors",
            "text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30",
            onOpenAgentPanel && "cursor-pointer"
          )}
        >
          {item.draft_message}
        </button>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="cta"
          size="sm"
          className="h-7 text-xs"
          onClick={handleApprove}
          disabled={isProcessing}
        >
          {isProcessing && approveMutation.variables?.action === "approve" ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Check className="h-3 w-3 mr-1" />
          )}
          {isEditing ? "Save & Send" : "Approve & Send"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={handleToggleEdit}
          disabled={isProcessing}
        >
          <Edit2 className="h-3 w-3 mr-1" />
          {isEditing ? "Cancel Edit" : "Edit"}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-destructive hover:text-destructive"
          onClick={handleReject}
          disabled={isProcessing}
        >
          {isProcessing && approveMutation.variables?.action === "reject" ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <X className="h-3 w-3 mr-1" />
          )}
          Reject
        </Button>
      </div>
    </div>
  );
}
