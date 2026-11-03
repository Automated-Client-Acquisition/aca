import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Eye, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useListBuildingJobs,
  useStopListBuildingJob,
  type ListBuildingJob,
  type ListBuildingJobStatus,
} from "@/hooks/useListBuilding";

const STATUS_COLORS: Record<ListBuildingJobStatus, string> = {
  pending: "bg-gray-500/15 text-gray-600 border-gray-500/30",
  running: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  completed: "bg-green-500/15 text-green-600 border-green-500/30",
  failed: "bg-red-500/15 text-red-600 border-red-500/30",
  cancelled: "bg-gray-500/15 text-gray-600 border-gray-500/30",
  paused: "bg-amber-500/15 text-amber-600 border-amber-500/30",
};

export function JobList() {
  const navigate = useNavigate();
  const { data: jobs = [], isLoading } = useListBuildingJobs();
  const stopJob = useStopListBuildingJob();

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Loading jobs...
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
        No list building jobs yet. Create one to get started.
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Companies</TableHead>
            <TableHead className="text-right">DMs</TableHead>
            <TableHead className="text-right">Verified</TableHead>
            <TableHead className="text-right">Strong</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job: ListBuildingJob) => (
            <TableRow
              key={job.id}
              className="cursor-pointer"
              onClick={() => navigate(`/list-building/${job.id}`)}
            >
              <TableCell className="font-medium">{job.name}</TableCell>
              <TableCell>
                <Badge variant="outline" className={STATUS_COLORS[job.status]}>
                  {job.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {job.total_companies.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {job.found_dms.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {job.verified_emails.toLocaleString()}
              </TableCell>
              <TableCell className="text-right">
                {job.strong_leads.toLocaleString()}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {formatDistanceToNow(new Date(job.created_at), {
                  addSuffix: true,
                })}
              </TableCell>
              <TableCell className="text-right">
                <div
                  className="flex items-center justify-end gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate(`/list-building/${job.id}`)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  {(job.status === "running" || job.status === "pending") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => stopJob.mutate(job.id)}
                      disabled={stopJob.isPending}
                    >
                      <StopCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
