import { usePublishedPosts } from "@/hooks/usePublishedPosts";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PLATFORMS } from "@/lib/platformRequirements";

interface PublishedPlatformsBadgeProps {
  outputId: string;
  variant?: 'compact' | 'detailed';
}

export function PublishedPlatformsBadge({ outputId, variant = 'compact' }: PublishedPlatformsBadgeProps) {
  const { data: publishedPosts, isLoading } = usePublishedPosts(outputId);

  if (isLoading) {
    return null; // Don't show loading state - cleaner UX
  }

  if (!publishedPosts || publishedPosts.length === 0) {
    return null;
  }

  // Count published vs scheduled
  const publishedCount = publishedPosts.filter(p => p.status === 'published').length;
  const scheduledCount = publishedPosts.filter(p => p.status === 'scheduled').length;

  // If nothing is published or scheduled, show nothing
  if (publishedCount === 0 && scheduledCount === 0) {
    return null;
  }

  // Get platform names for tooltip
  const platformGroups = publishedPosts.reduce((acc, post) => {
    const platform = post.platform.toLowerCase();
    if (!acc[platform]) {
      acc[platform] = [];
    }
    acc[platform].push(post);
    return acc;
  }, {} as Record<string, typeof publishedPosts>);

  const platformNames = Object.keys(platformGroups).map(key => {
    const platform = PLATFORMS[key as keyof typeof PLATFORMS];
    return platform?.name || key;
  });

  if (variant === 'compact') {
    // Simple badge: "Published" in green or "Scheduled" in blue
    if (publishedCount > 0) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="h-5 px-1.5 gap-1 text-xs font-normal bg-green-500/10 text-green-600 border-green-500/30 dark:text-green-400"
              >
                <CheckCircle2 className="h-3 w-3" />
                <span className="text-[10px] font-medium">Published</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="text-xs space-y-1">
                <p className="font-medium">{publishedCount} published{scheduledCount > 0 ? `, ${scheduledCount} scheduled` : ''}</p>
                <p className="text-muted-foreground">{platformNames.join(', ')}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    // Only scheduled
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="h-5 px-1.5 gap-1 text-xs font-normal bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400"
            >
              <Clock className="h-3 w-3" />
              <span className="text-[10px] font-medium">Scheduled</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="text-xs space-y-1">
              <p className="font-medium">{scheduledCount} scheduled</p>
              <p className="text-muted-foreground">{platformNames.join(', ')}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Detailed variant - show full breakdown
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Publishing Status:</div>
      <div className="space-y-1.5">
        {Object.entries(platformGroups).map(([platformKey, posts]) => {
          const platform = PLATFORMS[platformKey as keyof typeof PLATFORMS];

          return (
            <div key={platformKey} className="space-y-1">
              {posts.map((post) => (
                <div
                  key={post.id}
                  className="flex items-center gap-2 p-2 rounded-md border bg-card text-sm"
                >
                  <div className="flex items-center gap-2 flex-1">
                    {post.status === 'published' ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : post.status === 'scheduled' ? (
                      <Clock className="h-3 w-3 text-blue-500" />
                    ) : null}
                    <span className="font-medium" style={{ color: platform?.color }}>
                      {platform?.name || platformKey}
                    </span>
                    {post.platform_account_name && (
                      <span className="text-muted-foreground text-xs">
                        ({post.platform_account_name})
                      </span>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs capitalize ${
                      post.status === 'published'
                        ? 'bg-green-500/10 text-green-600 border-green-500/30'
                        : post.status === 'scheduled'
                        ? 'bg-blue-500/10 text-blue-600 border-blue-500/30'
                        : ''
                    }`}
                  >
                    {post.status}
                  </Badge>
                  {post.scheduled_for && post.status === 'scheduled' && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(post.scheduled_for).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
