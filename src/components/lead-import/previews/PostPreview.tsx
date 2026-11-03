import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ThumbsUp, MessageSquare, Share2, User } from "lucide-react";

interface PostPreviewData {
  authorName?: string;
  authorHeadline?: string;
  authorAvatarUrl?: string;
  content?: string;
  reactionCount?: number;
  commentCount?: number;
  shareCount?: number;
  reactions?: {
    type: string;
    count: number;
  }[];
}

interface PostPreviewProps {
  data: PostPreviewData | null;
  isLoading: boolean;
}

const REACTION_EMOJIS: Record<string, string> = {
  LIKE: "👍",
  CELEBRATE: "👏",
  SUPPORT: "💚",
  LOVE: "❤️",
  INSIGHTFUL: "💡",
  FUNNY: "😄",
};

export function PostPreview({ data, isLoading }: PostPreviewProps) {
  if (isLoading) {
    return (
      <Card className="bg-muted/50">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <Skeleton className="h-20 w-full" />
          <div className="flex gap-4">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-16" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <Card className="bg-muted/50 overflow-hidden">
      <CardContent className="p-4 space-y-4">
        {/* Author */}
        <div className="flex items-center gap-3">
          {data.authorAvatarUrl ? (
            <img
              src={data.authorAvatarUrl}
              alt={data.authorName || "Author"}
              className="w-12 h-12 rounded-full object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
              <User className="h-6 w-6 text-blue-600" />
            </div>
          )}
          <div>
            <p className="font-semibold">{data.authorName || "LinkedIn User"}</p>
            {data.authorHeadline && (
              <p className="text-sm text-muted-foreground line-clamp-1">
                {data.authorHeadline}
              </p>
            )}
          </div>
        </div>

        {/* Content */}
        {data.content && (
          <p className="text-sm text-muted-foreground line-clamp-4">
            {data.content}
          </p>
        )}

        {/* Engagement Stats */}
        <div className="flex items-center gap-6 pt-2 border-t">
          {/* Reactions */}
          <div className="flex items-center gap-2">
            {data.reactions && data.reactions.length > 0 ? (
              <div className="flex -space-x-1">
                {data.reactions.slice(0, 3).map((reaction) => (
                  <span
                    key={reaction.type}
                    className="text-sm"
                    title={`${reaction.count} ${reaction.type.toLowerCase()}`}
                  >
                    {REACTION_EMOJIS[reaction.type] || "👍"}
                  </span>
                ))}
              </div>
            ) : (
              <ThumbsUp className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm text-muted-foreground">
              {data.reactionCount || 0}
            </span>
          </div>

          {/* Comments */}
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {data.commentCount || 0} comments
            </span>
          </div>

          {/* Shares */}
          {data.shareCount !== undefined && data.shareCount > 0 && (
            <div className="flex items-center gap-2">
              <Share2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {data.shareCount} shares
              </span>
            </div>
          )}
        </div>

        {/* Reaction Breakdown */}
        {data.reactions && data.reactions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {data.reactions.map((reaction) => (
              <div
                key={reaction.type}
                className="flex items-center gap-1 px-2 py-1 bg-background rounded-full text-xs"
              >
                <span>{REACTION_EMOJIS[reaction.type] || "👍"}</span>
                <span className="text-muted-foreground">{reaction.count}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
