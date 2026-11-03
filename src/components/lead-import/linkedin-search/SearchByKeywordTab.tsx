import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useUnipileAccounts, hasSalesNavigator } from "@/hooks/useUnipileAccounts";
import {
  useSearchParamsTypeahead,
  type SearchParameter,
} from "@/hooks/useLinkedInSearchParams";
import {
  AlertCircle,
  Loader2,
  Search,
  Users,
  List,
  MapPin,
  Building,
  Briefcase,
  X,
} from "lucide-react";
import type { LinkedInImportType, SearchMode, ApiType, SearchParams } from "@/hooks/useLinkedInImport";

interface SearchByKeywordTabProps {
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
  preSelectedListId?: string | null;
  preSelectedListName?: string;
  forcedApiType?: ApiType;
}

export function SearchByKeywordTab({
  onStartImport,
  isStarting,
  preSelectedListId,
  preSelectedListName,
  forcedApiType,
}: SearchByKeywordTabProps) {
  const [listName, setListName] = useState(preSelectedListName || "");
  const [accountId, setAccountId] = useState("");
  const [keywords, setKeywords] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<SearchParameter[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<SearchParameter[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<SearchParameter[]>([]);
  const [connectionDegrees, setConnectionDegrees] = useState<string[]>([]);
  const [maxLeads, setMaxLeads] = useState(100);

  const { data: accountsData } = useUnipileAccounts();
  const linkedinAccounts = accountsData?.linkedinAccounts || [];

  // Dynamic parameter lookups from Unipile API
  const locationSearch = useSearchParamsTypeahead(accountId || null, 'location');
  const industrySearch = useSearchParamsTypeahead(accountId || null, 'industry');
  const companySearch = useSearchParamsTypeahead(accountId || null, 'company');

  const toggleConnectionDegree = (degree: string) => {
    setConnectionDegrees((prev) =>
      prev.includes(degree)
        ? prev.filter((d) => d !== degree)
        : [...prev, degree]
    );
  };

  const addLocation = (param: SearchParameter) => {
    if (!selectedLocations.find(l => l.id === param.id)) {
      setSelectedLocations(prev => [...prev, param]);
    }
    locationSearch.clearSearch();
  };

  const removeLocation = (param: SearchParameter) => {
    setSelectedLocations(prev => prev.filter(l => l.id !== param.id));
  };

  const addIndustry = (param: SearchParameter) => {
    if (!selectedIndustries.find(i => i.id === param.id)) {
      setSelectedIndustries(prev => [...prev, param]);
    }
    industrySearch.clearSearch();
  };

  const removeIndustry = (param: SearchParameter) => {
    setSelectedIndustries(prev => prev.filter(i => i.id !== param.id));
  };

  const addCompany = (param: SearchParameter) => {
    if (!selectedCompanies.find(c => c.id === param.id)) {
      setSelectedCompanies(prev => [...prev, param]);
    }
    companySearch.clearSearch();
  };

  const removeCompany = (param: SearchParameter) => {
    setSelectedCompanies(prev => prev.filter(c => c.id !== param.id));
  };

  // Detect if selected account has Sales Navigator
  const selectedAccount = linkedinAccounts.find(a => a.id === accountId);
  const accountHasSalesNav = selectedAccount ? hasSalesNavigator(selectedAccount) : false;

  const handleSubmit = () => {
    if (!accountId || !keywords || (!preSelectedListId && !listName.trim())) return;

    // Map connection degrees to Unipile format (numbers: 1, 2, 3)
    const networkDistanceMap: Record<string, string> = {
      "1st": "1",
      "2nd": "2",
      "3rd+": "3",
    };

    // Build search params for Unipile API
    const searchParams: SearchParams = {
      category: 'people',
      keywords,
      location: selectedLocations.map(l => l.id),
      industry: selectedIndustries.map(i => i.id),
      current_company: selectedCompanies.map(c => c.id),
      network_distance: connectionDegrees.map(d => networkDistanceMap[d]).filter(Boolean),
    };

    // Auto-use Sales Navigator when the account has it, or when the Sales Nav source was selected.
    const apiType: ApiType = forcedApiType || (accountHasSalesNav ? 'sales_navigator' : 'classic');

    onStartImport({
      type: apiType === "sales_navigator" ? "sales_nav" : "search",
      sourceUrl: "", // Not used for parameter mode
      accountId,
      maxLeads,
      searchMode: 'parameters',
      apiType,
      searchParams,
      listName: listName.trim() || undefined,
    });
  };

  // List name is valid if we have a pre-selected list OR user entered a name
  const hasValidList = preSelectedListId || listName.trim();
  const canSubmit = accountId && keywords && hasValidList && !isStarting;

  return (
    <div className="space-y-6">
      {/* Account Selection - First */}
      <div className="space-y-2">
        <Label htmlFor="account-keyword">Select account</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger id="account-keyword">
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
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Sales Navigator info */}
      {(accountHasSalesNav || forcedApiType === "sales_navigator") && (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <AlertDescription className="text-sm text-amber-400">
            This search will use Sales Navigator for richer results and larger result sets.
          </AlertDescription>
        </Alert>
      )}

      {/* List Name - Only show if no pre-selected list */}
      {!preSelectedListId && (
        <div className="space-y-2">
          <Label htmlFor="list-name-keyword">
            <List className="inline h-4 w-4 mr-2" />
            Enter your list name
          </Label>
          <Input
            id="list-name-keyword"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder="My Keyword Search Results"
          />
        </div>
      )}

      {/* Search Query Section */}
      <div className="space-y-4">
        <h3 className="font-medium">Search Query</h3>

        {/* Keywords */}
        <div className="space-y-2">
          <Label htmlFor="keywords">
            <Search className="inline h-4 w-4 mr-2" />
            Search keywords
          </Label>
          <Input
            id="keywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="e.g., Sales Manager, Marketing Director"
          />
        </div>

        {/* Locations and Companies Grid */}
        <div className="grid grid-cols-2 gap-4">
          {/* Locations - Dynamic search */}
          <div className="space-y-2">
            <Label>
              <MapPin className="inline h-4 w-4 mr-2" />
              Locations
            </Label>
            <div className="relative">
              <Input
                value={locationSearch.searchTerm}
                onChange={(e) => locationSearch.setSearchTerm(e.target.value)}
                placeholder={accountId ? "Search locations..." : "Select account first"}
                disabled={!accountId}
              />
              {locationSearch.isLoading && (
                <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {/* Search results dropdown */}
              {locationSearch.searchTerm && locationSearch.results.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {locationSearch.results.map((param) => (
                    <button
                      key={param.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => addLocation(param)}
                    >
                      {param.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedLocations.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedLocations.map((loc) => (
                  <Badge key={loc.id} variant="secondary" className="gap-1">
                    {loc.name}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => removeLocation(loc)}
                    />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Companies - Dynamic search */}
          <div className="space-y-2">
            <Label>
              <Building className="inline h-4 w-4 mr-2" />
              Companies
            </Label>
            <div className="relative">
              <Input
                value={companySearch.searchTerm}
                onChange={(e) => companySearch.setSearchTerm(e.target.value)}
                placeholder={accountId ? "Search companies..." : "Select account first"}
                disabled={!accountId}
              />
              {companySearch.isLoading && (
                <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {/* Search results dropdown */}
              {companySearch.searchTerm && companySearch.results.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {companySearch.results.map((param) => (
                    <button
                      key={param.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => addCompany(param)}
                    >
                      {param.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedCompanies.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedCompanies.map((company) => (
                  <Badge key={company.id} variant="secondary" className="gap-1">
                    {company.name}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => removeCompany(company)}
                    />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Industries - Dynamic search */}
          <div className="space-y-2 col-span-2">
            <Label>
              <Briefcase className="inline h-4 w-4 mr-2" />
              Industries
            </Label>
            <div className="relative">
              <Input
                value={industrySearch.searchTerm}
                onChange={(e) => industrySearch.setSearchTerm(e.target.value)}
                placeholder={accountId ? "Search industries..." : "Select account first"}
                disabled={!accountId}
              />
              {industrySearch.isLoading && (
                <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {/* Search results dropdown */}
              {industrySearch.searchTerm && industrySearch.results.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {industrySearch.results.map((param) => (
                    <button
                      key={param.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => addIndustry(param)}
                    >
                      {param.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedIndustries.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedIndustries.map((ind) => (
                  <Badge key={ind.id} variant="secondary" className="gap-1">
                    {ind.name}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => removeIndustry(ind)}
                    />
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Connection Degrees */}
        <div className="space-y-3">
          <Label>Connection degrees</Label>
          <div className="flex gap-6">
            {["1st", "2nd", "3rd+"].map((degree) => (
              <label
                key={degree}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Checkbox
                  checked={connectionDegrees.includes(degree)}
                  onCheckedChange={() => toggleConnectionDegree(degree)}
                />
                <span className="text-sm">{degree} degree connection</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Max Leads */}
      <div className="space-y-2">
        <Label htmlFor="max-leads-keyword">Maximum Leads to Import</Label>
        <div className="flex items-center gap-4">
          <Input
            id="max-leads-keyword"
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
            Start importing
          </>
        )}
      </Button>
    </div>
  );
}
