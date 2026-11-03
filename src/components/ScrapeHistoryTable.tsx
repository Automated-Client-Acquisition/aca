import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2 } from "lucide-react";
import { useScrapeHistory } from "@/hooks/useScrapeHistory";
import { Skeleton } from "@/components/ui/skeleton";

interface ScrapeHistoryTableProps {
  type: 'creator' | 'search_term';
  targetId: string;
}

export function ScrapeHistoryTable({ type, targetId }: ScrapeHistoryTableProps) {
  const { history, isLoading } = useScrapeHistory(type, targetId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No scraping history yet. Click "Scrape Now" to start.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="w-[100px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((run) => {
            const duration = run.completed_at && run.triggered_at
              ? Math.round((new Date(run.completed_at).getTime() - new Date(run.triggered_at).getTime()) / 1000)
              : null;

            return (
              <TableRow key={run.run_id}>
                <TableCell>
                  <Badge
                    variant={
                      run.status === 'SUCCEEDED'
                        ? 'outline'
                        : run.status === 'FAILED'
                        ? 'destructive'
                        : run.status === 'RUNNING' || run.status === 'PROCESSING'
                        ? 'secondary'
                        : 'outline'
                    }
                    className={run.status === 'SUCCEEDED' ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20' : ''}
                  >
                    {run.status === 'RUNNING' && (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    )}
                    {run.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {format(new Date(run.triggered_at), 'MMM d, HH:mm')}
                </TableCell>
                <TableCell className="text-sm">
                  {run.completed_at ? format(new Date(run.completed_at), 'MMM d, HH:mm') : '-'}
                </TableCell>
                <TableCell>
                  {run.items_scraped !== null ? (
                    <span className="font-medium">{run.items_scraped}</span>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {duration ? `${duration}s` : '-'}
                </TableCell>
                <TableCell>
                  {run.apify_run_url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(run.apify_run_url!, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
