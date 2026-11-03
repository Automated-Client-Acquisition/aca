import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Globe, Linkedin } from "lucide-react";
import type { DiscoveredCompany } from "@/hooks/useListBuilding";

interface DiscoveredCompaniesTableProps {
  companies: DiscoveredCompany[];
  isLoading: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  google_maps: "Maps",
  google_search: "Search",
  directory: "Dir",
  linkedin: "LinkedIn",
  common_crawl: "CC",
  whois: "WHOIS",
};

export function DiscoveredCompaniesTable({
  companies,
  isLoading,
}: DiscoveredCompaniesTableProps) {
  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        Loading companies...
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No companies discovered yet.
      </div>
    );
  }

  return (
    <div className="rounded-md border max-h-[400px] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead>Domain</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Links</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium max-w-[200px] truncate">
                {c.company_name}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {c.domain || "-"}
              </TableCell>
              <TableCell className="text-xs">
                {[c.city, c.state, c.country].filter(Boolean).join(", ") || "-"}
              </TableCell>
              <TableCell className="text-xs">
                {c.phone || "-"}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {SOURCE_LABELS[c.source] || c.source}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {c.website_url && (
                    <a
                      href={c.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Globe className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {c.linkedin_url && (
                    <a
                      href={c.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Linkedin className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {!c.website_url && !c.linkedin_url && (
                    <span className="text-muted-foreground text-xs">-</span>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
