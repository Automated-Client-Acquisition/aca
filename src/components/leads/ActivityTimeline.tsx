import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Activity,
  UserPlus,
  MessageSquare,
  Mail,
  Eye,
  UserCheck,
  Heart,
  Reply,
  Phone,
  Send,
  MessageCircle,
} from "lucide-react";
import {
  useLeadActivityTimeline,
  getActionLabel,
  getActionColor,
  type ActivityTimelineItem,
} from "@/hooks/useLeadActivityTimeline";
import { formatDistanceToNow } from "date-fns";

// Icon mapping for action types
const actionIcons: Record<string, React.ElementType> = {
  connection_request: UserPlus,
  connectionRequest: UserPlus,
  message: MessageSquare,
  inmail: Mail,
  email: Mail,
  whatsapp: MessageCircle,
  whatsappMessage: MessageCircle,
  instagram_dm: Send,
  instagramDm: Send,
  telegram: Send,
  telegramMessage: Send,
  sms: Phone,
  smsMessage: Phone,
  view_profile: Eye,
  viewProfile: Eye,
  follow: UserCheck,
  like_post: Heart,
  likePost: Heart,
  reply_detected: Reply,
  system_reply_detected: Reply,
};

interface TimelineItemProps {
  action: ActivityTimelineItem;
  isLast: boolean;
}

function TimelineItem({ action, isLast }: TimelineItemProps) {
  const Icon = actionIcons[action.action_type] || Activity;
  const colorClass = getActionColor(action.action_type);

  const timestamp = action.executed_at || action.created_at;
  const formattedTime = timestamp
    ? formatDistanceToNow(new Date(timestamp), { addSuffix: true })
    : "Unknown time";

  return (
    <div className="flex gap-3">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
            colorClass
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        {!isLast && <div className="w-0.5 h-full bg-border flex-1 min-h-[20px]" />}
      </div>

      {/* Content */}
      <div className={cn("pb-4 flex-1", isLast && "pb-0")}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <span className="font-medium text-sm">
              {getActionLabel(action.action_type)}
            </span>
            {action.campaign?.name && (
              <span className="text-xs text-muted-foreground ml-2">
                in {action.campaign.name}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formattedTime}
          </span>
        </div>

        {/* Channel badge */}
        {action.channel && (
          <Badge variant="outline" className="mt-1 text-xs">
            {action.channel}
          </Badge>
        )}

        {/* Message preview */}
        {action.message_content && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {action.message_content.substring(0, 150)}
            {action.message_content.length > 150 && "..."}
          </p>
        )}

        {/* Error message */}
        {action.status === "failed" && action.error_message && (
          <Badge variant="destructive" className="mt-1 text-xs">
            {action.error_message.substring(0, 100)}
          </Badge>
        )}

        {/* Status indicator for non-success */}
        {action.status === "skipped" && (
          <Badge variant="secondary" className="mt-1 text-xs">
            Skipped
          </Badge>
        )}
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ActivityTimelineProps {
  contactId: string | undefined;
  limit?: number;
  className?: string;
  showCard?: boolean;
}

export function ActivityTimeline({
  contactId,
  limit = 50,
  className,
  showCard = true,
}: ActivityTimelineProps) {
  const { data: activities, isLoading, error } = useLeadActivityTimeline(
    contactId,
    limit
  );

  const content = (
    <>
      {isLoading && <TimelineSkeleton />}

      {error && (
        <div className="text-center py-4 text-muted-foreground">
          <p className="text-sm">Failed to load activity</p>
        </div>
      )}

      {!isLoading && !error && activities?.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No activity yet</p>
          <p className="text-xs mt-1">
            Campaign actions will appear here once the lead is enrolled
          </p>
        </div>
      )}

      {!isLoading && !error && activities && activities.length > 0 && (
        <div className="space-y-0">
          {activities.map((action, index) => (
            <TimelineItem
              key={action.id}
              action={action}
              isLast={index === activities.length - 1}
            />
          ))}
        </div>
      )}
    </>
  );

  if (!showCard) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Activity Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}

// Compact timeline for inline use
export function ActivityTimelineCompact({
  contactId,
  limit = 5,
}: {
  contactId: string | undefined;
  limit?: number;
}) {
  const { data: activities, isLoading } = useLeadActivityTimeline(contactId, limit);

  if (isLoading) {
    return <Skeleton className="h-4 w-32" />;
  }

  if (!activities || activities.length === 0) {
    return <span className="text-xs text-muted-foreground">No activity</span>;
  }

  const latestAction = activities[0];
  const Icon = actionIcons[latestAction.action_type] || Activity;

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" />
      <span>{getActionLabel(latestAction.action_type)}</span>
      {latestAction.executed_at && (
        <span>
          {formatDistanceToNow(new Date(latestAction.executed_at), {
            addSuffix: true,
          })}
        </span>
      )}
    </div>
  );
}
