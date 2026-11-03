import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  DollarSign, 
  Activity, 
  AlertCircle,
  Lightbulb,
  ExternalLink
} from "lucide-react";
import { useStageAnalytics } from "@/hooks/useStageAnalytics";
import { Skeleton } from "@/components/ui/skeleton";

interface StageAnalyticsPanelProps {
  pipeline: string;
  stageId: string;
  stageName: string;
}

export function StageAnalyticsPanel({ pipeline, stageId, stageName }: StageAnalyticsPanelProps) {
  const { data: analytics, isLoading } = useStageAnalytics(pipeline, stageId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!analytics) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Stage Analytics: {stageName}
        </CardTitle>
        <CardDescription>
          Performance metrics and optimization recommendations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Key Metrics */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Cost</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-2xl font-bold">${analytics.avgCost.toFixed(4)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-2xl font-bold">{(analytics.avgGenerationTime / 1000).toFixed(1)}s</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Success Rate</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {analytics.successRate >= 90 ? (
                  <TrendingUp className="h-4 w-4 text-green-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-destructive" />
                )}
                <span className="text-2xl font-bold">{analytics.successRate.toFixed(1)}%</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Runs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-2xl font-bold">{analytics.totalRuns}</span>
              </div>
              {analytics.failureCount > 0 && (
                <div className="text-sm text-muted-foreground mt-1">
                  {analytics.failureCount} failures
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Most Used Model */}
        <div>
          <h4 className="text-sm font-medium mb-2">Most Used Model</h4>
          <Badge variant="secondary">{analytics.mostUsedModel}</Badge>
        </div>

        {/* Recommendations */}
        {analytics.recommendations.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              Optimization Recommendations
            </h4>
            {analytics.recommendations.map((rec, idx) => (
              <Alert key={idx} variant={rec.type === 'cost' ? 'default' : 'default'}>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-start justify-between gap-2">
                    <span>{rec.message}</span>
                    {rec.potentialSavings && (
                      <Badge variant="secondary" className="whitespace-nowrap">
                        Save ${rec.potentialSavings.toFixed(2)}
                      </Badge>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Cost Trend */}
        {analytics.costTrend.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Cost Trend (Last 30 Days)</h4>
            <div className="space-y-1">
              {analytics.costTrend.slice(-7).map((item) => (
                <div key={item.date} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{new Date(item.date).toLocaleDateString()}</span>
                  <span className="font-mono">${item.cost.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="w-full">
            <ExternalLink className="h-4 w-4 mr-2" />
            View Detailed Report
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
