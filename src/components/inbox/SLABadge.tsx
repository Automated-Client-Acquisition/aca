import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, Clock, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface SLABadgeProps {
  status: "ok" | "warning" | "breached";
  conversationId?: string;
  responseTimeMs?: number;
  className?: string;
}

function formatResponseTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function SLABadge({ status, conversationId, responseTimeMs, className }: SLABadgeProps) {
  // Don't show anything when status is OK
  if (status === "ok") return null;

  const queryClient = useQueryClient();

  const isBreached = status === "breached";
  const Icon = isBreached ? AlertTriangle : Clock;
  const timeText = responseTimeMs ? formatResponseTime(responseTimeMs) : null;

  const label = isBreached ? "Slow reply" : "Reply soon";
  const tooltipLabel = [
    responseTimeMs ? `Avg response: ${formatResponseTime(responseTimeMs)}` : null,
    isBreached ? "Response time exceeded 24h" : "Response time over 4h",
  ]
    .filter(Boolean)
    .join(" · ");

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!conversationId) return;

    // Optimistically patch all conversation caches
    const patchConversation = (old: any) => {
      if (!old) return old;
      // Infinite query shape: { pages: [...], pageParams: [...] }
      if (old.pages) {
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            conversations: page.conversations?.map((c: any) =>
              c.id === conversationId ? { ...c, sla_status: "ok" } : c
            ),
          })),
        };
      }
      // Regular query shape: { conversations: [...] } or array
      if (old.conversations) {
        return {
          ...old,
          conversations: old.conversations.map((c: any) =>
            c.id === conversationId ? { ...c, sla_status: "ok" } : c
          ),
        };
      }
      if (Array.isArray(old)) {
        return old.map((c: any) =>
          c.id === conversationId ? { ...c, sla_status: "ok" } : c
        );
      }
      return old;
    };

    // Patch all conversation query caches
    queryClient.setQueriesData({ queryKey: ["crm-conversations-infinite"] }, patchConversation);
    queryClient.setQueriesData({ queryKey: ["crm-conversations"] }, patchConversation);
    queryClient.setQueriesData({ queryKey: ["crm-contact-conversations"] }, patchConversation);

    // Persist to DB in background
    supabase
      .from("crm_conversations")
      .update({ sla_status: "ok" } as any)
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("[SLABadge] Failed to dismiss SLA:", error.message);
      });
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 h-4 text-[10px] font-medium leading-none whitespace-nowrap",
        isBreached ? "text-red-500" : "text-amber-500",
        className
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-0.5">
            <Icon
              className={cn(
                "h-3 w-3",
                isBreached ? "text-red-500" : "text-amber-500"
              )}
            />
            {timeText ? <span>{timeText}</span> : <span>{label}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{tooltipLabel}</p>
        </TooltipContent>
      </Tooltip>
      {conversationId && (
        <span
          role="button"
          tabIndex={0}
          onClick={handleDismiss}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDismiss(e as any); } }}
          className={cn(
            "inline-flex items-center justify-center h-3.5 w-3.5 rounded-full ml-0.5 transition-colors cursor-pointer",
            isBreached
              ? "hover:bg-red-500/20 text-red-500"
              : "hover:bg-amber-500/20 text-amber-500"
          )}
        >
          <X className="h-2.5 w-2.5" />
        </span>
      )}
    </span>
  );
}
