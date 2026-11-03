/**
 * EmailSequenceView Component
 *
 * Displays and allows editing of email sequences for a contact.
 * Shows sequence list, individual email preview/edit, and generation actions.
 */

import { useState } from "react";
import {
  Mail,
  ChevronDown,
  ChevronUp,
  Edit,
  Trash2,
  Save,
  X,
  Clock,
  CheckCircle2,
  Send,
  RefreshCw,
  Loader2,
  Plus,
  AlertCircle,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  useContactEmailSequences,
  useUpdateContactEmailSequence,
  useDeleteContactEmailSequence,
  type ContactEmailSequence,
  type GeneratedEmail,
} from "@/hooks/useEmailSequences";

interface EmailSequenceViewProps {
  contactId: string;
  contactName: string;
  onGenerateNew?: () => void;
}

export function EmailSequenceView({
  contactId,
  contactName,
  onGenerateNew,
}: EmailSequenceViewProps) {
  const { data: sequences, isLoading, error } = useContactEmailSequences(contactId);

  if (isLoading) {
    return <EmailSequenceViewSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <AlertCircle className="h-8 w-8 text-red-500 mb-2" />
        <p className="text-sm text-muted-foreground">Failed to load sequences</p>
      </div>
    );
  }

  if (!sequences || sequences.length === 0) {
    return (
      <EmptySequenceState contactName={contactName} onGenerate={onGenerateNew} />
    );
  }

  const currentSequences = sequences.filter(
    (s) => s.status === 'ready' || s.status === 'generating' || s.status === 'draft'
  );
  const historySequences = sequences.filter(
    (s) => s.status === 'pushed' || s.status === 'archived' || s.status === 'failed'
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {sequences.length} sequence{sequences.length !== 1 ? 's' : ''} generated
        </div>
        {onGenerateNew && (
          <Button variant="outline" size="sm" onClick={onGenerateNew}>
            <Plus className="h-4 w-4 mr-2" />
            New Sequence
          </Button>
        )}
      </div>

      {/* Current sequences */}
      {currentSequences.length > 0 && (
        <div className="space-y-3">
          {historySequences.length > 0 && (
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Current
            </h4>
          )}
          {currentSequences.map((sequence) => (
            <SequenceCard key={sequence.id} sequence={sequence} />
          ))}
        </div>
      )}

      {/* History sequences */}
      {historySequences.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            History
          </h4>
          {historySequences.map((sequence) => (
            <SequenceCard key={sequence.id} sequence={sequence} defaultCollapsed />
          ))}
        </div>
      )}
    </div>
  );
}

// Empty state component
function EmptySequenceState({
  contactName,
  onGenerate,
}: {
  contactName: string;
  onGenerate?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-4">
        <Mail className="h-8 w-8 text-blue-600" />
      </div>
      <h3 className="font-semibold text-lg mb-2">No Email Sequences</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Generate AI-personalized email sequences for {contactName} based on their company analysis data.
      </p>
      {onGenerate ? (
        <Button onClick={onGenerate}>
          <Sparkles className="h-4 w-4 mr-2" />
          Generate Email Sequence
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Select this contact from a lead list to generate sequences.
        </p>
      )}
    </div>
  );
}

// Individual sequence card
function SequenceCard({ sequence, defaultCollapsed }: { sequence: ContactEmailSequence; defaultCollapsed?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const deleteSequence = useDeleteContactEmailSequence();

  const statusBadge = {
    draft: { label: 'Draft', variant: 'secondary' as const, icon: Edit },
    generating: { label: 'Generating', variant: 'secondary' as const, icon: Loader2 },
    ready: { label: 'Ready', variant: 'default' as const, icon: CheckCircle2 },
    pushed: { label: 'Pushed', variant: 'default' as const, icon: Send },
    failed: { label: 'Failed', variant: 'destructive' as const, icon: AlertCircle },
    archived: { label: 'Archived', variant: 'secondary' as const, icon: Clock },
  }[sequence.status];

  const StatusIcon = statusBadge.icon;

  return (
    <Card>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <div>
                <CardTitle className="text-sm font-medium">
                  {sequence.name || `${sequence.email_count}-Email Sequence`}
                </CardTitle>
                <CardDescription className="text-xs">
                  {sequence.generated_at
                    ? `Generated ${formatDistanceToNow(new Date(sequence.generated_at), { addSuffix: true })}`
                    : `Created ${formatDistanceToNow(new Date(sequence.created_at), { addSuffix: true })}`}
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                variant={statusBadge.variant}
                className={cn(
                  "gap-1",
                  sequence.status === 'ready' && "bg-green-100 text-green-700 hover:bg-green-100",
                  sequence.status === 'pushed' && "bg-blue-100 text-blue-700 hover:bg-blue-100",
                  sequence.status === 'archived' && "bg-gray-100 text-gray-500 hover:bg-gray-100"
                )}
              >
                <StatusIcon className={cn(
                  "h-3 w-3",
                  sequence.status === 'generating' && "animate-spin"
                )} />
                {statusBadge.label}
              </Badge>

              {sequence.pushed_to_tool && (
                <Badge variant="outline" className="text-xs">
                  {sequence.pushed_to_tool}
                </Badge>
              )}

              {sequence.notion_preview_url && (
                <a
                  href={sequence.notion_preview_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Badge variant="outline" className="text-xs gap-1 cursor-pointer hover:bg-accent">
                    <ExternalLink className="h-3 w-3" />
                    Notion Preview
                  </Badge>
                </a>
              )}

              {/* Hide delete on pushed/archived — they are historical records */}
              {sequence.status !== 'pushed' && sequence.status !== 'archived' && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Sequence?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this email sequence. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteSequence.mutate(sequence.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="space-y-3">
              {sequence.emails.map((email, index) => (
                <EmailStepCard
                  key={index}
                  email={email}
                  sequenceId={sequence.id}
                  allEmails={sequence.emails}
                  isLast={index === sequence.emails.length - 1}
                />
              ))}
            </div>

            {/* Config summary */}
            <div className="mt-4 pt-3 border-t flex flex-wrap gap-2 text-xs text-muted-foreground">
              {sequence.generation_config.prompt && (
                <Badge variant="outline" className="text-xs font-normal max-w-[300px] truncate" title={sequence.generation_config.prompt}>
                  Prompt: {sequence.generation_config.prompt.substring(0, 80)}...
                </Badge>
              )}
              {sequence.generation_config.tone && (
                <Badge variant="outline" className="text-xs font-normal">
                  {sequence.generation_config.tone} tone
                </Badge>
              )}
              {sequence.generation_config.ctaType && (
                <Badge variant="outline" className="text-xs font-normal">
                  {sequence.generation_config.ctaType} CTA
                </Badge>
              )}
              {sequence.generation_config.delayPattern && (
                <Badge variant="outline" className="text-xs font-normal">
                  {sequence.generation_config.delayPattern} timing
                </Badge>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// Individual email step card with inline editing
function EmailStepCard({
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
      {
        onSuccess: () => setIsEditing(false),
      }
    );
  };

  const handleCancel = () => {
    setEditedSubject(email.subject);
    setEditedBody(email.body);
    setIsEditing(false);
  };

  return (
    <div className="relative">
      {/* Timeline connector */}
      {!isLast && (
        <div className="absolute left-4 top-10 bottom-0 w-0.5 bg-border" />
      )}

      <div className="flex gap-3">
        {/* Step indicator */}
        <div className="flex flex-col items-center">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-semibold">
            {email.step}
          </div>
        </div>

        {/* Email content */}
        <div className="flex-1 bg-muted/30 rounded-lg p-3 space-y-2">
          {/* Header with delay */}
          <div className="flex items-center justify-between">
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
                  <label className="text-xs font-medium text-muted-foreground">Subject</label>
                  <Input
                    value={editedSubject}
                    onChange={(e) => setEditedSubject(e.target.value)}
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Body</label>
                  <Textarea
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
                <div className="text-sm font-medium">{email.subject}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Body</div>
                <div
                  className="text-sm text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: email.body }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Loading skeleton
function EmailSequenceViewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>
      <Card>
        <CardHeader className="py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
