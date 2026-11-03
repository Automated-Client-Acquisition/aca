import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronsUpDown, ExternalLink, Link2, Loader2, Mail, Megaphone, Plus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EnrollmentModeSelector } from "@/components/lead-lists/EnrollmentModeSelector";
import type { ProcessingOutreachDestination } from "@/components/lead-lists/ConnectedOutreach";
import {
  useAvailableCampaigns,
  useAvailableSequences,
  useCampaignsTargetingList,
  useLinkSmartListToCampaign,
  useLinkSmartListToSequence,
  useSequencesTargetingList,
} from "@/hooks/useDiscovery";

interface LeadListRoutingDialogProps {
  listId: string;
  listName: string;
  isSmart?: boolean;
  processingDestination?: ProcessingOutreachDestination | null;
}

export function LeadListRoutingDialog({ listId, listName, isSmart = false, processingDestination }: LeadListRoutingDialogProps) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [kind, setKind] = useState<"email_sequence" | "linkedin_campaign">("email_sequence");
  const [destinationId, setDestinationId] = useState("");
  const [ongoing, setOngoing] = useState(isSmart);
  const sequences = useSequencesTargetingList(open ? listId : null);
  const campaigns = useCampaignsTargetingList(open ? listId : null);
  const availableSequences = useAvailableSequences();
  const availableCampaigns = useAvailableCampaigns();
  const linkSequence = useLinkSmartListToSequence();
  const linkCampaign = useLinkSmartListToCampaign();
  const linkedIds = new Set((kind === "email_sequence" ? sequences.data : campaigns.data)?.map((destination) => destination.id) ?? []);
  const sourceQuery = kind === "email_sequence" ? availableSequences : availableCampaigns;
  const connectionQuery = kind === "email_sequence" ? sequences : campaigns;
  const destinations = (sourceQuery.data ?? []).filter((destination) =>
    !linkedIds.has(destination.id) &&
    !(processingDestination?.enabled && processingDestination.type === kind && processingDestination.id === destination.id),
  );
  const selected = destinations.find((destination) => destination.id === destinationId);
  const existingSourceCount = selected?.lead_list_ids?.length ?? (selected?.lead_list_id ? 1 : 0);
  const hasExistingSources = existingSourceCount > 0;
  const effectiveOngoing = hasExistingSources ? !!selected?.auto_enroll_new_members : ongoing;
  const loading = sourceQuery.isLoading || connectionQuery.isLoading;
  const hasError = sourceQuery.isError || connectionQuery.isError;
  const connecting = linkSequence.isPending || linkCampaign.isPending;
  const audienceHref = selected
    ? kind === "email_sequence" ? `/email/sequences/${selected.id}?tab=audience` : `/campaigns/${selected.id}/edit?section=leads`
    : "";

  function connect() {
    if (!selected || connecting) return;
    const onSuccess = () => { setDestinationId(""); setOpen(false); };
    if (kind === "email_sequence") {
      linkSequence.mutate({ sequence_id: selected.id, list_id: listId, ongoing }, { onSuccess });
    } else {
      linkCampaign.mutate({ campaign_id: selected.id, list_id: listId, ongoing }, { onSuccess });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (connecting) return;
      setOpen(next);
      if (!next) { setDestinationId(""); setPickerOpen(false); }
    }}>
      <DialogTrigger asChild><Button variant="cta" size="sm"><Plus className="mr-1.5 h-4 w-4" />Connect outreach</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect {listName} to outreach</DialogTitle>
          <DialogDescription>Add this {isSmart ? "smart segment" : "list"} as an audience source. The destination keeps its senders, schedule and eligibility rules.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Outreach type">
            {[{ value: "email_sequence" as const, label: "Email sequence", icon: Mail }, { value: "linkedin_campaign" as const, label: "Campaign", icon: Megaphone }].map((option) => (
              <Button
                key={option.value} variant="outline" aria-pressed={kind === option.value} disabled={connecting}
                className={kind === option.value ? "border-amber-500/50 bg-amber-500/5" : ""}
                onClick={() => { setKind(option.value); setDestinationId(""); }}
              ><option.icon className="mr-1.5 h-4 w-4" />{option.label}</Button>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Choose a destination</p>
            {hasError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Destinations could not be loaded.</span><Button variant="outline" size="sm" onClick={() => { void sourceQuery.refetch(); void connectionQuery.refetch(); }}>Retry</Button>
            </div> : (
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild><Button variant="outline" role="combobox" aria-expanded={pickerOpen} disabled={loading || connecting} className="w-full justify-between">
                  <span className="truncate">{loading ? "Loading destinations…" : selected?.name ?? "Search destinations…"}</span><ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Button></PopoverTrigger>
                <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0">
                  <Command>
                    <CommandInput placeholder="Search destination names…" />
                    <CommandList>
                      <CommandEmpty>No available destinations match.</CommandEmpty>
                      {["active", "draft", "paused"].map((status) => {
                        const group = destinations.filter((destination) => destination.status === status);
                        return group.length > 0 && <CommandGroup key={status} heading={status === "active" ? "Active outreach" : status === "draft" ? "Drafts" : "Paused outreach"}>
                          {group.map((destination) => (
                            <CommandItem key={destination.id} value={`${destination.name} ${destination.id}`} className="py-2.5" onSelect={() => { setDestinationId(destination.id); setOngoing(isSmart); setPickerOpen(false); }}>
                              <span className="flex-1 truncate">{destination.name}</span>
                              <span className="ml-2 shrink-0 text-xs text-muted-foreground">{(destination.lead_list_ids?.length ?? 0) > 0 ? destination.auto_enroll_new_members ? "Continuous" : "One-time" : "No sources"}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>;
                      })}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
            {!loading && !hasError && destinations.length === 0 && <p className="text-xs text-muted-foreground">Create a {kind === "email_sequence" ? "sequence" : "campaign"} first, or use one of the connections already shown on this audience.</p>}
          </div>

          {selected && <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{selected.name}</span><Badge variant="outline" className="capitalize">{selected.status}</Badge>
            </div>
            {hasExistingSources ? <>
              <Badge variant="secondary">{effectiveOngoing ? "Continuous enrollment" : "One-time audience"}</Badge>
              <p className="text-xs leading-relaxed text-muted-foreground">This destination already has {existingSourceCount} audience source{existingSourceCount === 1 ? "" : "s"}. Its current enrollment mode applies to this connection too. Change it in the destination’s audience settings.</p>
            </> : <EnrollmentModeSelector
              value={ongoing} onChange={setOngoing} leadCount={0}
              list={{ is_smart: isSmart, source_type: isSmart ? "smart" : "manual" }}
              context={kind === "email_sequence" ? "sequence" : "campaign"} disabled={connecting}
            />}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {effectiveOngoing && selected.status === "active"
                ? "This destination is active. Eligible current members can enroll and begin outreach after you connect."
                : selected.status === "draft" || selected.status === "paused"
                  ? "Connecting does not activate this destination. Review its audience and sending setup before activating."
                  : kind === "email_sequence"
                    ? "Connecting adds the source. Review and enroll the current audience in the sequence when ready."
                    : "Connecting adds the source. Review the campaign audience before its next launch."}
            </p>
            <Button variant="link" className="h-auto p-0 text-xs" asChild><Link to={audienceHref}><ExternalLink className="mr-1 h-3 w-3" />Open audience settings</Link></Button>
          </div>}

          {processingDestination && <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><Workflow className="mt-0.5 h-3.5 w-3.5 shrink-0" />A processing route is configured for this source. Manage approval and routing in processing settings. Direct connections use the destination’s audience rules.</p>}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" disabled={connecting} onClick={() => { setOpen(false); setDestinationId(""); setPickerOpen(false); }}>Cancel</Button>
            <Button variant="cta" disabled={!selected || hasError || loading || connecting} onClick={connect}>{connecting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}{connecting ? "Connecting…" : "Connect source"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
