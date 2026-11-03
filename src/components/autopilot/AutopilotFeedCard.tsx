import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, LayoutGrid } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FEED_SIZE, useAutopilotFeed, type AutopilotPiece } from "@/hooks/useRecentPieces";

function pieceImage(p: AutopilotPiece): string | null {
  return p.image_url || p.slide_image || null;
}

function pieceText(p: AutopilotPiece): string {
  return (p.caption || p.text || p.title || "").replace(/\*\*/g, "").trim();
}

function PieceTile({ piece }: { piece: AutopilotPiece }) {
  const [broken, setBroken] = useState(false);
  const img = broken ? null : pieceImage(piece);
  const body = (
    <>
      {img ? (
        <img src={img} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <span className="line-clamp-6 p-2 text-[10px] leading-snug text-muted-foreground">{pieceText(piece) || "No text yet"}</span>
      )}
      {piece.look_label && (
        <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium">
          {piece.look_label}
        </span>
      )}
    </>
  );
  const title = `${formatDistanceToNow(new Date(piece.created_at), { addSuffix: true })}${piece.look_label ? ` · ${piece.look_label}` : ""}`;
  const cls = "relative block aspect-square overflow-hidden rounded-md border bg-muted/40 transition-opacity hover:opacity-90";
  return piece.job_id ? (
    <Link to={`/jobs/${piece.job_id}`} className={cls} title={title}>
      {body}
    </Link>
  ) : (
    <div className={cls} title={title}>
      {body}
    </div>
  );
}

/**
 * The autopilot's last posts as a grid: repetition (same look, same kind of
 * picture, same opening) is easy to spot here and invisible in a list.
 */
export function AutopilotFeedCard({ autopilotId }: { autopilotId: string }) {
  const { data, isLoading } = useAutopilotFeed(autopilotId);
  const pieces = data?.pieces ?? [];
  const posts = data?.postsLast30Days ?? 0;
  const ideas = data?.ideasInPool ?? 0;
  // Each idea comes back more than twice a month: the feed will feel repetitive.
  const thinPool = ideas > 0 && posts >= ideas * 2;
  const daysPerCycle = posts > 0 ? Math.max(1, Math.round((30 * ideas) / posts)) : 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-primary" />
          Last {FEED_SIZE} posts
        </CardTitle>
        <CardDescription>How the feed looks right now. Open a post to see its idea, look and prompts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="grid max-w-md grid-cols-3 gap-1.5">
            {Array.from({ length: FEED_SIZE }, (_, i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))}
          </div>
        ) : pieces.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing made yet. Posts show up here after the first run.</p>
        ) : (
          <div className="grid max-w-md grid-cols-3 gap-1.5">
            {pieces.map((p) => (
              <PieceTile key={p.id} piece={p} />
            ))}
          </div>
        )}
        {thinPool && (
          <div className="flex max-w-md items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {ideas} idea{ideas === 1 ? "" : "s"} in the pool and {posts} posts in 30 days, so each idea comes back about every {daysPerCycle} day
              {daysPerCycle === 1 ? "" : "s"}. Add ideas on the Ideas page, or give the blueprint a few looks so repeats at least look different.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
