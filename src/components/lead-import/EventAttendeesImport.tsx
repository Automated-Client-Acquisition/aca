import { useState, useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useUnipileAccounts } from '@/hooks/useUnipileAccounts';
import { AlertCircle, Loader2, Link2, Calendar, Users } from 'lucide-react';

interface Props {
  targetListId: string;
  onStartImport: (config: {
    type: 'event_attendees';
    sourceUrl: string;
    accountId: string;
    maxLeads: number;
  }) => void;
  isStarting: boolean;
}

export function EventAttendeesImport({ targetListId, onStartImport, isStarting }: Props) {
  const [url, setUrl] = useState('');
  const [accountId, setAccountId] = useState('');
  const [maxLeads, setMaxLeads] = useState(500);

  const { data: accountsData } = useUnipileAccounts();
  const linkedinAccounts = accountsData?.linkedinAccounts || [];

  // Validate URL - LinkedIn event URLs
  const urlValidation = useMemo(() => {
    if (!url) return { valid: false, message: '' };

    // LinkedIn event formats:
    // https://www.linkedin.com/events/7123456789012345678/
    // https://www.linkedin.com/events/eventname-7123456789012345678/
    const eventPatterns = [
      /linkedin\.com\/events\/[\w-]+-?\d+\/?/i,
      /linkedin\.com\/events\/\d+\/?/i,
    ];

    if (eventPatterns.some(p => p.test(url))) {
      return { valid: true, message: 'LinkedIn event URL detected' };
    }

    if (url.includes('linkedin.com')) {
      return { valid: false, message: 'Please paste a LinkedIn event URL' };
    }

    return { valid: false, message: 'Please enter a valid LinkedIn event URL' };
  }, [url]);

  // Extract event ID from URL
  const eventId = useMemo(() => {
    if (!urlValidation.valid) return null;

    // Extract numeric ID from URL
    const match = url.match(/\/events\/(?:[\w-]+-)?(\d+)/i);
    return match ? match[1] : null;
  }, [url, urlValidation.valid]);

  const handleSubmit = () => {
    if (!urlValidation.valid || !accountId) return;

    onStartImport({
      type: 'event_attendees',
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
        <Label htmlFor="event-url">LinkedIn Event URL</Label>
        <div className="relative">
          <Link2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="event-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.linkedin.com/events/..."
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
            <Calendar className="h-4 w-4" />
            {urlValidation.message}
            {eventId && <span className="text-muted-foreground">(ID: {eventId})</span>}
          </p>
        )}
      </div>

      {/* Info Alert */}
      {urlValidation.valid && (
        <Alert>
          <Calendar className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">Event Attendees Import</p>
            <p className="text-sm text-muted-foreground mt-1">
              This will import people who registered or are attending this LinkedIn event.
              The import may take a few minutes depending on the number of attendees.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Account Selection */}
      <div className="space-y-2">
        <Label htmlFor="account">LinkedIn Account</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger id="account">
            <SelectValue placeholder="Select account to use" />
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
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          This account will be used to fetch event attendees
        </p>
      </div>

      {/* Max Leads */}
      <div className="space-y-2">
        <Label htmlFor="max-leads">Maximum Attendees to Import</Label>
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
            <span>Max 2,500 per import</span>
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
            <Calendar className="mr-2 h-4 w-4" />
            Start Import
          </>
        )}
      </Button>
    </div>
  );
}
