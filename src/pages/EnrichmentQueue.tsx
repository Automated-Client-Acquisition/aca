import { useState } from "react";
import { Database, RotateCcw, XCircle, Trash2, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EnrichmentJobsTable } from "@/components/enrichment/EnrichmentJobsTable";
import { EnrichmentHistoryTable } from "@/components/enrichment/EnrichmentHistoryTable";
import { useEnrichmentJobStats } from "@/hooks/useEnrichmentSettings";
import {
  useEnrichmentJobsPaginated,
  useEnrichmentHistoryRecent,
  useRetryAllFailedJobs,
  useCancelAllPendingJobs,
  useClearCompletedJobs,
} from "@/hooks/useEnrichmentJobActions";

function StatsCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: "default" | "processing" | "success" | "error";
}) {
  const colors = {
    default: "bg-muted",
    processing: "bg-blue-100 dark:bg-blue-900/30",
    success: "bg-green-100 dark:bg-green-900/30",
    error: "bg-red-100 dark:bg-red-900/30",
  };

  return (
    <Card className={colors[variant || "default"]}>
      <CardContent className="pt-4 pb-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function EnrichmentQueue() {
  const [activeTab, setActiveTab] = useState("pending");
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const { data: stats, isLoading: statsLoading } = useEnrichmentJobStats();
  const { data: jobsData, isLoading: jobsLoading } = useEnrichmentJobsPaginated(
    activeTab === "history" ? "all" : (activeTab as "pending" | "processing" | "completed" | "failed")
  );
  const { data: historyData, isLoading: historyLoading } = useEnrichmentHistoryRecent(50);

  const retryAllFailed = useRetryAllFailedJobs();
  const cancelAllPending = useCancelAllPendingJobs();
  const clearCompleted = useClearCompletedJobs();

  const handleRetryAll = () => {
    retryAllFailed.mutate();
  };

  const handleCancelAll = () => {
    cancelAllPending.mutate();
    setShowCancelDialog(false);
  };

  const handleClearCompleted = () => {
    clearCompleted.mutate(7);
    setShowClearDialog(false);
  };

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-[1400px] mx-auto space-y-6">
          {/* Header */}
          <PageHeader
            icon={Database}
            title="Enrichment Queue"
            description="Monitor and manage contact enrichment jobs"
          />

          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-4">
            <StatsCard
              label="Pending"
              value={stats?.pending || 0}
              variant="default"
            />
            <StatsCard
              label="Processing"
              value={stats?.processing || 0}
              variant="processing"
            />
            <StatsCard
              label="Completed"
              value={stats?.completed || 0}
              variant="success"
            />
            <StatsCard
              label="Failed"
              value={stats?.failed || 0}
              variant="error"
            />
          </div>

          {/* Actions Bar */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetryAll}
              disabled={retryAllFailed.isPending || (stats?.failed || 0) === 0}
            >
              {retryAllFailed.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Retry All Failed
              {(stats?.failed || 0) > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {stats?.failed}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCancelDialog(true)}
              disabled={cancelAllPending.isPending || (stats?.pending || 0) === 0}
            >
              <XCircle className="h-4 w-4 mr-2" />
              Cancel All Pending
              {(stats?.pending || 0) > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {stats?.pending}
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClearDialog(true)}
              disabled={clearCompleted.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Old Completed
            </Button>
          </div>

          {/* Tabs */}
          <Card>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <CardHeader className="pb-0">
                <TabsList>
                  <TabsTrigger value="pending">
                    Pending
                    {(stats?.pending || 0) > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        {stats?.pending}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="processing">
                    Processing
                    {(stats?.processing || 0) > 0 && (
                      <Badge className="ml-2 bg-blue-600">
                        {stats?.processing}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="failed">
                    Failed
                    {(stats?.failed || 0) > 0 && (
                      <Badge variant="destructive" className="ml-2">
                        {stats?.failed}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="completed">Completed</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent className="pt-4">
                <TabsContent value="pending" className="mt-0">
                  <EnrichmentJobsTable
                    jobs={jobsData?.jobs || []}
                    isLoading={jobsLoading}
                    showActions={true}
                  />
                </TabsContent>
                <TabsContent value="processing" className="mt-0">
                  <EnrichmentJobsTable
                    jobs={jobsData?.jobs || []}
                    isLoading={jobsLoading}
                    showActions={false}
                  />
                </TabsContent>
                <TabsContent value="failed" className="mt-0">
                  <EnrichmentJobsTable
                    jobs={jobsData?.jobs || []}
                    isLoading={jobsLoading}
                    showActions={true}
                  />
                </TabsContent>
                <TabsContent value="completed" className="mt-0">
                  <EnrichmentJobsTable
                    jobs={jobsData?.jobs || []}
                    isLoading={jobsLoading}
                    showActions={false}
                  />
                </TabsContent>
                <TabsContent value="history" className="mt-0">
                  <EnrichmentHistoryTable
                    entries={historyData || []}
                    isLoading={historyLoading}
                  />
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </div>
      </div>

      {/* Cancel All Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel All Pending Jobs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel {stats?.pending || 0} pending enrichment jobs. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Jobs</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelAll}>Cancel All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear Completed Dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Old Completed Jobs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete completed and skipped jobs older than 7 days. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearCompleted}>Clear Jobs</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
