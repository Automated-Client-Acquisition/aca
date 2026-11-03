import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, X, Sparkles, FileText, Package, Zap } from "lucide-react";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useStorageCredentials } from "@/hooks/useStorageCredentials";
import { useOnboardingState } from "@/hooks/useOnboardingState";
import Confetti from "react-confetti";

interface OnboardingSuccessProps {
  onBack: () => void;
}

export function OnboardingSuccess({ onBack }: OnboardingSuccessProps) {
  const navigate = useNavigate();
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const { data: apiKeys } = useApiKeys();
  const { data: storage } = useStorageCredentials();
  const { completeOnboarding } = useOnboardingState();

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    completeOnboarding.mutate();
  }, []);

  const hasOpenRouter = apiKeys?.some(k => k.provider === 'openrouter' && k.is_valid);
  const hasReplicate = apiKeys?.some(k => k.provider === 'replicate' && k.is_valid);
  const hasElevenLabs = apiKeys?.some(k => k.provider === 'elevenlabs' && k.is_valid);
  const hasApify = apiKeys?.some(k => k.provider === 'apify' && k.is_valid);
  const hasYoutube = apiKeys?.some(k => k.provider === 'youtube' && k.is_valid);
  const hasStorage = storage && storage.length > 0;

  return (
    <>
      <Confetti
        width={windowSize.width}
        height={windowSize.height}
        recycle={false}
        numberOfPieces={500}
        gravity={0.3}
      />
      
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] px-8 py-8">
        <div className="w-full max-w-2xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex justify-center">
              <div className="p-4 rounded-2xl bg-primary/10">
                <Sparkles className="h-16 w-16 text-primary" />
              </div>
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl font-bold">You're All Set! 🎉</h1>
              <p className="text-lg text-muted-foreground">
                Your content engine is ready to roll
              </p>
            </div>
          </div>

          {/* Configuration Summary */}
          <Card className="p-6 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
            <h3 className="font-semibold">Configuration Summary</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">OpenRouter (AI Text)</span>
                {hasOpenRouter ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <Check className="h-4 w-4" />
                    <span className="text-sm font-medium">Connected</span>
                  </div>
                ) : (
                  <X className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Replicate (Media)</span>
                {hasReplicate ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <Check className="h-4 w-4" />
                    <span className="text-sm font-medium">Connected</span>
                  </div>
                ) : (
                  <X className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">ElevenLabs (Voice)</span>
                {hasElevenLabs ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <Check className="h-4 w-4" />
                    <span className="text-sm font-medium">Connected</span>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Skipped</div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Cloud Storage</span>
                {hasStorage ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <Check className="h-4 w-4" />
                    <span className="text-sm font-medium">Connected</span>
                  </div>
                ) : (
                  <X className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Research Tools</span>
                {hasApify || hasYoutube ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <Check className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      {[hasApify && 'Apify', hasYoutube && 'YouTube'].filter(Boolean).join(', ')}
                    </span>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Skipped</div>
                )}
              </div>
            </div>
          </Card>

          {/* Quick Start Actions */}
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
            <h3 className="font-semibold text-center">What's Next?</h3>
            <div className="grid md:grid-cols-3 gap-4">
              <Card
                className="p-6 cursor-pointer hover:border-primary transition-all"
                onClick={() => navigate('/blueprints')}
              >
                <div className="space-y-3">
                  <div className="p-2 rounded-lg bg-primary/10 w-fit">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-semibold">Create Blueprint</h4>
                    <p className="text-xs text-muted-foreground">
                      Set up your first content template
                    </p>
                  </div>
                </div>
              </Card>

              <Card
                className="p-6 cursor-pointer hover:border-primary transition-all"
                onClick={() => navigate('/assets?tab=products')}
              >
                <div className="space-y-3">
                  <div className="p-2 rounded-lg bg-primary/10 w-fit">
                    <Package className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-semibold">Add Assets</h4>
                    <p className="text-xs text-muted-foreground">
                      Upload products, characters, and more
                    </p>
                  </div>
                </div>
              </Card>

              <Card
                className="p-6 cursor-pointer hover:border-primary transition-all"
                onClick={() => navigate('/create')}
              >
                <div className="space-y-3">
                  <div className="p-2 rounded-lg bg-primary/10 w-fit">
                    <Zap className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-semibold">Generate Content</h4>
                    <p className="text-xs text-muted-foreground">
                      Start creating content right away
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* CTA */}
          <div className="flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
            <Button size="lg" onClick={() => navigate('/campaigns')}>
              Go to Automations
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
