import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import {
  CheckCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Edit,
  Save,
  X,
  Loader2,
  Mail,
  Clock,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCampaignPendingReviewSequences,
  useApproveAndPushSequences,
  useRegenerateSequence,
  useUpdateContactEmailSequence,
  type PendingReviewSequence,
  type GeneratedEmail,
} from "@/hooks/useEmailSequences";

const TOOL_LABELS: Record<string, string> = {
  smartlead: "Smartlead",
  instantly: "Instantly",
  leadconnector: "LeadConnector",
};

interface CampaignSequenceReviewProps {
  campaignId: string;
}

export function CampaignSequenceReview({ campaignId }: CampaignSequenceReviewProps) {
  const { data: sequences, isLoading, error, refetch, isFetching } = useCampaignPendingReviewSequences(campaignId);
  const approveAndPush = useApproveAndPushSequences();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => { setSelectedIds(new Set()); }, [campaignId]);
  const eligibleIds = new Set((sequences || []).map((sequence) => sequence.id));
  const selectedSequenceIds = [...selectedIds].filter((id) => eligibleIds.has(id));
  const selectedCount = selectedSequenceIds.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!sequences) return;
    if (selectedCount === sequences.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sequences.map((s) => s.id)));
    }
  };

  const handleApproveSelected = () => {
    approveAndPush.mutate(
      { sequenceIds: selectedSequenceIds },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const handleApproveAll = () => {
    if (!sequences) return;
    approveAndPush.mutate(
      { sequenceIds: sequences.map((s) => s.id) },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl shadow-none">
      <CardHeader className="border-b px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-5 w-5" />
            Email review queue
          </CardTitle>
          {sequences && sequences.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={selectedCount === 0 || approveAndPush.isPending}
                onClick={handleApproveSelected}
              >
                {approveAndPush.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Approve Selected ({selectedCount})
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="cta"
                    size="sm"
                    disabled={approveAndPush.isPending}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve All ({sequences.length})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Approve all sequences?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will push all {sequences.length} email sequences to their respective email tools.
                      Make sure you've reviewed the content.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleApproveAll}>
                      Approve All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Review personalized emails before approval queues them in the configured email tool.</p>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {error ? (
          <div role="alert" className="py-10 text-center">
            <p className="text-sm font-medium">Unable to load the review queue</p>
            <p className="mt-1 text-xs text-muted-foreground">Retry to see emails that need approval.</p>
            <Button variant="outline" className="mt-4" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Retry
            </Button>
          </div>
        ) : !sequences || sequences.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center mb-4">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg mb-2">All caught up</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              No email sequences are awaiting review. New sequences will appear here when
              this campaign generates personalized emails that require approval.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Select all */}
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                checked={selectedCount === sequences.length && sequences.length > 0}
                onCheckedChange={selectAll}
                aria-label="Select all emails awaiting review"
              />
              <span className="text-sm text-muted-foreground">
                Select all ({sequences.length})
              </span>
            </div>

            {sequences.map((seq) => (
              <ReviewSequenceCard
                key={seq.id}
                sequence={seq}
                selected={selectedIds.has(seq.id)}
                onSelect={() => toggleSelect(seq.id)}
                isPushing={approveAndPush.isPending}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewSequenceCard({
  sequence,
  selected,
  onSelect,
  isPushing,
}: {
  sequence: PendingReviewSequence;
  selected: boolean;
  onSelect: () => void;
  isPushing: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const approveAndPush = useApproveAndPushSequences();
  const regenerate = useRegenerateSequence();

  const contact = sequence.contact;
  const contactName = contact?.first_name || contact?.last_name
    ? `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim()
    : contact?.display_name || "Unknown";
  const initials =
    (contact?.first_name?.[0] || '') + (contact?.last_name?.[0] || '') ||
    contact?.display_name?.[0] || '?';
  const toolLabel = TOOL_LABELS[sequence.tool_type || ''] || sequence.tool_type || 'Unknown';

  return (
    <div className="border rounded-lg">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
          <Checkbox checked={selected} onCheckedChange={onSelect} aria-label={`Select emails for ${contactName}`} />

          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-3 flex-1 min-w-[140px] text-left hover:opacity-80">
              {contact?.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium flex-shrink-0">
                  {initials}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{contactName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[contact?.job_title, contact?.company].filter(Boolean).join(' at ')}
                </p>
              </div>
            </button>
          </CollapsibleTrigger>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              <Mail className="h-3 w-3 mr-1" />
              {sequence.email_count} emails
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {toolLabel}
            </Badge>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`${isExpanded ? "Collapse" : "Review"} emails for ${contactName}`}>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t px-3 pb-3 pt-3 space-y-3">
            {/* Email steps with inline editing */}
            <div className="space-y-3 sm:pl-8">
              {sequence.emails.map((email, index) => (
                <ReviewEmailStep
                  key={index}
                  email={email}
                  sequenceId={sequence.id}
                  allEmails={sequence.emails}
                  isLast={index === sequence.emails.length - 1}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={regenerate.isPending}
                  >
                    {regenerate.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Regenerate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate sequence?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete the current sequence and regenerate it on the next processing cycle.
                      Any edits you've made will be lost.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => regenerate.mutate({ sequenceId: sequence.id })}
                    >
                      Regenerate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                variant="cta"
                size="sm"
                disabled={approveAndPush.isPending || isPushing}
                onClick={() => approveAndPush.mutate({ sequenceIds: [sequence.id] })}
              >
                {approveAndPush.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Approve & Push
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function ReviewEmailStep({
  email,
  sequenceId,
  allEmails,
  isLast,
}: {
  email: GeneratedEmail;
  sequenceId: string;
  allEmails: GeneratedEmail[];
  isLast: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedSubject, setEditedSubject] = useState(email.subject);
  const [editedBody, setEditedBody] = useState(email.body);
  const updateSequence = useUpdateContactEmailSequence();

  const handleSave = () => {
    const updatedEmails = allEmails.map((e) =>
      e.step === email.step
        ? { ...e, subject: editedSubject, body: editedBody }
        : e
    );

    updateSequence.mutate(
      { sequenceId, updates: { emails: updatedEmails } },
      { onSuccess: () => setIsEditing(false) }
    );
  };

  const handleCancel = () => {
    setEditedSubject(email.subject);
    setEditedBody(email.body);
    setIsEditing(false);
  };

  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute left-4 top-10 bottom-0 w-0.5 bg-border" />
      )}

      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-semibold">
            {email.step}
          </div>
        </div>

        <div className="min-w-0 flex-1 bg-muted/30 rounded-lg p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {email.delay_days === 0 ? 'Send immediately' : `Wait ${email.delay_days} day${email.delay_days !== 1 ? 's' : ''}`}
            </div>
            {!isEditing && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setIsEditing(true)}
              >
                <Edit className="h-3 w-3 mr-1" />
                Edit
              </Button>
            )}
          </div>

          {isEditing ? (
            <>
              <div className="space-y-2">
                <div>
                  <label htmlFor={`review-subject-${sequenceId}-${email.step}`} className="text-xs font-medium text-muted-foreground">Subject</label>
                  <Input
                    id={`review-subject-${sequenceId}-${email.step}`}
                    value={editedSubject}
                    onChange={(e) => setEditedSubject(e.target.value)}
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor={`review-body-${sequenceId}-${email.step}`} className="text-xs font-medium text-muted-foreground">Body</label>
                  <Textarea
                    id={`review-body-${sequenceId}-${email.step}`}
                    value={editedBody}
                    onChange={(e) => setEditedBody(e.target.value)}
                    className="mt-1 min-h-[120px] text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  <X className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
                <Button
                  variant="cta"
                  size="sm"
                  onClick={handleSave}
                  disabled={updateSequence.isPending}
                >
                  {updateSequence.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3 mr-1" />
                  )}
                  Save
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Subject</div>
                <div className="break-words text-sm font-medium">{email.subject}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Body</div>
                <div
                  className="break-words text-sm text-muted-foreground [&_img]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.body) }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
