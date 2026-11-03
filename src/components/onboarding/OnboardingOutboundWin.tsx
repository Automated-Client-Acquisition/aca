import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Target, ArrowRight } from "lucide-react";
import type { PendingSignalSelection } from "@/lib/signalSelection";

interface OnboardingOutboundWinProps {
  selection: PendingSignalSelection;
  /** Completes onboarding and routes into the campaign builder with the picks pre-loaded. */
  onStartCampaign: () => void;
  onSkip: () => void;
  onBack: () => void;
  isStarting?: boolean;
}

const PREVIEW_LIMIT = 8;

export function OnboardingOutboundWin({
  selection,
  onStartCampaign,
  onSkip,
  onBack,
  isStarting = false,
}: OnboardingOutboundWinProps) {
  const { signals } = selection;
  const preview = signals.slice(0, PREVIEW_LIMIT);
  const remaining = signals.length - preview.length;

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] px-8">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 rounded-xl bg-primary/10">
              <Target className="h-10 w-10 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">Start with companies that have a reason to buy</h2>
            <p className="text-muted-foreground">
              You picked <strong>{signals.length.toLocaleString()}</strong>{" "}
              {signals.length === 1 ? "company" : "companies"} from the signal tracker. Let's turn them
              into your first outbound campaign — ACA will source the contacts and write around the trigger.
            </p>
          </div>
        </div>

        {/* Picked companies */}
        <Card className="p-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            {preview.map((signal) => (
              <span
                key={signal.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm bg-muted/40"
              >
                <span className="font-medium">{signal.company}</span>
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  {signal.type_label}
                </span>
              </span>
            ))}
            {remaining > 0 ? (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full border text-sm text-muted-foreground">
                +{remaining.toLocaleString()} more
              </span>
            ) : null}
          </div>
          <Button className="w-full" size="lg" onClick={onStartCampaign} disabled={isStarting}>
            {isStarting ? (
              "Setting up your campaign..."
            ) : (
              <>
                Build my outbound campaign
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </Card>

        {/* Navigation */}
        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack} disabled={isStarting}>
            Back
          </Button>
          <Button variant="outline" onClick={onSkip} disabled={isStarting}>
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
}
