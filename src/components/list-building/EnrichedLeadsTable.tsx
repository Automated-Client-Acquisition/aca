import { useState } from "react";
import { Eye, EyeOff, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FitLabelBadge } from "./FitLabelBadge";
import type { EnrichedLead } from "@/hooks/useListBuilding";

interface Props {
  leads: EnrichedLead[];
  isLoading?: boolean;
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export function EnrichedLeadsTable({ leads, isLoading }: Props) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const toggleReveal = (id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading leads...
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
        No enriched leads yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead>DM</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="text-right">ICP Score</TableHead>
            <TableHead>Fit</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => {
            const isRevealed = revealed.has(lead.id);
            const dmName = lead.dm
              ? `${lead.dm.first_name}${
                  lead.dm.last_name ? " " + lead.dm.last_name : ""
                }`
              : "-";
            return (
              <TableRow key={lead.id}>
                <TableCell className="font-medium">
                  {lead.company?.company_name ?? "-"}
                  {lead.company?.domain ? (
                    <div className="text-xs text-muted-foreground">
                      {lead.company.domain}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{dmName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {lead.dm?.title ?? "-"}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {isRevealed ? lead.verified_email : maskEmail(lead.verified_email)}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {lead.icp_score}
                </TableCell>
                <TableCell>
                  <FitLabelBadge label={lead.fit_label} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleReveal(lead.id)}
                    >
                      {isRevealed ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    {lead.dm?.linkedin_url ? (
                      <Button variant="ghost" size="icon" asChild>
                        <a
                          href={lead.dm.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
