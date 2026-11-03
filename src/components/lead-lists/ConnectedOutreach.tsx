import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Link2, Mail, Megaphone, Unlink, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadListRoutingDialog } from "@/components/lead-lists/LeadListRoutingDialog";
import {
  useCampaignsTargetingList,
  useSequencesTargetingList,
  useUnlinkListFromCampaign,
  useUnlinkListFromSequence,
} from "@/hooks/useDiscovery";

export interface ProcessingOutreachDestination {
  type: "email_sequence" | "linkedin_campaign";
  id: string;
  name?: string | null;
  enabled: boolean;
  isPaused?: boolean;
}

function outreachAudienceHref(type: ProcessingOutreachDestination["type"], id: string) {
  return type === "email_sequence"
    ? `/email/sequences/${id}?tab=audience`
    : `/campaigns/${id}/edit?section=leads`;
}

export function ConnectedOutreach({
  listId,
  listName,
  isSmart = false,
  processingDestination,
}: {
  listId: string;
  listName: string;
  isSmart?: boolean;
  processingDestination?: ProcessingOutreachDestination | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const sequences = useSequencesTargetingList(listId);
  const campaigns = useCampaignsTargetingList(listId);
  const unlinkSequence = useUnlinkListFromSequence();
  const unlinkCampaign = useUnlinkListFromCampaign();
  const loading = sequences.isLoading || campaigns.isLoading;
  const hasError = sequences.isError || campaigns.isError;
  const directDestinations = [
    ...(sequences.data ?? []).map((destination) => ({ ...destination, type: "email_sequence" as const })),
    ...(campaigns.data ?? []).map((destination) => ({ ...destination, type: "linkedin_campaign" as const })),
  ];
  const visibleLimit = processingDestination ? 2 : 3;
  const visibleDestinations = showAll ? directDestinations : directDestinations.slice(0, visibleLimit);

  return (
    <Card className="rounded-xl shadow-none">
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4 text-muted-foreground" />Connected outreach</CardTitle>
          <CardDescription>See where this {isSmart ? "segment" : "list"} is used and how members enter.</CardDescription>
        </div>
        <LeadListRoutingDialog listId={listId} listName={listName} isSmart={isSmart} processingDestination={processingDestination} />
      </CardHeader>
      <CardContent className="space-y-3">
        {hasError && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          <span className="flex-1 text-muted-foreground">Connected outreach could not be loaded.</span>
          <Button variant="outline" size="sm" onClick={() => { void sequences.refetch(); void campaigns.refetch(); }}>Retry</Button>
        </div>}
        {loading ? <Skeleton className="h-20 w-full" /> : visibleDestinations.map((destination) => {
          const Icon = destination.type === "email_sequence" ? Mail : Megaphone;
          const pending = destination.type === "email_sequence" ? unlinkSequence.isPending : unlinkCampaign.isPending;
          return (
            <div key={`${destination.type}:${destination.id}`} className="rounded-lg border p-3">
              <div className="flex items-start gap-2.5">
                <Icon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Link to={outreachAudienceHref(destination.type, destination.id)} className="break-words text-sm font-medium hover:underline">{destination.name}</Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">Direct source</Badge>
                    <Badge variant="outline" className="text-[10px]">{destination.auto_enroll_new_members ? "Continuous enrollment" : "One-time audience"}</Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{destination.status}</Badge>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild><Link to={outreachAudienceHref(destination.type, destination.id)} aria-label={`Open audience settings for ${destination.name}`}><ExternalLink className="h-3.5 w-3.5" /></Link></Button>
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Disconnect direct source from ${destination.name}`} disabled={pending}
                  onClick={() => destination.type === "email_sequence"
                    ? unlinkSequence.mutate({ sequence_id: destination.id, list_id: listId })
                    : unlinkCampaign.mutate({ campaign_id: destination.id, list_id: listId })}
                ><Unlink className="h-3.5 w-3.5" /></Button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {destination.auto_enroll_new_members
                  ? destination.status === "active"
                    ? "Current members and new matches are checked automatically against this destination’s audience rules."
                    : "Automatic enrollment requires this destination to be active."
                  : destination.type === "email_sequence"
                    ? "Open the sequence to review and enroll the current audience. Future matches are not added automatically."
                    : "Uses the audience selected at launch. Future matches are not added automatically."}
              </p>
            </div>
          );
        })}
        {processingDestination && <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex items-start gap-2.5">
            <Workflow className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <Link to={outreachAudienceHref(processingDestination.type, processingDestination.id)} className="break-words text-sm font-medium hover:underline">{processingDestination.name || (processingDestination.type === "email_sequence" ? "Email sequence" : "Campaign")}</Link>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="text-[10px]">After processing</Badge>
                <Badge variant="outline" className="text-[10px]">{processingDestination.isPaused ? "Processing paused" : processingDestination.enabled ? "Auto run on" : "Auto run off"}</Badge>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild><Link to={outreachAudienceHref(processingDestination.type, processingDestination.id)} aria-label="Open processing destination"><ExternalLink className="h-3.5 w-3.5" /></Link></Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Members route here after passing this source’s processing rules and settings. Manage this route in processing settings; view outreach controls at the destination.</p>
        </div>}
        {directDestinations.length > visibleLimit && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer connections" : `Show all ${directDestinations.length + (processingDestination ? 1 : 0)} connections`}</Button>}
        {!loading && !hasError && directDestinations.length === 0 && !processingDestination && <div className="rounded-lg border border-dashed bg-muted/20 p-4">
          <p className="text-sm font-medium">This audience is ready to connect</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose an email sequence or campaign. Matching this audience alone does not start outreach.</p>
        </div>}
        {(directDestinations.length > 0 || processingDestination) && <p className="text-xs leading-relaxed text-muted-foreground">Each destination keeps its own enrollment rules. Disconnecting a direct source stops future enrollment from that source; existing enrollments remain.</p>}
      </CardContent>
    </Card>
  );
}
