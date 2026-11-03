import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Telescope,
  Flame,
  Zap,
  FileText,
  Radar,
  Download,
  Plus,
  Users,
  Search as SearchIcon,
  ArrowRight,
  Lightbulb,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingContent } from "@/components/ideas/TrendingContent";
import { SignalsBoard } from "@/components/ideas/SignalsBoard";
import { ScrapedContentTable } from "@/components/ScrapedContentTable";
import { CreatorsTable } from "@/components/CreatorsTable";
import { SearchTermsTable } from "@/components/SearchTermsTable";
import { AddCreatorDialog } from "@/components/AddCreatorDialog";
import { AddSearchTermDialog } from "@/components/AddSearchTermDialog";
import { ImportPostDialog } from "@/components/ideas/ImportPostDialog";
import { ScrapingActivityCard } from "@/components/ScrapingActivityCard";
import { ActiveScrapesDrawer } from "@/components/ActiveScrapesDrawer";
import { ScrapeNotifications } from "@/components/ScrapeNotifications";
import { useCreators } from "@/hooks/useCreators";
import { useSearchTerms } from "@/hooks/useSearchTerms";

type ResearchTab = "trending" | "signals" | "posts" | "sources";
type SourceView = "creators" | "searches";

const TABS: Array<{
  id: ResearchTab;
  label: string;
  icon: React.ElementType;
  hint: string;
}> = [
  {
    id: "trending",
    label: "Trending",
    icon: Flame,
    hint: "Discover standout content",
  },
  {
    id: "signals",
    label: "Signals",
    icon: Zap,
    hint: "Catch emerging stories",
  },
  {
    id: "posts",
    label: "All posts",
    icon: FileText,
    hint: "Browse your collected posts",
  },
  {
    id: "sources",
    label: "Sources",
    icon: Radar,
    hint: "Manage what you follow",
  },
];

const isTab = (v: string | null): v is ResearchTab =>
  TABS.some((t) => t.id === v);

/**
 * Where ideas come from: what's working in the niche (Trending), what's
 * breaking (Signals), everything collected (All posts) and what we collect
 * from (Sources). Everything here has one main action: save it as an idea.
 */
const Research = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: ResearchTab = isTab(tabParam) ? tabParam : "trending";
  const sourceView: SourceView =
    searchParams.get("source") === "searches" ? "searches" : "creators";
  const creatorFilter = searchParams.get("creator");
  const searchTermFilter = searchParams.get("search_term");

  const [addCreatorOpen, setAddCreatorOpen] = useState(false);
  const [addSearchOpen, setAddSearchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { creators, isLoading: creatorsLoading } = useCreators();
  const { searchTerms, isLoading: searchesLoading } = useSearchTerms();

  const setTab = (next: string) =>
    setSearchParams(next === "trending" ? {} : { tab: next });
  const setSourceView = (next: SourceView) =>
    setSearchParams({
      tab: "sources",
      ...(next === "searches" ? { source: next } : {}),
    });
  const clearPostFilter = (key: "creator" | "search_term") => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    setSearchParams(next);
  };

  const noSources =
    !creatorsLoading &&
    !searchesLoading &&
    (creators?.length ?? 0) + (searchTerms?.length ?? 0) === 0;

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <ScrapeNotifications />
      <div className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <Telescope className="h-5 w-5" />
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">
                Research
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/ideas">
                  <Lightbulb className="mr-2 h-4 w-4" />
                  Saved ideas
                </Link>
              </Button>
              {tab === "sources" ? (
                <Button
                  variant="cta"
                  size="sm"
                  onClick={() =>
                    sourceView === "searches"
                      ? setAddSearchOpen(true)
                      : setAddCreatorOpen(true)
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {sourceView === "searches"
                    ? "Add a search"
                    : "Follow a creator"}
                </Button>
              ) : (
                <Button
                  variant="cta"
                  size="sm"
                  onClick={() => setImportOpen(true)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Import a post
                </Button>
              )}
            </div>
          </div>

          {noSources && tab !== "sources" && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4">
              <div>
                <div className="text-sm font-semibold">
                  Nothing to research yet
                </div>
                <p className="text-sm text-muted-foreground">
                  Follow a few creators in your niche or add a search, and their
                  posts show up here.
                </p>
              </div>
              <Button variant="cta" onClick={() => setTab("sources")}>
                Add sources <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList
              aria-label="Research views"
              className="mb-5 flex h-11 w-full justify-start gap-4 rounded-none border-b bg-transparent p-0 sm:gap-6"
            >
              {TABS.map((view) => (
                <TabsTrigger
                  key={view.id}
                  value={view.id}
                  title={view.hint}
                  className="h-11 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-1 text-sm data-[state=active]:border-amber-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  <view.icon className="hidden h-4 w-4 sm:block" />
                  {view.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="trending" className="mt-0">
              <TrendingContent />
            </TabsContent>
            <TabsContent value="signals" className="mt-0">
              <SignalsBoard />
            </TabsContent>
            <TabsContent value="posts" className="mt-0">
              <ScrapedContentTable
                initialCreatorFilter={creatorFilter}
                onClearCreatorFilter={() => clearPostFilter("creator")}
                initialSearchTermFilter={searchTermFilter}
                onClearSearchTermFilter={() => clearPostFilter("search_term")}
              />
            </TabsContent>
            <TabsContent value="sources" className="mt-0 space-y-4">
              <h2 className="sr-only">Research sources</h2>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Tabs
                  value={sourceView}
                  onValueChange={(value) => setSourceView(value as SourceView)}
                >
                  <TabsList
                    aria-label="Source type"
                    className="h-10 bg-muted/50 p-1"
                  >
                    <TabsTrigger
                      value="creators"
                      className="gap-1.5 px-2 sm:gap-2 sm:px-3"
                    >
                      <Users className="hidden h-4 w-4 sm:block" />
                      Creators
                      <span className="text-xs text-muted-foreground">
                        {creators?.length ?? 0}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="searches"
                      className="gap-1.5 px-2 sm:gap-2 sm:px-3"
                    >
                      <SearchIcon className="hidden h-4 w-4 sm:block" />
                      Searches
                      <span className="text-xs text-muted-foreground">
                        {searchTerms?.length ?? 0}
                      </span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <ScrapingActivityCard
                  compact
                  onClick={() => setDrawerOpen(true)}
                />
              </div>
              {sourceView === "creators" ? (
                <CreatorsTable embedded onAdd={() => setAddCreatorOpen(true)} />
              ) : (
                <SearchTermsTable
                  embedded
                  onAdd={() => setAddSearchOpen(true)}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <AddCreatorDialog
        open={addCreatorOpen}
        onOpenChange={setAddCreatorOpen}
      />
      <AddSearchTermDialog
        open={addSearchOpen}
        onOpenChange={setAddSearchOpen}
      />
      <ImportPostDialog open={importOpen} onOpenChange={setImportOpen} />
      <ActiveScrapesDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </AppLayout>
  );
};

export default Research;
