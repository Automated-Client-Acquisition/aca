import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFilteredLeads } from "@/hooks/useEmailStats";
import { Search, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface FilteredLeadsTableProps {
  sequenceId: string;
}

const REASON_BADGES: Record<string, { label: string; color: string }> = {
  unlikely_to_reply: {
    label: "Low Score",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  },
  flagged_hostile: {
    label: "Hostile",
    color: "bg-red-500/10 text-red-600 border-red-500/20",
  },
  previous_spam_complaint: {
    label: "Spam Complaint",
    color: "bg-red-500/10 text-red-600 border-red-500/20",
  },
  previously_bounced: {
    label: "Bounced",
    color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  },
  unsubscribed: {
    label: "Unsubscribed",
    color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  },
};

function getReasonBadge(reason: string | null) {
  const key = reason || "unknown";
  return REASON_BADGES[key] || {
    label: key.replace(/_/g, " "),
    color: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  };
}

export function FilteredLeadsTable({ sequenceId }: FilteredLeadsTableProps) {
  const { data: filteredLeads, isLoading, isError, refetch } = useFilteredLeads(sequenceId);
  const [search, setSearch] = useState("");

  const filtered = filteredLeads?.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.lead_email?.toLowerCase().includes(q) ||
      e.lead_name?.toLowerCase().includes(q) ||
      e.recipient_email?.toLowerCase().includes(q)
    );
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <div role="alert" className="rounded-xl border p-8 text-center space-y-3"><h2 className="font-semibold">Unable to load filtered leads</h2><p className="text-sm text-muted-foreground">Try again to review why leads were filtered.</p><Button variant="outline" onClick={() => { void refetch(); }}>Try again</Button></div>;
  }

  if (!filteredLeads || filteredLeads.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed rounded-lg">
        <ShieldAlert className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
        <h3 className="text-sm font-semibold mb-1">No filtered leads</h3>
        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
          When AI filters skip leads (unlikely to reply or hostile), they will
          appear here with the reason.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search filtered leads"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filteredLeads.length} filtered
        </span>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Step</TableHead>
              <TableHead>Filtered At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(filtered || []).map((entry) => {
              const badge = getReasonBadge(entry.error_message);
              return (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">
                        {entry.lead_name || "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.lead_email || entry.recipient_email}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn("text-xs", badge.color)}
                    >
                      {badge.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm tabular-nums">
                      {entry.sequence_step != null
                        ? `Step ${entry.sequence_step + 1}`
                        : "--"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(entry.created_at), "MMM d, h:mm a")}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
