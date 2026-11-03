import { useState } from "react";
import { useBlueprints } from "@/hooks/useBlueprints";
import { useVideoEditor } from "../context/VideoEditorContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, LayoutTemplate, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Blueprint } from "@/types/blueprint";

// ── Blueprint card ──────────────────────────────────────────────────

function BlueprintCard({
  blueprint,
  onUse,
}: {
  blueprint: Blueprint;
  onUse: (blueprint: Blueprint) => void;
}) {
  const pipeline = (blueprint.pipeline as string) || "";

  return (
    <button
      onClick={() => onUse(blueprint)}
      className="w-full text-left group flex items-start gap-2.5 p-2.5 rounded-lg border border-border bg-muted/30 hover:bg-muted hover:border-border/80 transition-colors"
    >
      <div className="flex-shrink-0 mt-0.5 p-1.5 rounded-md bg-primary/10">
        <LayoutTemplate className="h-3 w-3 text-primary" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{blueprint.name}</p>
        {blueprint.description && (
          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
            {blueprint.description}
          </p>
        )}
        {pipeline && (
          <span className="inline-block mt-1 px-1.5 py-px rounded text-[9px] bg-muted border border-border text-muted-foreground">
            {pipeline}
          </span>
        )}
      </div>

      <ChevronRight className="flex-shrink-0 h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors mt-1" />
    </button>
  );
}

// ── Main panel ──────────────────────────────────────────────────────

export function BlueprintPanel() {
  const [search, setSearch] = useState("");
  const { data: blueprints, isLoading } = useBlueprints();
  const { setPanel } = useVideoEditor();

  const filtered = (blueprints || []).filter(
    (b) =>
      !search ||
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      (b.description || "").toLowerCase().includes(search.toLowerCase())
  );

  function handleUse(blueprint: Blueprint) {
    // Copy the master prompt to clipboard and switch to chat
    const prompt = blueprint.master_prompt
      ? `Use this blueprint prompt to create my video:\n\n${blueprint.master_prompt}`
      : `Create a video using the "${blueprint.name}" style.`;

    navigator.clipboard
      .writeText(prompt)
      .then(() => {
        toast.success("Blueprint prompt copied to clipboard", {
          description: "Paste it into the chat to get started.",
        });
      })
      .catch(() => {});

    // Switch to chat panel so the user can paste
    setPanel("chat");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search blueprints..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-6 h-7 text-xs"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 text-center gap-1">
            <LayoutTemplate className="h-6 w-6 text-muted-foreground/20" />
            <p className="text-[10px] text-muted-foreground">
              {search ? "No blueprints match your search" : "No blueprints yet"}
            </p>
          </div>
        ) : (
          filtered.map((blueprint) => (
            <BlueprintCard
              key={blueprint.id}
              blueprint={blueprint}
              onUse={handleUse}
            />
          ))
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-border">
        <p className="text-[9px] text-muted-foreground text-center">
          Click a blueprint to copy its prompt to chat
        </p>
      </div>
    </div>
  );
}
