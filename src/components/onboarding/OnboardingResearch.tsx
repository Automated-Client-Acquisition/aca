import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Search, ExternalLink, Check, Loader2 } from "lucide-react";
import { useTestApiKey } from "@/hooks/useTestApiKey";
import { useAddApiKey } from "@/hooks/useAddApiKey";
import { FUNCTIONS_URL } from "@/config/site";

interface OnboardingResearchProps {
  onNext: () => void;
  onBack: () => void;
}

export function OnboardingResearch({ onNext, onBack }: OnboardingResearchProps) {
  const [apifyKey, setApifyKey] = useState("");
  const [youtubeKey, setYoutubeKey] = useState("");
  const [showApify, setShowApify] = useState(false);
  const [showYoutube, setShowYoutube] = useState(false);
  const testApiKey = useTestApiKey();
  const addApiKey = useAddApiKey();
  const [apifyValid, setApifyValid] = useState(false);
  const [youtubeValid, setYoutubeValid] = useState(false);

  const handleTestApify = async () => {
    const result = await testApiKey.mutateAsync({ 
      provider: 'apify', 
      apiKey: apifyKey 
    });
    
    if (result?.valid) {
      setApifyValid(true);
      await addApiKey.mutateAsync({
        provider: 'apify',
        apiKey: apifyKey,
      });
    }
  };

  const handleTestYoutube = async () => {
    const result = await testApiKey.mutateAsync({ 
      provider: 'youtube', 
      apiKey: youtubeKey 
    });
    
    if (result?.valid) {
      setYoutubeValid(true);
      await addApiKey.mutateAsync({
        provider: 'youtube',
        apiKey: youtubeKey,
      });
    }
  };

  const handleSkip = () => {
    onNext();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] px-8 py-8">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 rounded-xl bg-primary/10">
              <Search className="h-10 w-10 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">Research Tools</h2>
            <p className="text-muted-foreground">
              Scrape competitor content and analyze top-performing videos
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-sm">
            <span className="text-muted-foreground">Optional - You can skip both</span>
          </div>
        </div>

        {/* Apify */}
        <Card className="p-6 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Apify</h3>
              {apifyValid && <Check className="h-5 w-5 text-green-600" />}
            </div>
            <p className="text-sm text-muted-foreground">
              Scrape competitor content, product pages, and social posts
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apify-key">Apify API Token</Label>
              <div className="relative">
                <Input
                  id="apify-key"
                  type={showApify ? "text" : "password"}
                  placeholder="apify_api_..."
                  value={apifyKey}
                  onChange={(e) => setApifyKey(e.target.value)}
                  className="pr-20"
                />
                <button
                  type="button"
                  onClick={() => setShowApify(!showApify)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showApify ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Webhook URL instruction */}
            <div className="p-3 rounded-lg bg-[hsl(var(--status-warning))]/10 border border-[hsl(var(--status-warning))]/30 space-y-2">
              <p className="text-sm font-medium text-[hsl(var(--status-warning))]">
                Important: Configure webhook in Apify
              </p>
              <p className="text-xs text-[hsl(var(--status-warning))]/80">
                Go to your Apify Console → Settings → Integrations → Webhooks and add this URL:
              </p>
              <code className="text-xs bg-[hsl(var(--status-warning))]/20 px-2 py-1 rounded block break-all text-[hsl(var(--status-warning))]">
                {`${FUNCTIONS_URL}/apify-webhook`}
              </code>
              <div className="pt-1">
                <p className="text-xs font-medium text-[hsl(var(--status-warning))] mb-1">
                  Required actors (add webhook to each):
                </p>
                <ul className="text-xs text-[hsl(var(--status-warning))]/80 space-y-0.5">
                  <li><span className="font-medium">YouTube:</span> <a href="https://apify.com/streamers/youtube-scraper" target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--status-warning))] hover:underline">streamers/youtube-scraper</a></li>
                  <li><span className="font-medium">TikTok:</span> <a href="https://apify.com/clockworks/tiktok-scraper" target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--status-warning))] hover:underline">clockworks/tiktok-scraper</a></li>
                  <li><span className="font-medium">Instagram:</span> <a href="https://apify.com/apify/instagram-post-scraper" target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--status-warning))] hover:underline">apify/instagram-post-scraper</a></li>
                  <li><span className="font-medium">LinkedIn:</span> <a href="https://apify.com/supreme_coder/linkedin-post" target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--status-warning))] hover:underline">supreme_coder/linkedin-post</a></li>
                </ul>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.open('https://console.apify.com/account/integrations', '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Get Apify API token
              </Button>
              {apifyKey && !apifyValid && (
                <Button
                  onClick={handleTestApify}
                  disabled={testApiKey.isPending}
                  className="flex-1"
                >
                  {testApiKey.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    'Test & Save'
                  )}
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* YouTube API */}
        <Card className="p-6 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">YouTube API</h3>
              {youtubeValid && <Check className="h-5 w-5 text-green-600" />}
            </div>
            <p className="text-sm text-muted-foreground">
              Analyze top-performing videos in your niche
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="youtube-key">YouTube Data API Key</Label>
              <div className="relative">
                <Input
                  id="youtube-key"
                  type={showYoutube ? "text" : "password"}
                  placeholder="AIza..."
                  value={youtubeKey}
                  onChange={(e) => setYoutubeKey(e.target.value)}
                  className="pr-20"
                />
                <button
                  type="button"
                  onClick={() => setShowYoutube(!showYoutube)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showYoutube ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.open('https://console.cloud.google.com/apis/credentials', '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Get YouTube API key
              </Button>
              {youtubeKey && !youtubeValid && (
                <Button
                  onClick={handleTestYoutube}
                  disabled={testApiKey.isPending}
                  className="flex-1"
                >
                  {testApiKey.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    'Test & Save'
                  )}
                </Button>
              )}
            </div>
          </div>
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
            <Button variant="cta" onClick={onNext}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
