import { useMemo } from "react";
import {
  Users,
  Clock,
  MessageSquare,
  CheckCircle,
  XCircle,
  Reply,
  ExternalLink,
  Linkedin,
  Instagram,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type LeadWithCrmContact } from "@/hooks/leads/useLeadsSync";

interface LeadsPipelineProps {
  leads: LeadWithCrmContact[];
  isLoading: boolean;
}

interface PipelineStage {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  statuses: string[];
}

const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: "pending",
    name: "New / Pending",
    icon: Clock,
    color: "text-status-warning",
    bgColor: "bg-status-warning/20",
    statuses: ["pending"],
  },
  {
    id: "awaiting",
    name: "Awaiting Connection",
    icon: Users,
    color: "text-status-warning",
    bgColor: "bg-status-warning/20",
    statuses: ["awaiting_connection"],
  },
  {
    id: "dm_sent",
    name: "DM Sent",
    icon: MessageSquare,
    color: "text-green-600",
    bgColor: "bg-green-100",
    statuses: ["dm_sent"],
  },
  {
    id: "replied",
    name: "Replied",
    icon: Reply,
    color: "text-blue-600",
    bgColor: "bg-blue-100",
    statuses: ["replied"],
  },
  {
    id: "converted",
    name: "Converted",
    icon: CheckCircle,
    color: "text-primary",
    bgColor: "bg-primary/10",
    statuses: ["converted"],
  },
  {
    id: "failed",
    name: "Failed",
    icon: XCircle,
    color: "text-red-600",
    bgColor: "bg-red-100",
    statuses: ["dm_failed"],
  },
];

export function LeadsPipeline({ leads, isLoading }: LeadsPipelineProps) {
  // Group leads by stage
  const leadsByStage = useMemo(() => {
    const grouped: Record<string, LeadWithCrmContact[]> = {};

    for (const stage of PIPELINE_STAGES) {
      grouped[stage.id] = leads.filter((lead) =>
        stage.statuses.includes(lead.status)
      );
    }

    return grouped;
  }, [leads]);

  if (isLoading) {
    return (
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4 min-w-max">
          {PIPELINE_STAGES.map((stage) => (
            <div
              key={stage.id}
              className="flex-shrink-0 w-72 bg-muted/30 rounded-lg p-3 space-y-3"
            >
              <Skeleton className="h-6 w-32" />
              {[...Array(3)].map((_, j) => (
                <Skeleton key={j} className="h-28 rounded-lg" />
              ))}
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="w-full">
      <div className="flex gap-4 pb-4 min-w-max">
        {PIPELINE_STAGES.map((stage) => (
          <PipelineColumn
            key={stage.id}
            stage={stage}
            leads={leadsByStage[stage.id] || []}
          />
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

interface PipelineColumnProps {
  stage: PipelineStage;
  leads: LeadWithCrmContact[];
}

function PipelineColumn({ stage, leads }: PipelineColumnProps) {
  const Icon = stage.icon;

  return (
    <div className="flex-shrink-0 w-72">
      <div className="bg-muted/30 rounded-lg p-3 h-full">
        {/* Column Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={cn("w-6 h-6 rounded flex items-center justify-center", stage.bgColor)}>
              <Icon className={cn("h-3.5 w-3.5", stage.color)} />
            </div>
            <h3 className="font-medium text-sm">{stage.name}</h3>
            <Badge variant="secondary" className="h-5 text-xs">
              {leads.length}
            </Badge>
          </div>
        </div>

        {/* Cards */}
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {leads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No leads in this stage
            </div>
          ) : (
            leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface LeadCardProps {
  lead: LeadWithCrmContact;
}

function LeadCard({ lead }: LeadCardProps) {
  const Icon = lead.campaign?.account?.provider === "LINKEDIN" ? Linkedin : Instagram;
  const iconColor =
    lead.campaign?.account?.provider === "LINKEDIN" ? "text-[#0A66C2]" : "text-[#E1306C]";

  const initials = lead.commenter_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-start gap-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            {lead.commenter_profile_url ? (
              <a
                href={lead.commenter_profile_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sm hover:underline flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="truncate">{lead.commenter_name}</span>
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
              </a>
            ) : (
              <p className="font-medium text-sm truncate">{lead.commenter_name}</p>
            )}
            {lead.commenter_headline && (
              <p className="text-xs text-muted-foreground truncate">
                {lead.commenter_headline}
              </p>
            )}
          </div>
        </div>

        {/* Comment Preview */}
        <p className="text-xs text-muted-foreground line-clamp-2">
          {lead.comment_text}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[10px] h-4">
            {lead.matched_keyword}
          </Badge>
          {lead.crm_contact?.tags?.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] h-4">
              {tag}
            </Badge>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t">
          <div className="flex items-center gap-1">
            <Icon className={cn("h-3 w-3", iconColor)} />
            <span className="truncate max-w-[80px]">{lead.campaign?.name}</span>
          </div>
          <span>
            {formatDistanceToNow(new Date(lead.captured_at), { addSuffix: true })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
