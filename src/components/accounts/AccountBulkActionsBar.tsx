import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, X } from "lucide-react";
import type { OrganizationMember } from "@/types/organization";

interface AccountBulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkAssignOwner?: (userId: string | null) => void;
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

export function AccountBulkActionsBar({
  selectedCount,
  onClearSelection,
  onBulkAssignOwner,
  members,
}: AccountBulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-2 bg-background border shadow-lg rounded-lg px-4 py-2.5">
        <span className="text-sm font-medium tabular-nums mr-1">
          {selectedCount} selected
        </span>
        <div className="w-px h-5 bg-border" />
        {onBulkAssignOwner && members && members.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <UserPlus className="w-4 h-4 mr-1.5" />
                Assign Owner
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[200px]">
              <DropdownMenuItem onClick={() => onBulkAssignOwner(null)} className="gap-2">
                <X className="h-4 w-4 text-muted-foreground" />
                Remove Owner
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {members.map((member) => (
                <DropdownMenuItem
                  key={member.user_id}
                  onClick={() => onBulkAssignOwner(member.user_id)}
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
        <div className="w-px h-5 bg-border" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          className="text-muted-foreground"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
