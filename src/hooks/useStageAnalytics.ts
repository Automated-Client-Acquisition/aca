import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface StageAnalytics {
  stageId: string;
  avgCost: number;
  avgGenerationTime: number;
  successRate: number;
  totalRuns: number;
  failureCount: number;
  mostUsedModel: string;
  costTrend: Array<{ date: string; cost: number }>;
  recommendations: Array<{
    type: 'model' | 'parameter' | 'cost';
    message: string;
    potentialSavings?: number;
  }>;
}

export function useStageAnalytics(pipeline: string, stageId: string) {
  return useQuery({
    queryKey: ['stage-analytics', pipeline, stageId],
    queryFn: async (): Promise<StageAnalytics> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get organization
      const { data: userData } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!userData) throw new Error('User data not found');

      // Fetch stage data from all outputs
      const { data: outputs, error } = await supabase
        .from('content_outputs')
        .select('stage_data, created_at')
        .eq('organization_id', userData.organization_id)
        .eq('pipeline', pipeline);

      if (error) throw error;

      // Analyze stage performance
      const stageRuns = outputs
        ?.map(o => {
          const stage = o.stage_data?.[stageId];
          return stage ? { ...stage, created_at: o.created_at } : null;
        })
        .filter(Boolean) || [];

      const totalRuns = stageRuns.length;
      const failureCount = stageRuns.filter(s => s.error_message).length;
      const successRate = totalRuns > 0 ? ((totalRuns - failureCount) / totalRuns) * 100 : 0;

      const avgCost = stageRuns.reduce((sum, s) => sum + (s.cost || 0), 0) / (totalRuns || 1);
      const avgGenerationTime = stageRuns.reduce((sum, s) => sum + (s.generation_time_ms || 0), 0) / (totalRuns || 1);

      // Find most used model
      const modelCounts: Record<string, number> = {};
      stageRuns.forEach(s => {
        const model = s.model_used || 'unknown';
        modelCounts[model] = (modelCounts[model] || 0) + 1;
      });
      const mostUsedModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

      // Cost trend (last 30 days)
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const costByDate = stageRuns
        .filter(s => new Date(s.created_at) >= thirtyDaysAgo)
        .reduce((acc: Record<string, number>, s) => {
          const date = new Date(s.created_at).toISOString().split('T')[0];
          acc[date] = (acc[date] || 0) + (Number(s.cost) || 0);
          return acc;
        }, {});
      
      const costTrend = Object.entries(costByDate).map(([date, cost]) => ({ 
        date, 
        cost: Number(cost)
      }));

      // Generate recommendations
      const recommendations: StageAnalytics['recommendations'] = [];

      if (avgCost > 0.1) {
        recommendations.push({
          type: 'cost',
          message: 'High average cost detected. Consider using more cost-efficient models.',
          potentialSavings: avgCost * 0.3 * totalRuns
        });
      }

      if (failureCount / totalRuns > 0.1) {
        recommendations.push({
          type: 'model',
          message: `${failureCount} failures detected. Consider adjusting model parameters or trying alternative models.`
        });
      }

      if (avgGenerationTime > 30000) {
        recommendations.push({
          type: 'parameter',
          message: 'Slow generation time. Consider reducing quality parameters or using faster models.'
        });
      }

      return {
        stageId,
        avgCost,
        avgGenerationTime,
        successRate,
        totalRuns,
        failureCount,
        mostUsedModel,
        costTrend,
        recommendations
      };
    },
    enabled: !!pipeline && !!stageId
  });
}
