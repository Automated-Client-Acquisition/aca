import { useState, useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useUnipileAccounts } from '@/hooks/useUnipileAccounts';
import { AlertCircle, Loader2, Link2, Search, Users } from 'lucide-react';

interface Props {
  targetListId: string;
  onStartImport: (config: {
    type: 'search' | 'sales_nav';
    sourceUrl: string;
    accountId: string;
    maxLeads: number;
  }) => void;
  isStarting: boolean;
}

export function LinkedInSearchImport({ targetListId, onStartImport, isStarting }: Props) {
  const [url, setUrl] = useState('');
  const [accountId, setAccountId] = useState('');
  const [maxLeads, setMaxLeads] = useState(100);

  const { data: accountsData } = useUnipileAccounts();
  const linkedinAccounts = accountsData?.linkedinAccounts || [];

  // Determine import type from URL
  const importType = useMemo(() => {
    if (url.includes('/sales/search/')) {
      return 'sales_nav';
    }
    if (url.includes('linkedin.com/search/results/people')) {
      return 'search';
    }
    return null;
  }, [url]);

  // Validate URL
  const urlValidation = useMemo(() => {
    if (!url) return { valid: false, message: '' };

    if (url.includes('/sales/search/')) {
      return { valid: true, message: 'Sales Navigator search detected', type: 'sales_nav' as const };
    }

    if (url.includes('linkedin.com/search/results/people')) {
      return { valid: true, message: 'LinkedIn people search detected', type: 'search' as const };
    }

    if (url.includes('linkedin.com')) {
      return { valid: false, message: 'Please paste a LinkedIn People Search URL' };
    }

    return { valid: false, message: 'Please enter a valid LinkedIn URL' };
  }, [url]);

  // Parse search parameters from URL for preview
  const searchParams = useMemo(() => {
    if (!urlValidation.valid) return null;

    try {
      const urlObj = new URL(url);
      const params: Record<string, string> = {};

      // Extract keywords
      const keywords = urlObj.searchParams.get('keywords');
      if (keywords) params.keywords = decodeURIComponent(keywords);

      // Extract other common filters
      const geoUrn = urlObj.searchParams.get('geoUrn');
      if (geoUrn) params.location = 'Location filter applied';

      const network = urlObj.searchParams.get('network');
      if (network) params.network = network === '["F"]' ? '1st connections' :
                                    network === '["S"]' ? '2nd connections' :
                                    network === '["O"]' ? '3rd+ connections' : network;

      return params;
    } catch {
      return null;
    }
  }, [url, urlValidation.valid]);

  const handleSubmit = () => {
    if (!urlValidation.valid || !accountId || !importType) return;

    onStartImport({
      type: importType,
      sourceUrl: url,
      accountId,
      maxLeads,
    });
  };

  const canSubmit = urlValidation.valid && accountId && !isStarting;

  return (
    <div className="space-y-6">
      {/* URL Input */}
      <div className="space-y-2">
        <Label htmlFor="search-url">LinkedIn Search URL</Label>
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

      {/* Search Preview */}
      {searchParams && Object.keys(searchParams).length > 0 && (
        <Alert>
          <Search className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              {searchParams.keywords && (
                <p><strong>Keywords:</strong> {searchParams.keywords}</p>
              )}
              {searchParams.location && (
                <p><strong>Location:</strong> {searchParams.location}</p>
              )}
              {searchParams.network && (
                <p><strong>Network:</strong> {searchParams.network}</p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Account Selection */}
      <div className="space-y-2">
        <Label htmlFor="account">LinkedIn Account</Label>
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
                        {(account.display_name || account.username)?.charAt(0) || '?'}
                      </AvatarFallback>
                    </Avatar>
                    {account.display_name || account.username || 'LinkedIn Account'}
                    {account.status !== 'active' && (
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
        <p className="text-sm text-muted-foreground">
          This account will be used to fetch search results
        </p>
      </div>

      {/* Max Leads */}
      <div className="space-y-2">
        <Label htmlFor="max-leads">Maximum Leads to Import</Label>
        <div className="flex items-center gap-4">
          <Input
            id="max-leads"
            type="number"
            value={maxLeads}
            onChange={(e) => setMaxLeads(Math.min(2500, Math.max(1, Number(e.target.value))))}
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
            You need to connect a LinkedIn account first. Go to Settings to connect your account.
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
            Start Import
          </>
        )}
      </Button>
    </div>
  );
}
