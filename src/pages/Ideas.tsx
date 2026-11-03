import { useState, useMemo } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Folder, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { IdeasHeader } from "@/components/IdeasHeader";
import { IdeasTable } from "@/components/IdeasTable";
import { AddIdeaDialog } from "@/components/AddIdeaDialog";
import { AddIdeasManuallyDialog } from "@/components/AddIdeasManuallyDialog";
import { ImportIdeasCSVDialog } from "@/components/ImportIdeasCSVDialog";
import { IdeasStarterPackDialog } from "@/components/IdeasStarterPackDialog";
import { FoldersSidebar } from "@/components/ideas/FoldersSidebar";
import { AutopilotFuelStrip } from "@/components/ideas/AutopilotFuelStrip";
import { useIdeaFolders } from "@/hooks/useIdeaFolders";
import {
  useFeedOptions,
  useIdeaExclusions,
  useIdeaUsage,
} from "@/hooks/useIdeaFeeds";
import { useIdeas } from "@/hooks/useIdeas";
import { autopilotsFedBy } from "@/lib/idea-feeds";

/**
 * Old /ideas?tab=… links (emails, bookmarks, other pages) for the tabs that
 * moved: research to /research, saved images to the Brand Kit.
 */
function legacyTabRedirect(params: URLSearchParams): string | null {
  const tab = params.get("tab");
  if (!tab || tab === "ideas") return null;
  if (tab === "images") return "/assets?tab=images";
  const research = new URLSearchParams();
  if (tab === "signals" || tab === "trending") research.set("tab", tab);
  else if (tab === "scraped") {
    research.set("tab", "posts");
    for (const key of ["creator", "search_term"]) {
      const v = params.get(key);
      if (v) research.set(key, v);
    }
  } else if (tab === "creators") research.set("tab", "sources");
  else if (tab === "search") {
    research.set("tab", "sources");
    research.set("source", "searches");
  } else return null;
  return `/research?${research.toString()}`;
}

/** What to post about next: the list blueprints and autopilots write from. */
const Ideas = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  // ?feed= / ?pick= / ?add= come from a blueprint's Automate screen ("See its ideas", "Give it ideas").
  const [feedAutopilotId, setFeedAutopilotId] = useState<string | null>(() =>
    searchParams.get("feed"),
  );
  const [pickForAutopilotId, setPickForAutopilotId] = useState<string | null>(
    () => searchParams.get("pick"),
  );
  const [addForAutopilotId, setAddForAutopilotId] = useState<string | null>(
    () => searchParams.get("add"),
  );
  const [addIdeaOpen, setAddIdeaOpen] = useState(
    () => !!searchParams.get("add"),
  );
  const [addManualOpen, setAddManualOpen] = useState(false);
  const [importCSVOpen, setImportCSVOpen] = useState(false);
  const [starterPackOpen, setStarterPackOpen] = useState(false);
  const { data: folders = [] } = useIdeaFolders();
  const { ideas } = useIdeas();
  const { data: usage } = useIdeaUsage();
  const { data: exclusions } = useIdeaExclusions();
  const { fuel, tagNames } = useFeedOptions();

  const dropParam = (key: string) =>
    setSearchParams(
      (prev) => {
        if (!prev.has(key)) return prev;
        const next = new URLSearchParams(prev);
        next.delete(key);
        return next;
      },
      { replace: true },
    );

  // Unused ideas no autopilot takes by tag: what a starving autopilot can be handed.
  const unassignedCount = useMemo(
    () =>
      (usage && exclusions ? ideas : []).filter(
        (i) =>
          !usage?.get(i.id) &&
          !autopilotsFedBy(
            (i.tags ?? []).map((t) => t.name),
            fuel,
            exclusions?.get(i.id),
          ).some((f) => f.viaTag),
      ).length,
    [ideas, usage, fuel, exclusions],
  );

  const redirect = legacyTabRedirect(searchParams);
  if (redirect) return <Navigate to={redirect} replace />;

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-4 sm:p-8">
        <div className="max-w-[1600px] mx-auto">
          <IdeasHeader
            onAddClick={() => setAddIdeaOpen(true)}
            onAddManualClick={() => setAddManualOpen(true)}
            onImportCSVClick={() => setImportCSVOpen(true)}
            onStarterPackClick={() => setStarterPackOpen(true)}
          />
          <AutopilotFuelStrip
            fuel={fuel}
            existingTagNames={tagNames}
            unassignedCount={unassignedCount}
            selectedAutopilotId={pickForAutopilotId ? null : feedAutopilotId}
            onSelect={(id) => {
              setPickForAutopilotId(null);
              dropParam("pick");
              setFeedAutopilotId(id);
              if (!id) dropParam("feed");
            }}
            onPickIdeas={(id) => {
              setFeedAutopilotId(null);
              dropParam("feed");
              setPickForAutopilotId(id);
            }}
            onAddIdeas={(id) => {
              setAddForAutopilotId(id);
              setAddIdeaOpen(true);
            }}
          />
          <IdeasTable
            onAdd={() => setAddIdeaOpen(true)}
            folderFilter={selectedFolder}
            onClearFolder={() => setSelectedFolder(null)}
            folderControls={
              <Popover
                open={foldersOpen}
                onOpenChange={(open) => {
                  if (open || !folderDialogOpen) setFoldersOpen(open);
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 max-w-full"
                    aria-label="Choose or manage idea folders"
                  >
                    <Folder className="mr-2 h-4 w-4 shrink-0" />
                    <span className="max-w-40 truncate">
                      {selectedFolder === "uncategorized"
                        ? "Uncategorized"
                        : selectedFolder
                          ? (folders.find(
                              (folder) => folder.id === selectedFolder,
                            )?.name ?? "Selected folder")
                          : "All folders"}
                    </span>
                    <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-80 max-w-[calc(100vw-2rem)] p-0"
                  onInteractOutside={(event) => {
                    const target = event.target;
                    if (
                      folderDialogOpen ||
                      (target instanceof Element &&
                        target.closest(
                          '[role="dialog"], [role="alertdialog"], [role="menu"]',
                        ))
                    )
                      event.preventDefault();
                  }}
                  onFocusOutside={(event) => {
                    if (folderDialogOpen) event.preventDefault();
                  }}
                >
                  <FoldersSidebar
                    selectedFolder={selectedFolder}
                    onSelectFolder={(folderId) => {
                      setSelectedFolder(folderId);
                      setFoldersOpen(false);
                    }}
                    onDialogOpenChange={setFolderDialogOpen}
                    className="max-h-[min(28rem,60vh)] border-0 shadow-none"
                  />
                </PopoverContent>
              </Popover>
            }
            feedAutopilotId={feedAutopilotId}
            onClearFeed={() => {
              setFeedAutopilotId(null);
              dropParam("feed");
            }}
            pickForAutopilotId={pickForAutopilotId}
            onExitPick={() => {
              setPickForAutopilotId(null);
              dropParam("pick");
            }}
          />
        </div>
      </div>

      <AddIdeaDialog
        open={addIdeaOpen}
        onOpenChange={(open) => {
          setAddIdeaOpen(open);
          if (!open) {
            setAddForAutopilotId(null);
            dropParam("add");
          }
        }}
        autopilotId={addForAutopilotId}
      />
      <AddIdeasManuallyDialog
        open={addManualOpen}
        onOpenChange={setAddManualOpen}
      />
      <ImportIdeasCSVDialog
        open={importCSVOpen}
        onOpenChange={setImportCSVOpen}
      />
      <IdeasStarterPackDialog
        open={starterPackOpen}
        onOpenChange={setStarterPackOpen}
      />
    </AppLayout>
  );
};

export default Ideas;
