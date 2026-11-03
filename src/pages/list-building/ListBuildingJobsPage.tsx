import { useState } from "react";
import { Plus, Radar } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { JobList } from "@/components/list-building/JobList";
import { JobWizard } from "@/components/list-building/JobWizard";

export default function ListBuildingJobsPage() {
  const [wizardOpen, setWizardOpen] = useState(false);

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
          <PageHeader
            icon={Radar}
            title="List Building"
            description="Native prospecting: discovery, DM ID, SMTP verification, ICP scoring"
            actions={
              <Button variant="cta" onClick={() => setWizardOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Job
              </Button>
            }
          />

          <JobList />
        </div>
      </div>

      <JobWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </AppLayout>
  );
}
