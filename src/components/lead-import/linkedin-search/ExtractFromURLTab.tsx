import { useState, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useUnipileAccounts, hasSalesNavigator, useCheckUnipileStatus } from "@/hooks/useUnipileAccounts";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  Loader2,
  Link2,
  Search,
  Users,
  List,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import type { LinkedInImportType, SearchMode, ApiType } from "@/hooks/useLinkedInImport";

interface ExtractFromURLTabProps {
  onStartImport: (config: {
    type: LinkedInImportType;
    sourceUrl: string;
    accountId: string;
    maxLeads?: number;
    searchMode?: SearchMode;
    apiType?: ApiType;
    listName?: string;
  }) => void;
  isStarting: boolean;
  preSelectedListId?: string | null;
  preSelectedListName?: string;
}

export function ExtractFromURLTab({
  onStartImport,
  isStarting,
  preSelectedListId,
  preSelectedListName,
}: ExtractFromURLTabProps) {
  const [listName, setListName] = useState(preSelectedListName || "");
  const [url, setUrl] = useState("");
  const [accountId, setAccountId] = useState("");
  const [maxLeads, setMaxLeads] = useState(100);

  const { data: accountsData } = useUnipileAccounts();
  const linkedinAccounts = accountsData?.linkedinAccounts || [];
  const checkUnipileStatus = useCheckUnipileStatus();

  // Determine import type and API type from URL
  const { importType, apiType } = useMemo((): { importType: LinkedInImportType | null; apiType: ApiType | null } => {
    if (url.includes("/talent/search/")) {
      return { importType: "recruiter", apiType: "recruiter" };
    }
    if (url.includes("/sales/search/") || url.includes("/sales/lists/")) {
      return { importType: "sales_nav", apiType: "sales_navigator" };
    }
    if (url.includes("linkedin.com/search/results/people")) {
      return { importType: "search", apiType: "classic" };
    }
    return { importType: null, apiType: null };
  }, [url]);

  // Validate URL
  const urlValidation = useMemo(() => {
    if (!url) return { valid: false, message: "" };

    if (url.includes("/talent/search/")) {
      return {
        valid: true,
        message: "LinkedIn Recruiter search detected",
        type: "recruiter" as const,
      };
    }

    if (url.includes("/sales/search/") || url.includes("/sales/lists/")) {
      return {
        valid: true,
        message: "Sales Navigator search detected",
        type: "sales_nav" as const,
      };
    }

    if (url.includes("linkedin.com/search/results/people")) {
      return {
        valid: true,
        message: "LinkedIn people search detected",
        type: "search" as const,
      };
    }

    if (url.includes("linkedin.com")) {
      return { valid: false, message: "Please paste a LinkedIn People Search, Sales Navigator, or Recruiter URL" };
    }

    return { valid: false, message: "Please enter a valid LinkedIn URL" };
  }, [url]);

  // Parse search parameters from URL for preview
  const searchParams = useMemo(() => {
    if (!urlValidation.valid) return null;

    try {
      const urlObj = new URL(url);
      const params: Record<string, string> = {};

      const keywords = urlObj.searchParams.get("keywords");
      if (keywords) params.keywords = decodeURIComponent(keywords);

      const geoUrn = urlObj.searchParams.get("geoUrn");
      if (geoUrn) params.location = "Location filter applied";

      const network = urlObj.searchParams.get("network");
      if (network)
        params.network =
          network === '["F"]'
            ? "1st connections"
            : network === '["S"]'
            ? "2nd connections"
            : network === '["O"]'
            ? "3rd+ connections"
            : network;

      return params;
    } catch {
      return null;
    }
  }, [url, urlValidation.valid]);

  const handleSubmit = () => {
    if (!urlValidation.valid || !accountId || !importType || !apiType) return;
    if (!preSelectedListId && !listName.trim()) {
      return; // List name is required
    }

    onStartImport({
      type: importType,
      sourceUrl: url,
      accountId,
      maxLeads,
      searchMode: 'url', // URL-based search mode
      apiType,
      listName: listName.trim() || undefined,
    });
  };

  // Check if selected account has Sales Nav when a Sales Nav URL is pasted
  const selectedAccount = linkedinAccounts.find(a => a.id === accountId);
  const isSalesNavUrl = apiType === 'sales_navigator';
  const accountMissingSalesNav = isSalesNavUrl && selectedAccount && !hasSalesNavigator(selectedAccount);

  // List name is valid if we have a pre-selected list OR user entered a name
  const hasValidList = preSelectedListId || listName.trim();
  const canSubmit = urlValidation.valid && accountId && hasValidList && !isStarting;

  return (
    <div className="space-y-6">
      {/* Account Selection - First */}
      <div className="space-y-2">
        <Label htmlFor="account">Select account</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger id="account">
            <SelectValue placeholder="Select account to use for search" />
          </SelectTrigger>
          <SelectContent>
            {linkedinAccounts.length === 0 ? (
              <SelectItem value="none" disabled>
                No LinkedIn accounts connected
              </SelectItem>
            ) : (
              linkedinAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={account.avatar_url || undefined} referrerPolicy="no-referrer" />
                      <AvatarFallback className="text-[9px] bg-primary/10">
                        {(account.display_name || account.username)?.charAt(0) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    {account.display_name || account.username || "LinkedIn Account"}
                    {hasSalesNavigator(account) && (
                      <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 text-amber-500 border-amber-500/30">
                        Sales Nav
                      </Badge>
                    )}
                    {account.status !== "active" && (
                      <span className="text-xs text-muted-foreground">
                        ({account.status})
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {/* List Name - Only show if no pre-selected list */}
      {!preSelectedListId && (
        <div className="space-y-2">
          <Label htmlFor="list-name">
            <List className="inline h-4 w-4 mr-2" />
            Enter your list name
          </Label>
          <Input
            id="list-name"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder="My LinkedIn Search Results"
          />
        </div>
      )}

      {/* Search Query Section */}
      <div className="space-y-4">
        <h3 className="font-medium">Search Query</h3>

        {/* URL Input */}
        <div className="space-y-2">
          <Label htmlFor="search-url">Enter search URL</Label>
          <div className="relative">
            <Link2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              id="search-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.linkedin.com/search/results/people/?keywords=..."
              className="pl-9"
            />
          </div>
          {url && !urlValidation.valid && urlValidation.message && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {urlValidation.message}
            </p>
          )}
          {urlValidation.valid && (
            <p className="text-sm text-green-600 flex items-center gap-1">
              <Search className="h-4 w-4" />
              {urlValidation.message}
            </p>
          )}
        </div>

      </div>

      {/* Sales Nav metadata notice - informational, not blocking */}
      {accountMissingSalesNav && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>
              We couldn't confirm Sales Navigator access from stored account data. If you just upgraded or renewed your Sales Nav subscription, refresh the account metadata to pull the latest status from LinkedIn.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await checkUnipileStatus.mutateAsync();
                  toast.success("Account metadata refreshed");
                } catch (err) {
                  toast.error(`Refresh failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
              }}
              disabled={checkUnipileStatus.isPending}
            >
              {checkUnipileStatus.isPending ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Refreshing...</>
              ) : (
                <><RefreshCw className="mr-2 h-3 w-3" /> Refresh account status</>
              )}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Search Preview */}
      {searchParams && Object.keys(searchParams).length > 0 && (
        <Alert>
          <Search className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              {searchParams.keywords && (
                <p>
                  <strong>Keywords:</strong> {searchParams.keywords}
                </p>
              )}
              {searchParams.location && (
                <p>
                  <strong>Location:</strong> {searchParams.location}
                </p>
              )}
              {searchParams.network && (
                <p>
                  <strong>Network:</strong> {searchParams.network}
                </p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Max Leads */}
      <div className="space-y-2">
        <Label htmlFor="max-leads">Maximum Leads to Import</Label>
        <div className="flex items-center gap-4">
          <Input
            id="max-leads"
            type="number"
            value={maxLeads}
            onChange={(e) =>
              setMaxLeads(Math.min(2500, Math.max(1, Number(e.target.value))))
            }
            min={1}
            max={2500}
            className="w-32"
          />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>Max 2,500 leads per import</span>
          </div>
        </div>
      </div>

      {/* No Accounts Warning */}
      {linkedinAccounts.length === 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You need to connect a LinkedIn account first. Go to Settings to
            connect your account.
          </AlertDescription>
        </Alert>
      )}

      {/* Submit Button */}
      <Button
        variant="cta"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full"
        size="lg"
      >
        {isStarting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Starting Import...
          </>
        ) : (
          <>
            <Search className="mr-2 h-4 w-4" />
            Start Importing
          </>
        )}
      </Button>
    </div>
  );
}
