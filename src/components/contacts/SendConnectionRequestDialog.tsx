import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Send, Linkedin, Building2, AlertCircle, Sparkles, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useGenerateCampaignMessage } from "@/hooks/useGenerateCampaignMessage";
import type { CrmContact } from "@/hooks/crm/useContacts";

interface SendConnectionRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: CrmContact | null;
  accountId: string | null;
  onSubmit: (message?: string) => Promise<void>;
  isLoading?: boolean;
}

const MAX_MESSAGE_LENGTH = 300;

export function SendConnectionRequestDialog({
  open,
  onOpenChange,
  contact,
  accountId,
  onSubmit,
  isLoading,
}: SendConnectionRequestDialogProps) {
  const [message, setMessage] = useState("");
  const generateMessage = useGenerateCampaignMessage();

  // Reset message when dialog opens
  useEffect(() => {
    if (open) {
      setMessage("");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(message.trim() || undefined);
  };

  const handleGenerateWithAI = async () => {
    if (!contact) return;

    try {
      const result = await generateMessage.mutateAsync({
        messageType: "connectionRequest",
        context: {
          tonePreference: "professional",
        },
        sampleEnrichment: {
          firstName: contact.first_name || contact.display_name?.split(' ')[0] || '',
          lastName: contact.last_name || '',
          fullName: contact.display_name || '',
          company: contact.company || '',
          jobTitle: contact.job_title || '',
          industry: (contact.enrichment_data as Record<string, string>)?.industry || '',
          companySize: (contact.enrichment_data as Record<string, string>)?.company_size || '',
          location: [contact.city, contact.state, contact.country].filter(Boolean).join(', ') || '',
        },
      });

      if (result.success && result.message) {
        // Replace variables with actual contact data
        let personalizedMessage = result.message;
        personalizedMessage = personalizedMessage.replace(/\{\{firstName\}\}/g, contact.first_name || contact.display_name?.split(' ')[0] || '');
        personalizedMessage = personalizedMessage.replace(/\{\{lastName\}\}/g, contact.last_name || '');
        personalizedMessage = personalizedMessage.replace(/\{\{fullName\}\}/g, contact.display_name || '');
        personalizedMessage = personalizedMessage.replace(/\{\{company\}\}/g, contact.company || '');
        personalizedMessage = personalizedMessage.replace(/\{\{jobTitle\}\}/g, contact.job_title || '');

        setMessage(personalizedMessage);
      }
    } catch {
      // Error handled by hook
    }
  };

  const charactersRemaining = MAX_MESSAGE_LENGTH - message.length;
  const isOverLimit = charactersRemaining < 0;

  // Get contact initials for avatar fallback
  const getInitials = () => {
    if (!contact) return "?";
    const first = contact.first_name?.[0] || contact.display_name?.[0] || "";
    const last = contact.last_name?.[0] || "";
    return (first + last).toUpperCase() || "?";
  };

  // Get LinkedIn identity avatar
  const getAvatarUrl = () => {
    if (!contact) return undefined;
    if (contact.avatar_url) return contact.avatar_url;
    const linkedinIdentity = contact.identities?.find(
      (i) => i.channel === "linkedin"
    );
    return linkedinIdentity?.platform_avatar_url || undefined;
  };

  if (!contact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden">
        <form onSubmit={handleSubmit}>
          {/* Header with LinkedIn branding */}
          <div className="bg-[#0A66C2] px-6 py-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <Linkedin className="h-5 w-5" />
                Connect on LinkedIn
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-5">
            {/* Contact card */}
            <div className="flex items-start gap-4">
              <Avatar className="h-14 w-14 ring-2 ring-background shadow-md">
                <AvatarImage src={getAvatarUrl()} />
                <AvatarFallback className="bg-gradient-to-br from-slate-600 to-slate-800 text-white text-lg">
                  {getInitials()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 pt-1">
                <p className="font-semibold text-base truncate">{contact.display_name}</p>
                {contact.job_title && (
                  <p className="text-sm text-muted-foreground truncate">
                    {contact.job_title}
                  </p>
                )}
                {contact.company && (
                  <p className="text-sm text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                    <Building2 className="h-3 w-3 shrink-0" />
                    {contact.company}
                  </p>
                )}
              </div>
            </div>

            {/* Message input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Add a note</span>
                <span
                  className={`text-xs tabular-nums ${
                    isOverLimit
                      ? "text-destructive font-medium"
                      : charactersRemaining < 50
                      ? "text-amber-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {message.length}/{MAX_MESSAGE_LENGTH}
                </span>
              </div>
              <Textarea
                placeholder={`Hi ${contact.first_name || contact.display_name?.split(' ')[0] || 'there'}, I'd like to connect with you on LinkedIn.`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className={`resize-none ${isOverLimit ? "border-destructive focus-visible:ring-destructive" : ""}`}
              />

              {/* AI Generate button */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Personalized invitations are 30% more likely to be accepted
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerateWithAI}
                  disabled={generateMessage.isPending}
                  className="h-7 gap-1.5 text-primary hover:text-primary hover:bg-primary/5"
                >
                  {generateMessage.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Generating...
                    </>
                  ) : message ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Regenerate
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      Write with AI
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Warning if no account */}
            {!accountId && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No LinkedIn account connected. Please connect one first.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="px-6 py-4 bg-muted/30 border-t">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || isOverLimit || !accountId}
              className="bg-[#0A66C2] hover:bg-[#004182] min-w-[100px]"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
