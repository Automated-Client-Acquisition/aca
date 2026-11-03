import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { PromptsHeader, PromptsTable, AddPromptDialog } from "@/components/prompts";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { BookOpen } from "lucide-react";

const PromptLibrary = () => {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUsePromptLibrary = hasFeature("prompt_library");

  // If user doesn't have access and isn't a client, show upgrade screen
  if (!canUsePromptLibrary && showUpgradePrompts) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-8">
          <div className="max-w-[1600px] mx-auto">
            <PageHeader
              className="mb-8"
              icon={BookOpen}
              title="Prompt Library"
              description="Save and reuse your best-performing prompts"
            />

            {/* Upgrade prompt */}
            <div className="max-w-md mx-auto mt-12">
              <UpgradePrompt feature="prompt_library" variant="card" />
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  // If client without access, show nothing (they shouldn't see this page at all)
  if (!canUsePromptLibrary) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-8">
          <div className="max-w-[1600px] mx-auto text-center py-12">
            <p className="text-muted-foreground">This feature is not available for your organization.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-[1600px] mx-auto">
          <PromptsHeader onAddClick={() => setAddDialogOpen(true)} />
          <PromptsTable />
        </div>
      </div>

      <AddPromptDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </AppLayout>
  );
};

export default PromptLibrary;
