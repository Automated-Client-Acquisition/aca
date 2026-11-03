import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Mail,
  Phone,
  Building2,
  Briefcase,
  AlertCircle,
  Check,
  Plus,
  X,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePushContactToGHL } from "@/hooks/usePushContactToGHL";
import { useTags } from "@/hooks/crm/useTags";
import type { ConversationWithContact } from "@/hooks/crm/useConversations";

interface PushToLeadConnectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationWithContact;
}

export function PushToLeadConnectorDialog({
  open,
  onOpenChange,
  conversation,
}: PushToLeadConnectorDialogProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [applyTagsLocally, setApplyTagsLocally] = useState(true);
  const [tagSearch, setTagSearch] = useState("");
  const [newTagInput, setNewTagInput] = useState("");

  const pushMutation = usePushContactToGHL();
  const { data: availableTags = [], isLoading: tagsLoading } = useTags();

  const contact = conversation.contact;
  const hasEmail = !!contact?.primary_email;
  const hasPhone = !!contact?.primary_phone;
  const isValid = hasEmail || hasPhone;

  const filteredTags = tagSearch
    ? availableTags.filter((t) =>
        t.name.toLowerCase().includes(tagSearch.toLowerCase())
      )
    : availableTags;

  const handlePush = async () => {
    if (!contact || !isValid) return;

    await pushMutation.mutateAsync({
      contactId: contact.id,
      conversationId: conversation.id,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      applyTagsLocally:
        selectedTags.length > 0 ? applyTagsLocally : undefined,
    });

    onOpenChange(false);
    setSelectedTags([]);
    setApplyTagsLocally(true);
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedTags([]);
    setApplyTagsLocally(true);
    setTagSearch("");
    setNewTagInput("");
  };

  const handleToggleTag = (tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName)
        ? prev.filter((t) => t !== tagName)
        : [...prev, tagName]
    );
  };

  const handleRemoveTag = (tagName: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tagName));
  };

  const handleCreateTag = () => {
    const trimmed = newTagInput.trim();
    if (!trimmed || selectedTags.includes(trimmed)) return;
    setSelectedTags((prev) => [...prev, trimmed]);
    setNewTagInput("");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Push to Lead Connector</DialogTitle>
          <DialogDescription>
            Push this contact to your GoHighLevel account
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Validation Alert */}
          {!isValid && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Contact must have at least an email or phone number to push to
                Lead Connector.
              </AlertDescription>
            </Alert>
          )}

          {/* Contact Preview */}
          <div className="rounded-lg border p-3 space-y-1.5">
            <div className="font-medium text-sm">
              {contact?.display_name || "Unknown Contact"}
            </div>

            {hasEmail && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                {contact.primary_email}
              </div>
            )}

            {hasPhone && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                {contact.primary_phone}
              </div>
            )}

            {contact?.company && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                {contact.company}
              </div>
            )}

            {contact?.job_title && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Briefcase className="h-3.5 w-3.5 shrink-0" />
                {contact.job_title}
              </div>
            )}
          </div>

          {/* Tag Selection — inline in dialog */}
          <div className="space-y-2">
            <Label>Tags (optional)</Label>

            <div className="rounded-md border">
              {/* Search */}
              <div className="flex items-center border-b px-3">
                <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                <input
                  placeholder="Search tags..."
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>

              {/* Tag list */}
              <ScrollArea className="max-h-[150px]">
                <div className="p-1">
                  {tagsLoading ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Loading tags...
                    </p>
                  ) : filteredTags.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No tags found.
                    </p>
                  ) : (
                    filteredTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => handleToggleTag(tag.name)}
                        className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0",
                            selectedTags.includes(tag.name)
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        <div
                          className="mr-2 h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 truncate text-left">
                          {tag.name}
                        </span>
                        {tag.contact_count > 0 && (
                          <span className="text-xs text-muted-foreground">
                            ({tag.contact_count})
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>

              {/* Create new tag */}
              <div className="border-t p-2">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="New tag name..."
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleCreateTag();
                      }
                    }}
                    className="h-8"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleCreateTag}
                    disabled={!newTagInput.trim()}
                    className="h-8 px-2 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Selected Tags */}
            {selectedTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedTags.map((tagName) => {
                  const tag = availableTags.find((t) => t.name === tagName);
                  return (
                    <Badge
                      key={tagName}
                      variant="secondary"
                      className="hover:bg-secondary/80"
                      style={
                        tag
                          ? { borderLeft: `3px solid ${tag.color}` }
                          : undefined
                      }
                    >
                      {tagName}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tagName)}
                        className="ml-1 rounded-full outline-none hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                        <span className="sr-only">Remove {tagName}</span>
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Apply Tags Locally Checkbox */}
          {selectedTags.length > 0 && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="apply-locally"
                checked={applyTagsLocally}
                onCheckedChange={(checked) => setApplyTagsLocally(!!checked)}
              />
              <Label
                htmlFor="apply-locally"
                className="text-sm font-normal cursor-pointer"
              >
                Also apply tags to this contact in ACA
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handlePush}
            disabled={!isValid || pushMutation.isPending}
          >
            {pushMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Push to Lead Connector
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
