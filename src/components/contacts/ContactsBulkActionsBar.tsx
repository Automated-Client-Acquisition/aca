import { useState } from "react";
import {
  X,
  Trash2,
  Download,
  Search,
  Building2,
  Mail,
  MailCheck,
  Send,
  MailPlus,
  Ban,
  ListPlus,
  ChevronDown,
  Zap,
  Rocket,
  Eraser,
  BookOpen,
  RefreshCw,
  ShieldAlert,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
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

interface StaticList {
  id: string;
  name: string;
}

interface ContactsBulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  // Add to list
  staticLists: StaticList[];
  onAddToList: (listId: string, listName: string) => void;
  isAddingToList?: boolean;
  // Enrich
  onFindEmails: () => void;
  onAnalyzeCompanies: () => void;
  onCheckFirewalls: () => void;
  onVerifyEmails: () => void;
  // Outreach
  onGenerateSequences: () => void;
  onGenerateAndSend: () => void;
  onPushToEmailTool: () => void;
  onEnrollInEmailSequence: () => void;
  onClearSequences: () => void;
  isClearingSequences?: boolean;
  onGenerateNotionPages: () => void;
  onRegenerateNotionPages: () => void;
  onDeleteNotionPages: () => void;
  isDeletingNotionPages?: boolean;
  // Other
  onAddToExclusionList: () => void;
  onSetCustomField: () => void;
  onExport: () => void;
  // Delete
  onDelete?: () => void;
  isDeleting?: boolean;
}

export function ContactsBulkActionsBar({
  selectedCount,
  onClearSelection,
  staticLists,
  onAddToList,
  isAddingToList,
  onFindEmails,
  onAnalyzeCompanies,
  onCheckFirewalls,
  onVerifyEmails,
  onGenerateSequences,
  onGenerateAndSend,
  onPushToEmailTool,
  onEnrollInEmailSequence,
  onClearSequences,
  isClearingSequences,
  onGenerateNotionPages,
  onRegenerateNotionPages,
  onDeleteNotionPages,
  isDeletingNotionPages,
  onAddToExclusionList,
  onSetCustomField,
  onExport,
  onDelete,
  isDeleting,
}: ContactsBulkActionsBarProps) {
  const [showDeleteNotionDialog, setShowDeleteNotionDialog] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <>
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-3 bg-background border shadow-lg rounded-lg px-4 py-3">
        {/* Selection count */}
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="h-7 px-3 text-sm font-medium">
            {selectedCount} selected
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClearSelection}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="cta" size="sm">
              <Zap className="h-4 w-4 mr-2" />
              Actions
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-56">
            {/* Add to List */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ListPlus className="h-4 w-4 mr-2" />
                Add to List
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
                  {staticLists.length === 0 ? (
                    <DropdownMenuItem disabled>
                      <span className="text-muted-foreground">No lists available</span>
                    </DropdownMenuItem>
                  ) : (
                    staticLists.map((list) => (
                      <DropdownMenuItem
                        key={list.id}
                        onClick={() => onAddToList(list.id, list.name)}
                        disabled={isAddingToList}
                      >
                        {list.name}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Enrich</DropdownMenuLabel>
            <DropdownMenuItem onClick={onFindEmails}>
              <Search className="h-4 w-4 mr-2" />
              Find Emails
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAnalyzeCompanies}>
              <Building2 className="h-4 w-4 mr-2" />
              Analyze Companies
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCheckFirewalls}>
              <ShieldAlert className="h-4 w-4 mr-2" />
              Check Firewalls
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onVerifyEmails}>
              <MailCheck className="h-4 w-4 mr-2" />
              Verify Emails
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Outreach</DropdownMenuLabel>
            <DropdownMenuItem onClick={onGenerateSequences}>
              <Mail className="h-4 w-4 mr-2" />
              Generate Sequences
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onGenerateAndSend}>
              <Rocket className="h-4 w-4 mr-2" />
              Generate & Send
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPushToEmailTool}>
              <Send className="h-4 w-4 mr-2" />
              Push to Email Tool
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEnrollInEmailSequence}>
              <MailPlus className="h-4 w-4 mr-2" />
              Enroll in Email Sequence
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onClearSequences} disabled={isClearingSequences}>
              <Eraser className="h-4 w-4 mr-2" />
              Clear Sequences
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onGenerateNotionPages}>
              <BookOpen className="h-4 w-4 mr-2" />
              Generate Notion Pages
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRegenerateNotionPages}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate Notion Pages
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowDeleteNotionDialog(true)}
              disabled={isDeletingNotionPages}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Notion Pages
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onAddToExclusionList}>
              <Ban className="h-4 w-4 mr-2" />
              Add to Exclusion List
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSetCustomField}>
              <Pencil className="h-4 w-4 mr-2" />
              Set Custom Field
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onExport}>
              <Download className="h-4 w-4 mr-2" />
              Export Selected
            </DropdownMenuItem>

            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Selected
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    {/* Delete Notion Pages Confirmation Dialog */}
    <AlertDialog open={showDeleteNotionDialog} onOpenChange={setShowDeleteNotionDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Notion pages for {selectedCount} contact(s)?</AlertDialogTitle>
          <AlertDialogDescription>
            This will archive the Notion pages and remove the Notion URL from the selected contacts. This action cannot be easily undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onDeleteNotionPages();
              setShowDeleteNotionDialog(false);
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete Pages
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
