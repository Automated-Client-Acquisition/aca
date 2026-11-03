import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ABTestResult {
  branchA: {
    outputId: string;
    cost: number;
    generationTime: number;
    qualityScore?: number;
  };
  branchB: {
    outputId: string;
    cost: number;
    generationTime: number;
    qualityScore?: number;
  };
  statistics: {
    costDifference: number;
    costDifferencePercent: number;
    timeDifference: number;
    timeDifferencePercent: number;
    isSignificant: boolean;
    confidence: number;
    recommendation: 'branch_a' | 'branch_b' | 'inconclusive';
    reasoning: string;
  };
}

export function useABTestAnalysis(outputIdA: string, outputIdB: string) {
  return useQuery({
    queryKey: ['ab-test-analysis', outputIdA, outputIdB],
    queryFn: async (): Promise<ABTestResult> => {
      // Fetch both outputs
      const { data: outputs, error } = await supabase
        .from('content_outputs')
        .select('id, stage_data, generation_cost, generation_duration_ms')
        .in('id', [outputIdA, outputIdB]);

      if (error) throw error;
      if (!outputs || outputs.length !== 2) throw new Error('Both outputs not found');

      const [outputA, outputB] = outputs;

      // Calculate aggregate metrics
      const calcMetrics = (output: any) => {
        const stages = Object.values(output.stage_data || {}) as any[];
        return {
          outputId: output.id,
          cost: stages.reduce((sum, s) => sum + (s.cost || 0), 0),
          generationTime: stages.reduce((sum, s) => sum + (s.generation_time_ms || 0), 0),
          qualityScore: undefined // Could be user-rated
        };
      };

      const branchA = calcMetrics(outputA);
      const branchB = calcMetrics(outputB);

      // Calculate differences
      const costDifference = branchB.cost - branchA.cost;
      const costDifferencePercent = branchA.cost > 0 
        ? (costDifference / branchA.cost) * 100 
        : 0;

      const timeDifference = branchB.generationTime - branchA.generationTime;
      const timeDifferencePercent = branchA.generationTime > 0
        ? (timeDifference / branchA.generationTime) * 100
        : 0;

      // Statistical significance (simplified - would need more samples for real stats)
      const costThreshold = 0.15; // 15% difference
      const timeThreshold = 0.20; // 20% difference
      
      const isSignificant = 
        Math.abs(costDifferencePercent) > costThreshold * 100 ||
        Math.abs(timeDifferencePercent) > timeThreshold * 100;

      // Confidence calculation (simplified)
      const confidence = isSignificant ? 85 : 60;

      // Recommendation logic
      let recommendation: 'branch_a' | 'branch_b' | 'inconclusive' = 'inconclusive';
      let reasoning = 'Differences are too small to make a confident recommendation.';

      if (isSignificant) {
        if (costDifferencePercent < -10 && timeDifferencePercent < 30) {
          recommendation = 'branch_b';
          reasoning = `Branch B is ${Math.abs(costDifferencePercent).toFixed(1)}% cheaper with acceptable time increase.`;
        } else if (costDifferencePercent > 10 && timeDifferencePercent < -30) {
          recommendation = 'branch_a';
          reasoning = `Branch A is ${Math.abs(timeDifferencePercent).toFixed(1)}% faster with acceptable cost increase.`;
        } else if (costDifferencePercent < 0 && timeDifferencePercent < 0) {
          recommendation = 'branch_b';
          reasoning = 'Branch B is both cheaper and faster.';
        } else if (costDifferencePercent > 0 && timeDifferencePercent > 0) {
          recommendation = 'branch_a';
          reasoning = 'Branch A is both cheaper and faster.';
        }
      }

      return {
        branchA,
        branchB,
        statistics: {
          costDifference,
          costDifferencePercent,
          timeDifference,
          timeDifferencePercent,
          isSignificant,
          confidence,
          recommendation,
          reasoning
        }
      };
    },
    enabled: !!outputIdA && !!outputIdB
  });
}
