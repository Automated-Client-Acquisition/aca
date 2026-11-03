import { useParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { JobDetail } from "@/components/list-building/JobDetail";

export default function ListBuildingJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-[1400px] mx-auto">
          {jobId ? (
            <JobDetail jobId={jobId} />
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              Missing job id
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
