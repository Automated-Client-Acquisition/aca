import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook to check and sync a user's Skool membership with their ACA plan tier.
 * This is called on login to ensure instant access for users who just upgraded their Skool plan.
 */
export function useSkoolMembershipCheck() {
  /**
   * Check Skool membership for the current user and update their plan tier if needed.
   * This is a quick single-user check that happens on login.
   */
  const checkMembership = useCallback(async (userEmail: string): Promise<{
    success: boolean;
    tier?: string;
    error?: string;
  }> => {
    try {
      console.log('[SkoolCheck] Checking membership for:', userEmail);

      const { data, error } = await supabase.functions.invoke('sync-skool-memberships', {
        body: { user_email: userEmail },
      });

      if (error) {
        console.error('[SkoolCheck] Error:', error);
        return { success: false, error: error.message };
      }

      if (data?.success) {
        console.log('[SkoolCheck] Result:', data);
        return {
          success: true,
          tier: data.tier,
        };
      }

      return { success: false, error: 'Unknown response' };
    } catch (error) {
      console.error('[SkoolCheck] Exception:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }, []);

  return { checkMembership };
}
