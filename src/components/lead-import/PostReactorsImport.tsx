import { useState, useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useUnipileAccounts } from '@/hooks/useUnipileAccounts';
import { AlertCircle, Loader2, Link2, ThumbsUp, MessageSquare, Users, RefreshCw } from 'lucide-react';

interface Props {
  targetListId: string;
  onStartImport: (config: {
    type: 'post_reactors' | 'post_commenters';
    sourceUrl: string;
    accountId: string;
    maxLeads: number;
    includeReactors: boolean;
    includeCommenters: boolean;
    reactionTypes: string[];
    keepSynced: boolean;
    watchDays: number;
  }) => void;
  isStarting: boolean;
}

const WATCH_WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
];

const REACTION_TYPES = [
  { id: 'LIKE', label: 'Like', emoji: '👍' },
  { id: 'CELEBRATE', label: 'Celebrate', emoji: '👏' },
  { id: 'SUPPORT', label: 'Support', emoji: '💚' },
  { id: 'LOVE', label: 'Love', emoji: '❤️' },
  { id: 'INSIGHTFUL', label: 'Insightful', emoji: '💡' },
  { id: 'FUNNY', label: 'Funny', emoji: '😄' },
];

export function PostReactorsImport({ targetListId, onStartImport, isStarting }: Props) {
  const [url, setUrl] = useState('');
  const [accountId, setAccountId] = useState('');
  const [maxLeads, setMaxLeads] = useState(500);
  const [includeReactors, setIncludeReactors] = useState(true);
  const [includeCommenters, setIncludeCommenters] = useState(true);
  const [selectedReactions, setSelectedReactions] = useState<string[]>([]);
  const [keepSynced, setKeepSynced] = useState(false);
  const [watchDays, setWatchDays] = useState('60');

  const { data: accountsData } = useUnipileAccounts();
  const linkedinAccounts = accountsData?.linkedinAccounts || [];

  // Validate URL - LinkedIn post URLs
  const urlValidation = useMemo(() => {
    if (!url) return { valid: false, message: '' };

    // LinkedIn post formats:
    // https://www.linkedin.com/posts/username_activity-7123456789012345678-abcd
    // https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678
    // https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678
    const postPatterns = [
      /linkedin\.com\/posts\/[\w-]+_[\w-]+-\d+/i,
      /linkedin\.com\/feed\/update\/urn:li:(activity|share):\d+/i,
    ];

    if (postPatterns.some(p => p.test(url))) {
      return { valid: true, message: 'LinkedIn post URL detected' };
    }

    if (url.includes('linkedin.com')) {
      return { valid: false, message: 'Please paste a LinkedIn post URL (not search or profile)' };
    }

    return { valid: false, message: 'Please enter a valid LinkedIn post URL' };
  }, [url]);

  // Toggle reaction type
  const toggleReaction = (reactionId: string) => {
    setSelectedReactions(prev =>
      prev.includes(reactionId)
        ? prev.filter(r => r !== reactionId)
        : [...prev, reactionId]
    );
  };

  const handleSubmit = () => {
    if (!urlValidation.valid || !accountId) return;
    if (!includeReactors && !includeCommenters) return;

    // Determine type based on what's selected
    const type = includeReactors && !includeCommenters
      ? 'post_reactors'
      : 'post_commenters'; // We'll handle both in the edge function

    onStartImport({
      type,
      sourceUrl: url,
      accountId,
      maxLeads,
      includeReactors,
      includeCommenters,
      reactionTypes: selectedReactions.length > 0 ? selectedReactions : REACTION_TYPES.map(r => r.id),
      keepSynced,
      watchDays: parseInt(watchDays, 10),
    });
  };

  const canSubmit =
    urlValidation.valid &&
    accountId &&
    (includeReactors || includeCommenters) &&
    !isStarting;

  return (
    <div className="space-y-6">
      {/* URL Input */}
      <div className="space-y-2">
        <Label htmlFor="post-url">LinkedIn Post URL</Label>
        <div className="relative">
          <Link2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="post-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.linkedin.com/posts/username_activity-..."
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
            <ThumbsUp className="h-4 w-4" />
            {urlValidation.message}
          </p>
        )}
      </div>

      {/* Import Options */}
      <div className="space-y-3">
        <Label>Import from</Label>
        <div className="flex gap-4">
          <Card
            className={`flex-1 cursor-pointer transition-all ${
              includeReactors ? 'border-primary ring-1 ring-primary' : ''
            }`}
            onClick={() => setIncludeReactors(!includeReactors)}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <Checkbox checked={includeReactors} />
              <ThumbsUp className="h-5 w-5 text-blue-600" />
              <div>
                <p className="font-medium">Reactors</p>
                <p className="text-xs text-muted-foreground">People who reacted</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className={`flex-1 cursor-pointer transition-all ${
              includeCommenters ? 'border-primary ring-1 ring-primary' : ''
            }`}
            onClick={() => setIncludeCommenters(!includeCommenters)}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <Checkbox checked={includeCommenters} />
              <MessageSquare className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium">Commenters</p>
                <p className="text-xs text-muted-foreground">People who commented</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Reaction Type Filter */}
      {includeReactors && (
        <div className="space-y-3">
          <Label>Filter by Reaction Type (optional)</Label>
          <div className="flex flex-wrap gap-2">
            {REACTION_TYPES.map(reaction => (
              <Button
                key={reaction.id}
                variant={selectedReactions.includes(reaction.id) ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleReaction(reaction.id)}
                className="gap-1"
              >
                <span>{reaction.emoji}</span>
                {reaction.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {selectedReactions.length === 0
              ? 'All reaction types will be included'
              : `Filtering to: ${selectedReactions.map(r => REACTION_TYPES.find(rt => rt.id === r)?.label).join(', ')}`}
          </p>
        </div>
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

      {/* Keep Synced */}
      <Card className={keepSynced ? 'border-primary ring-1 ring-primary' : ''}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <RefreshCw className="h-5 w-5 text-primary mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium">Keep this list synced</p>
                <p className="text-xs text-muted-foreground">
                  We'll keep checking this post and automatically add new{' '}
                  {includeCommenters && includeReactors
                    ? 'commenters and reactors'
                    : includeCommenters
                    ? 'commenters'
                    : 'reactors'}{' '}
                  as they engage.
                </p>
              </div>
            </div>
            <Switch checked={keepSynced} onCheckedChange={setKeepSynced} />
          </div>
          {keepSynced && (
            <div className="mt-3 flex items-center gap-3">
              <Label className="text-sm text-muted-foreground shrink-0">Watch for</Label>
              <Select value={watchDays} onValueChange={setWatchDays}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WATCH_WINDOWS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Validation */}
      {!includeReactors && !includeCommenters && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please select at least one option: Reactors or Commenters
          </AlertDescription>
        </Alert>
      )}

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
            <ThumbsUp className="mr-2 h-4 w-4" />
            Start Import
          </>
        )}
      </Button>
    </div>
  );
}
