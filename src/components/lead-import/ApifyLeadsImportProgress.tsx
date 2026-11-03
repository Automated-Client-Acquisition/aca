import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  useApifyLeadsImportJob,
  useCancelApifyLeadsImport,
  type ApifyLeadsImportJob,
  type BatchInfo,
} from '@/hooks/useApifyLeadsImport';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Ban,
  Users,
  UserPlus,
  UserMinus,
  DollarSign,
} from 'lucide-react';

interface Props {
  jobId: string;
  onComplete?: (job: ApifyLeadsImportJob) => void;
}

function BatchStatusDot({ batch }: { batch: BatchInfo }) {
  if (batch.status === 'completed' || batch.status === 'succeeded') {
    return <CheckCircle className="h-4 w-4 text-green-600" />;
  }
  if (batch.status === 'failed') {
    return <XCircle className="h-4 w-4 text-destructive" />;
  }
  if (batch.status === 'running') {
    return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
  }
  return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
}

export function ApifyLeadsImportProgress({ jobId, onComplete }: Props) {
  const { data: job, isLoading, error } = useApifyLeadsImportJob(jobId);
  const cancelMutation = useCancelApifyLeadsImport();

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

  const statusVariant = isComplete
    ? 'default'
    : isFailed
      ? 'destructive'
      : isCancelled
        ? 'outline'
        : 'secondary';

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
              B2B Lead Finder (Apify)
            </p>
          </div>
        </div>
        <Badge variant={statusVariant}>
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
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-muted/50 rounded-lg p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-2xl font-bold">{job.total_found}</span>
          </div>
          <p className="text-xs text-muted-foreground">Found</p>
        </div>
        <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <UserPlus className="h-4 w-4 text-green-600" />
            <span className="text-2xl font-bold text-green-700 dark:text-green-400">{job.total_imported}</span>
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
        <div className="bg-muted/50 rounded-lg p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="text-2xl font-bold">${job.estimated_cost_usd?.toFixed(2) || '0.00'}</span>
          </div>
          <p className="text-xs text-muted-foreground">Estimated Cost</p>
        </div>
      </div>

      {/* Batch Progress */}
      {job.total_batches > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Batch Progress</p>
            <p className="text-sm text-muted-foreground">
              Batch {Math.min((job.current_batch || 0) + 1, job.total_batches)} of {job.total_batches}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {job.batches && job.batches.length > 0 ? (
              job.batches.map((batch: BatchInfo, index: number) => (
                <div
                  key={index}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-xs"
                  title={`Batch ${batch.batch_index + 1}: ${batch.status} - ${batch.leads_imported} imported`}
                >
                  <BatchStatusDot batch={batch} />
                  <span className="text-muted-foreground">#{batch.batch_index + 1}</span>
                </div>
              ))
            ) : (
              // Render placeholder dots based on total_batches
              Array.from({ length: job.total_batches }).map((_, index) => {
                const isPast = index < (job.current_batch || 0);
                const isCurrent = index === (job.current_batch || 0) && isRunning;
                return (
                  <div
                    key={index}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-xs"
                  >
                    {isPast && <CheckCircle className="h-4 w-4 text-green-600" />}
                    {isCurrent && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
                    {!isPast && !isCurrent && (
                      <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                    )}
                    <span className="text-muted-foreground">#{index + 1}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

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
