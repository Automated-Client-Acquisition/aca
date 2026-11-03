import { Check, UserCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { useAssignConversation } from "@/hooks/crm/useConversations";
import { cn } from "@/lib/utils";

interface AssignToUserPickerProps {
  conversationId: string;
  currentAssignedUserId: string | null;
  /** Compact mode for inline usage (e.g., conversation list) */
  compact?: boolean;
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

export function AssignToUserPicker({
  conversationId,
  currentAssignedUserId,
  compact,
}: AssignToUserPickerProps) {
  const { data: members } = useOrganizationMembers();
  const assignConversation = useAssignConversation();

  const currentMember = members?.find(
    (m) => m.user_id === currentAssignedUserId
  );

  const handleAssign = (userId: string | null) => {
    assignConversation.mutate({
      conversationId,
      userId,
      type: userId ? "user" : "unassigned",
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "sm" : "default"}
          className={cn(
            "gap-1.5",
            compact && "h-7 px-2 text-xs"
          )}
        >
          {currentMember ? (
            <>
              <Avatar className="h-5 w-5">
                <AvatarImage src={currentMember.user?.avatar_url || undefined} />
                <AvatarFallback className="text-[10px]">
                  {getInitials(currentMember.user?.full_name)}
                </AvatarFallback>
              </Avatar>
              {!compact && (
                <span className="max-w-[100px] truncate">
                  {currentMember.user?.full_name || currentMember.user?.email}
                </span>
              )}
            </>
          ) : (
            <>
              <UserCircle className="h-4 w-4 text-muted-foreground" />
              {!compact && (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px]">
        <DropdownMenuItem
          onClick={() => handleAssign(null)}
          className="gap-2"
        >
          <X className="h-4 w-4 text-muted-foreground" />
          <span>Unassign</span>
          {!currentAssignedUserId && (
            <Check className="ml-auto h-4 w-4 text-primary" />
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {members?.map((member) => (
          <DropdownMenuItem
            key={member.user_id}
            onClick={() => handleAssign(member.user_id)}
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
            {member.user_id === currentAssignedUserId && (
              <Check className="ml-auto h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
