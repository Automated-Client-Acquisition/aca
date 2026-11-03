import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Building2,
  Users,
  DollarSign,
  Briefcase,
  Target,
  MessageSquare,
  Send,
  Linkedin,
  MoreVertical,
  Edit,
  Trash2,
  Star,
  Clock,
  Activity,
  StickyNote,
  ExternalLink,
  Calendar,
  Sparkles,
  GraduationCap,
  Award,
  Languages,
  Heart,
  RefreshCw,
  UserCheck,
  Globe,
  CheckCircle,
  CheckCircle2,
  AlertCircle,
  ListPlus,
  UserMinus,
  Ban,
  MailX,
  Plus,
  Quote,
  TrendingUp,
  Megaphone,
  ChevronDown,
  ThumbsUp,
  MessageCircle,
  Loader2,
  UserPlus,
  Clock3,
  Pencil,
  Check,
  X,
  Gauge,
  Wrench,
  HelpCircle,
  Instagram,
} from "lucide-react";
import { EditableTextCell } from "@/components/editable-cells";
import { instagramUsername } from "@/lib/sequence-utils";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";
import { AppLayout } from "@/components/AppLayout";
import { LinkedDealsCard } from "@/components/deals/LinkedDealsCard";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeatureGate } from "@/components/UpgradePrompt";
import { AccountOwnerPicker } from "@/components/accounts/AccountOwnerPicker";
import { ContactSignalsCard } from "@/components/signals/ContactSignalsCard";
import { supabase } from "@/integrations/supabase/client";
import {
  useContact,
  useDeleteContact,
  useUpdateContact,
  useUpdateContactOwner,
  type CrmContact,
  type CrmContactIdentity,
  type CrmActivity,
} from "@/hooks/crm/useContacts";
import {
  useLinkedInProfile,
  useLinkedInAccount,
  type LinkedInProfile,
  type LinkedInWorkExperience,
  type LinkedInEducation,
  type LinkedInSkill,
} from "@/hooks/useLinkedInProfile";
import {
  useLinkedInPosts,
  type LinkedInPost,
  type LinkedInPostAttachment,
} from "@/hooks/useLinkedInPosts";
import { useResolveLinkedInIdentity } from "@/hooks/useResolveLinkedInIdentity";
import { useContactProductScores } from "@/hooks/useContactProductScores";
import {
  useLinkedInActivity,
  getReactionEmoji as getActivityReactionEmoji,
  getReactionLabel as getActivityReactionLabel,
  type LinkedInComment,
  type LinkedInReaction,
} from "@/hooks/useLinkedInActivity";
import {
  useEngagePost,
  REACTION_TYPES,
  type ReactionType,
} from "@/hooks/useEngagePost";
import {
  useContactInvitationStatus,
  formatInvitationDate,
} from "@/hooks/useLinkedInInvitations";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { RegenerateAnalysisDialog } from "@/components/contacts/RegenerateAnalysisDialog";
import { useLeadLists } from "@/hooks/useLeadLists";
import { useAddLeadListMember } from "@/hooks/useLeadListMembers";
import { useCampaigns } from "@/hooks/useCampaigns";
import { EmailSequenceView } from "@/components/contacts/EmailSequenceView";
import { MessageGeneratorDialog } from "@/components/contacts/MessageGeneratorDialog";
import { ActivityTimeline as CampaignActivityTimeline } from "@/components/leads/ActivityTimeline";
import { useLeadCampaignProgress, type ProgressStatus } from "@/hooks/useCampaignProgress";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";
import { CUSTOM_FIELD_SYSTEM_KEYS } from "@/lib/custom-fields";

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: contact, isLoading, error } = useContact(id);
  const deleteContact = useDeleteContact();

  // Get LinkedIn identity and fetch profile for avatar and highlights card
  const linkedinIdentity = contact?.identities?.find(
    (i) => i.channel === "linkedin"
  );
  const { data: linkedInAccount } = useLinkedInAccount();
  const {
    data: linkedInProfile,
    isLoading: linkedInProfileLoading,
  } = useLinkedInProfile({
    identifier: linkedinIdentity?.platform_user_id || null,
    accountId: linkedInAccount?.account_id || null,
    enabled: !!linkedinIdentity?.platform_user_id && !!linkedInAccount?.account_id,
  });

  // Auto-resolve LinkedIn identity if contact has a LinkedIn URL but no identity
  // This enables CSV-imported contacts to have their profiles resolved lazily
  const resolveLinkedInIdentity = useResolveLinkedInIdentity();
  const hasTriedResolving = useRef(false);

  useEffect(() => {
    // Only attempt resolution once per contact view
    if (hasTriedResolving.current) return;

    // Need contact loaded, no existing identity, but has a LinkedIn URL
    if (!contact?.id || !contact?.primary_linkedin_url) return;
    if (linkedinIdentity) return; // Already has an identity
    if (!linkedInAccount?.account_id) return; // Need a sender account to resolve

    // Don't resolve if already in progress
    if (resolveLinkedInIdentity.isPending) return;

    hasTriedResolving.current = true;
    console.log('[ContactDetail] Auto-resolving LinkedIn identity for contact:', contact.id);

    resolveLinkedInIdentity.mutate({
      contactId: contact.id,
      linkedInUrl: contact.primary_linkedin_url,
      accountId: linkedInAccount.account_id,
    });
  }, [
    contact?.id,
    contact?.primary_linkedin_url,
    linkedinIdentity,
    linkedInAccount?.account_id,
    resolveLinkedInIdentity,
  ]);

  // Get the best available avatar URL
  const linkedInAvatarUrl = linkedInProfile?.profile_picture_url;

  // Update avatar in database when we get fresh LinkedIn profile data
  // This ensures list views will have current avatar URLs
  // Uses direct Supabase call to avoid toast notification
  const hasUpdatedAvatar = useRef(false);

  useEffect(() => {
    // Only update if we have fresh LinkedIn avatar and it's different from stored
    if (
      linkedInAvatarUrl &&
      contact?.id &&
      contact.avatar_url !== linkedInAvatarUrl &&
      !hasUpdatedAvatar.current
    ) {
      hasUpdatedAvatar.current = true;

      // Silent update - no toast, just keep avatar URLs fresh
      supabase
        .from('crm_contacts')
        .update({ avatar_url: linkedInAvatarUrl, updated_at: new Date().toISOString() })
        .eq('id', contact.id)
        .then(({ error }) => {
          if (error) {
            console.error('[ContactDetail] Failed to update avatar_url:', error);
            hasUpdatedAvatar.current = false;
          } else {
            console.log('[ContactDetail] Updated avatar_url with fresh LinkedIn profile picture');
          }
        });
    }
  }, [linkedInAvatarUrl, contact?.id, contact?.avatar_url]);

  // Dialog states for engagement actions
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showInMailDialog, setShowInMailDialog] = useState(false);


  const handleDelete = () => {
    if (!id) return;
    if (window.confirm("Are you sure you want to delete this contact?")) {
      deleteContact.mutate(id, {
        onSuccess: () => {
          navigate("/people");
        },
      });
    }
  };

  if (isLoading) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <ContactDetailSkeleton />
      </AppLayout>
    );
  }

  if (error || !contact) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-6">
          <div className="max-w-4xl mx-auto">
            <Card className="p-8 text-center">
              <h2 className="text-lg font-semibold mb-2">Contact Not Found</h2>
              <p className="text-muted-foreground mb-4">
                The contact you're looking for doesn't exist or you don't have access to it.
              </p>
              <Button asChild>
                <Link to="/people">Back to People</Link>
              </Button>
            </Card>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <FeatureGate feature="messaging">
        <div className="flex-1 p-6">
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Back Button */}
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/people">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to People
                </Link>
              </Button>
            </div>

            {/* Hero — full-width identity, actions, status */}
            <ContactHero
              contact={contact}
              onDelete={handleDelete}
              linkedInAvatarUrl={linkedInAvatarUrl}
              onEmailClick={() => setShowEmailDialog(true)}
              onInMailClick={() => setShowInMailDialog(true)}
            />

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Column — actionable content, gets the wide column */}
              <div className="lg:col-span-2 space-y-4">
                <CompanyAnalysisCard contact={contact} />
                <CustomFieldsCard contact={contact} />
                <LinkedInHighlightsCard
                  profile={linkedInProfile}
                  isLoading={linkedInProfileLoading || resolveLinkedInIdentity.isPending}
                  contact={contact}
                  isResolvingIdentity={resolveLinkedInIdentity.isPending}
                  resolveError={resolveLinkedInIdentity.error}
                  onRetryResolve={
                    contact.primary_linkedin_url && linkedInAccount?.account_id
                      ? () => {
                          hasTriedResolving.current = false;
                          resolveLinkedInIdentity.mutate({
                            contactId: contact.id,
                            linkedInUrl: contact.primary_linkedin_url!,
                            accountId: linkedInAccount!.account_id,
                          });
                        }
                      : undefined
                  }
                />
                <ActivityTabs contact={contact} />
              </div>

              {/* Sidebar — quiet reference facts, sticky on desktop */}
              <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                <ContactInfoCard contact={contact} />
                <LinkedDealsCard
                  contact={{
                    id: contact.id,
                    display_name: contact.display_name,
                    company: contact.company,
                    company_id: (contact as { company_id?: string | null }).company_id ?? null,
                  }}
                />
                <CompanyInfoCard contact={contact} />
                <ContactSignalsCard contact={contact} />
              </div>
            </div>
          </div>
        </div>

        {/* Dialogs */}
        <MessageGeneratorDialog
          open={showEmailDialog}
          onOpenChange={setShowEmailDialog}
          messageType="email"
          contact={contact}
        />
        <MessageGeneratorDialog
          open={showInMailDialog}
          onOpenChange={setShowInMailDialog}
          messageType="inmail"
          contact={contact}
        />
      </FeatureGate>
    </AppLayout>
  );
}

// ============================================================================
// Contact Hero — full-width identity + status + actions, mirrors the
// CompanyHero pattern in CompanyDetailPage.tsx (avatar + identity block +
// meta row + quick actions, no separate gradient banner card).
// ============================================================================

interface ContactHeroProps {
  contact: CrmContact;
  onDelete: () => void;
  linkedInAvatarUrl?: string | null;
  onEmailClick: () => void;
  onInMailClick: () => void;
}

function ContactHero({ contact, onDelete, linkedInAvatarUrl, onEmailClick, onInMailClick }: ContactHeroProps) {
  const initials =
    contact.display_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  // Get LinkedIn identity for headline and avatar
  const linkedinIdentity = contact.identities?.find(
    (i) => i.channel === "linkedin"
  );
  const headline =
    ((linkedinIdentity?.platform_metadata as Record<string, unknown>)?.headline as string) ||
    ((contact.enrichment_data as Record<string, unknown> | null)?.headline as string) ||
    contact.job_title;

  // Get avatar URL - prefer freshly fetched LinkedIn profile picture over stored avatar
  // (stored avatar_url may contain expired LinkedIn URLs)
  const avatarUrl = linkedInAvatarUrl || contact.avatar_url || linkedinIdentity?.platform_avatar_url || undefined;

  // Get experience from custom_fields
  const experience = contact.custom_fields?.experience as string;

  // Get LinkedIn account and invitation status
  const { data: linkedInAccount } = useLinkedInAccount();
  const { status: inviteStatus, isLoading: inviteLoading } = useContactInvitationStatus({
    contactLinkedInId: linkedinIdentity?.platform_user_id || null,
    accountId: linkedInAccount?.account_id || null,
    enabled: !!linkedinIdentity?.platform_user_id && !!linkedInAccount?.account_id,
  });

  // Lead list hooks for Add to List dropdown
  const { leadLists, isLoading: listsLoading } = useLeadLists();
  const addToList = useAddLeadListMember();

  // Campaign hooks for Add to Campaign dropdown
  const { data: campaigns, isLoading: campaignsLoading } = useCampaigns();
  const [addingToCampaign, setAddingToCampaign] = useState<string | null>(null);

  // Handle adding contact to campaign
  const handleAddToCampaign = async (campaignId: string, campaignName: string) => {
    setAddingToCampaign(campaignId);
    try {
      const { error } = await supabase.rpc('add_leads_to_campaign', {
        p_campaign_id: campaignId,
        p_contact_ids: [contact.id],
      });

      if (error) throw error;
      toast.success(`Added to ${campaignName}`);
    } catch (err) {
      console.error('Add to campaign error:', err);
      toast.error(`Failed to add to ${campaignName}`);
    } finally {
      setAddingToCampaign(null);
    }
  };

  // Handle marking as Do Not Contact
  const handleDoNotContact = async () => {
    try {
      const { error } = await supabase
        .from('crm_contacts')
        .update({ status: 'do_not_contact' })
        .eq('id', contact.id);

      if (error) throw error;
      toast.success(`${contact.display_name} marked as Do Not Contact`);
    } catch (err) {
      toast.error('Failed to update contact');
      console.error('Do Not Contact error:', err);
    }
  };

  // Handle marking as Bounced
  const handleBounced = async () => {
    try {
      const { error } = await supabase
        .from('crm_contacts')
        .update({ status: 'bounced' })
        .eq('id', contact.id);

      if (error) throw error;
      toast.success(`${contact.display_name} marked as Bounced`);
    } catch (err) {
      toast.error('Failed to update contact');
      console.error('Bounced error:', err);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start gap-4">
          <Avatar className="h-16 w-16 sm:h-20 sm:w-20 border shadow-sm shrink-0">
            <AvatarImage
              src={avatarUrl}
              referrerPolicy="no-referrer"
            />
            <AvatarFallback className="text-xl font-semibold bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-xl font-bold truncate">{contact.display_name}</h1>
                {headline && (
                  <p className="text-sm text-muted-foreground truncate">{headline}</p>
                )}
                {experience && (
                  <p className="text-sm text-blue-600">Experience: {experience}</p>
                )}
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Contact
                  </DropdownMenuItem>
                  {contact.primary_linkedin_url && (
                    <DropdownMenuItem asChild>
                      <a
                        href={contact.primary_linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Linkedin className="h-4 w-4 mr-2" />
                        View on LinkedIn
                      </a>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={onDelete}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Contact
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Meta row — score, pipeline stage, invite status, tags: one glance instead of three stacked blocks */}
            {(contact.lead_score > 0 ||
              contact.stage ||
              (linkedinIdentity && (inviteStatus?.hasPendingInvite || inviteStatus?.hasReceivedInvite)) ||
              (contact.tags && contact.tags.length > 0)) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {contact.lead_score > 0 && (
                  <span className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold",
                    contact.lead_score >= 80 ? "bg-emerald-100 text-emerald-700" :
                    contact.lead_score >= 50 ? "bg-amber-100 text-amber-700" :
                    "bg-gray-100 text-gray-600"
                  )}>
                    <Target className="h-3 w-3" />
                    {contact.lead_score}
                  </span>
                )}
                {contact.stage && (
                  <Badge
                    style={{ backgroundColor: contact.stage.color + "20", color: contact.stage.color }}
                    className="border-0"
                  >
                    {contact.pipeline?.name}: {contact.stage.name}
                  </Badge>
                )}
                {linkedinIdentity && inviteStatus?.hasPendingInvite && (
                  <Badge variant="outline" className="gap-1 border-blue-200 bg-blue-50 text-blue-700">
                    <Clock3 className="h-3 w-3" />
                    Connection request sent {formatInvitationDate(inviteStatus.inviteSentAt)}
                  </Badge>
                )}
                {linkedinIdentity && inviteStatus?.hasReceivedInvite && (
                  <Badge variant="outline" className="gap-1 border-green-200 bg-green-50 text-green-700">
                    <UserPlus className="h-3 w-3" />
                    Wants to connect {formatInvitationDate(inviteStatus.receivedInviteAt)}
                  </Badge>
                )}
                {contact.tags?.map((tag) => {
                  const lower = tag.toLowerCase();
                  const colorClass =
                    lower === "sdr_tier_1" || lower === "fit:tier1" ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
                    lower === "sdr_tier_2" || lower === "fit:tier2" ? "bg-blue-100 text-blue-700 border-blue-200" :
                    lower === "sdr_tier_0" || lower === "fit:tier0" || lower === "not-a-fit" ? "bg-gray-100 text-gray-500 border-gray-200" :
                    lower === "do-not-contact" || lower === "not-interested" ? "bg-red-100 text-red-700 border-red-200" :
                    lower === "sdr_scored" ? "bg-violet-100 text-violet-700 border-violet-200" :
                    lower === "sdr_stuck" ? "bg-orange-100 text-orange-700 border-orange-200" :
                    lower.startsWith("sdr_") ? "bg-sky-100 text-sky-700 border-sky-200" :
                    "bg-secondary text-secondary-foreground border-border";
                  return (
                    <Badge key={tag} variant="outline" className={cn("text-xs border", colorClass)}>
                      {tag}
                    </Badge>
                  );
                })}
              </div>
            )}

            {/* Action Buttons - Icon Row */}
            <TooltipProvider>
              <div className="flex items-center gap-1 flex-wrap">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={onEmailClick}
                >
                  <Mail className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Send Email</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={onInMailClick}
                >
                  <Linkedin className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Send InMail</p>
              </TooltipContent>
            </Tooltip>
            {/* Add to Campaign Dropdown */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                    >
                      <Target className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add to Campaign</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Add to Campaign</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {campaignsLoading ? (
                  <DropdownMenuItem disabled>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </DropdownMenuItem>
                ) : !campaigns || campaigns.filter(c => c.status === 'active' || c.status === 'paused').length === 0 ? (
                  <div className="px-2 py-3 text-center">
                    <p className="text-sm text-muted-foreground mb-2">No active campaigns</p>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/campaigns/new">
                        <Plus className="h-3 w-3 mr-1" />
                        Create Campaign
                      </Link>
                    </Button>
                  </div>
                ) : (
                  campaigns
                    .filter(c => c.status === 'active' || c.status === 'paused')
                    .map((campaign) => (
                      <DropdownMenuItem
                        key={campaign.id}
                        disabled={addingToCampaign === campaign.id}
                        onClick={() => handleAddToCampaign(campaign.id, campaign.name)}
                      >
                        {addingToCampaign === campaign.id ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Target className="h-4 w-4 mr-2" />
                        )}
                        <span className="flex-1 truncate">{campaign.name}</span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "ml-2 text-xs",
                            campaign.status === 'active' && "bg-green-100 text-green-700",
                            campaign.status === 'paused' && "bg-amber-100 text-amber-700"
                          )}
                        >
                          {campaign.status}
                        </Badge>
                      </DropdownMenuItem>
                    ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Add to List Dropdown */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                    >
                      <ListPlus className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add to List</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Add to List</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {listsLoading ? (
                  <DropdownMenuItem disabled>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </DropdownMenuItem>
                ) : !leadLists || leadLists.filter(l => l.status === 'active').length === 0 ? (
                  <div className="px-2 py-3 text-center">
                    <p className="text-sm text-muted-foreground mb-2">No lists yet</p>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/lists/new">
                        <Plus className="h-3 w-3 mr-1" />
                        Create List
                      </Link>
                    </Button>
                  </div>
                ) : (
                  leadLists
                    .filter(l => l.status === 'active')
                    .map((list) => (
                      <DropdownMenuItem
                        key={list.id}
                        onClick={() => {
                          addToList.mutate(
                            { list_id: list.id, contact_id: contact.id },
                            {
                              onSuccess: () => toast.success(`Added to ${list.name}`),
                              onError: () => toast.error(`Failed to add to ${list.name}`),
                            }
                          );
                        }}
                      >
                        <Users className="h-4 w-4 mr-2" />
                        <span className="flex-1 truncate">{list.name}</span>
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {list.lead_count}
                        </Badge>
                      </DropdownMenuItem>
                    ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Do Not Contact Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                  onClick={handleDoNotContact}
                >
                  <Ban className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Do Not Contact</p>
              </TooltipContent>
            </Tooltip>
            {/* Bounced Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 text-destructive hover:text-destructive hover:bg-red-50"
                  onClick={handleBounced}
                >
                  <MailX className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Mark as Bounced</p>
              </TooltipContent>
            </Tooltip>
              </div>
            </TooltipProvider>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Contact Info Card
// ============================================================================

interface EnrichmentData {
  emailConfidence?: number;
  emailVerified?: boolean;
  seniority?: string;
  department?: string;
  lastEnrichedAt?: string;
  company?: {
    name?: string;
    domain?: string;
    website?: string;
    industry?: string;
    size?: string;
    sizeRange?: { min: number; max: number };
    revenue?: string;
    linkedinUrl?: string;
    description?: string;
    foundedYear?: number;
    technologies?: string[];
  };
  socialProfiles?: Array<{
    platform: string;
    url: string;
    username?: string;
  }>;
}

function ContactInfoCard({ contact }: { contact: CrmContact }) {
  const updateOwner = useUpdateContactOwner();
  const updateContact = useUpdateContact();
  const instagramHandle = instagramUsername(contact.instagram_url);
  const enrichmentData = contact.enrichment_data as EnrichmentData | null;
  // Build location string from enrichment data or custom fields
  const location = contact.city && contact.country
    ? `${contact.city}${contact.state ? `, ${contact.state}` : ''}, ${contact.country}`
    : (contact.custom_fields?.location as string);

  // Get email verification status from enrichment data
  const emailVerified = enrichmentData?.emailVerified ?? false;
  const emailConfidence = enrichmentData?.emailConfidence;

  // MoltSets deliverability grade — the fallback signal when no live SMTP
  // verification has run yet
  const flatEnrichment = (contact.enrichment_data as Record<string, unknown> | null) || {};
  const emailRiskGrade =
    typeof flatEnrichment.business_email_risk_score === "string"
      ? flatEnrichment.business_email_risk_score.trim().toUpperCase()
      : undefined;
  const emailValidatedAt =
    typeof flatEnrichment.business_email_validated_at === "string"
      ? flatEnrichment.business_email_validated_at
      : undefined;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          Contact
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Owner */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserCheck className="h-4 w-4 text-violet-500" />
            <span>Owner</span>
          </div>
          <AccountOwnerPicker
            value={(contact as any).owner_user_id ?? null}
            onChange={(userId) =>
              updateOwner.mutate({ contactId: contact.id, userId })
            }
          />
        </div>
        {contact.primary_email && (
          <div className="flex items-center justify-between">
            <a
              href={`mailto:${contact.primary_email}`}
              className="flex items-center gap-2 text-sm hover:text-primary transition-colors"
            >
              <Mail className="h-4 w-4 text-blue-500" />
              <span>{contact.primary_email}</span>
            </a>
            {contact.email_verification_status ? (
              <EmailStatusBadge
                status={contact.email_verification_status}
                catchAll={contact.email_is_catch_all}
              />
            ) : (emailVerified || emailConfidence) ? (
              <EmailVerificationBadge verified={emailVerified} confidence={emailConfidence} />
            ) : emailRiskGrade ? (
              <EmailRiskBadge grade={emailRiskGrade} validatedAt={emailValidatedAt} />
            ) : null}
          </div>
        )}
        {contact.primary_phone && (
          <a
            href={`tel:${contact.primary_phone}`}
            className="flex items-center gap-2 text-sm hover:text-primary transition-colors"
          >
            <Phone className="h-4 w-4 text-green-500" />
            <span>{contact.primary_phone}</span>
          </a>
        )}
        <div className="flex items-center gap-2 text-sm">
          {instagramHandle ? (
            <a
              href={`https://www.instagram.com/${instagramHandle}/`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open on Instagram"
              className="hover:text-primary transition-colors"
            >
              <Instagram className="h-4 w-4 text-pink-500" />
            </a>
          ) : (
            <Instagram className="h-4 w-4 text-pink-500" />
          )}
          <EditableTextCell
            value={contact.instagram_url}
            onSave={async (value) => {
              await updateContact.mutateAsync({ id: contact.id, instagram_url: value || null });
            }}
            placeholder="Add Instagram"
          />
        </div>
        {location && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 text-red-500" />
            <span>{location}</span>
          </div>
        )}
        {contact.company_website && (
          <a
            href={contact.company_website.startsWith('http') ? contact.company_website : `https://${contact.company_website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm hover:text-primary transition-colors"
          >
            <Globe className="h-4 w-4 text-primary" />
            <span>{contact.company_website.replace(/^https?:\/\//, '')}</span>
          </a>
        )}
      </CardContent>
    </Card>
  );
}

// Email verification badge component
function EmailVerificationBadge({ verified, confidence }: { verified?: boolean; confidence?: number }) {
  if (verified && confidence && confidence >= 90) {
    return (
      <Badge variant="outline" className="text-xs py-0 px-1.5 bg-green-50 text-green-700 border-green-200">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Verified
      </Badge>
    );
  }
  if (confidence && confidence >= 70) {
    return (
      <Badge variant="outline" className="text-xs py-0 px-1.5 bg-yellow-50 text-yellow-700 border-yellow-200">
        {confidence}%
      </Badge>
    );
  }
  if (confidence) {
    return (
      <Badge variant="outline" className="text-xs py-0 px-1.5 bg-cta/10 text-cta border-cta/30">
        {confidence}%
      </Badge>
    );
  }
  return null;
}

// MoltSets send-safety grade: A validated deliverable, B known engagement,
// C catch-all server, D hard invalid/bounce/trap, F no signal either way.
const EMAIL_RISK_CONFIG: Record<string, { label: string; className: string; ok: boolean }> = {
  A: { label: "Validated", className: "bg-green-50 text-green-700 border-green-200", ok: true },
  B: { label: "Engaged", className: "bg-green-50 text-green-700 border-green-200", ok: true },
  C: { label: "Catch-all · risky", className: "bg-amber-50 text-amber-700 border-amber-200", ok: false },
  D: { label: "Invalid", className: "bg-red-50 text-red-700 border-red-200", ok: false },
  F: { label: "Unverified", className: "bg-muted text-muted-foreground border-border", ok: false },
};

function EmailRiskBadge({ grade, validatedAt }: { grade: string; validatedAt?: string }) {
  const cfg = EMAIL_RISK_CONFIG[grade];
  if (!cfg) return null;
  const Icon = cfg.ok ? CheckCircle2 : AlertCircle;
  const validated = formatMaybeDate(validatedAt);
  return (
    <Badge
      variant="outline"
      className={cn("text-xs py-0 px-1.5", cfg.className)}
      title={`Provider deliverability grade ${grade}${validated ? ` · validated ${validated}` : ""}`}
    >
      <Icon className="h-3 w-3 mr-1" />
      {cfg.label} · {grade}
    </Badge>
  );
}

// Live email verification result (from the verifier / verifyEmail sequence step).
// Takes priority over the enrichment "verified" flag, which can be a stale
// import-time value — a contact may read "Verified" from Apollo yet come back
// risky/invalid on a real SMTP check.
const EMAIL_STATUS_CONFIG: Record<string, { label: string; className: string; tone: "ok" | "risky" | "bad" }> = {
  valid:      { label: "Valid",                className: "bg-green-50 text-green-700 border-green-200", tone: "ok" },
  catch_all:  { label: "Catch-all · risky",    className: "bg-amber-50 text-amber-700 border-amber-200", tone: "risky" },
  unknown:    { label: "Unverifiable · risky", className: "bg-amber-50 text-amber-700 border-amber-200", tone: "risky" },
  risky:      { label: "Risky",                className: "bg-amber-50 text-amber-700 border-amber-200", tone: "risky" },
  role:       { label: "Role address · risky", className: "bg-amber-50 text-amber-700 border-amber-200", tone: "risky" },
  role_only:  { label: "Role address · risky", className: "bg-amber-50 text-amber-700 border-amber-200", tone: "risky" },
  invalid:    { label: "Invalid",              className: "bg-red-50 text-red-700 border-red-200", tone: "bad" },
  disposable: { label: "Disposable",           className: "bg-red-50 text-red-700 border-red-200", tone: "bad" },
  spamtrap:   { label: "Spam-trap",            className: "bg-red-50 text-red-700 border-red-200", tone: "bad" },
};

function EmailStatusBadge({ status, catchAll }: { status?: string | null; catchAll?: boolean | null }) {
  if (!status) return null;
  const cfg = EMAIL_STATUS_CONFIG[status.toLowerCase()] ?? {
    label: status,
    className: "bg-muted text-muted-foreground border-border",
    tone: "risky" as const,
  };
  const Icon = cfg.tone === "ok" ? CheckCircle2 : AlertCircle;
  return (
    <Badge
      variant="outline"
      className={cn("text-xs py-0 px-1.5", cfg.className)}
      title={`Live email verification: ${status}${catchAll ? " (catch-all domain)" : ""}`}
    >
      <Icon className="h-3 w-3 mr-1" />
      {cfg.label}
    </Badge>
  );
}

// ============================================================================
// Company Info Card
// ============================================================================

/** "mortgage_bankers_loan_correspondents" → "Mortgage Bankers Loan Correspondents" */
const formatSnakeCase = (value: string) =>
  value
    .replace(/_+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Semicolon- or comma-separated provider lists → deduped array */
const splitProviderList = (value?: string | null) =>
  Array.from(
    new Set(
      (value || "")
        .split(/[;,]/)
        .map((part) => part.trim())
        .filter(Boolean)
    )
  );

/**
 * Providers hand us money as a bare number ("1500000000"), a short form
 * ("1.4B"), or already formatted. Normalise all three to "$1.5B".
 */
const formatMoney = (value?: string) => {
  if (!value) return undefined;
  const raw = value.trim();
  if (/^\$/.test(raw)) return raw;
  const numeric = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isFinite(numeric) || numeric === 0) {
    // "1.4B", "10.7M" and friends — just prefix the currency
    return /^[\d.]+\s*[KMBT]$/i.test(raw) ? `$${raw.toUpperCase()}` : raw;
  }
  const units: Array<[number, string]> = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (Math.abs(numeric) >= size) {
      return `$${Number((numeric / size).toFixed(1))}${suffix}`;
    }
  }
  return `$${numeric.toLocaleString()}`;
};

/** ISO dates/timestamps ("2026-07-21", "2026-05-27T09:12:00Z") → "27 May 2026"; anything else unchanged */
const formatMaybeDate = (value?: string) => {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

/**
 * Every company-level fact we store on `crm_contacts.enrichment_data`, in
 * display order. Providers disagree on key names for the same fact, so each
 * row lists its aliases (first non-empty wins). Add new provider keys here —
 * anything not listed still shows up under "Other enrichment data".
 */
const FIRMOGRAPHIC_FIELDS: Array<{
  label: string;
  keys: string[];
  format?: (value: string) => string;
  href?: (value: string) => string;
}> = [
  { label: "Employees", keys: ["employees_range", "estimated_company_size", "employee_count", "employees"] },
  { label: "Annual revenue", keys: ["annual_revenue", "company_annual_revenue"], format: formatMoney },
  { label: "Revenue model", keys: ["revenue_model"], format: formatSnakeCase },
  { label: "Total funding", keys: ["total_funding", "company_total_funding", "funding_amount"], format: formatMoney },
  { label: "Latest round", keys: ["latest_funding_round", "latest_funding"] },
  { label: "Round size", keys: ["latest_funding_amount"], format: formatMoney },
  { label: "Last raised", keys: ["last_raised_at"] },
  { label: "Founded", keys: ["company_founded_year"] },
  { label: "Locations", keys: ["retail_locations"] },
  { label: "Subsidiary of", keys: ["subsidiary_of"] },
  { label: "Phone", keys: ["company_phone", "corporate_phone"], href: (v) => `tel:${v}` },
  {
    // Providers send both a bare domain and a full URL for the same company —
    // one merged row, shown as the bare domain, linking to the full URL.
    label: "Website",
    keys: ["company_website", "website", "company_domain"],
    format: (v) => v.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
    href: (v) => (/^https?:/.test(v) ? v : `https://${v}`),
  },
  { label: "Category", keys: ["verified_category"], format: formatSnakeCase },
  { label: "Address", keys: ["company_address"] },
  { label: "SIC", keys: ["sic_code", "p_sic"] },
];

/**
 * Keys rendered by CompanyInfoCard's dedicated blocks or by other cards on this
 * page — excluded from the "Other enrichment data" catch-all so we don't show
 * the same fact twice.
 */
const ENRICHMENT_KEYS_SHOWN_ELSEWHERE = new Set<string>([
  // Firmographic blocks below
  ...FIRMOGRAPHIC_FIELDS.flatMap((f) => f.keys),
  "industry", "p_industry", "keywords", "technologies", "company_technologies",
  "company_city", "company_state", "company_country",
  "company_linkedin_url", "company_linkedin", "facebook_url", "twitter_url",
  "company_tagline", "company_description", "company",
  "seniority", "seniority_level", "department", "departments", "functional_level",
  // CompanyAnalysisCard
  "company_niche", "company_offering", "company_target", "company_verbiage",
  "company_priorities", "company_tone", "primary_need", "primary_need_reasoning",
  "primary_need_evidence", "primary_need_confidence", "cold_email_angle",
  "selected_outcome", "is_b2b", "has_outbound_motion", "outbound_signals",
  "sales_tools_detected", "hiring_sales_roles", "sales_roles_open",
  "icp_score", "icp_score_reasoning", "icp_score_basis", "analysis_scope",
  "product_fit_score", "product_fit_reasoning", "need_evidence_score", "need_evidence_reasoning",
  "outbound_maturity", "outbound_maturity_reasoning", "personalization_evidence_score", "personalization_evidence_reasoning",
  "growth_signals", "recent_linkedin_posts", "linkedin_topics", "best_post_hook",
  "custom_analysis", "detected_technologies", "analyzed_at",
  "decision_maker_score", "decision_maker_reasoning",
  // Contact-level, shown in the contact/email cards
  "emailConfidence", "emailVerified", "lastEnrichedAt", "socialProfiles",
  "email_status", "email_catchall_status", "email_last_verified", "email_source",
  "email_open", "email_bounced", "email_sent", "personal_email", "tertiary_email",
  "mobile_number", "mobile_phone", "replied", "demoed", "stage", "lists",
  "apollo_contact_id", "apollo_account_id", "restored_from_product_scores",
  // MoltSets — logo renders in the header, risk grades as email badges,
  // source/score/updated-at in the provenance footer, headline in ProfileCard
  "company_logo_url", "company_logo", "logo_url", "headline",
  "enrichment_source", "provider_last_updated_at", "moltsets_score",
  "business_email_risk_score", "business_email_validated_at",
  "personal_email_risk_score", "personal_email_validated_at",
  "mobile_phone_risk_score", "mobile_phone_validated_at",
]);

function CompanyInfoCard({ contact }: { contact: CrmContact }) {
  const [expanded, setExpanded] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const enrichmentData = contact.enrichment_data as EnrichmentData | null;
  const enrichedCompany = enrichmentData?.company;
  // Providers write firmographics flat on enrichment_data (employees,
  // employees_range, industry, sic_code, annual_revenue…) — only a minority use
  // the nested `company` object. Read both, nested first.
  const flatEnrichment = (contact.enrichment_data as Record<string, unknown> | null) || {};
  const flat = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = flatEnrichment[key];
      if (value != null && value !== "" && typeof value !== "object") return String(value);
    }
    return undefined;
  };
  const splitList = splitProviderList;

  // Merge enrichment data with custom fields (enrichment takes priority)
  const company = contact.company;
  const industries = (() => {
    const list = splitList(
      enrichedCompany?.industry ||
        flat("industry") ||
        (contact.custom_fields?.industry as string) ||
        ""
    );
    if (list.length) return list;
    const proxy = flat("p_industry");
    return proxy ? [formatSnakeCase(proxy)] : [];
  })();
  const industry = industries[0];

  // Every firmographic row we have a value for, resolved through the alias spec
  const firmographics = FIRMOGRAPHIC_FIELDS.map((field) => {
    const raw =
      // The legacy nested shape wins where it exists
      (field.label === "Employees" ? enrichedCompany?.size : undefined) ||
      (field.label === "Annual revenue" ? enrichedCompany?.revenue : undefined) ||
      flat(...field.keys) ||
      (field.label === "Employees"
        ? (contact.custom_fields?.employees as string | undefined)
        : undefined);
    if (!raw) return null;
    return {
      label: field.label,
      value: field.format ? field.format(String(raw)) : String(raw),
      href: field.href?.(String(raw)),
    };
  }).filter(Boolean) as Array<{
    label: string;
    value: string;
    href?: string;
  }>;

  const employees = firmographics.find((f) => f.label === "Employees")?.value;
  const companyLocation = [flat("company_city"), flat("company_state"), flat("company_country")]
    .filter(Boolean)
    .join(", ");
  const keywords = splitList(flat("keywords"));
  const companyLinkedIn = flat("company_linkedin_url", "company_linkedin");
  const companyTwitter = flat("twitter_url");
  const companyFacebook = flat("facebook_url");
  const annualBudget = contact.custom_fields?.annual_budget as string;
  const avgDealValue = contact.custom_fields?.avg_deal_value as string;
  const activeProjects = contact.custom_fields?.active_projects as number;
  const technologies = (() => {
    if (enrichedCompany?.technologies?.length) return enrichedCompany.technologies;
    const fromStrings = splitList(flat("technologies", "company_technologies"));
    if (fromStrings.length) return fromStrings;
    // The AI analyser stores a categorised object; `all` is the flat union
    const detected = flatEnrichment.detected_technologies as { all?: string[] } | undefined;
    return detected?.all || [];
  })();
  const seniority = enrichmentData?.seniority || flat("seniority_level");
  const department = enrichmentData?.department || flat("departments", "functional_level");
  const description =
    enrichedCompany?.description || flat("company_description", "company_tagline");
  const logoUrl = flat("company_logo_url", "company_logo", "logo_url");
  // Provider provenance — footer text, not data rows
  const enrichmentSource = flat("enrichment_source");
  const providerUpdatedAt = formatMaybeDate(flat("provider_last_updated_at"));
  const providerScore = flat("moltsets_score");

  // Anything a provider sent that no card on this page renders — surfaced so new
  // enrichment keys are never silently invisible.
  const otherEnrichment = Object.entries(flatEnrichment)
    .filter(
      ([key, value]) =>
        !ENRICHMENT_KEYS_SHOWN_ELSEWHERE.has(key) &&
        value != null &&
        value !== "" &&
        typeof value !== "object"
    )
    .map(([key, value]) => [key, String(value)] as const);

  // Format seniority/department
  const formatLabel = (str: string) => {
    return str
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  // One flat list of label/value rows — firmographics first, then the long tail.
  // A single list reads far better in a narrow sidebar than a grid of icon rows.
  const details: Array<{ label: string; value: string; href?: string; wrap?: boolean }> = [
    ...(companyLocation ? [{ label: "HQ", value: companyLocation }] : []),
    ...firmographics.map(({ label, value, href }) => ({
      label,
      value,
      href,
      // Free-text fields are long enough that truncating loses the useful half
      wrap: label === "Address",
    })),
    ...(industries.length > 1
      ? [{ label: "Industries", value: industries.slice(1).join(", "), wrap: true }]
      : []),
    ...(companyLinkedIn ? [{ label: "LinkedIn", value: "View profile", href: companyLinkedIn }] : []),
    ...(companyTwitter ? [{ label: "X", value: "View profile", href: companyTwitter }] : []),
    ...(companyFacebook ? [{ label: "Facebook", value: "View page", href: companyFacebook }] : []),
    ...(annualBudget ? [{ label: "Annual budget", value: annualBudget }] : []),
    ...(avgDealValue ? [{ label: "Avg deal value", value: avgDealValue }] : []),
    ...(activeProjects !== undefined
      ? [{ label: "Active projects", value: String(activeProjects) }]
      : []),
    ...otherEnrichment.map(([key, value]) => ({
      label: formatSnakeCase(key),
      value: (/(_at|_date)$/.test(key) && formatMaybeDate(value)) || value,
    })),
  ];

  const PREVIEW_ROWS = 5;
  const previewDetails = expanded ? details : details.slice(0, PREVIEW_ROWS);
  const hiddenCount = details.length - previewDetails.length;

  const hasCompanyData = company || industry || employees;
  const hasRoleData = seniority || department;
  const tagGroups = [
    { label: "Tech", items: technologies },
    { label: "Keywords", items: keywords },
  ].filter((group) => group.items.length > 0);

  if (
    !hasCompanyData &&
    !hasRoleData &&
    details.length === 0 &&
    tagGroups.length === 0 &&
    !description &&
    !contact.linkedin_bio &&
    !contact.home_page_text
  )
    return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          Company
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Company header */}
        {company && (
          <div className="flex items-center gap-3">
            {logoUrl && !logoFailed ? (
              <img
                src={logoUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setLogoFailed(true)}
                className="h-9 w-9 rounded-lg border bg-background object-contain flex-shrink-0"
              />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-4 w-4 text-blue-600" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{company}</p>
              {(industry || employees) && (
                // Headcount first — it is short, so it survives the truncate
                <p className="text-xs text-muted-foreground truncate" title={industry}>
                  {employees && `${employees} employees`}
                  {industry && employees ? " · " : ""}
                  {industry}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Role badges */}
        {hasRoleData && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {seniority && (
              <Badge variant="secondary" className="text-xs">
                {formatLabel(seniority)}
              </Badge>
            )}
            {department && (
              <Badge variant="outline" className="text-xs">
                {formatLabel(department)}
              </Badge>
            )}
          </div>
        )}

        {/* Company description */}
        {description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>
        )}

        {/* LinkedIn bio */}
        {contact.linkedin_bio && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground font-medium mb-0.5">LinkedIn bio</p>
            <p className="text-xs text-muted-foreground line-clamp-3">{contact.linkedin_bio}</p>
          </div>
        )}

        {/* Home page text */}
        {contact.home_page_text && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground font-medium mb-0.5">Home page text</p>
            <p className="text-xs text-muted-foreground line-clamp-3">{contact.home_page_text}</p>
          </div>
        )}

        {/* Firmographics — quiet label/value list, long tail behind one toggle */}
        {details.length > 0 && (
          <div className="pt-2 border-t space-y-1.5">
            {previewDetails.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-muted-foreground shrink-0">{row.label}</span>
                {row.href ? (
                  <a
                    href={row.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium truncate text-right hover:text-primary hover:underline"
                    title={row.value}
                  >
                    {row.value}
                  </a>
                ) : (
                  <span
                    className={`font-medium text-right ${row.wrap ? "break-words" : "truncate"}`}
                    title={row.value}
                  >
                    {row.value}
                  </span>
                )}
              </div>
            ))}

            {/* Tag groups only once expanded — they are the noisiest part */}
            {expanded &&
              tagGroups.map((group) => (
                <div key={group.label} className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-muted-foreground shrink-0 pt-0.5">{group.label}</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {group.items.slice(0, 10).map((item, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="text-xs py-0 px-1.5 font-normal text-muted-foreground"
                      >
                        {item}
                      </Badge>
                    ))}
                    {group.items.length > 10 && (
                      <Badge variant="outline" className="text-xs py-0 px-1.5">
                        +{group.items.length - 10}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}

            {(hiddenCount > 0 || tagGroups.length > 0) && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground pt-0.5"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
                />
                {expanded ? "Show less" : `Show ${hiddenCount + tagGroups.length} more`}
              </button>
            )}
          </div>
        )}

        {/* Provider provenance — metadata, not company facts, so a quiet footer */}
        {enrichmentSource && (
          <p
            className="text-[11px] text-muted-foreground/70 pt-1"
            title={providerScore ? `Provider match score: ${providerScore}` : undefined}
          >
            Enriched via {formatSnakeCase(enrichmentSource)}
            {providerUpdatedAt ? ` · updated ${providerUpdatedAt}` : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Custom Fields Card (definition-driven, org-managed custom variables)
// ============================================================================

// Keys already displayed in CompanyInfoCard — exclude from generic list
const HARDCODED_CUSTOM_KEYS = new Set([
  "industry", "employees", "annual_budget", "avg_deal_value",
  "active_projects", "location", "experience",
]);

const formatCustomFieldKey = (key: string) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function CustomFieldRow({
  fieldKey,
  label,
  fieldType,
  value,
  placeholder,
  onSave,
}: {
  fieldKey: string;
  label: string;
  fieldType?: string;
  value: string;
  placeholder?: string | null;
  onSave: (fieldKey: string, value: string) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [isSaving, setIsSaving] = useState(false);

  const startEditing = () => {
    setDraft(value);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setDraft(value);
  };

  const save = async () => {
    setIsSaving(true);
    try {
      await onSave(fieldKey, draft);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const hasValue = value !== "";
  // Dates store as raw ISO — render through the same formatter the firmographics
  // list uses so a stored "2026-06-01" doesn't look worse than the card next to it.
  const displayValue = fieldType === "date" ? formatMaybeDate(value) ?? value : value;

  return (
    <div className="group rounded-md -mx-2 px-2 py-1.5 hover:bg-muted/40 transition-colors">
      <span className="block text-xs text-muted-foreground mb-0.5">{label}</span>
      {isEditing ? (
        <div className="flex items-center gap-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            type={fieldType === "number" ? "number" : fieldType === "date" ? "date" : "text"}
            className="h-8 text-sm flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancelEditing();
            }}
          />
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={save} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={cancelEditing} disabled={isSaving}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className="flex items-center gap-1.5 w-full text-left text-sm font-medium hover:underline decoration-dotted"
        >
          {hasValue ? (
            <span className="truncate">{displayValue}</span>
          ) : placeholder ? (
            <span className="text-muted-foreground italic font-normal truncate">{placeholder} (default)</span>
          ) : (
            <span className="text-muted-foreground font-normal">—</span>
          )}
          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 shrink-0 ml-auto" />
        </button>
      )}
    </div>
  );
}

interface CustomFieldRowData {
  key: string;
  label: string;
  fieldType?: string;
  value: string;
  placeholder?: string | null;
}

function CustomFieldsCard({ contact }: { contact: CrmContact }) {
  const { data: fieldDefs } = useCustomFieldDefs();
  const updateContact = useUpdateContact();
  const [showEmpty, setShowEmpty] = useState(false);
  const customFields = (contact.custom_fields as Record<string, unknown> | null) || {};

  const definedKeys = new Set((fieldDefs || []).map((f) => f.field_key));
  const orphanEntries = Object.entries(customFields).filter(
    ([key, value]) =>
      value != null &&
      value !== "" &&
      !HARDCODED_CUSTOM_KEYS.has(key) &&
      !CUSTOM_FIELD_SYSTEM_KEYS.has(key) &&
      !definedKeys.has(key)
  );

  if ((!fieldDefs || fieldDefs.length === 0) && orphanEntries.length === 0) return null;

  const defRows: CustomFieldRowData[] = (fieldDefs || [])
    .filter((def) => !HARDCODED_CUSTOM_KEYS.has(def.field_key))
    .map((def) => ({
      key: def.field_key,
      label: def.display_name,
      fieldType: def.field_type,
      value: customFields[def.field_key] != null ? String(customFields[def.field_key]) : "",
      placeholder: def.default_value,
    }));
  const orphanRows: CustomFieldRowData[] = orphanEntries.map(([key, value]) => ({
    key,
    label: formatCustomFieldKey(key),
    value: String(value),
  }));

  // Filled fields (and fields with a default to show) up front; fields with
  // nothing to show at all collapse behind a toggle instead of rendering a
  // wall of "—" — the reason custom fields were unreadable before.
  const allRows = [...defRows, ...orphanRows];
  const visibleRows = allRows.filter((r) => r.value !== "" || r.placeholder);
  const emptyRows = allRows.filter((r) => r.value === "" && !r.placeholder);
  const filledCount = allRows.filter((r) => r.value !== "").length;

  const handleSave = async (fieldKey: string, value: string) => {
    await updateContact.mutateAsync({
      id: contact.id,
      // Merge onto the current custom_fields — the update mutation replaces the
      // whole JSONB column, so writing only the changed key would wipe every
      // other custom field (including ones set via CSV import).
      custom_fields: { ...customFields, [fieldKey]: value },
    });
  };

  const renderRow = (row: CustomFieldRowData) => (
    <CustomFieldRow
      key={row.key}
      fieldKey={row.key}
      label={row.label}
      fieldType={row.fieldType}
      value={row.value}
      placeholder={row.placeholder}
      onSave={handleSave}
    />
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          Custom Fields
          <Badge variant="outline" className="ml-1 text-xs font-normal text-muted-foreground">
            {filledCount} of {allRows.length} filled
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {visibleRows.map(renderRow)}
          {showEmpty && emptyRows.map(renderRow)}
        </div>
        {emptyRows.length > 0 && (
          <button
            type="button"
            onClick={() => setShowEmpty((prev) => !prev)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showEmpty ? "" : "-rotate-90"}`} />
            {showEmpty ? "Hide empty fields" : `Show ${emptyRows.length} empty field${emptyRows.length === 1 ? "" : "s"}`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Company Analysis Card (from enrichment_data)
// ============================================================================

interface CompanyAnalysisData {
  company_niche?: string;
  company_offering?: string;
  company_target?: string;
  company_verbiage?: string[];
  company_priorities?: string[];  // What they're focused on/investing in

  // THE KEY INSIGHT - a hedged hypothesis, not an asserted fact
  primary_need?: string;          // What do they need more of?
  primary_need_reasoning?: string; // Why we think they need this
  primary_need_evidence?: string; // The concrete fact this hypothesis is grounded in
  primary_need_confidence?: 'low' | 'medium' | 'high'; // How directly the evidence supports it
  cold_email_angle?: string;      // Instruction for the email writer: what's safe to ask, what not to imply
  selected_outcome?: string;       // Which outcome was selected (when multiple options provided)

  // ICP QUALIFICATION FIELDS
  is_b2b?: boolean;
  revenue_model?: 'SaaS' | 'Services' | 'Product' | 'Marketplace' | 'Hybrid' | 'Unknown';
  has_outbound_motion?: boolean;
  outbound_signals?: string[];
  sales_tools_detected?: string[];
  hiring_sales_roles?: boolean;
  sales_roles_open?: string[];
  estimated_company_size?: 'Small (1-50)' | 'Mid-Market (51-500)' | 'Enterprise (500+)' | 'Unknown';
  icp_score?: number;
  icp_score_reasoning?: string;

  // Supplementary breakdown of icp_score - informational only, icp_score itself
  // is unchanged and still the number filters/automation read.
  product_fit_score?: number;
  product_fit_reasoning?: string;
  need_evidence_score?: number;
  need_evidence_reasoning?: string;
  outbound_maturity?: 'unknown' | 'low' | 'medium' | 'high';
  outbound_maturity_reasoning?: string;
  personalization_evidence_score?: number;
  personalization_evidence_reasoning?: string;

  // Supporting context
  growth_signals?: {
    signal: string;
    evidence: string;
    interpretation: string;
    confidence: 'low' | 'medium' | 'high';
    email_usability: 'strong' | 'medium' | 'dont_use';
    safe_use: string;
  }[];
  latest_funding_round?: string;
  funding_amount?: string;
  recent_linkedin_posts?: Array<{
    text: string;
    date: string;
    engagement: number;
  }>;
  linkedin_topics?: string[];
  best_post_hook?: string;
  custom_analysis?: Array<{ question: string; answer: string; score?: number | null }>;
  detected_technologies?: {
    advertising: string[];
    analytics: string[];
    marketing: string[];
    cms: string[];
    ecommerce: string[];
    chat: string[];
    total: number;
    runs_paid_ads: boolean;
  };
  analyzed_at?: string;
}

function CompanyAnalysisCard({ contact }: { contact: CrmContact }) {
  const enrichmentData = contact.enrichment_data as CompanyAnalysisData | null;
  const { data: productScores } = useContactProductScores(contact.id);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    icp: true,
    overview: false,
    insights: false,
    linkedin: false,
  });
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);

  // Edit state
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const updateContact = useUpdateContact();

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const startEditing = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  };

  const cancelEditing = () => {
    setEditingField(null);
    setEditValue('');
  };

  const saveEdit = async (field: string) => {
    if (!enrichmentData) return;

    setIsSaving(true);
    try {
      const updatedEnrichmentData = {
        ...enrichmentData,
        [field]: editValue,
      };

      await updateContact.mutateAsync({
        id: contact.id,
        enrichment_data: updatedEnrichmentData,
      });

      setEditingField(null);
      setEditValue('');
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Check if we have any analysis data
  const hasAnalysisData = enrichmentData && (
    enrichmentData.company_niche ||
    enrichmentData.company_offering ||
    enrichmentData.primary_need ||
    enrichmentData.custom_analysis?.length ||
    (enrichmentData.detected_technologies?.total ?? 0) > 0 ||
    enrichmentData.recent_linkedin_posts?.length
  );

  if (!hasAnalysisData) return null;

  const hasOverviewData = enrichmentData.company_niche || enrichmentData.company_offering || enrichmentData.company_target;
  const hasPrimaryNeed = !!enrichmentData.primary_need;
  const hasIcpData = enrichmentData.icp_score !== undefined || enrichmentData.is_b2b !== undefined;
  const hasInsightsData = (enrichmentData.company_priorities?.length ?? 0) > 0 ||
                          (enrichmentData.growth_signals?.length ?? 0) > 0 ||
                          enrichmentData.latest_funding_round;
  const hasLinkedInData = (enrichmentData.recent_linkedin_posts?.length ?? 0) > 0;

  return (
    <Card className="overflow-hidden">
      {/* Header with gradient accent */}
      <div className="px-4 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold text-sm">AI Company Analysis</h3>
              {enrichmentData.analyzed_at && (
                <p className="text-xs text-muted-foreground">
                  Updated {formatDistanceToNow(new Date(enrichmentData.analyzed_at), { addSuffix: true })}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setRegenerateDialogOpen(true)}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Regenerate
          </Button>
        </div>
      </div>

      {/* Regenerate Dialog */}
      <RegenerateAnalysisDialog
        contact={{
          id: contact.id,
          display_name: contact.display_name,
          company_website: contact.company_website,
          primary_linkedin_url: contact.primary_linkedin_url,
        }}
        open={regenerateDialogOpen}
        onOpenChange={setRegenerateDialogOpen}
      />

      <div className="divide-y">
        {/* ACTIONABLE SECTION 1: Primary Need - THE KEY INSIGHT */}
        {hasPrimaryNeed && (
          <div className="px-4 py-3 group/primary">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-medium text-primary uppercase tracking-wide">
                  Primary Need
                </p>
                {enrichmentData.selected_outcome && (
                  <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                    {enrichmentData.selected_outcome}
                  </Badge>
                )}
              </div>
              {editingField !== 'primary_need' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover/primary:opacity-100 transition-opacity"
                  onClick={() => startEditing('primary_need', enrichmentData.primary_need || '')}
                >
                  <Pencil className="h-3 w-3 text-primary" />
                </Button>
              )}
            </div>
            {editingField === 'primary_need' ? (
              <div className="space-y-2">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="text-sm bg-white/80 border-primary/20 focus:border-primary/40 min-h-[60px]"
                  placeholder="What they need more of..."
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 px-2 bg-primary hover:bg-primary/90"
                    onClick={() => saveEdit('primary_need')}
                    disabled={isSaving}
                  >
                    {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    <span className="ml-1 text-xs">Save</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={cancelEditing}
                    disabled={isSaving}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm font-medium text-foreground leading-snug">
                {enrichmentData.primary_need}
              </p>
            )}
            {editingField !== 'primary_need_reasoning' && enrichmentData.primary_need_reasoning && (
              <div className="group/reasoning mt-1.5 flex items-start gap-1">
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                  {enrichmentData.primary_need_reasoning}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover/reasoning:opacity-100 transition-opacity shrink-0"
                  onClick={() => startEditing('primary_need_reasoning', enrichmentData.primary_need_reasoning || '')}
                >
                  <Pencil className="h-2.5 w-2.5 text-primary" />
                </Button>
              </div>
            )}
            {editingField === 'primary_need_reasoning' && (
              <div className="space-y-2 mt-2">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="text-sm bg-white/80 border-primary/20 focus:border-primary/40 min-h-[80px]"
                  placeholder="Why they need this..."
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 px-2 bg-primary hover:bg-primary/90"
                    onClick={() => saveEdit('primary_need_reasoning')}
                    disabled={isSaving}
                  >
                    {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    <span className="ml-1 text-xs">Save</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={cancelEditing}
                    disabled={isSaving}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
            {(enrichmentData.primary_need_evidence || enrichmentData.primary_need_confidence || enrichmentData.cold_email_angle) && (
              <div className="mt-2 space-y-1 rounded-md border border-primary/15 bg-primary/5 px-2.5 py-2">
                {enrichmentData.primary_need_evidence && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground">Observed evidence: </span>
                    {enrichmentData.primary_need_evidence}
                  </p>
                )}
                {enrichmentData.primary_need_confidence && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">Confidence:</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] capitalize",
                        enrichmentData.primary_need_confidence === 'high' && "bg-green-500/10 text-green-700 border-green-500/20",
                        enrichmentData.primary_need_confidence === 'medium' && "bg-amber-500/10 text-amber-700 border-amber-500/20",
                        enrichmentData.primary_need_confidence === 'low' && "bg-muted text-muted-foreground border-border",
                      )}
                    >
                      {enrichmentData.primary_need_confidence}
                    </Badge>
                  </div>
                )}
                {enrichmentData.cold_email_angle && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground">Safe angle for the writer: </span>
                    {enrichmentData.cold_email_angle}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Custom Questions - user-defined questions answered during analysis */}
        {(enrichmentData.custom_analysis?.length ?? 0) > 0 && (
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2.5">
              <HelpCircle className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs font-medium text-primary uppercase tracking-wide">
                Custom Questions
              </p>
            </div>
            <div className="space-y-2">
              {enrichmentData.custom_analysis!.map((qa, idx) => {
                const answered = !!qa.answer?.trim();
                const hasScore = typeof qa.score === 'number';
                const scoreColor = !hasScore
                  ? ''
                  : qa.score! >= 70
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : qa.score! >= 40
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                      : 'bg-muted text-muted-foreground border-border';
                return (
                  <div key={idx} className="rounded-lg border bg-muted/30 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted-foreground leading-snug">
                        {qa.question}
                      </p>
                      {hasScore && (
                        <Badge variant="outline" className={`text-[10px] font-medium shrink-0 ${scoreColor}`}>
                          {qa.score}
                        </Badge>
                      )}
                    </div>
                    <p className={`text-sm leading-relaxed mt-1 ${answered ? 'font-medium text-foreground' : 'italic text-muted-foreground/70'}`}>
                      {answered ? qa.answer : 'No answer available'}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Technology & Ad Signals - detected from website HTML */}
        {(enrichmentData.detected_technologies?.total ?? 0) > 0 && (() => {
          const tech = enrichmentData.detected_technologies!;
          const groups: Array<{ label: string; items: string[] }> = [
            { label: 'Marketing / CRM', items: tech.marketing },
            { label: 'Platform / CMS', items: tech.cms },
            { label: 'Ecommerce', items: tech.ecommerce },
            { label: 'Analytics', items: tech.analytics },
            { label: 'Chat', items: tech.chat },
          ].filter(g => g.items?.length);
          return (
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <Wrench className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-medium text-primary uppercase tracking-wide">
                  Technology &amp; Ad Signals
                </p>
              </div>

              {/* Paid-ads verdict — the headline buying signal */}
              {tech.runs_paid_ads ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 mb-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Megaphone className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Runs paid ads</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tech.advertising.map((name) => (
                      <Badge
                        key={name}
                        className="text-[10px] font-medium bg-emerald-600 hover:bg-emerald-600 text-white border-transparent"
                      >
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground">
                  <Megaphone className="h-3.5 w-3.5 opacity-40 shrink-0" />
                  No advertising pixels detected on their site
                </div>
              )}

              {/* Tech stack */}
              {groups.length > 0 && (
                <div className="space-y-2">
                  {groups.map((g) => (
                    <div key={g.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide w-24 shrink-0">
                        {g.label}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {g.items.map((name) => (
                          <Badge key={name} variant="secondary" className="text-[10px] font-normal">
                            {name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* ACTIONABLE SECTION 2: LinkedIn Conversation Starter */}
        {enrichmentData.best_post_hook && (
          <div className="px-4 py-3 group/hook">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5">
                <Quote className="h-3.5 w-3.5 text-cta" />
                <p className="text-xs font-medium text-cta uppercase tracking-wide">
                  Conversation Starter
                </p>
              </div>
              {editingField !== 'best_post_hook' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover/hook:opacity-100 transition-opacity"
                  onClick={() => startEditing('best_post_hook', enrichmentData.best_post_hook || '')}
                >
                  <Pencil className="h-3 w-3 text-cta" />
                </Button>
              )}
            </div>
            {editingField === 'best_post_hook' ? (
              <div className="space-y-2">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="text-sm bg-white/80 border-cta/30 focus:border-cta min-h-[60px]"
                  placeholder="Conversation starter..."
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="cta"
                    className="h-7 px-2"
                    onClick={() => saveEdit('best_post_hook')}
                    disabled={isSaving}
                  >
                    {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    <span className="ml-1 text-xs">Save</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={cancelEditing}
                    disabled={isSaving}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed italic">
                "{enrichmentData.best_post_hook}"
              </p>
            )}
          </div>
        )}

        {/* ICP QUALIFICATION SECTION */}
        {hasIcpData && (
          <AnalysisSection
            title="ICP Qualification"
            icon={<Gauge className="h-4 w-4" />}
            expanded={expandedSections.icp}
            onToggle={() => toggleSection('icp')}
          >
            <div className="space-y-4">
              {/* ICP Score Badge */}
              {enrichmentData.icp_score !== undefined && (
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "h-14 w-14 rounded-xl flex items-center justify-center text-white font-bold text-lg",
                    enrichmentData.icp_score >= 80 ? "bg-gradient-to-br from-green-500 to-emerald-600" :
                    enrichmentData.icp_score >= 60 ? "bg-gradient-to-br from-blue-500 to-cyan-600" :
                    enrichmentData.icp_score >= 40 ? "bg-gradient-to-br from-amber-500 to-orange-600" :
                    "bg-gradient-to-br from-red-500 to-rose-600"
                  )}>
                    {enrichmentData.icp_score}
                  </div>
                  <div className="flex-1">
                    <p className={cn(
                      "text-sm font-semibold",
                      enrichmentData.icp_score >= 80 ? "text-green-700" :
                      enrichmentData.icp_score >= 60 ? "text-blue-700" :
                      enrichmentData.icp_score >= 40 ? "text-amber-700" :
                      "text-red-700"
                    )}>
                      {enrichmentData.icp_score >= 80 ? "Perfect Fit" :
                       enrichmentData.icp_score >= 60 ? "Good Fit" :
                       enrichmentData.icp_score >= 40 ? "Moderate Fit" :
                       enrichmentData.icp_score >= 20 ? "Poor Fit" : "Not a Fit"}
                    </p>
                    {enrichmentData.icp_score_reasoning && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {enrichmentData.icp_score_reasoning}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ICP Score Breakdown - supplementary to icp_score above, not a replacement.
                  icp_score itself is what filtering/auto-enroll read; these four exist so a
                  "great fit, no evidence of need" company doesn't look identical to a
                  "so-so fit, strong buying signal" one. */}
              {(enrichmentData.product_fit_score !== undefined || enrichmentData.need_evidence_score !== undefined ||
                enrichmentData.outbound_maturity || enrichmentData.personalization_evidence_score !== undefined) && (
                <div className="grid grid-cols-2 gap-2">
                  {enrichmentData.product_fit_score !== undefined && (
                    <div
                      className="rounded-lg border bg-slate-50 p-2"
                      title={enrichmentData.product_fit_reasoning || undefined}
                    >
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Product Fit</p>
                      <p className="text-sm font-semibold text-foreground">{enrichmentData.product_fit_score}/100</p>
                    </div>
                  )}
                  {enrichmentData.need_evidence_score !== undefined && (
                    <div
                      className="rounded-lg border bg-slate-50 p-2"
                      title={enrichmentData.need_evidence_reasoning || undefined}
                    >
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Need Evidence</p>
                      <p className="text-sm font-semibold text-foreground">{enrichmentData.need_evidence_score}/100</p>
                    </div>
                  )}
                  {enrichmentData.outbound_maturity && (
                    <div
                      className="rounded-lg border bg-slate-50 p-2"
                      title={enrichmentData.outbound_maturity_reasoning || undefined}
                    >
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Outbound Maturity</p>
                      <p className="text-sm font-semibold capitalize text-foreground">{enrichmentData.outbound_maturity}</p>
                    </div>
                  )}
                  {enrichmentData.personalization_evidence_score !== undefined && (
                    <div
                      className="rounded-lg border bg-slate-50 p-2"
                      title={enrichmentData.personalization_evidence_reasoning || undefined}
                    >
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Personalization Evidence</p>
                      <p className="text-sm font-semibold text-foreground">{enrichmentData.personalization_evidence_score}/100</p>
                    </div>
                  )}
                </div>
              )}

              {/* Per-Product ICP Scores */}
              {productScores && productScores.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Scores by Product</p>
                  <div className="space-y-2">
                    {productScores.map((score) => (
                      <div key={score.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border">
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className={cn(
                            "h-10 w-10 rounded-lg flex items-center justify-center text-white font-bold text-sm",
                            (score.icp_score ?? 0) >= 80 ? "bg-gradient-to-br from-green-500 to-emerald-600" :
                            (score.icp_score ?? 0) >= 60 ? "bg-gradient-to-br from-blue-500 to-cyan-600" :
                            (score.icp_score ?? 0) >= 40 ? "bg-gradient-to-br from-amber-500 to-orange-600" :
                            "bg-gradient-to-br from-red-500 to-rose-600"
                          )}>
                            {score.icp_score ?? "–"}
                          </div>
                          {score.decision_maker_score != null && (
                            <div className="relative group">
                              <div className={cn(
                                "h-8 w-8 rounded-md flex items-center justify-center text-white font-bold text-xs ring-2 ring-background",
                                score.decision_maker_score >= 80 ? "bg-gradient-to-br from-violet-500 to-purple-600" :
                                score.decision_maker_score >= 60 ? "bg-gradient-to-br from-blue-500 to-indigo-600" :
                                score.decision_maker_score >= 40 ? "bg-gradient-to-br from-amber-500 to-orange-600" :
                                "bg-gradient-to-br from-red-500 to-rose-600"
                              )}>
                                {score.decision_maker_score}
                              </div>
                              {score.decision_maker_reasoning && (
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-popover border rounded-lg shadow-lg text-xs text-popover-foreground w-64 hidden group-hover:block z-50">
                                  <p className="font-medium mb-1">Decision-Maker Fit{score.decision_maker_source === 'rule' ? ' (Estimated)' : ' (AI-verified)'}</p>
                                  <p className="text-muted-foreground">{score.decision_maker_reasoning}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{score.product_name || "Unknown Product"}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {score.decision_maker_score != null && (
                              <span className="text-[10px] font-medium text-violet-600 uppercase tracking-wide">DM {score.decision_maker_score}</span>
                            )}
                            {score.primary_need && (
                              <p className="text-xs text-muted-foreground truncate">{score.primary_need}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Qualification Details Grid */}
              <div className="flex flex-wrap gap-2">
                {enrichmentData.is_b2b !== undefined && (
                  <div className="px-3 py-2 rounded-lg bg-slate-50 border">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Business Type</p>
                    <p className="text-sm font-medium mt-0.5">
                      {enrichmentData.is_b2b ? (
                        <span className="text-green-700">B2B</span>
                      ) : (
                        <span className="text-amber-700">B2C</span>
                      )}
                    </p>
                  </div>
                )}

                {enrichmentData.revenue_model && (
                  <div className="px-3 py-2 rounded-lg bg-slate-50 border">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Revenue Model</p>
                    <p className="text-sm font-medium mt-0.5">{enrichmentData.revenue_model}</p>
                  </div>
                )}

                {enrichmentData.estimated_company_size && (
                  <div className="px-3 py-2 rounded-lg bg-slate-50 border">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Company Size</p>
                    <p className="text-sm font-medium mt-0.5">{enrichmentData.estimated_company_size}</p>
                  </div>
                )}

                {enrichmentData.has_outbound_motion !== undefined && (
                  <div className="px-3 py-2 rounded-lg bg-slate-50 border">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Outbound Motion</p>
                    <p className="text-sm font-medium mt-0.5">
                      {enrichmentData.has_outbound_motion ? (
                        <span className="text-green-700">Yes</span>
                      ) : (
                        <span className="text-slate-500">No evidence</span>
                      )}
                    </p>
                  </div>
                )}

                {enrichmentData.hiring_sales_roles !== undefined && (
                  <div className="px-3 py-2 rounded-lg bg-slate-50 border">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Hiring Sales</p>
                    <p className="text-sm font-medium mt-0.5">
                      {enrichmentData.hiring_sales_roles ? (
                        <span className="text-green-700">Yes</span>
                      ) : (
                        <span className="text-slate-500">No</span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              {/* Outbound Signals */}
              {enrichmentData.outbound_signals && enrichmentData.outbound_signals.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp className="h-3.5 w-3.5 text-blue-500" />
                    <p className="text-xs font-medium">Outbound Signals</p>
                  </div>
                  <div className="space-y-1">
                    {enrichmentData.outbound_signals.map((signal, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span>{signal}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sales Tools Detected */}
              {enrichmentData.sales_tools_detected && enrichmentData.sales_tools_detected.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Wrench className="h-3.5 w-3.5 text-primary" />
                    <p className="text-xs font-medium">Sales Tools Detected</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {enrichmentData.sales_tools_detected.map((tool, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Hiring Sales Roles */}
              {enrichmentData.hiring_sales_roles && enrichmentData.sales_roles_open && enrichmentData.sales_roles_open.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <UserPlus className="h-3.5 w-3.5 text-green-500" />
                    <p className="text-xs font-medium">Hiring Sales Roles</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {enrichmentData.sales_roles_open.map((role, idx) => (
                      <Badge key={idx} className="text-xs bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
                        {role}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </AnalysisSection>
        )}

        {/* CONTEXT SECTION: Company Overview (collapsed by default) */}
        {hasOverviewData && (
          <AnalysisSection
            title="Company Overview"
            icon={<Building2 className="h-4 w-4" />}
            expanded={expandedSections.overview}
            onToggle={() => toggleSection('overview')}
            defaultCollapsed
          >
            <div className="grid gap-3">
              {enrichmentData.company_niche && (
                <AnalysisItem
                  label="Niche"
                  value={enrichmentData.company_niche}
                  color="blue"
                />
              )}
              {enrichmentData.company_offering && (
                <AnalysisItem
                  label="What They Sell"
                  value={enrichmentData.company_offering}
                  color="green"
                />
              )}
              {enrichmentData.company_target && (
                <AnalysisItem
                  label="Target Market"
                  value={enrichmentData.company_target}
                  color="amber"
                />
              )}
              {enrichmentData.company_verbiage && enrichmentData.company_verbiage.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Their Language & Keywords</p>
                  <div className="flex flex-wrap gap-1.5">
                    {enrichmentData.company_verbiage.slice(0, 8).map((term, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs font-normal">
                        {term}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </AnalysisSection>
        )}

        {/* CONTEXT SECTION: Business Insights (collapsed by default) */}
        {hasInsightsData && (
          <AnalysisSection
            title="Business Insights"
            icon={<TrendingUp className="h-4 w-4" />}
            expanded={expandedSections.insights}
            onToggle={() => toggleSection('insights')}
            defaultCollapsed
          >
            <div className="space-y-5">
              {/* Priorities */}
              {enrichmentData.company_priorities && enrichmentData.company_priorities.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Target className="h-3.5 w-3.5 text-blue-500" />
                    <p className="text-xs font-medium">Current Priorities</p>
                  </div>
                  <div className="space-y-1.5">
                    {enrichmentData.company_priorities.slice(0, 3).map((priority, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span>{priority}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Growth Signals */}
              {(enrichmentData.latest_funding_round || (enrichmentData.growth_signals && enrichmentData.growth_signals.length > 0)) && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                    <p className="text-xs font-medium">Growth Signals</p>
                  </div>
                  <div className="space-y-1.5">
                    {enrichmentData.latest_funding_round && (
                      <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
                        {enrichmentData.latest_funding_round}
                      </Badge>
                    )}
                    {enrichmentData.growth_signals?.slice(0, 3).map((signal, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 text-sm text-muted-foreground"
                        title={signal.evidence ? `Evidence: ${signal.evidence}` : undefined}
                      >
                        <span className="text-green-500 mt-0.5">↑</span>
                        <span>{signal.signal}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </AnalysisSection>
        )}

        {/* CONTEXT SECTION: LinkedIn Activity (collapsed by default) */}
        {hasLinkedInData && (
          <AnalysisSection
            title="LinkedIn Activity"
            icon={<Linkedin className="h-4 w-4" />}
            expanded={expandedSections.linkedin}
            onToggle={() => toggleSection('linkedin')}
            defaultCollapsed
          >
            <div className="space-y-3">
              {enrichmentData.linkedin_topics && enrichmentData.linkedin_topics.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {enrichmentData.linkedin_topics.slice(0, 6).map((topic, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs bg-blue-50 border-blue-200 text-blue-700">
                      #{topic}
                    </Badge>
                  ))}
                </div>
              )}

              {enrichmentData.recent_linkedin_posts?.slice(0, 2).map((post, idx) => (
                <div key={idx} className="p-3 bg-slate-50 rounded-lg border">
                  <p className="text-sm text-slate-700 line-clamp-3 leading-relaxed">{post.text}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {post.date}
                    </span>
                    {post.engagement > 0 && (
                      <span className="flex items-center gap-1">
                        <Heart className="h-3 w-3" />
                        {post.engagement} engagements
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </AnalysisSection>
        )}
      </div>
    </Card>
  );
}

// Sub-component for collapsible analysis sections
interface AnalysisSectionProps {
  title: string;
  icon: React.ReactNode;
  expanded?: boolean;
  onToggle: () => void;
  highlighted?: boolean;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

function AnalysisSection({
  title,
  icon,
  expanded,
  onToggle,
  highlighted,
  defaultCollapsed,
  children
}: AnalysisSectionProps) {
  const isExpanded = expanded ?? !defaultCollapsed;

  return (
    <div className={cn(
      highlighted && "bg-gradient-to-r from-primary/10 to-blue-50"
    )}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-muted-foreground",
            highlighted && "text-primary"
          )}>{icon}</span>
          <span className={cn(
            "text-sm font-medium",
            highlighted && "text-foreground"
          )}>{title}</span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-180"
          )}
        />
      </button>
      {isExpanded && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

// Sub-component for individual analysis items
interface AnalysisItemProps {
  label: string;
  value: string;
  color: 'blue' | 'green' | 'amber';
}

function AnalysisItem({ label, value, color }: AnalysisItemProps) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-100',
    green: 'bg-green-50 border-green-100',
    amber: 'bg-amber-50 border-amber-100',
  };

  return (
    <div className={cn("p-2.5 rounded-lg border", colorClasses[color])}>
      <p className="text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm leading-relaxed">{value}</p>
    </div>
  );
}

// ============================================================================
// LinkedIn Highlights Card
// ============================================================================

interface LinkedInHighlightsCardProps {
  profile: LinkedInProfile | null | undefined;
  isLoading: boolean;
  contact: CrmContact;
  isResolvingIdentity?: boolean;
  resolveError?: Error | null;
  onRetryResolve?: () => void;
}

function LinkedInHighlightsCard({ profile, isLoading, contact, isResolvingIdentity, resolveError, onRetryResolve }: LinkedInHighlightsCardProps) {
  const [activeTab, setActiveTab] = useState("overview");

  if (isLoading) {
    return (
      <Card className="border-blue-100 bg-gradient-to-br from-white to-blue-50/30">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Linkedin className="h-4 w-4 text-[#0A66C2]" />
            <span className="text-sm font-medium">LinkedIn Profile</span>
          </div>
          {isResolvingIdentity ? (
            <div className="flex items-center gap-2 text-blue-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Connecting LinkedIn profile...</span>
            </div>
          ) : (
            <div className="space-y-2 animate-pulse">
              <div className="h-4 w-3/4 bg-muted rounded" />
              <div className="h-4 w-1/2 bg-muted rounded" />
              <div className="flex gap-2">
                <div className="h-5 w-20 bg-muted rounded" />
                <div className="h-5 w-16 bg-muted rounded" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!profile) {
    const hasLinkedInUrl = !!contact.primary_linkedin_url;
    const errorMsg = resolveError instanceof Error ? resolveError.message : '';
    const isUnreachable = errorMsg.includes('cannot be reached') || errorMsg.includes('invalid_recipient');

    // Determine messaging based on the actual failure reason
    let title: string;
    let description: string;
    let borderClass: string;
    let iconClass: string;

    if (!hasLinkedInUrl) {
      title = "No LinkedIn URL";
      description = "Add a LinkedIn URL to this contact to see their profile";
      borderClass = "border-muted";
      iconClass = "text-muted-foreground";
    } else if (isUnreachable) {
      title = "Profile restricted on LinkedIn";
      description = "This person's LinkedIn profile is private or has restricted visibility";
      borderClass = "border-muted";
      iconClass = "text-muted-foreground";
    } else if (resolveError) {
      title = "Could not connect profile";
      description = "Something went wrong while fetching this LinkedIn profile";
      borderClass = "border-amber-100";
      iconClass = "text-amber-600";
    } else {
      title = "LinkedIn profile unavailable";
      description = "Connect a LinkedIn account in Settings to view profiles";
      borderClass = "border-muted";
      iconClass = "text-muted-foreground";
    }

    return (
      <Card className={cn(borderClass, "bg-gradient-to-br from-white to-muted/20")}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Linkedin className={cn("h-4 w-4", iconClass)} />
              <span className="text-sm font-medium">{title}</span>
            </div>
            {hasLinkedInUrl && contact.primary_linkedin_url && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
                <a href={contact.primary_linkedin_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  View on LinkedIn
                </a>
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
          {resolveError && !isUnreachable && onRetryResolve && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-xs"
              onClick={onRetryResolve}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const hasExperience = profile.work_experience && profile.work_experience.length > 0;
  const hasEducation = profile.education && profile.education.length > 0;
  const hasSkills = profile.skills && profile.skills.length > 0;
  const hasLanguages = profile.languages && profile.languages.length > 0;
  const hasCertifications = profile.certifications && profile.certifications.length > 0;
  const hasProjects = profile.projects && profile.projects.length > 0;

  return (
    <Card className="border-blue-100 bg-gradient-to-br from-white to-blue-50/30">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Linkedin className="h-4 w-4 text-[#0A66C2]" />
            <span className="text-sm font-medium">LinkedIn Profile</span>
          </div>
          <div className="flex items-center gap-2">
            {profile.network_distance && (
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  profile.network_distance === "FIRST_DEGREE" && "border-green-300 text-green-700 bg-green-50",
                  profile.network_distance === "SECOND_DEGREE" && "border-blue-300 text-blue-700 bg-blue-50",
                  profile.network_distance === "THIRD_DEGREE" && "border-amber-300 text-amber-700 bg-amber-50"
                )}
              >
                {profile.network_distance === "FIRST_DEGREE" && "1st"}
                {profile.network_distance === "SECOND_DEGREE" && "2nd"}
                {profile.network_distance === "THIRD_DEGREE" && "3rd"}
                {profile.network_distance === "OUT_OF_NETWORK" && "3rd+"}
              </Badge>
            )}
            {profile.public_profile_url && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
                <a href={profile.public_profile_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  View
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {profile.is_open_to_work && (
            <Badge className="text-xs bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
              Open to work
            </Badge>
          )}
          {profile.is_hiring && (
            <Badge className="text-xs bg-primary/10 text-primary border-primary/20 hover:bg-primary/10">
              Hiring
            </Badge>
          )}
          {profile.can_send_inmail && (
            <Badge variant="outline" className="text-xs">
              InMail available
            </Badge>
          )}
          {profile.is_premium && (
            <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">
              Premium
            </Badge>
          )}
          {profile.is_creator && (
            <Badge variant="secondary" className="text-xs bg-cyan-100 text-cyan-700">
              Creator
            </Badge>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground pb-2">
          {profile.connections_count !== undefined && (
            <span className="flex items-center gap-1">
              <UserCheck className="h-3 w-3" />
              {profile.connections_count.toLocaleString()} connections
            </span>
          )}
          {profile.follower_count !== undefined && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {profile.follower_count.toLocaleString()} followers
            </span>
          )}
          {profile.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {profile.location}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="border-t border-b bg-muted/30">
          <TabsList className="w-full h-auto p-0 bg-transparent rounded-none justify-start">
            <TabsTrigger
              value="overview"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent px-4 py-2 text-xs"
            >
              Overview
            </TabsTrigger>
            {hasExperience && (
              <TabsTrigger
                value="experience"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent px-4 py-2 text-xs"
              >
                Experience ({profile.work_experience?.length})
              </TabsTrigger>
            )}
            {hasEducation && (
              <TabsTrigger
                value="education"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent px-4 py-2 text-xs"
              >
                Education ({profile.education?.length})
              </TabsTrigger>
            )}
            {hasSkills && (
              <TabsTrigger
                value="skills"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent px-4 py-2 text-xs"
              >
                Skills ({profile.skills?.length})
              </TabsTrigger>
            )}
            {(hasLanguages || hasCertifications || hasProjects) && (
              <TabsTrigger
                value="more"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent px-4 py-2 text-xs"
              >
                More
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <CardContent className="p-4">
          {/* Overview Tab */}
          <TabsContent value="overview" className="m-0 space-y-4">
            {/* Headline & Current Role */}
            {profile.headline && (
              <div>
                <p className="text-sm font-medium">{profile.headline}</p>
              </div>
            )}

            {/* Summary/About */}
            {profile.summary && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">About</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {profile.summary}
                </p>
              </div>
            )}

            {/* Current Position Preview */}
            {profile.work_experience?.[0] && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Current Role</h4>
                <LinkedInExperienceItem experience={profile.work_experience[0]} />
              </div>
            )}

            {/* Top Skills Preview */}
            {hasSkills && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Top Skills</h4>
                <div className="flex flex-wrap gap-1.5">
                  {profile.skills?.slice(0, 8).map((skill) => (
                    <Badge key={skill.name} variant="secondary" className="text-xs">
                      {skill.name}
                      {skill.endorsement_count > 0 && (
                        <span className="ml-1 text-muted-foreground">({skill.endorsement_count})</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Contact Info */}
            {profile.contact_info && (
              <LinkedInContactInfoSection contactInfo={profile.contact_info} />
            )}
          </TabsContent>

          {/* Experience Tab */}
          <TabsContent value="experience" className="m-0">
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-4 pr-4">
                {profile.work_experience?.map((exp, idx) => (
                  <LinkedInExperienceItem key={exp.id || idx} experience={exp} />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Education Tab */}
          <TabsContent value="education" className="m-0">
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-4 pr-4">
                {profile.education?.map((edu, idx) => (
                  <LinkedInEducationItem key={edu.id || idx} education={edu} />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Skills Tab */}
          <TabsContent value="skills" className="m-0">
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-2 pr-4">
                {profile.skills?.map((skill) => (
                  <LinkedInSkillItem key={skill.name} skill={skill} />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* More Tab (Languages, Certifications, Projects) */}
          <TabsContent value="more" className="m-0">
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-6 pr-4">
                {/* Languages */}
                {hasLanguages && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <Languages className="h-3.5 w-3.5" />
                      Languages
                    </h4>
                    <div className="space-y-1.5">
                      {profile.languages?.map((lang) => (
                        <div key={lang.name} className="flex items-center justify-between text-sm">
                          <span>{lang.name}</span>
                          {lang.proficiency && (
                            <span className="text-xs text-muted-foreground">{lang.proficiency}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Certifications */}
                {hasCertifications && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <Award className="h-3.5 w-3.5" />
                      Certifications
                    </h4>
                    <div className="space-y-3">
                      {profile.certifications?.map((cert, idx) => (
                        <div key={idx} className="text-sm">
                          <p className="font-medium">{cert.name}</p>
                          <p className="text-xs text-muted-foreground">{cert.organization}</p>
                          {cert.url && (
                            <a
                              href={cert.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            >
                              View credential
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Projects */}
                {hasProjects && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <Briefcase className="h-3.5 w-3.5" />
                      Projects
                    </h4>
                    <div className="space-y-3">
                      {profile.projects?.map((project, idx) => (
                        <div key={idx} className="text-sm">
                          <p className="font-medium">{project.name}</p>
                          {project.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>
                          )}
                          {project.skills && project.skills.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {project.skills.map((skill) => (
                                <Badge key={skill} variant="outline" className="text-[10px] py-0">
                                  {skill}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hashtags/Topics */}
                {profile.hashtags && profile.hashtags.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Topics of Interest
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.hashtags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}

// Helper components for LinkedIn profile sections
function LinkedInExperienceItem({ experience }: { experience: LinkedInWorkExperience }) {
  const formatDate = (date: string | null) => {
    if (!date) return null;
    try {
      return new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch {
      return date;
    }
  };

  return (
    <div className="flex gap-3">
      {experience.company_picture_url ? (
        <Avatar className="h-10 w-10 rounded-lg">
          <AvatarImage src={experience.company_picture_url} />
          <AvatarFallback className="rounded-lg bg-muted">
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{experience.position}</p>
        <p className="text-xs text-muted-foreground">
          {experience.company}
          {experience.current && <Badge variant="outline" className="ml-2 text-[10px] py-0">Current</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDate(experience.start)}
          {experience.start && " - "}
          {experience.current ? "Present" : formatDate(experience.end)}
          {experience.location && ` · ${experience.location}`}
        </p>
        {experience.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{experience.description}</p>
        )}
        {experience.skills && experience.skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {experience.skills.slice(0, 5).map((skill) => (
              <Badge key={skill} variant="outline" className="text-[10px] py-0">
                {skill}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LinkedInEducationItem({ education }: { education: LinkedInEducation }) {
  const formatDate = (date: string | null) => {
    if (!date) return null;
    try {
      return new Date(date).toLocaleDateString('en-US', { year: 'numeric' });
    } catch {
      return date;
    }
  };

  return (
    <div className="flex gap-3">
      {education.school_picture_url ? (
        <Avatar className="h-10 w-10 rounded-lg">
          <AvatarImage src={education.school_picture_url} />
          <AvatarFallback className="rounded-lg bg-muted">
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <GraduationCap className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{education.school}</p>
        {(education.degree || education.field_of_study) && (
          <p className="text-xs text-muted-foreground">
            {education.degree}
            {education.degree && education.field_of_study && ", "}
            {education.field_of_study}
          </p>
        )}
        {(education.start || education.end) && (
          <p className="text-xs text-muted-foreground">
            {formatDate(education.start)}
            {education.start && education.end && " - "}
            {formatDate(education.end)}
          </p>
        )}
        {education.grade && (
          <p className="text-xs text-muted-foreground">Grade: {education.grade}</p>
        )}
        {education.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{education.description}</p>
        )}
        {education.activities && (
          <p className="text-xs text-muted-foreground mt-1">Activities: {education.activities}</p>
        )}
      </div>
    </div>
  );
}

function LinkedInSkillItem({ skill }: { skill: LinkedInSkill }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-0">
      <span className="text-sm">{skill.name}</span>
      <div className="flex items-center gap-2">
        {skill.endorsement_count > 0 && (
          <span className="text-xs text-muted-foreground">
            {skill.endorsement_count} endorsement{skill.endorsement_count !== 1 ? "s" : ""}
          </span>
        )}
        {skill.endorsed && (
          <Badge variant="outline" className="text-[10px] py-0 bg-green-50 text-green-700 border-green-200">
            Endorsed
          </Badge>
        )}
      </div>
    </div>
  );
}

function LinkedInContactInfoSection({ contactInfo }: { contactInfo: LinkedInContactInfo }) {
  const hasAnyInfo = contactInfo.emails?.length || contactInfo.phones?.length || contactInfo.socials?.length;

  if (!hasAnyInfo) return null;

  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Contact Info</h4>
      <div className="space-y-1.5">
        {contactInfo.emails?.map((email) => (
          <div key={email} className="flex items-center gap-2 text-sm">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            <a href={`mailto:${email}`} className="text-blue-600 hover:underline">{email}</a>
          </div>
        ))}
        {contactInfo.phones?.map((phone) => (
          <div key={phone} className="flex items-center gap-2 text-sm">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            <a href={`tel:${phone}`} className="text-blue-600 hover:underline">{phone}</a>
          </div>
        ))}
        {contactInfo.socials?.map((social) => (
          <div key={social.name} className="flex items-center gap-2 text-sm">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{social.type}: {social.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Activity Tabs (with LinkedIn Profile)
// ============================================================================

function ActivityTabs({ contact }: { contact: CrmContact & { activities?: CrmActivity[]; notes?: { id: string; content: string; is_pinned: boolean; created_at: string }[] } }) {
  // Get LinkedIn identity to fetch posts and activity
  const linkedinIdentity = contact.identities?.find(
    (i) => i.channel === "linkedin"
  );

  // Get a LinkedIn account to use for fetching
  const { data: linkedInAccount } = useLinkedInAccount();

  // Fetch LinkedIn posts
  const {
    data: linkedInPosts,
    isLoading: postsLoading,
    error: postsError,
    refetch: refetchPosts,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useLinkedInPosts({
    identifier: linkedinIdentity?.platform_user_id || null,
    accountId: linkedInAccount?.account_id || null,
    enabled: !!linkedinIdentity?.platform_user_id && !!linkedInAccount?.account_id,
    limit: 20,
  });

  const hasLinkedIn = !!linkedinIdentity;

  return (
    <Card>
      <Tabs defaultValue={hasLinkedIn ? "posts" : "notes"}>
        <CardHeader className="pb-0">
          <TabsList>
            {hasLinkedIn && (
              <TabsTrigger value="posts" data-value="posts" className="gap-2">
                <Megaphone className="h-4 w-4" />
                Posts
              </TabsTrigger>
            )}
            {hasLinkedIn && (
              <TabsTrigger value="activity" className="gap-2">
                <Activity className="h-4 w-4" />
                Activity
              </TabsTrigger>
            )}
            <TabsTrigger value="notes" className="gap-2">
              <StickyNote className="h-4 w-4" />
              Notes
            </TabsTrigger>
            <TabsTrigger value="sequences" className="gap-2">
              <Mail className="h-4 w-4" />
              Sequences
            </TabsTrigger>
            <TabsTrigger value="outreach" className="gap-2">
              <Target className="h-4 w-4" />
              Outreach
            </TabsTrigger>
          </TabsList>
        </CardHeader>

        <CardContent className="pt-4">
          {hasLinkedIn && (
            <TabsContent value="posts" className="mt-0">
              <LinkedInPostsView
                posts={linkedInPosts}
                isLoading={postsLoading}
                error={postsError}
                onRefresh={refetchPosts}
                hasNextPage={hasNextPage}
                onLoadMore={fetchNextPage}
                isLoadingMore={isFetchingNextPage}
                accountId={linkedInAccount?.account_id || null}
                contactId={contact.id}
              />
            </TabsContent>
          )}

          {hasLinkedIn && (
            <TabsContent value="activity" className="mt-0">
              <LinkedInActivityView
                identifier={linkedinIdentity?.platform_user_id || null}
                accountId={linkedInAccount?.account_id || null}
                crmActivities={contact.activities || []}
              />
            </TabsContent>
          )}

          <TabsContent value="notes" className="mt-0">
            <NotesList notes={contact.notes || []} />
          </TabsContent>

          <TabsContent value="sequences" className="mt-0">
            <EmailSequenceView
              contactId={contact.id}
              contactName={contact.display_name}
            />
          </TabsContent>

          <TabsContent value="outreach" className="mt-0">
            <CampaignOutreachView contactId={contact.id} />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}

// ============================================================================
// LinkedIn Profile View Component
// ============================================================================

interface LinkedInProfileViewProps {
  profile: LinkedInProfile | null | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  linkedinUrl?: string | null;
}

function LinkedInProfileView({
  profile,
  isLoading,
  error,
  onRefresh,
  linkedinUrl,
}: LinkedInProfileViewProps) {
  if (isLoading) {
    return <LinkedInProfileSkeleton />;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
        <p className="text-muted-foreground mb-2">Unable to load LinkedIn profile</p>
        <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
          {linkedinUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={linkedinUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                View on LinkedIn
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-8">
        <Linkedin className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-muted-foreground mb-2">No LinkedIn profile data available</p>
        <p className="text-sm text-muted-foreground mb-4">
          Connect a LinkedIn account to fetch profile details
        </p>
        {linkedinUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={linkedinUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              View on LinkedIn
            </a>
          </Button>
        )}
      </div>
    );
  }

  return (
    <ScrollArea className="h-[500px] pr-4">
      <div className="space-y-6">
        {/* Profile Header */}
        <LinkedInProfileHeader profile={profile} />

        {/* About Section */}
        {profile.summary && (
          <ProfileSection title="About" icon={<Users className="h-4 w-4" />}>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {profile.summary}
            </p>
          </ProfileSection>
        )}

        {/* Contact Info */}
        {profile.contact_info && (
          <LinkedInContactInfo contactInfo={profile.contact_info} />
        )}

        {/* Experience */}
        {profile.work_experience && profile.work_experience.length > 0 && (
          <ProfileSection
            title="Experience"
            icon={<Briefcase className="h-4 w-4" />}
            count={profile.work_experience_total_count}
          >
            <div className="space-y-4">
              {profile.work_experience.map((exp, idx) => (
                <ExperienceItem key={exp.id || idx} experience={exp} />
              ))}
            </div>
          </ProfileSection>
        )}

        {/* Education */}
        {profile.education && profile.education.length > 0 && (
          <ProfileSection
            title="Education"
            icon={<GraduationCap className="h-4 w-4" />}
            count={profile.education_total_count}
          >
            <div className="space-y-4">
              {profile.education.map((edu, idx) => (
                <EducationItem key={edu.id || idx} education={edu} />
              ))}
            </div>
          </ProfileSection>
        )}

        {/* Skills */}
        {profile.skills && profile.skills.length > 0 && (
          <ProfileSection
            title="Skills"
            icon={<Award className="h-4 w-4" />}
            count={profile.skills_total_count}
          >
            <div className="flex flex-wrap gap-2">
              {profile.skills.slice(0, 20).map((skill, idx) => (
                <SkillBadge key={idx} skill={skill} />
              ))}
              {profile.skills.length > 20 && (
                <Badge variant="outline" className="text-xs">
                  +{profile.skills.length - 20} more
                </Badge>
              )}
            </div>
          </ProfileSection>
        )}

        {/* Languages */}
        {profile.languages && profile.languages.length > 0 && (
          <ProfileSection
            title="Languages"
            icon={<Languages className="h-4 w-4" />}
          >
            <div className="flex flex-wrap gap-2">
              {profile.languages.map((lang, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {lang.name}
                  {lang.proficiency && (
                    <span className="text-muted-foreground ml-1">
                      ({lang.proficiency})
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          </ProfileSection>
        )}

        {/* Certifications */}
        {profile.certifications && profile.certifications.length > 0 && (
          <ProfileSection
            title="Certifications"
            icon={<Award className="h-4 w-4" />}
            count={profile.certifications_total_count}
          >
            <div className="space-y-2">
              {profile.certifications.map((cert, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{cert.name}</p>
                    <p className="text-xs text-muted-foreground">{cert.organization}</p>
                  </div>
                </div>
              ))}
            </div>
          </ProfileSection>
        )}

        {/* Recommendations */}
        {profile.recommendations?.received && profile.recommendations.received.length > 0 && (
          <ProfileSection
            title="Recommendations"
            icon={<Heart className="h-4 w-4" />}
            count={profile.recommendations.received_total_count}
          >
            <div className="space-y-3">
              {profile.recommendations.received.slice(0, 3).map((rec, idx) => (
                <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm italic mb-2">"{rec.text}"</p>
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-xs font-medium text-blue-600">
                        {rec.actor.first_name?.[0]}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-medium">
                        {rec.actor.first_name} {rec.actor.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">{rec.actor.headline}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ProfileSection>
        )}

        {/* Throttled sections warning */}
        {profile.throttled_sections && profile.throttled_sections.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs text-amber-700">
              Some sections may be limited due to LinkedIn rate limits:{" "}
              {profile.throttled_sections.join(", ")}
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// ============================================================================
// LinkedIn Posts View Component
// ============================================================================

interface LinkedInPostsViewProps {
  posts: LinkedInPost[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  hasNextPage: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  accountId: string | null;
  contactId: string;
}

function LinkedInPostsView({
  posts,
  isLoading,
  error,
  onRefresh,
  hasNextPage,
  onLoadMore,
  isLoadingMore,
  accountId,
  contactId,
}: LinkedInPostsViewProps) {
  if (isLoading) {
    return <LinkedInPostsSkeleton />;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
        <p className="text-muted-foreground mb-2">Unable to load LinkedIn posts</p>
        <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="text-center py-8">
        <Megaphone className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-muted-foreground mb-2">No posts found</p>
        <p className="text-sm text-muted-foreground">
          This user hasn't posted on LinkedIn recently
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {posts.length} post{posts.length !== 1 ? 's' : ''} loaded
        </p>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <ScrollArea className="h-[450px] pr-4">
        <div className="space-y-4">
          {posts.map((post) => (
            <LinkedInPostCard
              key={post.id}
              post={post}
              accountId={accountId}
              contactId={contactId}
            />
          ))}

          {hasNextPage && (
            <div className="flex justify-center pt-2 pb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={onLoadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-2" />
                    Load More
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface LinkedInPostCardProps {
  post: LinkedInPost;
  accountId: string | null;
  contactId: string;
}

function LinkedInPostCard({ post, accountId, contactId }: LinkedInPostCardProps) {
  const [showCommentDialog, setShowCommentDialog] = useState(false);
  const [commentText, setCommentText] = useState('');
  const engagePost = useEngagePost();

  const postDate = post.parsed_datetime
    ? formatDistanceToNow(new Date(post.parsed_datetime), { addSuffix: true })
    : post.date;

  // Get reaction emoji based on type (for display)
  const getReactionEmojiForDisplay = (reaction?: string) => {
    const reactions: Record<string, string> = {
      LIKE: '👍',
      PRAISE: '👏',
      APPRECIATION: '❤️',
      EMPATHY: '💜',
      INTEREST: '💡',
      ENTERTAINMENT: '😄',
    };
    return reaction ? reactions[reaction] : null;
  };

  const handleReaction = (reactionType: ReactionType) => {
    if (!accountId) {
      toast.error('No LinkedIn account connected');
      return;
    }
    engagePost.mutate({
      accountId,
      postId: post.social_id,
      action: 'reaction',
      reactionType,
      contactId,
    });
  };

  const handleComment = () => {
    if (!accountId) {
      toast.error('No LinkedIn account connected');
      return;
    }
    if (!commentText.trim()) {
      toast.error('Please enter a comment');
      return;
    }
    engagePost.mutate(
      {
        accountId,
        postId: post.social_id,
        action: 'comment',
        commentText: commentText.trim(),
        contactId,
      },
      {
        onSuccess: () => {
          setCommentText('');
          setShowCommentDialog(false);
        },
      }
    );
  };

  const canEngage = !!accountId && post.permissions?.can_react !== false;

  return (
    <div className="p-4 border rounded-lg hover:bg-muted/50 transition-colors">
      {/* Post Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {post.author.profile_picture_url ? (
            <Avatar className="h-8 w-8">
              <AvatarImage
                src={post.author.profile_picture_url}
                referrerPolicy="no-referrer"
              />
              <AvatarFallback>
                {post.author.name?.[0] || '?'}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
              <Linkedin className="h-4 w-4 text-blue-600" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{post.author.name || 'Unknown'}</p>
            <p className="text-xs text-muted-foreground">{postDate}</p>
          </div>
        </div>

        <a
          href={post.share_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </a>
      </div>

      {/* Repost indicator */}
      {post.is_repost && post.reposted_by && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
          <RefreshCw className="h-3 w-3" />
          <span>Reposted by {post.reposted_by.name}</span>
        </div>
      )}

      {/* Post Content */}
      <div className="mb-3">
        <p className="text-sm whitespace-pre-wrap line-clamp-6">
          {post.text}
        </p>
        {post.text.length > 400 && (
          <a
            href={post.share_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            ...see more
          </a>
        )}
      </div>

      {/* Attachments */}
      {post.attachments && post.attachments.length > 0 && (
        <LinkedInPostAttachments attachments={post.attachments} />
      )}

      {/* Poll */}
      {post.poll && (
        <div className="mb-3 p-3 bg-muted/50 rounded-lg">
          <p className="text-sm font-medium mb-2">{post.poll.question}</p>
          <div className="space-y-1">
            {post.poll.options.map((option) => (
              <div key={option.id} className="flex items-center gap-2">
                <div className="flex-1 h-6 bg-muted rounded overflow-hidden">
                  <div
                    className={cn(
                      "h-full flex items-center px-2",
                      option.win ? "bg-blue-500 text-white" : "bg-blue-200"
                    )}
                    style={{
                      width: `${(option.votes_count / post.poll!.total_votes_count) * 100}%`,
                    }}
                  >
                    <span className="text-xs truncate">{option.text}</span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground w-10 text-right">
                  {Math.round((option.votes_count / post.poll!.total_votes_count) * 100)}%
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {post.poll.total_votes_count} votes • {post.poll.is_open ? 'Open' : 'Closed'}
          </p>
        </div>
      )}

      {/* Engagement Metrics */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Heart className="h-3.5 w-3.5" />
          <span>{post.reaction_counter.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1">
          <MessageSquare className="h-3.5 w-3.5" />
          <span>{post.comment_counter.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1">
          <RefreshCw className="h-3.5 w-3.5" />
          <span>{post.repost_counter.toLocaleString()}</span>
        </div>
        {post.impressions_counter > 0 && (
          <div className="flex items-center gap-1">
            <Globe className="h-3.5 w-3.5" />
            <span>{post.impressions_counter.toLocaleString()}</span>
          </div>
        )}
        {post.user_reacted && (
          <span className="ml-auto">{getReactionEmojiForDisplay(post.user_reacted)} You reacted</span>
        )}
      </div>

      {/* Quick Engage Actions */}
      {canEngage && (
        <div className="mt-3 pt-3 border-t flex items-center gap-2">
          <TooltipProvider>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={engagePost.isPending}
                      className="gap-2"
                    >
                      {engagePost.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ThumbsUp className="h-4 w-4" />
                      )}
                      React
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Add a reaction to warm up engagement</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start">
                {REACTION_TYPES.map((reaction) => (
                  <DropdownMenuItem
                    key={reaction.type}
                    onClick={() => handleReaction(reaction.type)}
                    className="gap-2"
                  >
                    <span className="text-lg">{reaction.emoji}</span>
                    <span>{reaction.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCommentDialog(true)}
                  disabled={engagePost.isPending || post.permissions?.can_post_comments === false}
                  className="gap-2"
                >
                  <MessageCircle className="h-4 w-4" />
                  Comment
                </Button>
              </TooltipTrigger>
              <TooltipContent>Leave a thoughtful comment</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Analytics (if available - for own posts) */}
      {post.analytics && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs font-medium mb-2">Post Analytics</p>
          <div className="grid grid-cols-3 gap-2">
            {post.analytics.impressions !== undefined && (
              <div className="text-center p-2 bg-muted/50 rounded">
                <p className="text-lg font-semibold">{post.analytics.impressions.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Impressions</p>
              </div>
            )}
            {post.analytics.engagements !== undefined && (
              <div className="text-center p-2 bg-muted/50 rounded">
                <p className="text-lg font-semibold">{post.analytics.engagements.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Engagements</p>
              </div>
            )}
            {post.analytics.clicks !== undefined && (
              <div className="text-center p-2 bg-muted/50 rounded">
                <p className="text-lg font-semibold">{post.analytics.clicks.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Clicks</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Group info */}
      {post.group && (
        <div className="mt-2 text-xs text-muted-foreground">
          Posted in <span className="font-medium">{post.group.name}</span>
          {post.group.private && <Badge variant="outline" className="ml-1 text-xs">Private</Badge>}
        </div>
      )}

      {/* Comment Dialog */}
      <Dialog open={showCommentDialog} onOpenChange={setShowCommentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Comment</DialogTitle>
            <DialogDescription>
              Leave a thoughtful comment on this post to warm up engagement with {post.author.name || 'this contact'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Write a genuine, value-adding comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Tip: Reference something specific from the post to make your comment more authentic and noticeable.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCommentDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleComment}
              disabled={engagePost.isPending || !commentText.trim()}
            >
              {engagePost.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Posting...
                </>
              ) : (
                'Post Comment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LinkedInPostAttachments({ attachments }: { attachments: LinkedInPostAttachment[] }) {
  const imageAttachments = attachments.filter(a => a.type === 'img' && !a.unavailable);
  const videoAttachments = attachments.filter(a => a.type === 'video' && !a.unavailable);

  if (imageAttachments.length === 0 && videoAttachments.length === 0) {
    return null;
  }

  return (
    <div className="mb-3">
      {/* Images */}
      {imageAttachments.length > 0 && (
        <div className={cn(
          "grid gap-2",
          imageAttachments.length === 1 ? "grid-cols-1" :
          imageAttachments.length === 2 ? "grid-cols-2" :
          "grid-cols-2"
        )}>
          {imageAttachments.slice(0, 4).map((img, idx) => (
            <div
              key={img.id || idx}
              className={cn(
                "relative rounded-lg overflow-hidden bg-muted",
                imageAttachments.length === 1 ? "aspect-video" : "aspect-square"
              )}
            >
              {img.url ? (
                <img
                  src={img.url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Globe className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              {idx === 3 && imageAttachments.length > 4 && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <span className="text-white text-lg font-semibold">
                    +{imageAttachments.length - 4}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Videos */}
      {videoAttachments.length > 0 && (
        <div className="mt-2">
          {videoAttachments.map((video, idx) => (
            <div
              key={video.id || idx}
              className="relative rounded-lg overflow-hidden bg-muted aspect-video"
            >
              {video.url ? (
                <video
                  src={video.url}
                  controls
                  className="w-full h-full object-cover"
                  preload="metadata"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <Globe className="h-8 w-8 text-muted-foreground mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">Video unavailable</p>
                  </div>
                </div>
              )}
              {video.gif && (
                <Badge className="absolute top-2 left-2 text-xs">GIF</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkedInPostsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="p-4 border rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="space-y-1">
              <div className="h-4 w-32 bg-muted rounded" />
              <div className="h-3 w-20 bg-muted rounded" />
            </div>
          </div>
          <div className="space-y-2 mb-3">
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-3/4 bg-muted rounded" />
            <div className="h-4 w-1/2 bg-muted rounded" />
          </div>
          <div className="flex gap-4">
            <div className="h-4 w-12 bg-muted rounded" />
            <div className="h-4 w-12 bg-muted rounded" />
            <div className="h-4 w-12 bg-muted rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// LinkedIn Activity View Component (Comments + Reactions)
// ============================================================================

interface LinkedInActivityViewProps {
  identifier: string | null;
  accountId: string | null;
  crmActivities: CrmActivity[];
}

function LinkedInActivityView({ identifier, accountId, crmActivities }: LinkedInActivityViewProps) {
  const {
    comments,
    reactions,
    isLoading,
    error,
    refetch,
    partialErrors,
  } = useLinkedInActivity({
    identifier,
    accountId,
    enabled: !!identifier && !!accountId,
    limit: 30,
  });

  const [activeTab, setActiveTab] = useState<'all' | 'comments' | 'reactions' | 'crm'>('all');

  if (isLoading) {
    return <LinkedInActivitySkeleton />;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
        <p className="text-muted-foreground mb-2">Unable to load LinkedIn activity</p>
        <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const hasComments = comments && comments.length > 0;
  const hasReactions = reactions && reactions.length > 0;
  const hasCrmActivities = crmActivities && crmActivities.length > 0;
  const hasAnyActivity = hasComments || hasReactions || hasCrmActivities;

  if (!hasAnyActivity) {
    return (
      <div className="text-center py-8">
        <Activity className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-muted-foreground mb-2">No activity found</p>
        <p className="text-sm text-muted-foreground">
          This user hasn't commented or reacted to posts recently
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Activity Filter Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          <Button
            variant={activeTab === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('all')}
            className="h-7 text-xs"
          >
            All
          </Button>
          {hasComments && (
            <Button
              variant={activeTab === 'comments' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('comments')}
              className="h-7 text-xs"
            >
              <MessageSquare className="h-3 w-3 mr-1" />
              Comments ({comments.length})
            </Button>
          )}
          {hasReactions && (
            <Button
              variant={activeTab === 'reactions' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('reactions')}
              className="h-7 text-xs"
            >
              <Heart className="h-3 w-3 mr-1" />
              Reactions ({reactions.length})
            </Button>
          )}
          {hasCrmActivities && (
            <Button
              variant={activeTab === 'crm' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('crm')}
              className="h-7 text-xs"
            >
              <Target className="h-3 w-3 mr-1" />
              CRM ({crmActivities.length})
            </Button>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Partial errors warning */}
      {partialErrors && partialErrors.length > 0 && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-700">
            Some data couldn't be loaded: {partialErrors.join(', ')}
          </p>
        </div>
      )}

      <ScrollArea className="h-[400px] pr-4">
        <div className="space-y-3">
          {/* Comments Section */}
          {(activeTab === 'all' || activeTab === 'comments') && hasComments && (
            <>
              {activeTab === 'all' && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium py-1">
                  <MessageSquare className="h-3 w-3" />
                  <span>Comments on posts</span>
                </div>
              )}
              {comments.map((comment) => (
                <LinkedInCommentCard key={comment.id} comment={comment} />
              ))}
            </>
          )}

          {/* Reactions Section */}
          {(activeTab === 'all' || activeTab === 'reactions') && hasReactions && (
            <>
              {activeTab === 'all' && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium py-1 mt-4">
                  <Heart className="h-3 w-3" />
                  <span>Reactions to posts</span>
                </div>
              )}
              {reactions.map((reaction, idx) => (
                <LinkedInReactionCard key={`${reaction.post_id}-${idx}`} reaction={reaction} />
              ))}
            </>
          )}

          {/* CRM Activities Section */}
          {(activeTab === 'all' || activeTab === 'crm') && hasCrmActivities && (
            <>
              {activeTab === 'all' && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium py-1 mt-4">
                  <Target className="h-3 w-3" />
                  <span>CRM activity</span>
                </div>
              )}
              {crmActivities.map((activity) => (
                <CrmActivityCard key={activity.id} activity={activity} />
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function LinkedInCommentCard({ comment }: { comment: LinkedInComment }) {
  // Construct LinkedIn post URL from post_urn or post_id
  // URN format: urn:li:activity:1234567890 or urn:li:share:1234567890
  // We extract the ID and build the URL
  const getPostUrl = () => {
    if (comment.post_urn) {
      // Extract activity/share ID from URN
      const match = comment.post_urn.match(/urn:li:(activity|share|ugcPost):(\d+)/);
      if (match) {
        return `https://www.linkedin.com/feed/update/urn:li:activity:${match[2]}`;
      }
    }
    if (comment.post_id) {
      return `https://www.linkedin.com/feed/update/urn:li:activity:${comment.post_id}`;
    }
    return null;
  };

  const postUrl = getPostUrl();

  return (
    <div className="p-3 border rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
          <MessageSquare className="h-4 w-4 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm whitespace-pre-wrap line-clamp-3">{comment.text}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{comment.date}</span>
            {comment.reaction_counter > 0 && (
              <span className="flex items-center gap-1">
                <Heart className="h-3 w-3" />
                {comment.reaction_counter}
              </span>
            )}
            {comment.reply_counter > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {comment.reply_counter}
              </span>
            )}
            {postUrl && (
              <a
                href={postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-600 hover:underline ml-auto"
              >
                <ExternalLink className="h-3 w-3" />
                View post
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkedInReactionCard({ reaction }: { reaction: LinkedInReaction }) {
  const emoji = getActivityReactionEmoji(reaction.value);
  const label = getActivityReactionLabel(reaction.value);

  // Construct LinkedIn post URL from post_id
  const postUrl = reaction.post_id
    ? `https://www.linkedin.com/feed/update/urn:li:activity:${reaction.post_id}`
    : null;

  return (
    <div className="p-3 border rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-lg">
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-sm">
              <span className="font-medium">{label}</span>
              {reaction.comment_id ? ' a comment' : ' a post'}
            </p>
            {postUrl && (
              <a
                href={postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0 ml-2"
              >
                <ExternalLink className="h-3 w-3" />
                View
              </a>
            )}
          </div>
          {reaction.author.name && (
            <p className="text-xs text-muted-foreground truncate">
              Post by {reaction.author.name}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CrmActivityCard({ activity }: { activity: CrmActivity }) {
  return (
    <div className="p-3 border rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <ActivityIcon type={activity.activity_type} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{activity.title}</p>
          {activity.description && (
            <p className="text-sm text-muted-foreground truncate">
              {activity.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(new Date(activity.created_at), {
              addSuffix: true,
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

function LinkedInActivitySkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex gap-2">
        <div className="h-7 w-12 bg-muted rounded" />
        <div className="h-7 w-24 bg-muted rounded" />
        <div className="h-7 w-24 bg-muted rounded" />
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="p-3 border rounded-lg">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-full bg-muted rounded" />
              <div className="h-4 w-2/3 bg-muted rounded" />
              <div className="h-3 w-20 bg-muted rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// LinkedIn Profile Sub-components
// ============================================================================

function LinkedInProfileHeader({ profile }: { profile: LinkedInProfile }) {
  return (
    <div className="flex items-start gap-4">
      {profile.profile_picture_url_large || profile.profile_picture_url ? (
        <img
          src={profile.profile_picture_url_large || profile.profile_picture_url}
          alt={`${profile.first_name} ${profile.last_name}`}
          className="h-16 w-16 rounded-full object-cover border-2 border-blue-100"
        />
      ) : (
        <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xl font-semibold">
          {profile.first_name?.[0] || "?"}
        </div>
      )}

      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-lg">
            {profile.first_name} {profile.last_name}
          </h3>
          {profile.is_premium && (
            <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">
              Premium
            </Badge>
          )}
          {profile.is_influencer && (
            <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
              Influencer
            </Badge>
          )}
          {profile.is_creator && (
            <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
              Creator
            </Badge>
          )}
        </div>

        {profile.headline && (
          <p className="text-sm text-muted-foreground mt-1">{profile.headline}</p>
        )}

        <div className="flex items-center gap-4 mt-2 flex-wrap">
          {profile.location && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {profile.location}
            </span>
          )}

          {profile.connections_count !== undefined && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <UserCheck className="h-3 w-3" />
              {profile.connections_count.toLocaleString()} connections
            </span>
          )}

          {profile.follower_count !== undefined && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" />
              {profile.follower_count.toLocaleString()} followers
            </span>
          )}

          {profile.network_distance && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                profile.network_distance === "FIRST_DEGREE" && "border-green-300 text-green-700",
                profile.network_distance === "SECOND_DEGREE" && "border-blue-300 text-blue-700",
                profile.network_distance === "THIRD_DEGREE" && "border-amber-300 text-amber-700"
              )}
            >
              {profile.network_distance.replace("_", " ").toLowerCase()}
            </Badge>
          )}
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {profile.is_open_to_work && (
            <Badge className="text-xs bg-green-100 text-green-700 border-green-200">
              Open to work
            </Badge>
          )}
          {profile.is_hiring && (
            <Badge className="text-xs bg-primary/10 text-primary border-primary/20">
              Hiring
            </Badge>
          )}
          {profile.can_send_inmail && (
            <Badge variant="outline" className="text-xs">
              InMail available
            </Badge>
          )}
          {profile.is_relationship && (
            <Badge variant="outline" className="text-xs border-green-300 text-green-700">
              <UserCheck className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          )}
        </div>

        {/* External link */}
        {profile.public_profile_url && (
          <Button variant="link" size="sm" className="px-0 mt-2 h-auto" asChild>
            <a href={profile.public_profile_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 mr-1" />
              View on LinkedIn
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function LinkedInContactInfo({ contactInfo }: { contactInfo: LinkedInProfile["contact_info"] }) {
  if (!contactInfo) return null;

  const hasInfo =
    (contactInfo.emails && contactInfo.emails.length > 0) ||
    (contactInfo.phones && contactInfo.phones.length > 0) ||
    (contactInfo.adresses && contactInfo.adresses.length > 0) ||
    (contactInfo.socials && contactInfo.socials.length > 0);

  if (!hasInfo) return null;

  return (
    <ProfileSection title="Contact Info" icon={<Mail className="h-4 w-4" />}>
      <div className="space-y-2">
        {contactInfo.emails?.map((email, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-blue-500" />
            <a href={`mailto:${email}`} className="text-blue-600 hover:underline">
              {email}
            </a>
          </div>
        ))}
        {contactInfo.phones?.map((phone, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 text-green-500" />
            <a href={`tel:${phone}`} className="hover:underline">
              {phone}
            </a>
          </div>
        ))}
        {contactInfo.adresses?.map((address, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-red-500" />
            <span>{address}</span>
          </div>
        ))}
        {contactInfo.socials?.map((social, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            <Globe className="h-4 w-4 text-primary" />
            <span>
              {social.type}: {social.name}
            </span>
          </div>
        ))}
      </div>
    </ProfileSection>
  );
}

function ProfileSection({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h4 className="font-medium text-sm">{title}</h4>
        {count !== undefined && count > 0 && (
          <Badge variant="secondary" className="text-xs">
            {count}
          </Badge>
        )}
      </div>
      {children}
    </div>
  );
}

function ExperienceItem({ experience }: { experience: LinkedInWorkExperience }) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex gap-3">
      {experience.company_picture_url ? (
        <img
          src={experience.company_picture_url}
          alt={experience.company}
          className="h-10 w-10 rounded object-cover"
        />
      ) : (
        <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
          <Building2 className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{experience.position}</p>
        <p className="text-sm text-muted-foreground">{experience.company}</p>
        <p className="text-xs text-muted-foreground">
          {formatDate(experience.start)} - {experience.current ? "Present" : formatDate(experience.end)}
          {experience.location && ` · ${experience.location}`}
        </p>
        {experience.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {experience.description}
          </p>
        )}
        {experience.skills && experience.skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {experience.skills.slice(0, 5).map((skill, idx) => (
              <Badge key={idx} variant="outline" className="text-xs py-0">
                {skill}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EducationItem({ education }: { education: LinkedInEducation }) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return date.getFullYear().toString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex gap-3">
      {education.school_picture_url ? (
        <img
          src={education.school_picture_url}
          alt={education.school}
          className="h-10 w-10 rounded object-cover"
        />
      ) : (
        <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
          <GraduationCap className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{education.school}</p>
        {(education.degree || education.field_of_study) && (
          <p className="text-sm text-muted-foreground">
            {[education.degree, education.field_of_study].filter(Boolean).join(", ")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {formatDate(education.start)} - {formatDate(education.end)}
        </p>
        {education.grade && (
          <p className="text-xs text-muted-foreground">Grade: {education.grade}</p>
        )}
      </div>
    </div>
  );
}

function SkillBadge({ skill }: { skill: LinkedInSkill }) {
  return (
    <Badge
      variant={skill.endorsement_count > 10 ? "default" : "secondary"}
      className="text-xs gap-1"
    >
      {skill.name}
      {skill.endorsement_count > 0 && (
        <span className="text-muted-foreground">({skill.endorsement_count})</span>
      )}
    </Badge>
  );
}

function LinkedInProfileSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex gap-4">
        <div className="h-16 w-16 rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-40 bg-muted rounded" />
          <div className="h-4 w-64 bg-muted rounded" />
          <div className="h-3 w-32 bg-muted rounded" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-4 w-20 bg-muted rounded" />
        <div className="h-16 w-full bg-muted rounded" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-20 w-full bg-muted rounded" />
        <div className="h-20 w-full bg-muted rounded" />
      </div>
    </div>
  );
}

function ActivityTimeline({ activities }: { activities: CrmActivity[] }) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No activity recorded yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-h-[400px] overflow-y-auto">
      {activities.map((activity) => (
        <div key={activity.id} className="flex gap-3">
          <div className="mt-1">
            <ActivityIcon type={activity.activity_type} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{activity.title}</p>
            {activity.description && (
              <p className="text-sm text-muted-foreground truncate">
                {activity.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {formatDistanceToNow(new Date(activity.created_at), {
                addSuffix: true,
              })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    message_sent: <Send className="h-4 w-4 text-blue-500" />,
    message_received: <MessageSquare className="h-4 w-4 text-green-500" />,
    lead_captured: <Target className="h-4 w-4 text-primary" />,
    contact_created: <Users className="h-4 w-4 text-cyan-500" />,
    stage_changed: <Activity className="h-4 w-4 text-amber-500" />,
    note_added: <StickyNote className="h-4 w-4 text-yellow-500" />,
  };

  return (
    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
      {icons[type] || <Clock className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

function NotesList({ notes }: { notes: { id: string; content: string; is_pinned: boolean; created_at: string }[] }) {
  if (notes.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <StickyNote className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No notes yet</p>
        <Button variant="outline" size="sm" className="mt-2">
          Add Note
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto">
      {notes.map((note) => (
        <div
          key={note.id}
          className={cn(
            "p-3 rounded-lg border",
            note.is_pinned && "bg-yellow-50 border-yellow-200"
          )}
        >
          <div className="text-sm prose prose-sm prose-neutral dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
            <ReactMarkdown>{note.content}</ReactMarkdown>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
          </p>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Campaign Outreach View (Enrollment Summary + Activity Timeline)
// ============================================================================

function CampaignOutreachView({ contactId }: { contactId: string }) {
  const { data: campaignProgress, isLoading: progressLoading } = useLeadCampaignProgress(contactId);

  const statusColors: Record<ProgressStatus, string> = {
    pending: "bg-gray-100 text-gray-700",
    in_progress: "bg-blue-100 text-blue-700",
    waiting: "bg-yellow-100 text-yellow-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    replied: "bg-emerald-100 text-emerald-700",
    skipped: "bg-gray-100 text-gray-500",
    handed_off: "bg-indigo-100 text-indigo-700",
    pending_review: "bg-orange-100 text-orange-700",
    sender_disconnected: "bg-orange-100 text-orange-700",
  };

  const statusLabels: Record<ProgressStatus, string> = {
    pending: "Pending",
    in_progress: "In Progress",
    waiting: "Waiting",
    completed: "Completed",
    failed: "Failed",
    replied: "Replied",
    skipped: "Skipped",
    handed_off: "Handed Off",
    pending_review: "Awaiting Review",
    sender_disconnected: "Sender Disconnected",
  };

  return (
    <div className="space-y-4">
      {/* Campaign Enrollment Summary */}
      <div>
        <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Target className="h-4 w-4" />
          Campaign Enrollment
        </h4>
        {progressLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : !campaignProgress || campaignProgress.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not enrolled in any campaigns
          </p>
        ) : (
          <div className="space-y-2">
            {campaignProgress.map((progress) => (
              <div
                key={progress.id}
                className="flex items-center justify-between p-2 rounded-lg border"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Link
                    to={`/campaigns/${progress.campaign_id}`}
                    className="text-sm font-medium truncate hover:underline"
                  >
                    {progress.campaign?.name || "Unknown Campaign"}
                  </Link>
                  {progress.campaign?.status && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {progress.campaign.status}
                    </Badge>
                  )}
                </div>
                <Badge
                  className={cn(
                    "text-xs shrink-0 ml-2",
                    statusColors[progress.status] || "bg-gray-100 text-gray-700"
                  )}
                >
                  {statusLabels[progress.status] || progress.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Action History */}
      <div>
        <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Action History
        </h4>
        <CampaignActivityTimeline
          contactId={contactId}
          showCard={false}
          limit={50}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Loading Skeleton
// ============================================================================

function ContactDetailSkeleton() {
  return (
    <div className="flex-1 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-8 w-32" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="space-y-4">
            <Card>
              <div className="h-16 bg-muted" />
              <CardContent className="pt-0 -mt-8">
                <div className="flex items-start gap-4">
                  <Skeleton className="h-20 w-20 rounded-full" />
                  <div className="flex-1 pt-8 space-y-2">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-5 w-28" />
              </CardContent>
            </Card>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-32 rounded-lg" />
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Skeleton className="h-8 w-48" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
