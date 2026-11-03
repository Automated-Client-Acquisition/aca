import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Bot, Copy } from "lucide-react";

interface AgentEditConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  /** User chose "Update Agent" — save config back to the shared profile */
  onUpdateAgent: () => void;
  /** User chose "Save as New" — create a new profile with the modified config */
  onSaveAsNew: () => void;
  isPending?: boolean;
}

export function AgentEditConfirmDialog({
  open,
  onOpenChange,
  agentName,
  onUpdateAgent,
  onSaveAsNew,
  isPending,
}: AgentEditConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="!max-w-md overflow-hidden">
        <AlertDialogHeader>
          <AlertDialogTitle>Update Agent Configuration</AlertDialogTitle>
          <AlertDialogDescription>
            You're editing <span className="font-medium text-foreground truncate inline-block max-w-full align-bottom">{agentName}</span>. This agent may be used by other campaigns and sequences.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <Button
            variant="cta"
            className="justify-start gap-3 h-auto py-3 px-4"
            onClick={onUpdateAgent}
            disabled={isPending}
          >
            <Bot className="h-4 w-4 shrink-0" />
            <div className="text-left">
              <div className="text-sm font-medium">Update Existing Agent</div>
              <div className="text-xs font-normal opacity-80">
                Changes apply everywhere this agent is used
              </div>
            </div>
          </Button>

          <Button
            variant="outline"
            className="justify-start gap-3 h-auto py-3 px-4"
            onClick={onSaveAsNew}
            disabled={isPending}
          >
            <Copy className="h-4 w-4 shrink-0" />
            <div className="text-left">
              <div className="text-sm font-medium">Save as New Agent</div>
              <div className="text-xs font-normal text-muted-foreground">
                Create a separate agent with these settings
              </div>
            </div>
          </Button>

          <Button
            variant="ghost"
            className="mt-1 text-muted-foreground"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
