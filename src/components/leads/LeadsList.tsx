import { useState, useMemo } from "react";
import { Search, Users, Filter, Linkedin, Instagram, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useCampaignLeads, type UnipileCampaign, type UnipileLead } from "@/hooks/useUnipileCampaigns";
import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface LeadsListProps {
  campaigns: UnipileCampaign[];
}

export function LeadsList({ campaigns }: LeadsListProps) {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");

  // Fetch all leads across campaigns
  const { data: allLeads, isLoading } = useQuery({
    queryKey: ['all-unipile-leads', user?.id],
    queryFn: async () => {
      if (!user) return [];

      // Get organization ID
      const { data: userData } = await supabase
        .from("users")
        .select("organization_id, active_organization_id")
        .eq("id", user.id)
        .single();

      const orgId = userData?.active_organization_id || userData?.organization_id;
      if (!orgId) return [];

      // Fetch all leads for this org's campaigns
      const { data: leads, error } = await supabase
        .from('unipile_leads')
        .select(`
          *,
          post:unipile_monitored_posts(*),
          campaign:unipile_campaigns(id, name, account:unipile_accounts(provider))
        `)
        .in('campaign_id', campaigns.map(c => c.id))
        .order('captured_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return leads as (UnipileLead & { campaign: { id: string; name: string; account: { provider: string } } })[];
    },
    enabled: !!user && campaigns.length > 0,
  });

  // Filter leads
  const filteredLeads = useMemo(() => {
    if (!allLeads) return [];

    return allLeads.filter((lead) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          lead.commenter_name.toLowerCase().includes(query) ||
          lead.comment_text.toLowerCase().includes(query) ||
          lead.matched_keyword.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (statusFilter !== "all" && lead.status !== statusFilter) {
        return false;
      }

      // Campaign filter
      if (campaignFilter !== "all" && lead.campaign_id !== campaignFilter) {
        return false;
      }

      return true;
    });
  }, [allLeads, searchQuery, statusFilter, campaignFilter]);

  // Stats
  const stats = useMemo(() => {
    if (!allLeads) return { total: 0, dmSent: 0, pending: 0, awaiting: 0, failed: 0 };

    return {
      total: allLeads.length,
      dmSent: allLeads.filter((l) => l.status === "dm_sent").length,
      pending: allLeads.filter((l) => l.status === "pending").length,
      awaiting: allLeads.filter((l) => l.status === "awaiting_connection").length,
      failed: allLeads.filter((l) => l.status === "dm_failed").length,
    };
  }, [allLeads]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard label="Total Leads" value={stats.total} />
        <StatCard label="DMs Sent" value={stats.dmSent} className="text-green-600" />
        <StatCard label="Pending" value={stats.pending} className="text-[hsl(var(--status-warning))]" />
        <StatCard label="Awaiting Connect" value={stats.awaiting} className="text-[hsl(var(--status-warning))]" />
        <StatCard label="Failed" value={stats.failed} className="text-red-600" />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-lg">All Leads</CardTitle>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search leads..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[200px]"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="awaiting_connection">Awaiting Connection</SelectItem>
                  <SelectItem value="dm_sent">DM Sent</SelectItem>
                  <SelectItem value="dm_failed">Failed</SelectItem>
                  <SelectItem value="replied">Replied</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                </SelectContent>
              </Select>

              <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Campaign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Campaigns</SelectItem>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{searchQuery || statusFilter !== "all" || campaignFilter !== "all" ? "No leads match your filters" : "No leads captured yet"}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Comment</TableHead>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Captured</TableHead>
                  <TableHead>DM Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeads.map((lead) => {
                  const Icon = lead.campaign?.account?.provider === "LINKEDIN" ? Linkedin : Instagram;
                  const iconColor = lead.campaign?.account?.provider === "LINKEDIN" ? "text-[#0A66C2]" : "text-[#E1306C]";

                  return (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                            {lead.commenter_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            {lead.commenter_profile_url ? (
                              <a
                                href={lead.commenter_profile_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium hover:underline flex items-center gap-1"
                              >
                                {lead.commenter_name}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-sm font-medium">{lead.commenter_name}</span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Icon className={cn("h-4 w-4", iconColor)} />
                          <span className="text-sm">{lead.campaign?.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <p className="text-sm text-muted-foreground truncate">
                          {lead.comment_text}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {lead.matched_keyword}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <LeadStatusBadge status={lead.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(lead.captured_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {lead.dm_sent_at
                          ? formatDistanceToNow(new Date(lead.dm_sent_at), { addSuffix: true })
                          : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={cn("text-2xl font-bold mt-1", className)}>{value}</div>
      </CardContent>
    </Card>
  );
}

function LeadStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "dm_sent":
      return <Badge className="bg-green-600">DM Sent</Badge>;
    case "dm_failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "pending":
      return <Badge variant="secondary">Pending</Badge>;
    case "awaiting_connection":
      return <Badge className="bg-[hsl(var(--status-warning))]">Awaiting Connection</Badge>;
    case "replied":
      return <Badge className="bg-blue-600">Replied</Badge>;
    case "converted":
      return <Badge className="bg-primary">Converted</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
