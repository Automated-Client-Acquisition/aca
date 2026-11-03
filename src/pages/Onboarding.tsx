import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";
import { OnboardingWelcome } from "@/components/onboarding/OnboardingWelcome";
import { OnboardingQuickSetup } from "@/components/onboarding/OnboardingQuickSetup";
import { OnboardingQuickWin } from "@/components/onboarding/OnboardingQuickWin";
import { OnboardingOutboundWin } from "@/components/onboarding/OnboardingOutboundWin";
import { useOnboardingState, type OnboardingStep } from "@/hooks/useOnboardingState";
import { loadPendingSignalSelection, type PendingSignalSelection } from "@/lib/signalSelection";

// New streamlined 4-step flow (was 8 steps)
const STEP_ORDER: OnboardingStep[] = [
  'welcome',    // Intro splash
  'setup',      // Quick AI setup (skippable)
  'quick-win',  // Add first idea
  'success',    // Done - redirect to outreach automations
];

export default function Onboarding() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentStep, updateStep, completeOnboarding, isCompleted } = useOnboardingState();

  // Visitors who picked companies on /signals get an outbound first-win instead
  // of the content-idea quick-win. Read once on mount; leave it in storage so the
  // campaign builder can consume it after onboarding completes.
  const [pendingSelection] = useState<PendingSignalSelection | null>(() => loadPendingSignalSelection());
  const [isStartingOutbound, setIsStartingOutbound] = useState(false);

  // Handle legacy steps by mapping them to new flow
  const rawStep = searchParams.get('step') || currentStep || 'welcome';
  const step = mapLegacyStep(rawStep as string);

  useEffect(() => {
    if (isCompleted) {
      navigate('/campaigns');
    }
  }, [isCompleted, navigate]);

  const goToStep = (newStep: OnboardingStep) => {
    setSearchParams({ step: newStep });
    updateStep.mutate(newStep);
  };

  const handleNext = async () => {
    const currentIndex = STEP_ORDER.indexOf(step);
    if (currentIndex < STEP_ORDER.length - 1) {
      const nextStep = STEP_ORDER[currentIndex + 1];
      if (nextStep === 'success') {
        // Complete onboarding and land on outreach automations, matching
        // the "book meetings" promise (not the content jobs list).
        await completeOnboarding.mutateAsync();
        navigate('/campaigns');
      } else {
        goToStep(nextStep);
      }
    }
  };

  const handleBack = () => {
    const currentIndex = STEP_ORDER.indexOf(step);
    if (currentIndex > 0) {
      goToStep(STEP_ORDER[currentIndex - 1]);
    }
  };

  const handleSkipSetup = () => {
    // Skip to quick-win, user can set up later via checklist
    goToStep('quick-win');
  };

  // Outbound first-win: finish onboarding and drop them straight into the
  // campaign builder, which reads the still-stored selection as a draft list.
  const handleStartOutbound = async () => {
    setIsStartingOutbound(true);
    try {
      await completeOnboarding.mutateAsync();
      navigate('/campaigns/new?source=public-signals');
    } catch {
      setIsStartingOutbound(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {step !== 'welcome' && step !== 'success' && (
        <OnboardingProgress currentStep={step} />
      )}

      {step === 'welcome' && <OnboardingWelcome onNext={handleNext} />}
      {step === 'setup' && (
        <OnboardingQuickSetup
          onNext={handleNext}
          onBack={handleBack}
          onSkip={handleSkipSetup}
        />
      )}
      {step === 'quick-win' && (
        pendingSelection ? (
          <OnboardingOutboundWin
            selection={pendingSelection}
            onStartCampaign={handleStartOutbound}
            onSkip={handleNext}
            onBack={handleBack}
            isStarting={isStartingOutbound}
          />
        ) : (
          <OnboardingQuickWin onNext={handleNext} onBack={handleBack} />
        )
      )}
    </div>
  );
}

// Map legacy 8-step flow to new 4-step flow for backwards compatibility
function mapLegacyStep(step: string): OnboardingStep {
  const legacyToNew: Record<string, OnboardingStep> = {
    'welcome': 'welcome',
    'llm': 'setup',
    'media': 'setup',
    'voice': 'setup',
    'storage': 'setup',
    'research': 'setup',
    'publishing': 'setup',
    'setup': 'setup',
    'quick-win': 'quick-win',
    'success': 'success',
  };
  return legacyToNew[step] || 'welcome';
}
