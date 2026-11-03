import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Brain, ExternalLink, Check, Loader2, AlertCircle } from "lucide-react";
import { useTestApiKey } from "@/hooks/useTestApiKey";
import { useAddApiKey } from "@/hooks/useAddApiKey";

interface OnboardingLLMProps {
  onNext: () => void;
  onBack: () => void;
}

export function OnboardingLLM({ onNext, onBack }: OnboardingLLMProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const testApiKey = useTestApiKey();
  const addApiKey = useAddApiKey();
  const [isValid, setIsValid] = useState(false);

  const handleTest = async () => {
    const result = await testApiKey.mutateAsync({ 
      provider: 'openrouter', 
      apiKey 
    });
    
    if (result?.valid) {
      setIsValid(true);
      await addApiKey.mutateAsync({
        provider: 'openrouter',
        apiKey,
      });
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] px-8">
      <div className="w-full max-w-xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 rounded-xl bg-primary/10">
              <Brain className="h-10 w-10 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">AI Text Generation</h2>
            <p className="text-muted-foreground">
              OpenRouter gives you access to 100+ AI models through one API
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-destructive/10 text-sm">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="font-medium text-destructive">Required</span>
          </div>
        </div>

        {/* Form */}
        <Card className="p-6 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="openrouter-key">OpenRouter API Key</Label>
            <div className="relative">
              <Input
                id="openrouter-key"
                type={showKey ? "text" : "password"}
                placeholder="sk-or-v1-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-20"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            {isValid && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="h-4 w-4" />
                <span>API key verified successfully</span>
              </div>
            )}
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => window.open('https://openrouter.ai/keys', '_blank')}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Get your OpenRouter API key
          </Button>

          {apiKey && !isValid && (
            <Button
              className="w-full"
              onClick={handleTest}
              disabled={testApiKey.isPending}
            >
              {testApiKey.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                'Test & Save API Key'
              )}
            </Button>
          )}
        </Card>

        {/* Navigation */}
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button variant="cta" onClick={onNext} disabled={!isValid}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
