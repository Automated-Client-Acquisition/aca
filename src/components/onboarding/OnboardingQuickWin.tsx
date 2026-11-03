import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Lightbulb, Loader2, Check, Sparkles } from "lucide-react";
import { useIdeas } from "@/hooks/useIdeas";
import { cn } from "@/lib/utils";

interface OnboardingQuickWinProps {
  onNext: () => void;
  onBack: () => void;
}

const EXAMPLE_IDEAS = [
  "5 signs your ideal client is about to switch providers",
  "How we book 20 meetings a month without ads",
  "The cold email mistakes that kill reply rates",
  "Why referrals dry up (and what to do instead)",
  "The LinkedIn post that fills our calendar every time",
];

export function OnboardingQuickWin({ onNext, onBack }: OnboardingQuickWinProps) {
  const [idea, setIdea] = useState("");
  const [isCreated, setIsCreated] = useState(false);
  const { createIdea, isCreating } = useIdeas();

  const handleCreate = async () => {
    if (!idea.trim()) return;

    try {
      await createIdea({ title: idea.trim() });
      setIsCreated(true);
      // Auto-advance after a brief celebration
      setTimeout(() => {
        onNext();
      }, 1500);
    } catch (error) {
      // Error handled by hook
    }
  };

  const handleUseExample = (example: string) => {
    setIdea(example);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] px-8">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 rounded-xl bg-primary/10">
              <Lightbulb className="h-10 w-10 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">Give the Machine Its First Idea</h2>
            <p className="text-muted-foreground">
              Content is how warm leads find you. Drop one idea and ACA turns it
              into posts that pull buyers in.
            </p>
          </div>
        </div>

        {/* Success State */}
        {isCreated ? (
          <Card className="p-8 text-center space-y-4 border-green-500/50 bg-green-500/5">
            <div className="flex justify-center">
              <div className="p-3 rounded-full bg-green-500/10">
                <Check className="h-8 w-8 text-green-500" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold">Idea Created!</h3>
              <p className="text-muted-foreground">
                Taking you to your dashboard...
              </p>
            </div>
            <div className="flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          </Card>
        ) : (
          <>
            {/* Input */}
            <Card className="p-6 space-y-4">
              <Textarea
                placeholder="e.g., 10 AI Tools Every Content Creator Should Know..."
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                className="min-h-[100px] resize-none text-lg"
                autoFocus
              />
              <Button
                className="w-full"
                size="lg"
                onClick={handleCreate}
                disabled={!idea.trim() || isCreating}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Create Idea
                  </>
                )}
              </Button>
            </Card>

            {/* Examples */}
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Or click an example to use it:
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {EXAMPLE_IDEAS.map((example, index) => (
                  <button
                    key={index}
                    onClick={() => handleUseExample(example)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-sm border transition-all",
                      "hover:border-primary hover:bg-accent",
                      idea === example && "border-primary bg-accent"
                    )}
                  >
                    {example.length > 40
                      ? example.substring(0, 40) + "..."
                      : example}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Navigation */}
        {!isCreated && (
          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button variant="outline" onClick={onNext}>
              Skip for now
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
