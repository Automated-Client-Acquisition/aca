import { useState } from "react";
import { Link2, Settings } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExtractFromURLTab } from "./ExtractFromURLTab";
import { SearchByKeywordTab } from "./SearchByKeywordTab";
import type { LinkedInImportType, SearchMode, ApiType, SearchParams } from "@/hooks/useLinkedInImport";

interface LinkedInSearchDetailProps {
  onStartImport: (config: {
    type: LinkedInImportType;
    sourceUrl: string;
    accountId: string;
    maxLeads?: number;
    searchMode?: SearchMode;
    apiType?: ApiType;
    searchParams?: SearchParams;
    listName?: string;
  }) => void;
  isStarting: boolean;
  sourceType?: "linkedin_search" | "sales_nav_leads" | "linkedin_recruiter";
  preSelectedListId?: string | null;
  preSelectedListName?: string;
}

export function LinkedInSearchDetail({
  onStartImport,
  isStarting,
  sourceType = "linkedin_search",
  preSelectedListId,
  preSelectedListName,
}: LinkedInSearchDetailProps) {
  const [activeTab, setActiveTab] = useState<"url" | "keyword">("url");

  // Recruiter still only supports URL extraction in this UI; Sales Navigator supports
  // both URL and parameter searches through the same Unipile endpoint.
  const showKeywordTab = sourceType === "linkedin_search" || sourceType === "sales_nav_leads";
  const forcedKeywordApiType: ApiType | undefined = sourceType === "sales_nav_leads" ? "sales_navigator" : undefined;

  // If only URL tab, render without tabs wrapper
  if (!showKeywordTab) {
    return (
      <div className="space-y-6">
        <ExtractFromURLTab
          onStartImport={onStartImport}
          isStarting={isStarting}
          preSelectedListId={preSelectedListId}
          preSelectedListName={preSelectedListName}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "url" | "keyword")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="url" className="gap-2">
            <Link2 className="h-4 w-4" />
            Extract from URL
          </TabsTrigger>
          <TabsTrigger value="keyword" className="gap-2">
            <Settings className="h-4 w-4" />
            Search by keyword
          </TabsTrigger>
        </TabsList>

        <TabsContent value="url" className="mt-6">
          <ExtractFromURLTab
            onStartImport={onStartImport}
            isStarting={isStarting}
            preSelectedListId={preSelectedListId}
            preSelectedListName={preSelectedListName}
          />
        </TabsContent>

        <TabsContent value="keyword" className="mt-6">
          <SearchByKeywordTab
            onStartImport={onStartImport}
            isStarting={isStarting}
            preSelectedListId={preSelectedListId}
            preSelectedListName={preSelectedListName}
            forcedApiType={forcedKeywordApiType}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
