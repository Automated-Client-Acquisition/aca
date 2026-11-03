import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMailboxSequences } from "@/hooks/useMailboxSequences";
import { GitBranch, Inbox } from "lucide-react";

interface MailboxCampaignsTabProps {
  mailboxId: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  active: "bg-green-500/10 text-green-600 border-green-500/20",
  paused: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  completed: "bg-blue-500/10 text-blue-600 border-blue-500/20",
};

export function MailboxCampaignsTab({ mailboxId }: MailboxCampaignsTabProps) {
  const navigate = useNavigate();
  const { data: sequences, isLoading } = useMailboxSequences(mailboxId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!sequences || sequences.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Inbox className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium mb-1">No Sequences</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm">
          This mailbox is not currently assigned to any email sequences.
        </p>
        <Button variant="outline" onClick={() => navigate("/email/sequences")}>
          <GitBranch className="h-4 w-4 mr-2" />
          Go to Sequences
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-medium mb-3">
        Sequences Using This Mailbox
      </h3>
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sequence Name</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[120px] text-right">
                Enrolled Leads
              </TableHead>
              <TableHead className="w-[160px]">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sequences.map((seq) => (
              <TableRow
                key={seq.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => navigate(`/email/sequences/${seq.id}`)}
              >
                <TableCell className="font-medium">{seq.name}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={STATUS_COLORS[seq.status] || STATUS_COLORS.draft}
                  >
                    {seq.status.charAt(0).toUpperCase() + seq.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {seq.enrollment_count}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(seq.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
