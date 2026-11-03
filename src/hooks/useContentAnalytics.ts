import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AggregatedAnalytics, ContentAnalytics } from "@/types/organization";

type TimeRange = "7d" | "30d" | "90d" | "all";

function getStartDate(range: TimeRange): Date | null {
  if (range === "all") return null;

  const now = new Date();
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  now.setDate(now.getDate() - days);
  return now;
}

// Fetch content analytics for current organization
export function useContentAnalytics(timeRange: TimeRange = "30d") {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["content-analytics", currentOrganization?.id, timeRange],
    queryFn: async (): Promise<AggregatedAnalytics> => {
      if (!currentOrganization) {
        return {
          byType: [],
          byPipeline: [],
          totals: { totalContent: 0, totalCost: 0, totalJobs: 0 },
        };
      }

      const startDate = getStartDate(timeRange);

      // Build query
      let query = supabase
        .from("content_outputs")
        .select("type, pipeline, generation_cost, status")
        .eq("organization_id", currentOrganization.id)
        .eq("status", "approved");

      if (startDate) {
        query = query.gte("created_at", startDate.toISOString());
      }

      const { data: outputs, error } = await query;

      if (error) {
        console.error("Error fetching analytics:", error);
        throw error;
      }

      // Aggregate by type
      const typeMap: Record<string, { count: number; cost: number }> = {};
      const pipelineMap: Record<string, { count: number; cost: number }> = {};

      (outputs || []).forEach((output) => {
        // By type
        if (!typeMap[output.type]) {
          typeMap[output.type] = { count: 0, cost: 0 };
        }
        typeMap[output.type].count += 1;
        typeMap[output.type].cost += output.generation_cost || 0;

        // By pipeline
        if (!pipelineMap[output.pipeline]) {
          pipelineMap[output.pipeline] = { count: 0, cost: 0 };
        }
        pipelineMap[output.pipeline].count += 1;
        pipelineMap[output.pipeline].cost += output.generation_cost || 0;
      });

      // Get jobs count
      let jobsQuery = supabase
        .from("content_generation_jobs")
        .select("id", { count: "exact" })
        .eq("organization_id", currentOrganization.id);

      if (startDate) {
        jobsQuery = jobsQuery.gte("created_at", startDate.toISOString());
      }

      const { count: totalJobs } = await jobsQuery;

      // Calculate totals
      const totalContent = outputs?.length || 0;
      const totalCost = (outputs || []).reduce(
        (sum, o) => sum + (o.generation_cost || 0),
        0
      );

      return {
        byType: Object.entries(typeMap).map(([type, data]) => ({
          type,
          count: data.count,
          cost: data.cost,
        })),
        byPipeline: Object.entries(pipelineMap).map(([pipeline, data]) => ({
          pipeline,
          count: data.count,
          cost: data.cost,
        })),
        totals: {
          totalContent,
          totalCost,
          totalJobs: totalJobs || 0,
        },
      };
    },
    enabled: !!currentOrganization,
  });
}

// Fetch analytics for agency's clients
export function useAgencyAnalytics(timeRange: TimeRange = "30d") {
  const { currentOrganization, isAgency } = useAuth();

  return useQuery({
    queryKey: ["agency-analytics", currentOrganization?.id, timeRange],
    queryFn: async () => {
      if (!currentOrganization || !isAgency) return [];

      const startDate = getStartDate(timeRange);

      // Get all client organizations
      const { data: clients, error: clientsError } = await supabase
        .from("organizations")
        .select("id, name")
        .eq("parent_id", currentOrganization.id);

      if (clientsError) throw clientsError;

      const clientIds = (clients || []).map((c) => c.id);

      if (clientIds.length === 0) return [];

      // Get content for all clients
      let query = supabase
        .from("content_outputs")
        .select("organization_id, type, pipeline, generation_cost, status")
        .in("organization_id", clientIds)
        .eq("status", "approved");

      if (startDate) {
        query = query.gte("created_at", startDate.toISOString());
      }

      const { data: outputs, error } = await query;

      if (error) throw error;

      // Aggregate by client
      const clientMap: Record<
        string,
        {
          id: string;
          name: string;
          totalContent: number;
          totalCost: number;
          byType: Record<string, number>;
        }
      > = {};

      // Initialize all clients
      (clients || []).forEach((client) => {
        clientMap[client.id] = {
          id: client.id,
          name: client.name,
          totalContent: 0,
          totalCost: 0,
          byType: {},
        };
      });

      // Aggregate outputs
      (outputs || []).forEach((output) => {
        const client = clientMap[output.organization_id];
        if (client) {
          client.totalContent += 1;
          client.totalCost += output.generation_cost || 0;
          client.byType[output.type] = (client.byType[output.type] || 0) + 1;
        }
      });

      return Object.values(clientMap).sort(
        (a, b) => b.totalContent - a.totalContent
      );
    },
    enabled: !!currentOrganization && isAgency,
  });
}

// Fetch platform-wide analytics (super admin only)
export function usePlatformAnalytics(timeRange: TimeRange = "30d") {
  const { isSuperAdmin } = useAuth();

  return useQuery({
    queryKey: ["platform-analytics", timeRange],
    queryFn: async () => {
      const startDate = getStartDate(timeRange);

      // Get organization counts by type
      const { data: orgCounts } = await supabase
        .from("organizations")
        .select("type");

      const orgsByType: Record<string, number> = {};
      (orgCounts || []).forEach((org) => {
        orgsByType[org.type] = (orgsByType[org.type] || 0) + 1;
      });

      // Get user count
      const { count: totalUsers } = await supabase
        .from("users")
        .select("id", { count: "exact" });

      // Get content count
      let contentQuery = supabase
        .from("content_outputs")
        .select("id", { count: "exact" })
        .eq("status", "approved");

      if (startDate) {
        contentQuery = contentQuery.gte("created_at", startDate.toISOString());
      }

      const { count: totalContent } = await contentQuery;

      // Get jobs count
      let jobsQuery = supabase
        .from("content_generation_jobs")
        .select("id", { count: "exact" });

      if (startDate) {
        jobsQuery = jobsQuery.gte("created_at", startDate.toISOString());
      }

      const { count: totalJobs } = await jobsQuery;

      // Count agencies (orgs with children)
      const { data: agencies } = await supabase
        .from("organizations")
        .select("id")
        .not("id", "in", `(${
          (await supabase.from("organizations").select("parent_id").not("parent_id", "is", null))
            .data?.map((o) => o.parent_id)
            .join(",") || "''"
        })`);

      return {
        totalOrganizations: orgCounts?.length || 0,
        totalAgencies: (orgCounts || []).filter(
          (o) => o.type === "agency"
        ).length,
        totalClients: (orgCounts || []).filter(
          (o) => o.type === "client"
        ).length,
        totalStandalone: (orgCounts || []).filter(
          (o) => o.type === "standalone" || !o.type
        ).length,
        totalUsers: totalUsers || 0,
        totalContent: totalContent || 0,
        totalJobs: totalJobs || 0,
        orgsByType,
      };
    },
    enabled: isSuperAdmin,
  });
}

// Get content trend over time
export function useContentTrend(
  organizationId?: string,
  timeRange: TimeRange = "30d"
) {
  const { currentOrganization } = useAuth();
  const orgId = organizationId || currentOrganization?.id;

  return useQuery({
    queryKey: ["content-trend", orgId, timeRange],
    queryFn: async () => {
      if (!orgId) return [];

      const startDate = getStartDate(timeRange);
      const now = new Date();

      let query = supabase
        .from("content_outputs")
        .select("created_at, type")
        .eq("organization_id", orgId)
        .eq("status", "approved")
        .order("created_at", { ascending: true });

      if (startDate) {
        query = query.gte("created_at", startDate.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;

      // Group by date
      const dateMap: Record<string, { date: string; count: number }> = {};

      (data || []).forEach((item) => {
        const date = new Date(item.created_at).toISOString().split("T")[0];
        if (!dateMap[date]) {
          dateMap[date] = { date, count: 0 };
        }
        dateMap[date].count += 1;
      });

      // Fill in missing dates
      const result: { date: string; count: number }[] = [];
      const current = startDate ? new Date(startDate) : new Date(now);
      current.setDate(current.getDate() - (timeRange === "all" ? 90 : parseInt(timeRange)));

      while (current <= now) {
        const dateStr = current.toISOString().split("T")[0];
        result.push(dateMap[dateStr] || { date: dateStr, count: 0 });
        current.setDate(current.getDate() + 1);
      }

      return result;
    },
    enabled: !!orgId,
  });
}
