import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConversationThread } from "./ConversationThread";
import type { ConversationWithContact } from "@/hooks/crm/useConversations";
import { Clock, PartyPopper, SkipForward, X, XCircle } from "lucide-react";

interface TriageModeProps {
  conversations: ConversationWithContact[];
  onExit: () => void;
  onConversationAction: (action: 'close' | 'snooze' | 'skip', conversationId: string) => void;
}

export function TriageMode({
  conversations,
  onExit,
  onConversationAction,
}: TriageModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleAction = (action: 'close' | 'snooze' | 'skip') => {
    if (currentIndex >= conversations.length) return;

    const conversationId = conversations[currentIndex].id;
    onConversationAction(action, conversationId);
    setCurrentIndex((prev) => prev + 1);
  };

  // Completion state
  if (currentIndex >= conversations.length) {
    return (
      <div className="h-full flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-sm">Triage Mode</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onExit} aria-label="Exit triage mode" title="Exit triage mode">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* All done */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <PartyPopper className="h-16 w-16 text-amber-500 mx-auto" />
            <h3 className="text-xl font-semibold">All done!</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              You have triaged all {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}. Great work.
            </p>
            <Button variant="outline" onClick={onExit} className="mt-4">
              Exit Triage Mode
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const currentConversation = conversations[currentIndex];

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-sm">Triage Mode</h2>
          <span className="text-xs text-muted-foreground">
            {currentIndex + 1} of {conversations.length}
          </span>
          {/* Progress bar */}
          <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / conversations.length) * 100}%` }}
            />
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onExit} aria-label="Exit triage mode" title="Exit triage mode">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Conversation Thread */}
      <div className="flex-1 min-h-0">
        <ConversationThread
          conversation={currentConversation}
          onToggleContactDetails={() => {}}
          showContactDetails={false}
        />
      </div>

      {/* Bottom action bar */}
      <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-3 border-t bg-muted/30">
        <p className="text-xs text-muted-foreground">
          Reply in the composer above, then choose an outcome.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleAction('skip')}
          className="gap-1.5"
        >
          <SkipForward className="h-4 w-4" />
          Keep open
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleAction('snooze')}
          className="gap-1.5"
        >
          <Clock className="h-4 w-4" />
          Snooze 3h
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleAction('close')}
          className="gap-1.5"
        >
          <XCircle className="h-4 w-4" />
          Close conversation
        </Button>
      </div>
    </div>
  );
}
