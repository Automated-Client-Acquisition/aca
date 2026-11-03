import { formatDistanceToNow } from "date-fns";
import {
  Loader2,
  User,
  AlertCircle,
  CheckCircle2,
  Clock,
  RotateCcw,
  XCircle,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCancelEnrichmentJob,
  useRetryEnrichmentJob,
  useUpdateJobPriority,
} from "@/hooks/useEnrichmentJobActions";

interface EnrichmentJob {
  id: string;
  enrichment_type: string;
  provider: string | null;
  priority: number;
  status: string;
  attempts: number;
  error_message: string | null;
  credits_used: number;
  source: string | null;
  created_at: string;
  processed_at: string | null;
  contact: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    primary_email: string | null;
    primary_phone: string | null;
    company: string | null;
  } | null;
}

interface EnrichmentJobsTableProps {
  jobs: EnrichmentJob[];
  isLoading?: boolean;
  showActions?: boolean;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" />
          Pending
        </Badge>
      );
    case "processing":
      return (
        <Badge className="gap-1 bg-blue-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          Processing
        </Badge>
      );
    case "completed":
      return (
        <Badge className="gap-1 bg-green-600">
          <CheckCircle2 className="h-3 w-3" />
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    case "skipped":
      return (
        <Badge variant="secondary" className="gap-1">
          <XCircle className="h-3 w-3" />
          Skipped
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function PriorityBadge({ priority }: { priority: number }) {
  if (priority <= 3) {
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200">
        High
      </Badge>
    );
  }
  if (priority <= 6) {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
        Normal
      </Badge>
    );
  }
  return (
    <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-200">
      Low
    </Badge>
  );
}

function EnrichmentTypeDisplay({ type }: { type: string }) {
  const types = type.split(",").map((t) => t.trim());
  return (
    <div className="flex flex-wrap gap-1">
      {types.map((t) => (
        <Badge key={t} variant="outline" className="text-xs">
          {t}
        </Badge>
      ))}
    </div>
  );
}

export function EnrichmentJobsTable({
  jobs,
  isLoading,
  showActions = true,
}: EnrichmentJobsTableProps) {
  const cancelJob = useCancelEnrichmentJob();
  const retryJob = useRetryEnrichmentJob();
  const updatePriority = useUpdateJobPriority();

  const handlePriorityChange = (jobId: string, currentPriority: number, direction: "up" | "down") => {
    const newPriority = direction === "up" ? Math.max(1, currentPriority - 1) : Math.min(10, currentPriority + 1);
    updatePriority.mutate({ jobId, priority: newPriority });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No enrichment jobs in queue</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Created</TableHead>
              {showActions && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage
                        src={job.contact?.avatar_url || undefined}
                        referrerPolicy="no-referrer"
                      />
                      <AvatarFallback>
                        <User className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {job.contact?.display_name || "Unknown Contact"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {job.contact?.company || job.contact?.primary_email || ""}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <EnrichmentTypeDisplay type={job.enrichment_type} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <PriorityBadge priority={job.priority} />
                    {showActions && job.status === "pending" && (
                      <div className="flex flex-col">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 p-0"
                          onClick={() => handlePriorityChange(job.id, job.priority, "up")}
                          disabled={job.priority <= 1}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 p-0"
                          onClick={() => handlePriorityChange(job.id, job.priority, "down")}
                          disabled={job.priority >= 10}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <StatusBadge status={job.status} />
                    {job.error_message && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-xs text-red-600 truncate max-w-[150px] cursor-help">
                            {job.error_message}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">{job.error_message}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground">{job.attempts}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                  </span>
                </TableCell>
                {showActions && (
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {job.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => cancelJob.mutate(job.id)}
                          disabled={cancelJob.isPending}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                      {job.status === "failed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => retryJob.mutate(job.id)}
                          disabled={retryJob.isPending}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
