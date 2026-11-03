import { Link } from "react-router-dom";
import { format } from "date-fns";
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Loader2 } from "lucide-react";
import type { JobContentPiece, JobPublicationTarget } from "@/hooks/useJobContentSummaries";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PLATFORMS: Record<string, string> = { linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", twitter: "X", x: "X", youtube: "YouTube", tiktok: "TikTok", google: "Google", googlemybusiness: "Google Business", pinterest: "Pinterest", wordpress: "WordPress" };

function dateLabel(value?: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  return format(new Date(value), "MMM d, h:mm a");
}

interface Props {
  targets: JobPublicationTarget[];
  outputs: JobContentPiece[];
  isLoading: boolean;
  hasError: boolean;
  hasOutputs: boolean;
}

export function JobPublicationDetails({ targets, outputs, isLoading, hasError, hasOutputs }: Props) {
  if (isLoading) return <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-40" /></div>;
  const published = targets.filter(target => target.status === "published").length;
  const upcoming = targets.filter(target => ["scheduled", "pending", "publishing"].includes(target.status)).length;
  const failed = targets.filter(target => ["failed", "error"].includes(target.status)).length;
  const renderTarget = (target: JobPublicationTarget) => {
    const live = target.status === "published";
    const error = ["failed", "error"].includes(target.status);
    const publishing = target.status === "publishing";
    const label = live ? "Published" : error ? "Failed" : publishing ? "Publishing" : target.status === "scheduled" ? "Scheduled" : target.status === "pending" ? "In queue" : target.status === "draft" ? "Draft" : target.status === "saved" ? "Saved" : target.status.replace(/_/g, " ");
    const Icon = live ? CheckCircle2 : error ? AlertCircle : publishing ? Loader2 : Clock;
    const date = dateLabel(live ? target.publishedAt : target.scheduledFor);
    const title = outputs.length > 1 ? outputs.find(output => output.id === target.outputId)?.title : null;
    return (
      <div key={target.id} className="min-w-0 rounded-md bg-muted/30 px-2.5 py-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="font-medium">{PLATFORMS[target.platform.toLowerCase()] || target.platform}</span>
          <span className={cn("inline-flex items-center gap-1", live ? "text-green-700 dark:text-green-400" : error ? "text-destructive" : "text-muted-foreground")}><Icon className={cn("h-3 w-3", publishing && "animate-spin")} />{label}</span>
        </div>
        <p className="mt-1 break-words text-muted-foreground">{target.accountName || (target.platform === "wordpress" ? "WordPress site" : "Account name unavailable")}</p>
        {date && <time className="mt-0.5 block text-muted-foreground" dateTime={(live ? target.publishedAt : target.scheduledFor) || undefined}>{date}</time>}
        {title && <p className="mt-1 line-clamp-1 text-muted-foreground" title={title}>{title}</p>}
        {target.url && (live || target.status === "saved") && <a href={target.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 underline underline-offset-2" aria-label={`View ${live ? "published post" : "saved content"} on ${PLATFORMS[target.platform.toLowerCase()] || target.platform}`}>{live ? "View post" : "Open in WordPress"}<ExternalLink className="h-3 w-3" /></a>}
        {error && target.error && <p className="mt-1 line-clamp-2 break-words text-destructive" title={target.error}>{target.error}</p>}
      </div>
    );
  };
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Publishing</p>
      {hasError && <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertCircle className="h-3.5 w-3.5 shrink-0" />Some publishing records unavailable</p>}
      {targets.length > 1 && <p className="text-sm font-medium">{[published ? `${published} published` : "", upcoming ? `${upcoming} upcoming` : "", failed ? `${failed} failed` : ""].filter(Boolean).join(" · ") || `${targets.length} destinations`}</p>}
      {targets.length === 0 && !hasError && <div><p className="text-sm font-medium">Not published</p><p className="mt-0.5 text-xs text-muted-foreground">{hasOutputs ? "No publishing destinations yet" : "No content has been published"}</p></div>}
      {targets.slice(0, 2).map(renderTarget)}
      {targets.length > 2 && <details className="text-xs"><summary className="cursor-pointer py-1 text-muted-foreground hover:text-foreground">{targets.length - 2} more destinations</summary><div className="mt-2 space-y-2">{targets.slice(2).map(renderTarget)}</div></details>}
      {targets.some(target => ["scheduled", "pending", "publishing", "failed", "error"].includes(target.status)) && <Link to="/publish-queue" className="inline-flex items-center gap-1 py-1 text-xs underline underline-offset-2">Open publish queue<ExternalLink className="h-3 w-3" /></Link>}
    </div>
  );
}
