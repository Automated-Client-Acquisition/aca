import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Share2, Check } from "lucide-react";
import { useGHLConnection } from "@/hooks/useGHLConnection";
import { supabase } from "@/integrations/supabase/client";

interface OnboardingPublishingProps {
  onNext: () => void;
  onBack: () => void;
}

export function OnboardingPublishing({ onNext, onBack }: OnboardingPublishingProps) {
  const { data: ghlConnection, isLoading } = useGHLConnection();
  const isConnected = ghlConnection?.connected;

  const handleConnect = async () => {
    const { data } = await supabase.functions.invoke('ghl-oauth-init');
    if (data?.authUrl) {
      window.open(data.authUrl, 'GHL OAuth', 'width=600,height=700');
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
              <Share2 className="h-10 w-10 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">Publishing Integration</h2>
            <p className="text-muted-foreground">
              Connect LeadConnector to publish content directly to social platforms
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-sm">
            <span className="text-muted-foreground">Optional - You can publish manually</span>
          </div>
        </div>

        {/* Connection Card */}
        <Card className="p-6 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="font-semibold">LeadConnector</h3>
                <p className="text-sm text-muted-foreground">
                  Publish to Instagram, Facebook, LinkedIn, and more
                </p>
              </div>
              {isConnected && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Check className="h-4 w-4" />
                  <span>Connected</span>
                </div>
              )}
            </div>

            {!isConnected && (
              <Button
                variant="cta"
                className="w-full"
                onClick={handleConnect}
                disabled={isLoading}
              >
                Connect LeadConnector
              </Button>
            )}
          </div>
        </Card>

        {/* Navigation */}
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <div className="flex gap-2">
            {!isConnected && (
              <Button variant="outline" onClick={handleSkip}>
                Skip for now
              </Button>
            )}
            <Button variant="cta" onClick={onNext}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
