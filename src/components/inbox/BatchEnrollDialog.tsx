import { useState, useMemo } from "react";
import { Mail, AlertTriangle, Loader2, Search, Check, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useEmailSequences, type SequenceWithStats } from "@/hooks/useEmailSequences";
import { useBulkEnrollLeads } from "@/hooks/useEmailEnrollments";
import type { ConversationWithContact } from "@/hooks/crm/useConversations";

const DELAY_OPTIONS = [
  { value: "0", label: "No delay (send immediately)" },
  { value: "1", label: "1 hour" },
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "1 day" },
  { value: "48", label: "2 days" },
  { value: "72", label: "3 days" },
  { value: "168", label: "1 week" },
  { value: "custom", label: "Custom..." },
];

interface BatchEnrollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: ConversationWithContact[];
  onComplete: () => void;
}

export function BatchEnrollDialog({
  open,
  onOpenChange,
  conversations,
  onComplete,
}: BatchEnrollDialogProps) {
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [delayPreset, setDelayPreset] = useState("0");
  const [customDelayHours, setCustomDelayHours] = useState("");
  const { data: sequences, isLoading: sequencesLoading } = useEmailSequences();
  const enrollMutation = useBulkEnrollLeads();

  // Extract unique contact IDs from conversations
  const contactIds = useMemo(() => {
    const ids = new Set<string>();
    for (const conv of conversations) {
      if (conv.contact_id) ids.add(conv.contact_id);
    }
    return [...ids];
  }, [conversations]);

  // Count contacts with emails
  const contactsWithEmail = useMemo(() => {
    return conversations.filter((c) => c.contact?.primary_email).length;
  }, [conversations]);

  // Filter sequences by search
  const filteredSequences = useMemo(() => {
    if (!sequences) return [];
    const q = search.toLowerCase();
    return sequences.filter(
      (s) => !q || s.name.toLowerCase().includes(q)
    );
  }, [sequences, search]);

  const effectiveDelayHours = delayPreset === "custom"
    ? parseFloat(customDelayHours) || 0
    : parseInt(delayPreset, 10);

  const handleEnroll = async () => {
    if (!selectedSequenceId || contactIds.length === 0) return;

    await enrollMutation.mutateAsync({
      sequence_id: selectedSequenceId,
      lead_ids: contactIds,
      ...(effectiveDelayHours > 0 ? { delay_hours: effectiveDelayHours } : {}),
    });

    onComplete();
    onOpenChange(false);
    setSelectedSequenceId(null);
    setSearch("");
    setDelayPreset("0");
    setCustomDelayHours("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Enroll in Email Sequence</DialogTitle>
          <DialogDescription>
            Enroll {contactIds.length} contact{contactIds.length !== 1 ? "s" : ""} from
            selected conversations into an email sequence.
            {contactsWithEmail < contactIds.length && (
              <span className="flex items-center gap-1 mt-1 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                {contactIds.length - contactsWithEmail} contact{contactIds.length - contactsWithEmail !== 1 ? "s" : ""} without email will be skipped.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Sequence Picker */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search sequences..."
              className="pl-9 h-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <ScrollArea className="h-[240px] border rounded-md">
            {sequencesLoading ? (
              <div className="flex items-center justify-center h-full p-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredSequences.length === 0 ? (
              <div className="flex items-center justify-center h-full p-8">
                <p className="text-sm text-muted-foreground">
                  {search ? "No sequences match your search" : "No email sequences found"}
                </p>
              </div>
            ) : (
              <div className="p-1 space-y-0.5">
                {filteredSequences.map((seq) => (
                  <SequenceRow
                    key={seq.id}
                    sequence={seq}
                    isSelected={seq.id === selectedSequenceId}
                    onClick={() => setSelectedSequenceId(seq.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Delay before first email */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Delay before first email
          </Label>
          <div className="flex items-center gap-2">
            <Select value={delayPreset} onValueChange={setDelayPreset}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELAY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {delayPreset === "custom" && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Hours"
                  className="h-8 w-20 text-sm"
                  value={customDelayHours}
                  onChange={(e) => setCustomDelayHours(e.target.value)}
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">hours</span>
              </div>
            )}
          </div>
          {effectiveDelayHours > 0 && (
            <p className="text-[11px] text-muted-foreground">
              First email will be sent ~{formatDelay(effectiveDelayHours)} from now
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            disabled={!selectedSequenceId || enrollMutation.isPending}
            onClick={handleEnroll}
          >
            {enrollMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Enrolling...
              </>
            ) : (
              <>Enroll {contactIds.length} Contact{contactIds.length !== 1 ? "s" : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDelay(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remaining = hours % 24;
  if (remaining === 0) return `${days}d`;
  return `${days}d ${remaining}h`;
}

function SequenceRow({
  sequence,
  isSelected,
  onClick,
}: {
  sequence: SequenceWithStats;
  isSelected: boolean;
  onClick: () => void;
}) {
  const stepCount = sequence.steps?.length ?? 0;

  const statusDot = sequence.status === "active"
    ? "bg-green-500"
    : sequence.status === "paused"
    ? "bg-yellow-500"
    : "bg-gray-400";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
        isSelected
          ? "bg-accent"
          : "hover:bg-accent/50"
      )}
    >
      {/* Selection indicator */}
      <div className={cn(
        "flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
        isSelected
          ? "border-amber-500 bg-amber-500 text-white"
          : "border-muted-foreground/30"
      )}>
        {isSelected && <Check className="h-3 w-3" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm truncate", isSelected && "font-medium")}>{sequence.name}</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className={cn("w-1.5 h-1.5 rounded-full", statusDot)} />
            <span className="text-[10px] text-muted-foreground capitalize">{sequence.status}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-[11px] text-muted-foreground">
          <span>{stepCount} step{stepCount !== 1 ? "s" : ""}</span>
          {sequence.enrollment_active > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{sequence.enrollment_active} active</span>
            </>
          )}
          {sequence.enrollment_total > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{sequence.enrollment_total} total</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
