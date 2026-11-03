import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useOnboardingState } from "@/hooks/useOnboardingState";

interface OnboardingWelcomeProps {
  onNext: () => void;
}

export function OnboardingWelcome({ onNext }: OnboardingWelcomeProps) {
  const { isLoading } = useOnboardingState();

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] px-8">
      <div className="w-full max-w-2xl space-y-12 text-center">
        {/* Logo & Headline */}
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="flex justify-center">
            <img src="/media/mascot/fox-wave-cut.png" alt="" className="h-32 w-auto" />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">
              Welcome to ACA
            </h1>
            <p className="text-lg text-muted-foreground">
              Warm leads, nurtured until they buy or book. Set up in under 3 minutes.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-muted text-sm text-muted-foreground">
              <span className="font-medium">Bring your own keys</span>
            </span>
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-muted text-sm text-muted-foreground">
              <span className="font-medium">Never pay per credit</span>
            </span>
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-muted text-sm text-muted-foreground">
              <span className="font-medium">Unlimited leads, seats, campaigns &amp; content</span>
            </span>
          </div>
        </div>

        {/* CTA */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
          <Button
            variant="cta"
            size="lg"
            onClick={onNext}
            disabled={isLoading}
            className="px-8"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading...
              </>
            ) : (
              "Get Started"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
