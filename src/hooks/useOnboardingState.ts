import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// New streamlined onboarding steps (4 steps instead of 8)
export type OnboardingStep =
  | 'welcome'      // Intro splash
  | 'setup'        // Quick AI setup (skippable)
  | 'quick-win'    // Add first idea
  | 'success';     // Done - redirect to dashboard

// Keep legacy steps for backwards compatibility
export type LegacyOnboardingStep =
  | 'llm'
  | 'media'
  | 'voice'
  | 'storage'
  | 'research'
  | 'publishing';

interface OnboardingSettings {
  onboarding_completed: boolean;
  onboarding_step: string | null;
  setup_completed: boolean;
  checklist_dismissed: boolean;
  organization_id: string;
}

export function useOnboardingState() {
  const { user, loading: authLoading, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  // Use currentOrganization from auth context - it's already available and updates on org switch
  const orgId = currentOrganization?.id;

  // Fetch onboarding settings for the current organization
  // Query key includes orgId so it caches separately per org (no refetch flash on switch)
  const { data: settings, isLoading } = useQuery({
    queryKey: ['onboarding-status', orgId],
    queryFn: async () => {
      if (!orgId) return null;

      const { data, error } = await supabase
        .from('organization_settings')
        .select('onboarding_completed, onboarding_step, setup_completed, checklist_dismissed, organization_id')
        .eq('organization_id', orgId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching onboarding settings:', error);
        throw error;
      }

      // No settings row yet - return defaults
      if (!data) {
        return {
          onboarding_completed: false,
          onboarding_step: null,
          setup_completed: false,
          checklist_dismissed: false,
          organization_id: orgId,
        } as OnboardingSettings;
      }

      return { ...data, organization_id: orgId } as OnboardingSettings;
    },
    enabled: !!user && !!orgId,
    // Keep previous data while switching orgs to avoid flash
    placeholderData: (previousData) => previousData,
  });

  const updateStep = useMutation({
    mutationFn: async (step: OnboardingStep) => {
      if (!settings?.organization_id) throw new Error('Organization not found');

      const { error } = await supabase
        .from('organization_settings')
        .upsert({
          organization_id: settings.organization_id,
          onboarding_step: step
        }, { onConflict: 'organization_id' });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
    },
  });

  const completeOnboarding = useMutation({
    mutationFn: async () => {
      if (!settings?.organization_id) throw new Error('Organization not found');

      const { error } = await supabase
        .from('organization_settings')
        .upsert({
          organization_id: settings.organization_id,
          onboarding_completed: true,
          onboarding_step: 'success'
        }, { onConflict: 'organization_id' });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
      toast.success('Welcome to ContentAI Studio!');
    },
  });

  const dismissChecklist = useMutation({
    mutationFn: async () => {
      if (!settings?.organization_id) throw new Error('Organization not found');

      const { error } = await supabase
        .from('organization_settings')
        .upsert({
          organization_id: settings.organization_id,
          checklist_dismissed: true
        }, { onConflict: 'organization_id' });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
    },
  });

  const restoreChecklist = useMutation({
    mutationFn: async () => {
      if (!settings?.organization_id) throw new Error('Organization not found');

      const { error } = await supabase
        .from('organization_settings')
        .upsert({
          organization_id: settings.organization_id,
          checklist_dismissed: false
        }, { onConflict: 'organization_id' });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
    },
  });

  // Loading is true only while auth is loading or we have no cached data yet
  // Once we have data for any org, we use placeholderData to avoid flashing
  const effectiveLoading = authLoading || (!!user && !!orgId && isLoading && !settings);

  return {
    isLoading: effectiveLoading,
    isReady: !authLoading && !!user && !!orgId && !!settings,
    currentStep: settings?.onboarding_step as OnboardingStep | null,
    isCompleted: settings?.onboarding_completed ?? false,
    setupCompleted: settings?.setup_completed ?? false,
    checklistDismissed: settings?.checklist_dismissed ?? false,
    updateStep,
    completeOnboarding,
    dismissChecklist,
    restoreChecklist,
  };
}
