import { useState } from "react";
import { useRefreshModelSchema, useCheckSchemaAge } from "@/hooks/useSchemaRefresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Clock, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * Demo component for testing Schema Refresh Strategy
 */
export function SchemaRefreshDemo() {
  const [provider, setProvider] = useState("replicate");
  const [modelId, setModelId] = useState("stability-ai/sdxl");
  const [maxAgeHours, setMaxAgeHours] = useState(24);
  const [refreshResult, setRefreshResult] = useState<any>(null);
  const [ageCheckResult, setAgeCheckResult] = useState<boolean | null>(null);

  const refreshSchema = useRefreshModelSchema();
  const checkAge = useCheckSchemaAge();

  const handleRefresh = async () => {
    try {
      const result = await refreshSchema.mutateAsync({ provider, modelId });
      setRefreshResult(result);

      if (result.success) {
        toast.success("Schema refreshed successfully!");
      } else {
        toast.error(`Schema refresh failed: ${result.error}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh schema");
      console.error(error);
    }
  };

  const handleCheckAge = async () => {
    try {
      const needsRefresh = await checkAge.mutateAsync({ provider, modelId, maxAgeHours });
      setAgeCheckResult(needsRefresh);

      if (needsRefresh) {
        toast.info("Schema is stale and should be refreshed");
      } else {
        toast.success("Schema is fresh!");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to check schema age");
      console.error(error);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Schema Refresh Strategy Demo</CardTitle>
          <CardDescription>
            Test automatic schema refresh and parameter mismatch detection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Model Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Input 
                value={provider} 
                onChange={(e) => setProvider(e.target.value)}
                placeholder="e.g., replicate"
              />
            </div>
            <div className="space-y-2">
              <Label>Model ID</Label>
              <Input 
                value={modelId} 
                onChange={(e) => setModelId(e.target.value)}
                placeholder="e.g., stability-ai/sdxl"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Manual Schema Refresh</Label>
              <Button 
                onClick={handleRefresh} 
                disabled={refreshSchema.isPending}
                className="w-full"
                variant="default"
              >
                {refreshSchema.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {!refreshSchema.isPending && <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh Schema
              </Button>
              <p className="text-xs text-muted-foreground">
                Fetches fresh schema from provider and re-normalizes with LLM
              </p>
            </div>

            <div className="space-y-2">
              <Label>Check Schema Age (Max Age: {maxAgeHours}h)</Label>
              <div className="flex gap-2">
                <Input 
                  type="number"
                  value={maxAgeHours}
                  onChange={(e) => setMaxAgeHours(parseInt(e.target.value))}
                  className="w-24"
                  min="1"
                />
                <Button 
                  onClick={handleCheckAge} 
                  disabled={checkAge.isPending}
                  variant="outline"
                  className="flex-1"
                >
                  {checkAge.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {!checkAge.isPending && <Clock className="mr-2 h-4 w-4" />}
                  Check Age
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Checks if cached schema is older than specified hours
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Refresh Result */}
      {refreshResult && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Refresh Result</CardTitle>
              {refreshResult.success ? (
                <Badge variant="default" className="flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Success
                </Badge>
              ) : (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  Failed
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {refreshResult.success ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  ✓ Schema fetched from provider
                </p>
                <p className="text-sm text-muted-foreground">
                  ✓ Schema normalized with LLM
                </p>
                <p className="text-sm text-muted-foreground">
                  ✓ Cache updated in database
                </p>
              </div>
            ) : (
              <div className="p-3 bg-destructive/10 rounded-md">
                <p className="text-sm font-medium text-destructive">Error:</p>
                <p className="text-sm text-destructive/80 mt-1">{refreshResult.error}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Age Check Result */}
      {ageCheckResult !== null && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Schema Age Check</CardTitle>
              {ageCheckResult ? (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Needs Refresh
                </Badge>
              ) : (
                <Badge variant="default" className="flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Fresh
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {ageCheckResult ? (
              <p className="text-sm text-muted-foreground">
                Schema is older than {maxAgeHours} hours and should be refreshed
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Schema is fresh (less than {maxAgeHours} hours old)
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* How It Works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How Schema Refresh Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Automatic Refresh Flow:</h4>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              <li>Generation fails with parameter mismatch error (400/422)</li>
              <li>System detects error contains parameter-related keywords</li>
              <li>Automatically refetches schema from provider API</li>
              <li>Re-normalizes schema using LLM (Gemini 2.5 Flash)</li>
              <li>Updates database cache with fresh schema</li>
              <li>Retries generation ONCE with new schema</li>
              <li>If still fails → returns error to user</li>
            </ol>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Detected Parameter Errors:</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>"parameter"</li>
              <li>"invalid input"</li>
              <li>"missing required"</li>
              <li>"validation error"</li>
              <li>"schema mismatch"</li>
              <li>"unexpected field"</li>
              <li>"additional properties"</li>
            </ul>
          </div>

          <div className="p-3 bg-muted/50 rounded-md">
            <p className="text-sm font-medium mb-1">Key Features:</p>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>Only refreshes failing model (no bulk refresh)</li>
              <li>Maximum 1 retry per request</li>
              <li>~3-5 second refresh time</li>
              <li>Minimal cost (~$0.001 per normalization)</li>
              <li>Benefits all future requests</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
