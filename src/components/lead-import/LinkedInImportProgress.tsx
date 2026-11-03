import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  useLinkedInImportJob,
  useCancelLinkedInImport,
  getImportTypeName,
  getStatusVariant,
  type LinkedInImportJob,
} from '@/hooks/useLinkedInImport';
import { CheckCircle, XCircle, Loader2, Ban, Users, UserPlus, UserMinus } from 'lucide-react';

interface Props {
  jobId: string;
  onComplete?: (job: LinkedInImportJob) => void;
}

export function LinkedInImportProgress({ jobId, onComplete }: Props) {
  const { data: job, isLoading, error } = useLinkedInImportJob(jobId);
  const cancelMutation = useCancelLinkedInImport();

  // Call onComplete when job finishes
  useEffect(() => {
    if (job && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')) {
      onComplete?.(job);
    }
  }, [job, onComplete]);

  if (isLoading && !job) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          {error?.message || 'Failed to load import job'}
        </AlertDescription>
      </Alert>
    );
  }

  const isRunning = job.status === 'pending' || job.status === 'running';
  const isComplete = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isCancelled = job.status === 'cancelled';

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isRunning && <Loader2 className="h-6 w-6 animate-spin text-blue-600" />}
          {isComplete && <CheckCircle className="h-6 w-6 text-green-600" />}
          {isFailed && <XCircle className="h-6 w-6 text-destructive" />}
          {isCancelled && <Ban className="h-6 w-6 text-muted-foreground" />}
          <div>
            <h3 className="font-semibold">
              {isRunning && 'Importing Leads...'}
              {isComplete && 'Import Complete'}
              {isFailed && 'Import Failed'}
              {isCancelled && 'Import Cancelled'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {getImportTypeName(job.type)}
            </p>
          </div>
        </div>
        <Badge variant={getStatusVariant(job.status)}>
          {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
        </Badge>
      </div>

      {/* Progress Bar */}
      {isRunning && (
        <div className="space-y-2">
          <Progress value={job.progress} className="h-2" />
          <p className="text-sm text-muted-foreground text-center">
            {job.progress}% complete
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-muted/50 rounded-lg p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-2xl font-bold">{job.total_found}</span>
          </div>
          <p className="text-xs text-muted-foreground">Found</p>
        </div>
        <div className="bg-green-50 rounded-lg p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <UserPlus className="h-4 w-4 text-green-600" />
            <span className="text-2xl font-bold text-green-700">{job.total_imported}</span>
          </div>
          <p className="text-xs text-muted-foreground">Imported</p>
        </div>
        <div className="bg-[hsl(var(--status-warning))]/10 rounded-lg p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <UserMinus className="h-4 w-4 text-[hsl(var(--status-warning))]" />
            <span className="text-2xl font-bold text-[hsl(var(--status-warning))]">{job.total_skipped}</span>
          </div>
          <p className="text-xs text-muted-foreground">Skipped</p>
        </div>
      </div>

      {/* Error Message */}
      {job.error_message && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{job.error_message}</AlertDescription>
        </Alert>
      )}

      {/* Cancel Button */}
      {isRunning && (
        <Button
          variant="outline"
          onClick={() => cancelMutation.mutate(jobId)}
          disabled={cancelMutation.isPending}
          className="w-full"
        >
          {cancelMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Cancelling...
            </>
          ) : (
            <>
              <Ban className="mr-2 h-4 w-4" />
              Cancel Import
            </>
          )}
        </Button>
      )}

      {/* Success Message */}
      {isComplete && job.total_imported > 0 && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Success!</AlertTitle>
          <AlertDescription>
            Successfully imported {job.total_imported} new contacts to your lead list.
            {job.total_skipped > 0 && (
              <span className="text-muted-foreground">
                {' '}({job.total_skipped} duplicates skipped)
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
