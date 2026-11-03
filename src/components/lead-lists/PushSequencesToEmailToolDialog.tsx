import { useState, useEffect } from "react";
import { chunkedIn } from "@/hooks/crm/useContacts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Mail,
  AlertTriangle,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { EmailToolLogo } from "@/components/icons/EmailToolLogos";
import { useToolConnections, useToolCampaigns, type ToolConnection, type ToolCampaign } from "@/hooks/useToolConnections";
import { useEmailSequencesByStatus, usePushSequencesToEmailTool, usePushContactsDirectly } from "@/hooks/useEmailSequences";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PushSequencesToEmailToolDialogProps {
  contactIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (pushedCount: number) => void;
}

type PushState = 'idle' | 'pushing' | 'complete' | 'error';
type PushMode = 'with_sequences' | 'leads_only';

interface PushProgress {
  current: number;
  total: number;
  currentContactName?: string;
  pushed: number;
  failed: number;
}

export function PushSequencesToEmailToolDialog({
  contactIds,
  open,
  onOpenChange,
  onComplete,
}: PushSequencesToEmailToolDialogProps) {
  // Selection state
  const [pushMode, setPushMode] = useState<PushMode>('leads_only');
  const [selectedToolType, setSelectedToolType] = useState<'smartlead' | 'instantly' | 'successai' | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>();

  // Push state
  const [pushState, setPushState] = useState<PushState>('idle');
  const [progress, setProgress] = useState<PushProgress>({
    current: 0,
    total: 0,
    pushed: 0,
    failed: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Hooks
  const { currentOrganization } = useAuth();
  const organizationId = currentOrganization?.id;
  const queryClient = useQueryClient();
  const shouldLoadSequences = open && pushMode === 'with_sequences' && contactIds.length > 0;
  const { data: sequences, isLoading: sequencesLoading } = useEmailSequencesByStatus(
    'ready',
    contactIds,
    shouldLoadSequences,
  );
  const { data: connections, isLoading: connectionsLoading } = useToolConnections(selectedToolType || undefined);
  const { data: campaigns, isLoading: campaignsLoading } = useToolCampaigns(selectedConnectionId);
  const pushMutation = usePushSequencesToEmailTool();
  const pushDirectlyMutation = usePushContactsDirectly();

  // Fetch contacts for leads-only mode
  const { data: contactsData, isLoading: contactsLoading } = useQuery({
    queryKey: ['contacts-for-push', organizationId, contactIds],
    queryFn: async () => {
      if (!organizationId || contactIds.length === 0) return [];
      return chunkedIn(contactIds, (chunk) =>
        supabase
          .from('crm_contacts')
          .select('id, display_name, primary_email')
          .eq('organization_id', organizationId)
          .in('id', chunk)
      );
    },
    enabled: open && pushMode === 'leads_only' && contactIds.length > 0 && !!organizationId,
  });

  const contactsWithEmail = contactsData?.filter(c => c.primary_email) || [];
  const contactsWithoutEmail = contactsData?.filter(c => !c.primary_email) || [];

  // Filter sequences to only those for selected contacts
  // Only one 'ready' sequence exists per contact (others are archived), so no de-duplication needed
  const sequencesToPush = sequences?.filter(seq => contactIds.includes(seq.contact_id)) || [];

  // Filter connections by selected tool type
  const filteredConnections = connections?.filter(c =>
    !selectedToolType || c.tool_type === selectedToolType
  ) || [];

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      const timeout = setTimeout(() => {
        setPushState('idle');
        setProgress({ current: 0, total: 0, pushed: 0, failed: 0 });
        setErrorMessage(null);
        setPushMode('leads_only');
        setSelectedToolType(null);
        setSelectedConnectionId(undefined);
        setSelectedCampaignId(undefined);
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  // Reset connection and campaign when tool type changes
  useEffect(() => {
    setSelectedConnectionId(undefined);
    setSelectedCampaignId(undefined);
  }, [selectedToolType]);

  // Reset campaign when connection changes
  useEffect(() => {
    setSelectedCampaignId(undefined);
  }, [selectedConnectionId]);

  const handlePush = async () => {
    if (!selectedConnectionId || !selectedCampaignId || !selectedToolType) {
      return;
    }

    // Validate based on push mode
    if (pushMode === 'leads_only') {
      if (contactsWithEmail.length === 0) return;
    } else {
      if (sequencesToPush.length === 0) return;
    }

    setPushState('pushing');
    setErrorMessage(null);

    const totalCount = pushMode === 'leads_only' ? contactsWithEmail.length : sequencesToPush.length;

    setProgress({
      current: 0,
      total: totalCount,
      pushed: 0,
      failed: 0,
    });

    try {
      if (pushMode === 'leads_only') {
        // Push contacts directly without sequences
        const result = await pushDirectlyMutation.mutateAsync({
          contactIds: contactsWithEmail.map(c => c.id),
          toolType: selectedToolType,
          connectionId: selectedConnectionId,
          externalCampaignId: selectedCampaignId,
        });

        setProgress({
          current: totalCount,
          total: totalCount,
          pushed: result.pushed,
          failed: result.failed,
        });
      } else {
        // Push with sequences (existing behavior)
        const result = await pushMutation.mutateAsync({
          sequenceIds: sequencesToPush.map(s => s.id),
          toolType: selectedToolType,
          connectionId: selectedConnectionId,
          externalCampaignId: selectedCampaignId,
        });

        setProgress({
          current: totalCount,
          total: totalCount,
          pushed: result.pushed,
          failed: result.failed,
        });

        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ['contact-email-sequences'] });
      }

      setPushState('complete');

    } catch (err) {
      console.error('Push failed:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
      setPushState('error');
    }
  };

  const handleClose = () => {
    if (pushState === 'pushing') return;
    onOpenChange(false);
    if (progress.pushed > 0) {
      onComplete?.(progress.pushed);
    }
  };

  const progressPercentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  // Pushing view
  if (pushState === 'pushing') {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[500px]" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                <Loader2 className="h-4 w-4 text-green-600 animate-spin" />
              </div>
              Pushing to {selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'}...
            </DialogTitle>
            <DialogDescription>
              {pushMode === 'leads_only'
                ? 'Sending leads to your email campaign.'
                : 'Sending leads with personalized email sequences.'}
            </DialogDescription>
          </DialogHeader>

          <div className="py-6 space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Progress: {progress.current} of {progress.total}
                </span>
                <span className="font-medium">{Math.round(progressPercentage)}%</span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-emerald-600">{progress.pushed}</div>
                <div className="text-xs text-emerald-600/80">Pushed</div>
              </div>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-red-600">{progress.failed}</div>
                <div className="text-xs text-red-600/80">Failed</div>
              </div>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              This may take a moment. Don't close this dialog.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Complete view
  if (pushState === 'complete') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-green-500/20 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              Push Complete
            </DialogTitle>
            <DialogDescription>
              Leads have been pushed to {selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'}.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-600">{progress.pushed}</div>
                <div className="text-xs text-emerald-600/80">Pushed Successfully</div>
              </div>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{progress.failed}</div>
                <div className="text-xs text-red-600/80">Failed</div>
              </div>
            </div>

            {progress.pushed > 0 && (
              <p className="text-sm text-muted-foreground">
                {pushMode === 'leads_only'
                  ? `The leads are now in your ${selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'} campaign. Use your email tool's built-in sequences to send emails.`
                  : `The leads are now in your ${selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'} campaign with personalized email content in custom fields.`}
              </p>
            )}

            {progress.failed > 0 && (
              <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-500/10 p-3 rounded-lg">
                <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  {progress.failed} leads failed to push. They may be missing email addresses or there was an API error.
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="cta" onClick={handleClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Error view
  if (pushState === 'error') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center">
                <XCircle className="h-4 w-4 text-red-600" />
              </div>
              Push Failed
            </DialogTitle>
            <DialogDescription>
              There was an error pushing leads.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-500/10 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{errorMessage || 'An unknown error occurred. Please try again.'}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Close</Button>
            <Button variant="cta" onClick={() => setPushState('idle')}>Try Again</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Determine if we can push based on mode
  const canPush = pushMode === 'leads_only'
    ? contactsWithEmail.length > 0
    : sequencesToPush.length > 0;

  const pushCount = pushMode === 'leads_only'
    ? contactsWithEmail.length
    : sequencesToPush.length;

  const isLoading = pushMode === 'leads_only' ? contactsLoading : sequencesLoading;

  // Default: Setup view
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
              <Send className="h-4 w-4 text-green-600" />
            </div>
            Push to Email Tool
          </DialogTitle>
          <DialogDescription>
            Send leads to SmartLead, Instantly, or Success.ai.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-5">
          {/* Push Mode Selection */}
          <div className="space-y-3">
            <Label>Push Mode</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPushMode('leads_only')}
                className={cn(
                  "p-4 rounded-lg border text-left transition-all",
                  pushMode === 'leads_only'
                    ? "border-green-500 bg-green-500/10 ring-1 ring-green-500"
                    : "border-border hover:border-muted-foreground/30"
                )}
              >
                <div className="font-medium">Leads Only</div>
                <div className="text-xs text-muted-foreground">
                  Push contact info - use your email tool's sequences
                </div>
              </button>
              <button
                type="button"
                onClick={() => setPushMode('with_sequences')}
                className={cn(
                  "p-4 rounded-lg border text-left transition-all",
                  pushMode === 'with_sequences'
                    ? "border-green-500 bg-green-500/10 ring-1 ring-green-500"
                    : "border-border hover:border-muted-foreground/30"
                )}
              >
                <div className="font-medium">With Sequences</div>
                <div className="text-xs text-muted-foreground">
                  Include AI-generated email content as custom fields
                </div>
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : pushMode === 'with_sequences' && sequencesToPush.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">No Sequences Ready</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  None of the selected contacts have generated email sequences.
                  <br />
                  Run "Generate Email Sequences" first, or switch to "Leads Only" mode.
                </p>
              </div>
            </div>
          ) : pushMode === 'leads_only' && contactsWithEmail.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">No Contacts with Email</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  None of the selected contacts have email addresses.
                  <br />
                  Enrich contacts to get their email addresses first.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Summary */}
              {pushMode === 'leads_only' ? (
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Users className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <span className="text-lg font-bold">{contactsWithEmail.length}</span>
                        <span className="text-sm text-muted-foreground ml-2">
                          contacts with email addresses
                        </span>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-blue-500/15 text-blue-600 dark:text-blue-400">
                      Leads only
                    </Badge>
                  </div>
                  {contactsWithoutEmail.length > 0 && (
                    <p className="text-xs text-amber-600">
                      {contactsWithoutEmail.length} contact(s) without email will be skipped
                    </p>
                  )}
                </div>
              ) : (
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Mail className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <span className="text-lg font-bold">{sequencesToPush.length}</span>
                        <span className="text-sm text-muted-foreground ml-2">
                          contacts with email sequences
                        </span>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-green-500/15 text-green-600 dark:text-green-400">
                      Ready to push
                    </Badge>
                  </div>
                </div>
              )}

              {/* Tool Selection */}
              <div className="space-y-3">
                <Label>Email Tool</Label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedToolType('smartlead')}
                    className={cn(
                      "p-4 rounded-lg border text-left transition-all",
                      selectedToolType === 'smartlead'
                        ? "border-green-500 bg-green-500/10 ring-1 ring-green-500"
                        : "border-border hover:border-muted-foreground/30"
                    )}
                  >
                    <EmailToolLogo toolType="smartlead" size="md" className="mb-2" />
                    <div className="font-medium">SmartLead</div>
                    <div className="text-xs text-muted-foreground">Cold email outreach</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedToolType('instantly')}
                    className={cn(
                      "p-4 rounded-lg border text-left transition-all",
                      selectedToolType === 'instantly'
                        ? "border-green-500 bg-green-500/10 ring-1 ring-green-500"
                        : "border-border hover:border-muted-foreground/30"
                    )}
                  >
                    <EmailToolLogo toolType="instantly" size="md" className="mb-2" />
                    <div className="font-medium">Instantly</div>
                    <div className="text-xs text-muted-foreground">Email outreach platform</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedToolType('successai')}
                    className={cn(
                      "p-4 rounded-lg border text-left transition-all",
                      selectedToolType === 'successai'
                        ? "border-green-500 bg-green-500/10 ring-1 ring-green-500"
                        : "border-border hover:border-muted-foreground/30"
                    )}
                  >
                    <EmailToolLogo toolType="successai" size="md" className="mb-2" />
                    <div className="font-medium">Success.ai</div>
                    <div className="text-xs text-muted-foreground">AI-powered outreach</div>
                  </button>
                </div>
              </div>

              {/* Connection Selection */}
              {selectedToolType && (
                <div className="space-y-3">
                  <Label>Connection</Label>
                  {connectionsLoading ? (
                    <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Loading...</span>
                    </div>
                  ) : filteredConnections.length === 0 ? (
                    <div className="border border-amber-500/30 bg-amber-500/10 rounded-lg p-3 space-y-2">
                      <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                          <p className="font-medium">No {selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'} connections</p>
                          <p className="text-amber-600 dark:text-amber-400">Add a connection in Settings first.</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" asChild className="w-full">
                        <Link to="/settings?tab=integrations">
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          Add Connection
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a connection..." />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredConnections.map((conn) => (
                          <SelectItem key={conn.id} value={conn.id}>
                            <div className="flex items-center gap-2">
                              <span>{conn.name}</span>
                              {conn.status === 'active' ? (
                                <Badge variant="secondary" className="text-[10px] bg-green-500/15 text-green-600 dark:text-green-400">
                                  Active
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[10px] bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">
                                  {conn.status}
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Campaign Selection */}
              {selectedConnectionId && (
                <div className="space-y-3">
                  <Label>Campaign</Label>
                  {campaignsLoading ? (
                    <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Loading campaigns...</span>
                    </div>
                  ) : campaigns && campaigns.length === 0 ? (
                    <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                      No campaigns found. Create a campaign in {selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'} first.
                    </div>
                  ) : (
                    <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a campaign..." />
                      </SelectTrigger>
                      <SelectContent>
                        {campaigns?.map((campaign) => (
                          <SelectItem key={campaign.id} value={String(campaign.id)}>
                            <div className="flex items-center gap-2">
                              <span>{campaign.name}</span>
                              {campaign.status && (
                                <Badge variant="outline" className="text-[10px]">
                                  {campaign.status}
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Info box - different content based on mode */}
              {selectedCampaignId && pushMode === 'leads_only' && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 space-y-1">
                  <div className="flex items-start gap-2 text-blue-600 dark:text-blue-400 text-sm">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Leads Only Mode</p>
                      <p className="text-blue-600 dark:text-blue-400 text-xs mt-1">
                        Contacts will be added to your {selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'} campaign with basic info
                        (name, email, company, etc.) as custom fields. Use your email tool's built-in
                        sequences to send emails.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {selectedCampaignId && pushMode === 'with_sequences' && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 space-y-1">
                  <div className="flex items-start gap-2 text-blue-600 dark:text-blue-400 text-sm">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Custom Fields Setup</p>
                      <p className="text-blue-600 dark:text-blue-400 text-xs mt-1">
                        The emails will be stored as custom {selectedToolType === 'successai' ? 'variables' : 'fields'}: <code className="bg-blue-500/20 px-1 rounded">email_1_subject</code>, <code className="bg-blue-500/20 px-1 rounded">email_1_body</code>, etc.
                        <br />
                        Use these in your {selectedToolType === 'smartlead' ? 'SmartLead' : selectedToolType === 'instantly' ? 'Instantly' : 'Success.ai'} templates with {`{{email_1_subject}}`} syntax.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handlePush}
            disabled={
              !canPush ||
              !selectedToolType ||
              !selectedConnectionId ||
              !selectedCampaignId
            }
          >
            <Send className="h-4 w-4 mr-2" />
            Push {pushCount} Leads
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
