import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, MapPin, Users, Clock } from "lucide-react";

interface EventPreviewData {
  title?: string;
  description?: string;
  imageUrl?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  attendeeCount?: number;
  hostName?: string;
  hostAvatarUrl?: string;
}

interface EventPreviewProps {
  data: EventPreviewData | null;
  isLoading: boolean;
}

export function EventPreview({ data, isLoading }: EventPreviewProps) {
  if (isLoading) {
    return (
      <Card className="bg-muted/50 overflow-hidden">
        <Skeleton className="w-full h-40" />
        <CardContent className="p-4 space-y-4">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="flex gap-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-24" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  // Format date
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Card className="bg-muted/50 overflow-hidden">
      {/* Event Image */}
      {data.imageUrl && (
        <div className="relative h-40 bg-gradient-to-br from-blue-500 to-cyan-500">
          <img
            src={data.imageUrl}
            alt={data.title || "Event"}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <CardContent className="p-4 space-y-4">
        {/* Title */}
        <h3 className="font-semibold text-lg line-clamp-2">
          {data.title || "LinkedIn Event"}
        </h3>

        {/* Description */}
        {data.description && (
          <p className="text-sm text-muted-foreground line-clamp-3">
            {data.description}
          </p>
        )}

        {/* Event Details */}
        <div className="space-y-2">
          {/* Date */}
          {data.startDate && (
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-blue-600" />
              <span>{formatDate(data.startDate)}</span>
              {data.endDate && (
                <>
                  <span className="text-muted-foreground">-</span>
                  <span>{formatDate(data.endDate)}</span>
                </>
              )}
            </div>
          )}

          {/* Location */}
          {data.location && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-green-600" />
              <span>{data.location}</span>
            </div>
          )}

          {/* Attendees */}
          {data.attendeeCount !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-primary" />
              <span className="font-medium">{data.attendeeCount.toLocaleString()}</span>
              <span className="text-muted-foreground">attendees</span>
            </div>
          )}
        </div>

        {/* Host */}
        {data.hostName && (
          <div className="flex items-center gap-3 pt-3 border-t">
            {data.hostAvatarUrl ? (
              <img
                src={data.hostAvatarUrl}
                alt={data.hostName}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                <Clock className="h-4 w-4 text-blue-600" />
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Hosted by</p>
              <p className="text-sm font-medium">{data.hostName}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
