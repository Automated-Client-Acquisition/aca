import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Settings, Pause, Play, X, PenLine, Mail, Loader2, Tag, UserPlus, Download, Flame, FlameKindling, Trash2, ImagePlus } from "lucide-react";
import type { OrganizationMember } from "@/types/organization";

interface MailboxBulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkEdit: () => void;
  onBulkSignature: () => void;
  onBulkTag: () => void;
  onBulkSetAvatar: () => void;
  onBulkPause: () => void;
  onBulkResume: () => void;
  onBulkStartWarming: () => void;
  onBulkStopWarming: () => void;
  onBulkTestConnection: () => void;
  isTestingConnection?: boolean;
  onBulkExportMailflow?: () => void;
  isExporting?: boolean;
  onBulkAssignOwner?: (userId: string | null) => void;
  onBulkDelete?: () => void;
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

export function MailboxBulkActionsBar({
  selectedCount,
  onClearSelection,
  onBulkEdit,
  onBulkSignature,
  onBulkTag,
  onBulkSetAvatar,
  onBulkPause,
  onBulkResume,
  onBulkStartWarming,
  onBulkStopWarming,
  onBulkTestConnection,
  isTestingConnection,
  onBulkExportMailflow,
  isExporting,
  onBulkAssignOwner,
  onBulkDelete,
  members,
}: MailboxBulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 z-50 left-[calc(var(--sidebar-width,0px)+((100vw-var(--sidebar-width,0px))/2))] -translate-x-1/2">
      <div className="flex items-center gap-2 bg-background border shadow-lg rounded-lg px-4 py-2.5 max-w-[calc(100vw-var(--sidebar-width,0px)-3rem)] overflow-x-auto">
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
        <Button variant="outline" size="sm" onClick={onBulkEdit}>
          <Settings className="w-4 h-4 mr-1.5" />
          Edit Settings
        </Button>
        <Button variant="outline" size="sm" onClick={onBulkSignature}>
          <PenLine className="w-4 h-4 mr-1.5" />
          Edit Signature
        </Button>
        <Button variant="outline" size="sm" onClick={onBulkTag}>
          <Tag className="w-4 h-4 mr-1.5" />
          Tag
        </Button>
        <Button variant="outline" size="sm" onClick={onBulkSetAvatar}>
          <ImagePlus className="w-4 h-4 mr-1.5" />
          Set Avatar
        </Button>
        <Button variant="outline" size="sm" onClick={onBulkTestConnection} disabled={isTestingConnection}>
          {isTestingConnection ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Mail className="w-4 h-4 mr-1.5" />
          )}
          Test Connection
        </Button>
        {onBulkExportMailflow && (
          <Button variant="outline" size="sm" onClick={onBulkExportMailflow} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-1.5" />
            )}
            Export CSV
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onBulkStartWarming}>
          <Flame className="w-4 h-4 mr-1.5" />
          Start Warming
        </Button>
        <Button variant="outline" size="sm" onClick={onBulkStopWarming}>
          <FlameKindling className="w-4 h-4 mr-1.5" />
          Stop Warming
        </Button>
        <Button variant="outline" size="sm" onClick={onBulkPause}>
          <Pause className="w-4 h-4 mr-1.5" />
          Pause All
        </Button>
        <Button variant="outline" size="sm" onClick={onBulkResume}>
          <Play className="w-4 h-4 mr-1.5" />
          Resume All
        </Button>
        {onBulkDelete && (
          <Button variant="destructive" size="sm" onClick={onBulkDelete}>
            <Trash2 className="w-4 h-4 mr-1.5" />
            Delete
          </Button>
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
