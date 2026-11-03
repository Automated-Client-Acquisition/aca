import { useState } from "react";
import { usePayloadBuilder } from "@/hooks/usePayloadBuilder";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Demo component showing how to use the Payload Builder
 * This demonstrates the semantic input → provider payload flow
 */
export function PayloadBuilderDemo() {
  const [provider] = useState("replicate");
  const [modelId, setModelId] = useState("stability-ai/sdxl");
  const [mainPrompt, setMainPrompt] = useState("A majestic dragon flying over mountains");
  const [negativePrompt, setNegativePrompt] = useState("blurry, low quality");
  const [steps, setSteps] = useState(30);
  const [guidance, setGuidance] = useState(7.5);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolutionTier, setResolutionTier] = useState<"SD" | "HD" | "FHD" | "UHD">("HD");
  const [result, setResult] = useState<any>(null);

  const buildPayload = usePayloadBuilder();

  const handleBuildPayload = async () => {
    try {
      const response = await buildPayload.mutateAsync({
        provider,
        model_id: modelId,
        user_input: {
          main_prompt: mainPrompt,
          negative_prompt: negativePrompt,
          steps,
          guidance,
          aspect_ratio: aspectRatio,
          resolution_tier: resolutionTier,
        },
      });

      setResult(response);

      if (response.success) {
        toast.success("Payload built successfully!");
      } else {
        toast.error(`Missing required parameters: ${response.missing_required.join(", ")}`);
      }

      if (response.warnings.length > 0) {
        response.warnings.forEach((warning) => toast.warning(warning));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to build payload");
      console.error(error);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Payload Builder Demo</CardTitle>
          <CardDescription>
            Test semantic input → provider payload conversion
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Input value={provider} disabled />
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

          <div className="space-y-2">
            <Label>Main Prompt</Label>
            <Textarea
              value={mainPrompt}
              onChange={(e) => setMainPrompt(e.target.value)}
              placeholder="Describe what you want to generate..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Negative Prompt</Label>
            <Textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="What to avoid..."
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Steps: {steps}</Label>
              <Input
                type="range"
                min="1"
                max="100"
                value={steps}
                onChange={(e) => setSteps(parseInt(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>Guidance: {guidance}</Label>
              <Input
                type="range"
                min="0"
                max="20"
                step="0.5"
                value={guidance}
                onChange={(e) => setGuidance(parseFloat(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Aspect Ratio</Label>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1:1">1:1 (Square)</SelectItem>
                  <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                  <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                  <SelectItem value="4:3">4:3</SelectItem>
                  <SelectItem value="3:4">3:4</SelectItem>
                  <SelectItem value="21:9">21:9 (Ultrawide)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Resolution Tier</Label>
              <Select value={resolutionTier} onValueChange={(v) => setResolutionTier(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SD">SD (512px)</SelectItem>
                  <SelectItem value="HD">HD (1024px)</SelectItem>
                  <SelectItem value="FHD">FHD (1920px)</SelectItem>
                  <SelectItem value="UHD">UHD (2560px)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button 
            onClick={handleBuildPayload} 
            disabled={buildPayload.isPending}
            className="w-full"
          >
            {buildPayload.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Build Payload
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Result</CardTitle>
              <div className="flex gap-2">
                {result.success ? (
                  <Badge variant="default">Success</Badge>
                ) : (
                  <Badge variant="destructive">Failed</Badge>
                )}
                {result.estimated_cost && (
                  <Badge variant="secondary">${result.estimated_cost.toFixed(3)}</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.missing_required.length > 0 && (
              <div className="p-3 bg-destructive/10 rounded-md">
                <p className="text-sm font-medium text-destructive">Missing Required Parameters:</p>
                <ul className="list-disc list-inside text-sm text-destructive/80 mt-1">
                  {result.missing_required.map((param: string) => (
                    <li key={param}>{param}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="p-3 bg-yellow-500/10 rounded-md">
                <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">Warnings:</p>
                <ul className="list-disc list-inside text-sm text-yellow-600/80 dark:text-yellow-400/80 mt-1">
                  {result.warnings.map((warning: string, i: number) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-sm font-medium mb-2">Provider Payload:</p>
              <pre className="bg-muted p-4 rounded-md overflow-x-auto text-xs">
                {JSON.stringify(result.payload, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
