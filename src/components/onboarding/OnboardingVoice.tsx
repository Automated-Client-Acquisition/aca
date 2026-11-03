import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Mic, ExternalLink, Check, Loader2 } from "lucide-react";
import { useTestApiKey } from "@/hooks/useTestApiKey";
import { useAddApiKey } from "@/hooks/useAddApiKey";

interface OnboardingVoiceProps {
  onNext: () => void;
  onBack: () => void;
}

export function OnboardingVoice({ onNext, onBack }: OnboardingVoiceProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const testApiKey = useTestApiKey();
  const addApiKey = useAddApiKey();
  const [isValid, setIsValid] = useState(false);

  const handleTest = async () => {
    const result = await testApiKey.mutateAsync({ 
      provider: 'elevenlabs', 
      apiKey 
    });
    
    if (result?.valid) {
      setIsValid(true);
      await addApiKey.mutateAsync({
        provider: 'elevenlabs',
        apiKey,
      });
    }
  };

  const handleSkip = () => {
    onNext();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] px-8">
      <div className="w-full max-w-xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 rounded-xl bg-primary/10">
              <Mic className="h-10 w-10 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">Voice Generation</h2>
            <p className="text-muted-foreground">
              Generate realistic voiceovers for your videos with ElevenLabs
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-sm">
            <span className="text-muted-foreground">Optional - You can skip this</span>
          </div>
        </div>

        {/* Form */}
        <Card className="p-6 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="elevenlabs-key">ElevenLabs API Key</Label>
            <div className="relative">
              <Input
                id="elevenlabs-key"
                type={showKey ? "text" : "password"}
                placeholder="sk_..."
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
            onClick={() => window.open('https://elevenlabs.io/app/settings/api-keys', '_blank')}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Get your ElevenLabs API key
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
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSkip}>
              Skip for now
            </Button>
            <Button variant="cta" onClick={onNext} disabled={!isValid}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
