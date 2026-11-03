/**
 * Hook to fetch LinkedIn profile data via Unipile
 *
 * Fetches detailed profile information including experience, education,
 * skills, and contact info from LinkedIn using the Unipile API.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ============================================================================
// Types for LinkedIn Profile Data (from Unipile API)
// ============================================================================

export interface LinkedInWorkExperience {
  id?: string;
  position: string;
  company: string;
  company_id?: string;
  company_url?: string;
  company_picture_url?: string;
  industry?: string[];
  location?: string;
  description?: string;
  skills?: string[];
  current?: boolean;
  status?: string;
  start: string | null;
  end: string | null;
}

export interface LinkedInEducation {
  id?: string;
  school: string;
  school_id?: string;
  school_url?: string;
  school_picture_url?: string;
  degree?: string;
  field_of_study?: string;
  grade?: string;
  description?: string;
  activities?: string;
  skills?: string[];
  start: string | null;
  end: string | null;
}

export interface LinkedInSkill {
  name: string;
  endorsement_count: number;
  endorsement_id: number | null;
  insights?: string[];
  endorsed: boolean;
}

export interface LinkedInLanguage {
  name: string;
  proficiency?: string;
}

export interface LinkedInCertification {
  name: string;
  organization: string;
  url?: string;
}

export interface LinkedInProject {
  name: string;
  description: string;
  skills?: string[];
  start: string | null;
  end: string | null;
}

export interface LinkedInRecommendation {
  text: string;
  caption: string;
  actor: {
    first_name: string;
    last_name: string;
    provider_id: string;
    headline: string;
    public_identifier: string;
    public_profile_url: string;
    profile_picture_url?: string;
  };
}

export interface LinkedInContactInfo {
  emails?: string[];
  phones?: string[];
  adresses?: string[];
  socials?: Array<{ type: string; name: string }>;
}

export interface LinkedInProfile {
  provider: 'LINKEDIN';
  provider_id: string;
  public_identifier: string | null;
  first_name: string | null;
  last_name: string | null;
  headline: string;
  summary?: string;
  location?: string;
  websites?: string[];
  profile_picture_url?: string;
  profile_picture_url_large?: string;
  background_picture_url?: string;
  public_profile_url?: string;

  // Contact info
  contact_info?: LinkedInContactInfo;
  birthdate?: { month: number; day: number };
  primary_locale?: { country: string; language: string };

  // Status flags
  can_send_inmail?: boolean;
  is_open_profile?: boolean;
  is_premium?: boolean;
  is_influencer?: boolean;
  is_creator?: boolean;
  is_hiring?: boolean;
  is_open_to_work?: boolean;
  is_relationship?: boolean;
  is_self?: boolean;

  // Connection info
  invitation?: { type: 'SENT' | 'RECEIVED'; status: 'PENDING' | 'IGNORED' | 'WITHDRAWN' };
  network_distance?: 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | 'OUT_OF_NETWORK';
  follower_count?: number;
  connections_count?: number;
  shared_connections_count?: number;

  // Detailed sections
  work_experience?: LinkedInWorkExperience[];
  work_experience_total_count?: number;
  education?: LinkedInEducation[];
  education_total_count?: number;
  skills?: LinkedInSkill[];
  skills_total_count?: number;
  languages?: LinkedInLanguage[];
  languages_total_count?: number;
  certifications?: LinkedInCertification[];
  certifications_total_count?: number;
  projects?: LinkedInProject[];
  projects_total_count?: number;
  volunteering_experience?: Array<{
    company: string;
    description: string;
    role: string;
    cause: string;
    start: string | null;
    end: string | null;
  }>;
  volunteering_experience_total_count?: number;
  recommendations?: {
    received?: LinkedInRecommendation[];
    received_total_count?: number;
    given?: LinkedInRecommendation[];
    given_total_count?: number;
  };

  // Hashtags and creator content
  hashtags?: string[];
  creator_website?: { url: string; description: string };

  // Throttling info
  throttled_sections?: string[];

  object: 'UserProfile';
}

// ============================================================================
// Hook
// ============================================================================

interface UseLinkedInProfileOptions {
  /** LinkedIn provider_id or public_identifier */
  identifier: string | null | undefined;
  /** Unipile account ID to use for fetching */
  accountId: string | null | undefined;
  /** Enable the query */
  enabled?: boolean;
  /** Profile sections to fetch */
  sections?: string[];
}

interface UseLinkedInProfileResult {
  data: LinkedInProfile | null | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useLinkedInProfile({
  identifier,
  accountId,
  enabled = true,
  sections,
}: UseLinkedInProfileOptions): UseLinkedInProfileResult {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['linkedin-profile', identifier, accountId],
    queryFn: async (): Promise<LinkedInProfile> => {
      if (!identifier || !accountId) {
        throw new Error('Missing identifier or accountId');
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('unipile-fetch-profile', {
        body: { identifier, accountId, sections, notify: false },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch profile');
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Failed to fetch profile');
      }

      return response.data.profile;
    },
    enabled: enabled && !!user && !!identifier && !!accountId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    retry: (failureCount, error) => {
      // Don't retry on auth or not found errors
      const message = error instanceof Error ? error.message : '';
      if (message.includes('not found') || message.includes('not authorized')) {
        return false;
      }
      return failureCount < 2;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to get the first available LinkedIn account for profile fetching
 */
export function useLinkedInAccount() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['linkedin-account-for-profile'],
    queryFn: async () => {
      // Get user's organization
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('organization_id, active_organization_id')
        .eq('id', user!.id)
        .single();

      if (userError) throw userError;

      const organizationId = userData.active_organization_id || userData.organization_id;

      // Get first active LinkedIn account
      const { data: accounts, error: accountsError } = await supabase
        .from('unipile_accounts')
        .select('unipile_account_id, display_name, provider')
        .eq('organization_id', organizationId)
        .eq('provider', 'LINKEDIN')
        .eq('status', 'active')
        .limit(1);

      if (accountsError) throw accountsError;

      const account = accounts?.[0];
      return account ? {
        account_id: account.unipile_account_id,
        name: account.display_name,
        provider: account.provider,
      } : null;
    },
    enabled: !!user,
    staleTime: 60 * 1000, // Cache for 1 minute
  });
}
