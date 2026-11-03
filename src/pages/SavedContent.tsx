import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { ContentTabs } from "@/components/ContentTabs";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { SavedContentTable } from "@/components/saved-content/SavedContentTable";
import { UploadSavedContentDialog } from "@/components/saved-content/UploadSavedContentDialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FileText, Image, Video, Music, Bookmark, Upload } from "lucide-react";
import type { SavedContentType } from "@/types/savedContent";

type TabValue = "all" | SavedContentType;

export default function SavedContent() {
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  const contentTypeFilter = activeTab === "all" ? undefined : activeTab;

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
          <ContentTabs />
          <PageHeader
            className="mb-8"
            icon={Bookmark}
            title="Saved Content"
            description="Your library of saved content for reuse"
            actions={
              <Button variant="cta" onClick={() => setUploadDialogOpen(true)} className="shadow-lg gap-2">
                <Upload className="h-4 w-4" />
                Upload Content
              </Button>
            }
          />

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="mb-6">
            <TabsList>
              <TabsTrigger value="all" className="gap-2">
                <Bookmark className="h-4 w-4" />
                All
              </TabsTrigger>
              <TabsTrigger value="text" className="gap-2">
                <FileText className="h-4 w-4" />
                Text
              </TabsTrigger>
              <TabsTrigger value="image" className="gap-2">
                <Image className="h-4 w-4" />
                Images
              </TabsTrigger>
              <TabsTrigger value="video" className="gap-2">
                <Video className="h-4 w-4" />
                Videos
              </TabsTrigger>
              <TabsTrigger value="audio" className="gap-2">
                <Music className="h-4 w-4" />
                Audio
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Table */}
          <SavedContentTable contentType={contentTypeFilter} />
        </div>
      </div>

      <UploadSavedContentDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
      />
    </AppLayout>
  );
}
