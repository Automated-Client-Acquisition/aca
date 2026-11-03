import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import {
  useActivationChecklist,
  type ChecklistItem,
} from "@/hooks/useActivationChecklist";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ListChecks,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function FloatingChecklist() {
  const navigate = useNavigate();
  const isOnboardingRoute = useLocation().pathname.startsWith("/onboarding");
  const [isOpen, setIsOpen] = useState(true);
  const [showDismissDialog, setShowDismissDialog] = useState(false);
  const {
    items,
    completedCount,
    totalCount,
    progress,
    isDismissed,
    isLoading,
    dismissChecklist,
  } = useActivationChecklist();

  // Auto-dismiss permanently when all items are completed
  useEffect(() => {
    const allItemsComplete = completedCount === totalCount && totalCount > 0;
    if (!isLoading && allItemsComplete && !isDismissed) {
      dismissChecklist.mutate();
    }
  }, [completedCount, totalCount, isLoading, isDismissed]);

  // Hide while the /onboarding wizard is on screen (it does its own guiding),
  // if dismissed, or while loading.
  //
  // This deliberately does NOT gate on onboarding_completed. Users who sign up
  // through the /get-started wizard never touch /onboarding, so that flag stays
  // false for them forever - which meant the one piece of in-app activation
  // guidance (connect LinkedIn, connect a mailbox, import leads) was invisible
  // to every single person the marketing funnel brought in.
  if (isOnboardingRoute || isDismissed || isLoading) {
    return null;
  }

  // Hide when all items complete (will be auto-dismissed above)
  if (completedCount === totalCount && totalCount > 0) {
    return null;
  }

  const handleDismissClick = () => {
    setShowDismissDialog(true);
  };

  const handleConfirmDismiss = () => {
    dismissChecklist.mutate();
    setShowDismissDialog(false);
  };

  const handleItemClick = (item: ChecklistItem) => {
    if (item.link.startsWith("http")) {
      window.open(item.link, "_blank");
    } else {
      navigate(item.link);
    }
  };

  // Group items by category
  const setupItems = items.filter((i) => i.category === "setup");
  const contentItems = items.filter((i) => i.category === "content");
  const outreachItems = items.filter((i) => i.category === "outreach");
  const integrationItems = items.filter((i) => i.category === "integration");

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card className="shadow-lg border-2">
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b">
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                  <div className="p-1.5 rounded-lg bg-primary/10">
                    <ListChecks className="h-4 w-4 text-primary" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium">Getting Started</p>
                    <p className="text-xs text-muted-foreground">
                      {completedCount}/{totalCount} complete
                    </p>
                  </div>
                </button>
              </CollapsibleTrigger>

              <div className="flex items-center gap-1">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronUp className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={handleDismissClick}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="px-3 py-2">
              <Progress value={progress} className="h-1.5" />
            </div>

            <CollapsibleContent>
              <div className="px-3 pb-3 max-h-96 overflow-y-auto">
                {/* Required Setup Section */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider py-1">
                    Required
                  </p>
                  {setupItems.map((item) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      onClick={() => handleItemClick(item)}
                    />
                  ))}
                </div>

                {/* Content Section */}
                <div className="space-y-1 mt-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider py-1">
                    Get Started
                  </p>
                  {contentItems.map((item) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      onClick={() => handleItemClick(item)}
                    />
                  ))}
                </div>

                {/* Outreach Section */}
                <div className="space-y-1 mt-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider py-1">
                    Outreach
                  </p>
                  {outreachItems.map((item) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      onClick={() => handleItemClick(item)}
                    />
                  ))}
                </div>

                {/* Integrations Section */}
                <div className="space-y-1 mt-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider py-1">
                    Optional
                  </p>
                  {integrationItems.map((item) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      onClick={() => handleItemClick(item)}
                    />
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>

      <AlertDialog open={showDismissDialog} onOpenChange={setShowDismissDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide getting started checklist?</AlertDialogTitle>
            <AlertDialogDescription>
              You've completed {completedCount} of {totalCount} items. You can restore the checklist later from Settings &gt; Account &gt; Preferences.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDismiss}>
              Hide checklist
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface ChecklistItemRowProps {
  item: ChecklistItem;
  onClick: () => void;
}

function ChecklistItemRow({ item, onClick }: ChecklistItemRowProps) {
  return (
    <button
      onClick={onClick}
      disabled={item.isCompleted}
      className={cn(
        "w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors",
        item.isCompleted
          ? "bg-green-500/10 cursor-default"
          : "hover:bg-accent cursor-pointer"
      )}
    >
      <div
        className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center shrink-0 border",
          item.isCompleted
            ? "bg-green-500 border-green-500"
            : "border-muted-foreground/30"
        )}
      >
        {item.isCompleted && <Check className="h-3 w-3 text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm truncate",
            item.isCompleted && "text-muted-foreground line-through"
          )}
        >
          {item.label}
        </p>
      </div>
      {!item.isCompleted && (
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
    </button>
  );
}
