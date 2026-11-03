import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BellOff, CheckCheck, Clock, Loader2, Mail, MailOpen, Trash2, UserPlus, X, XCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { OrganizationMember } from "@/types/organization";

interface BatchSelectionBarProps {
  selectedCount: number;
  totalCount: number;
  loadedCount?: number;
  selectAllMode?: boolean;
  isFetchingAll?: boolean;
  selectionError?: string;
  onRetrySelection?: () => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
  onSelectAllMatching?: () => void;
  onBatchClose: () => void;
  onBatchSnooze: () => void;
  onBatchMute: () => void;
  onBatchMarkRead: () => void;
  onBatchDelete: () => void;
  onBatchEnroll?: () => void;
  onBatchAssign?: (userId: string | null) => void;
  members?: OrganizationMember[];
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function BatchSelectionBar({
  selectedCount,
  totalCount,
  loadedCount,
  selectAllMode,
  isFetchingAll,
  selectionError,
  onRetrySelection,
  onClearSelection,
  onSelectAll,
  onSelectAllMatching,
  onBatchClose,
  onBatchSnooze,
  onBatchMute,
  onBatchMarkRead,
  onBatchDelete,
  onBatchEnroll,
  onBatchAssign,
  members,
}: BatchSelectionBarProps) {
  if (selectedCount === 0 && !selectAllMode) return null;

  // Whether the loaded page is fully selected (but not yet "select all matching")
  const loadedAllSelected = loadedCount != null && selectedCount >= loadedCount && loadedCount > 0;
  const showSelectAllMatchingPrompt = !selectAllMode && loadedAllSelected && totalCount > (loadedCount ?? 0) && onSelectAllMatching;

  return (
    <div className="border-b border-primary/20">
      <div
        className={cn(
          "flex items-center justify-between flex-wrap gap-2 px-3 py-2",
          "bg-primary/10",
          "animate-in slide-in-from-top duration-200"
        )}
      >
        {/* Left: count + select all / clear */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {selectAllMode ? (
              selectionError ? "Selection failed" : isFetchingAll ? "Selecting all..." : `All ${selectedCount} selected`
            ) : (
              `${selectedCount} selected`
            )}
          </span>
          {!selectAllMode && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onSelectAll}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              {loadedAllSelected ? "Deselect All" : `Select All (${loadedCount ?? totalCount})`}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onClearSelection}
          >
            Clear
          </Button>
        </div>

        {/* Right: bulk actions */}
        <fieldset disabled={isFetchingAll || !!selectionError} className="flex flex-wrap items-center gap-1.5 disabled:opacity-50">
          {isFetchingAll && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground mr-1" />
          )}
          {onBatchAssign && members && members.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Assign to...
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[200px]">
                <DropdownMenuItem onClick={() => onBatchAssign(null)} className="gap-2">
                  <X className="h-4 w-4 text-muted-foreground" />
                  Unassign
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {members.map((member) => (
                  <DropdownMenuItem
                    key={member.user_id}
                    onClick={() => onBatchAssign(member.user_id)}
                    className="gap-2"
                  >
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={member.user?.avatar_url || undefined} />
                      <AvatarFallback className="text-[10px]">
                        {getInitials(member.user?.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">
                      {member.user?.full_name || member.user?.email}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onBatchEnroll && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={onBatchEnroll}
            >
              <Mail className="h-3.5 w-3.5" />
              Enroll in Sequence
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={onBatchMarkRead}
          >
            <MailOpen className="h-3.5 w-3.5" />
            Mark Read
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={onBatchClose}
          >
            <XCircle className="h-3.5 w-3.5" />
            Close All
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={onBatchSnooze}
          >
            <Clock className="h-3.5 w-3.5" />
            Snooze All
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={onBatchMute}
          >
            <BellOff className="h-3.5 w-3.5" />
            Mute All
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={onBatchDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete All
          </Button>
        </fieldset>
      </div>

      {/* Gmail-style "Select all X conversations" prompt */}
      {showSelectAllMatchingPrompt && (
        <div className="flex items-center justify-center flex-wrap gap-1 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-300 border-b border-blue-200 dark:border-blue-800">
          All {loadedCount} conversations on this page are selected.{" "}
          <Button
            variant="link"
            size="sm"
            className="h-auto px-1 text-xs text-blue-700 dark:text-blue-300 underline font-medium"
            onClick={onSelectAllMatching}
          >
            Select all {totalCount} conversations
          </Button>
        </div>
      )}

      {selectAllMode && (
        <div className="flex items-center justify-center flex-wrap gap-1 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-300 border-b border-blue-200 dark:border-blue-800">
          {selectionError ? (
            <><span role="alert">{selectionError}</span><Button variant="outline" size="sm" onClick={onRetrySelection}>Retry</Button></>
          ) : isFetchingAll ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
              Loading all matching conversations...
            </>
          ) : (
            <>
              All {selectedCount} conversations matching this filter are selected.{" "}
              <Button
                variant="link"
                size="sm"
                className="h-auto px-1 text-xs text-blue-700 dark:text-blue-300 underline font-medium"
                onClick={onClearSelection}
              >
                Clear selection
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
