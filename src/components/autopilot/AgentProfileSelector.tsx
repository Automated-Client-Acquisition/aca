import { Bot, ChevronDown, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentProfiles, type AgentProfile } from "@/hooks/useAgentProfiles";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface AgentProfileSelectorProps {
  selectedProfileId: string | null;
  onSelect: (profile: AgentProfile) => void;
  onCreateNew?: () => void;
  className?: string;
}

export function AgentProfileSelector({
  selectedProfileId,
  onSelect,
  onCreateNew,
  className,
}: AgentProfileSelectorProps) {
  const { data: profiles, isLoading } = useAgentProfiles();
  const [open, setOpen] = useState(false);

  const selectedProfile = profiles?.find((p) => p.id === selectedProfileId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-full justify-between h-9 text-sm overflow-hidden", className)}
        >
          <span className="flex items-center gap-2 min-w-0 truncate">
            <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {selectedProfile ? (
              <span className="truncate">{selectedProfile.name}</span>
            ) : (
              <span className="text-muted-foreground">Select agent profile...</span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <ScrollArea className="max-h-[300px]">
          <div className="p-1">
            {isLoading ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading profiles...</div>
            ) : !profiles?.length ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No agent profiles yet
              </div>
            ) : (
              profiles.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => { onSelect(profile); setOpen(false); }}
                  className={cn(
                    "flex flex-col w-full px-3 py-2 rounded-md text-left transition-colors",
                    profile.id === selectedProfileId
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{profile.name}</span>
                    {profile.is_default && (
                      <Badge variant="secondary" className="text-[9px] h-4 px-1 gap-0.5">
                        <Star className="h-2.5 w-2.5 fill-current" /> Default
                      </Badge>
                    )}
                  </div>
                  {profile.description && (
                    <span className="text-xs text-muted-foreground truncate mt-0.5">{profile.description}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
        {onCreateNew && (
          <div className="border-t p-1">
            <button
              onClick={() => { onCreateNew(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Create New Agent
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
