import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Clock, 
  Award,
  AlertCircle,
  CheckCircle2
} from "lucide-react";
import { useABTestAnalysis } from "@/hooks/useABTestAnalysis";
import { Skeleton } from "@/components/ui/skeleton";

interface ABTestComparisonPanelProps {
  outputIdA: string;
  outputIdB: string;
  onSelectWinner?: (winnerId: string) => void;
}

export function ABTestComparisonPanel({ 
  outputIdA, 
  outputIdB,
  onSelectWinner 
}: ABTestComparisonPanelProps) {
  const { data: analysis, isLoading } = useABTestAnalysis(outputIdA, outputIdB);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!analysis) return null;

  const { branchA, branchB, statistics } = analysis;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5" />
          A/B Test Analysis
        </CardTitle>
        <CardDescription>
          Statistical comparison of both branches
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Recommendation */}
        {statistics.isSignificant && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium mb-1">
                    Recommended: {statistics.recommendation === 'branch_a' ? 'Branch A' : statistics.recommendation === 'branch_b' ? 'Branch B' : 'Inconclusive'}
                  </div>
                  <div className="text-sm">{statistics.reasoning}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Confidence: {statistics.confidence}%
                  </div>
                </div>
                {statistics.recommendation !== 'inconclusive' && onSelectWinner && (
                  <Button
                    size="sm"
                    onClick={() => onSelectWinner(
                      statistics.recommendation === 'branch_a' ? outputIdA : outputIdB
                    )}
                  >
                    Use This
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {!statistics.isSignificant && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No statistically significant difference detected. Both branches perform similarly.
            </AlertDescription>
          </Alert>
        )}

        {/* Side-by-side Comparison */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Branch A */}
          <Card className={statistics.recommendation === 'branch_a' ? 'border-primary' : ''}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Branch A
                {statistics.recommendation === 'branch_a' && (
                  <Badge variant="default">Recommended</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DollarSign className="h-4 w-4" />
                  Cost
                </div>
                <div className="font-mono font-medium">
                  ${branchA.cost.toFixed(4)}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Time
                </div>
                <div className="font-mono font-medium">
                  {(branchA.generationTime / 1000).toFixed(1)}s
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Branch B */}
          <Card className={statistics.recommendation === 'branch_b' ? 'border-primary' : ''}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Branch B
                {statistics.recommendation === 'branch_b' && (
                  <Badge variant="default">Recommended</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DollarSign className="h-4 w-4" />
                  Cost
                </div>
                <div className="font-mono font-medium">
                  ${branchB.cost.toFixed(4)}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Time
                </div>
                <div className="font-mono font-medium">
                  {(branchB.generationTime / 1000).toFixed(1)}s
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Difference Metrics */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Differences</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Cost Difference</span>
              <div className="flex items-center gap-2">
                {statistics.costDifferencePercent < 0 ? (
                  <TrendingDown className="h-4 w-4 text-green-500" />
                ) : statistics.costDifferencePercent > 0 ? (
                  <TrendingUp className="h-4 w-4 text-destructive" />
                ) : null}
                <span className={
                  statistics.costDifferencePercent < -10 ? 'text-green-500 font-medium' :
                  statistics.costDifferencePercent > 10 ? 'text-destructive font-medium' :
                  ''
                }>
                  {statistics.costDifferencePercent > 0 ? '+' : ''}
                  {statistics.costDifferencePercent.toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Time Difference</span>
              <div className="flex items-center gap-2">
                {statistics.timeDifferencePercent < 0 ? (
                  <TrendingDown className="h-4 w-4 text-green-500" />
                ) : statistics.timeDifferencePercent > 0 ? (
                  <TrendingUp className="h-4 w-4 text-destructive" />
                ) : null}
                <span className={
                  statistics.timeDifferencePercent < -20 ? 'text-green-500 font-medium' :
                  statistics.timeDifferencePercent > 20 ? 'text-destructive font-medium' :
                  ''
                }>
                  {statistics.timeDifferencePercent > 0 ? '+' : ''}
                  {statistics.timeDifferencePercent.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
