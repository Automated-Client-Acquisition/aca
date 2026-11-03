import { formatDistanceToNow } from "date-fns";
import {
  Loader2,
  User,
  CheckCircle2,
  XCircle,
  Mail,
  Phone,
  Building,
  Globe,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EnrichmentHistoryEntry {
  id: string;
  provider: string;
  enrichment_type: string;
  data_found: Record<string, unknown>;
  data_applied: boolean;
  credits_used: number;
  created_at: string;
  contact: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    primary_email: string | null;
    primary_phone: string | null;
  } | null;
}

interface EnrichmentHistoryTableProps {
  entries: EnrichmentHistoryEntry[];
  isLoading?: boolean;
}

const PROVIDER_COLORS: Record<string, string> = {
  apollo: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  hunter: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
  prospeo: "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary",
  clearbit: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
  rocketreach: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-200",
};

function DataFoundBadges({ data }: { data: Record<string, unknown> }) {
  const items: { icon: typeof Mail; label: string; value: string }[] = [];

  if (data.email) {
    items.push({ icon: Mail, label: "Email", value: String(data.email) });
  }
  if (data.phone) {
    items.push({ icon: Phone, label: "Phone", value: String(data.phone) });
  }
  if (data.company?.name || data.companyName) {
    items.push({
      icon: Building,
      label: "Company",
      value: String(data.company?.name || data.companyName),
    });
  }
  if (data.website || data.company?.website) {
    items.push({
      icon: Globe,
      label: "Website",
      value: String(data.website || data.company?.website),
    });
  }

  if (items.length === 0) {
    return (
      <span className="text-muted-foreground text-sm flex items-center gap-1">
        <XCircle className="h-3 w-3" />
        No data found
      </span>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Tooltip key={item.label}>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-1 cursor-help">
                <item.icon className="h-3 w-3" />
                {item.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-sm">{item.value}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

export function EnrichmentHistoryTable({
  entries,
  isLoading,
}: EnrichmentHistoryTableProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No enrichment history yet</p>
        <p className="text-sm">Start enriching contacts to see results here</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contact</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Data Found</TableHead>
            <TableHead>Applied</TableHead>
            <TableHead>Credits</TableHead>
            <TableHead>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage
                      src={entry.contact?.avatar_url || undefined}
                      referrerPolicy="no-referrer"
                    />
                    <AvatarFallback>
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {entry.contact?.display_name || "Unknown Contact"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {entry.contact?.primary_email || entry.contact?.primary_phone || ""}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge className={PROVIDER_COLORS[entry.provider] || "bg-gray-100 text-gray-800"}>
                  {entry.provider}
                </Badge>
              </TableCell>
              <TableCell>
                <DataFoundBadges data={entry.data_found || {}} />
              </TableCell>
              <TableCell>
                {entry.data_applied ? (
                  <Badge className="bg-green-600 gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Applied
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not Applied</Badge>
                )}
              </TableCell>
              <TableCell>
                <span className="text-muted-foreground">{entry.credits_used || 0}</span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
