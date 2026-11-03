import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export type CrmChannelType =
  | 'email'
  | 'linkedin_invitation'
  | 'linkedin_message'
  | 'linkedin_comment'
  | 'instagram_dm'
  | 'twitter_dm'
  | 'sms'
  | 'whatsapp';

export type LimitZone = 'safe' | 'moderate' | 'faster' | 'risky';

export type WarmupStatus = 'not_started' | 'in_progress' | 'paused' | 'completed';

export interface ChannelLimitDefinition {
  id: string;
  channel: CrmChannelType;
  display_name: string;
  description: string | null;
  icon: string | null;
  safe_daily_limit: number;
  moderate_daily_limit: number;
  faster_daily_limit: number;
  risky_daily_limit: number;
  absolute_max_daily: number;
  absolute_max_hourly: number;
  warmup_enabled: boolean;
  warmup_start_limit: number;
  warmup_increment_per_day: number;
  warmup_duration_days: number;
  min_interval_seconds: number;
  business_hours_recommended: boolean;
  risk_weight: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationChannelLimit {
  id: string;
  organization_id: string;
  channel: CrmChannelType;
  is_enabled: boolean;
  current_zone: LimitZone;
  custom_daily_limit: number | null;
  custom_hourly_limit: number | null;
  warmup_status: WarmupStatus;
  warmup_started_at: string | null;
  warmup_paused_at: string | null;
  warmup_completed_at: string | null;
  warmup_current_day: number;
  warmup_progress_percent: number;
  channel_account_id: string | null;
  business_hours_only: boolean;
  business_hours_start: string;
  business_hours_end: string;
  timezone: string;
  active_days: number[];
  risk_tolerance: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelUsageTracking {
  id: string;
  organization_id: string;
  channel: CrmChannelType;
  channel_account_id: string | null;
  period_date: string;
  period_hour: number | null;
  messages_sent: number;
  messages_delivered: number;
  messages_failed: number;
  messages_bounced: number;
  replies_received: number;
  opens_tracked: number;
  clicks_tracked: number;
  rate_limit_hits: number;
  effective_limit: number | null;
  usage_percent: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelLimitReport {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  channels: CrmChannelType[];
  date_range_days: number;
  show_warmup: boolean;
  show_risk_zones: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChannelLimitSummary {
  channel: CrmChannelType;
  display_name: string;
  description: string | null;
  icon: string | null;
  is_enabled: boolean;
  current_zone: LimitZone;
  daily_limit: number;
  today_used: number;
  today_remaining: number;
  usage_percent: number;
  warmup_status: WarmupStatus;
  warmup_progress: number;
  avg_daily_usage: number;
  total_sent_period: number;
  total_delivered_period: number;
  total_failed_period: number;
  reply_rate: number;
}

export interface UpdateChannelLimitInput {
  channel: CrmChannelType;
  is_enabled?: boolean;
  current_zone?: LimitZone;
  custom_daily_limit?: number | null;
  custom_hourly_limit?: number | null;
  business_hours_only?: boolean;
  business_hours_start?: string;
  business_hours_end?: string;
  timezone?: string;
  active_days?: number[];
  risk_tolerance?: number;
  notes?: string;
}

export interface CheckLimitResult {
  allowed: boolean;
  remaining: number;
  daily_limit: number;
  daily_used: number;
  hourly_limit: number;
  hourly_used: number;
  reason: string | null;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch all channel limit definitions (global defaults)
 */
export function useChannelDefinitions() {
  return useQuery({
    queryKey: ['channel-limit-definitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('channel_limit_definitions')
        .select('*')
        .order('display_name');

      if (error) throw error;
      return data as ChannelLimitDefinition[];
    },
    staleTime: 60000 * 5, // 5 minutes - these rarely change
  });
}

/**
 * Fetch organization-specific channel limits
 */
export function useOrganizationChannelLimits() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['organization-channel-limits', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization');

      const { data, error } = await supabase
        .from('organization_channel_limits')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('channel');

      if (error) throw error;
      return data as OrganizationChannelLimit[];
    },
    enabled: !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Get channel limits summary with usage data (for the UI dashboard)
 */
export function useChannelLimitsSummary(dateRangeDays: number = 7) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['channel-limits-summary', currentOrganization?.id, dateRangeDays],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization');

      const { data, error } = await supabase.rpc('get_channel_limits_summary', {
        p_organization_id: currentOrganization.id,
        p_date_range_days: dateRangeDays,
      });

      if (error) throw error;
      return data as ChannelLimitSummary[];
    },
    enabled: !!currentOrganization,
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

/**
 * Check if an action is allowed for a specific channel
 */
export function useCheckChannelLimit(channel: CrmChannelType | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['check-channel-limit', currentOrganization?.id, channel],
    queryFn: async () => {
      if (!currentOrganization || !channel) throw new Error('No organization or no channel');

      const { data, error } = await supabase.rpc('check_channel_limit', {
        p_organization_id: currentOrganization.id,
        p_channel: channel,
      });

      if (error) throw error;
      return (data?.[0] || null) as CheckLimitResult | null;
    },
    enabled: !!currentOrganization && !!channel,
    staleTime: 10000,
  });
}

/**
 * Fetch channel usage history for analytics
 */
export function useChannelUsageHistory(
  channel: CrmChannelType | null,
  dateRangeDays: number = 7
) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['channel-usage-history', currentOrganization?.id, channel, dateRangeDays],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization');

      let query = supabase
        .from('channel_usage_tracking')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .is('period_hour', null)
        .gte('period_date', new Date(Date.now() - dateRangeDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('period_date', { ascending: true });

      if (channel) {
        query = query.eq('channel', channel);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as ChannelUsageTracking[];
    },
    enabled: !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Fetch limit reports for the organization
 */
export function useLimitReports() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['limit-reports', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization');

      const { data, error } = await supabase
        .from('channel_limit_reports')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('name');

      if (error) throw error;
      return data as ChannelLimitReport[];
    },
    enabled: !!currentOrganization,
    staleTime: 60000,
  });
}

/**
 * Update channel limit configuration
 */
export function useUpdateChannelLimit() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateChannelLimitInput) => {
      if (!currentOrganization) throw new Error('No organization');

      const orgId = currentOrganization.id;

      // Build the update object with only defined fields
      const updateData: Record<string, unknown> = {
        organization_id: orgId,
        channel: input.channel,
        updated_at: new Date().toISOString(),
      };

      // Only include fields that are explicitly provided
      if (input.is_enabled !== undefined) updateData.is_enabled = input.is_enabled;
      if (input.current_zone !== undefined) updateData.current_zone = input.current_zone;
      if (input.custom_daily_limit !== undefined) updateData.custom_daily_limit = input.custom_daily_limit;
      if (input.custom_hourly_limit !== undefined) updateData.custom_hourly_limit = input.custom_hourly_limit;
      if (input.business_hours_only !== undefined) updateData.business_hours_only = input.business_hours_only;
      if (input.business_hours_start !== undefined) updateData.business_hours_start = input.business_hours_start;
      if (input.business_hours_end !== undefined) updateData.business_hours_end = input.business_hours_end;
      if (input.timezone !== undefined) updateData.timezone = input.timezone;
      if (input.active_days !== undefined) updateData.active_days = input.active_days;
      if (input.risk_tolerance !== undefined) updateData.risk_tolerance = input.risk_tolerance;
      if (input.notes !== undefined) updateData.notes = input.notes;

      // First try to find existing record
      const { data: existing } = await supabase
        .from('organization_channel_limits')
        .select('id')
        .eq('organization_id', orgId)
        .eq('channel', input.channel)
        .is('channel_account_id', null)
        .single();

      let data;
      let error;

      if (existing) {
        // Update existing record
        const result = await supabase
          .from('organization_channel_limits')
          .update(updateData)
          .eq('id', existing.id)
          .select()
          .single();
        data = result.data;
        error = result.error;
      } else {
        // Insert new record
        const result = await supabase
          .from('organization_channel_limits')
          .insert(updateData)
          .select()
          .single();
        data = result.data;
        error = result.error;
      }

      if (error) throw error;
      return data as OrganizationChannelLimit;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-channel-limits'] });
      queryClient.invalidateQueries({ queryKey: ['channel-limits-summary'] });
      queryClient.invalidateQueries({ queryKey: ['check-channel-limit'] });
      toast.success('Channel limit updated');
    },
    onError: (error) => {
      console.error('Failed to update channel limit:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update limit');
    },
  });
}

/**
 * Start warmup for a channel
 */
export function useStartWarmup() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channel: CrmChannelType) => {
      if (!currentOrganization) throw new Error('No organization');

      const { data, error } = await supabase
        .from('organization_channel_limits')
        .upsert({
          organization_id: currentOrganization.id,
          channel: channel,
          warmup_status: 'in_progress',
          warmup_started_at: new Date().toISOString(),
          warmup_current_day: 0,
          warmup_progress_percent: 0,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'organization_id,channel,channel_account_id',
        })
        .select()
        .single();

      if (error) throw error;
      return data as OrganizationChannelLimit;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-channel-limits'] });
      queryClient.invalidateQueries({ queryKey: ['channel-limits-summary'] });
      toast.success('Warmup started');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to start warmup');
    },
  });
}

/**
 * Pause warmup for a channel
 */
export function usePauseWarmup() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channel: CrmChannelType) => {
      if (!currentOrganization) throw new Error('No organization');

      const { data, error } = await supabase
        .from('organization_channel_limits')
        .update({
          warmup_status: 'paused',
          warmup_paused_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', currentOrganization.id)
        .eq('channel', channel)
        .select()
        .single();

      if (error) throw error;
      return data as OrganizationChannelLimit;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-channel-limits'] });
      queryClient.invalidateQueries({ queryKey: ['channel-limits-summary'] });
      toast.success('Warmup paused');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to pause warmup');
    },
  });
}

/**
 * Resume warmup for a channel
 */
export function useResumeWarmup() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channel: CrmChannelType) => {
      if (!currentOrganization) throw new Error('No organization');

      const { data, error } = await supabase
        .from('organization_channel_limits')
        .update({
          warmup_status: 'in_progress',
          warmup_paused_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', currentOrganization.id)
        .eq('channel', channel)
        .select()
        .single();

      if (error) throw error;
      return data as OrganizationChannelLimit;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-channel-limits'] });
      queryClient.invalidateQueries({ queryKey: ['channel-limits-summary'] });
      toast.success('Warmup resumed');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to resume warmup');
    },
  });
}

/**
 * Reset warmup for a channel
 */
export function useResetWarmup() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (channel: CrmChannelType) => {
      if (!currentOrganization) throw new Error('No organization');

      const { data, error } = await supabase
        .from('organization_channel_limits')
        .update({
          warmup_status: 'not_started',
          warmup_started_at: null,
          warmup_paused_at: null,
          warmup_completed_at: null,
          warmup_current_day: 0,
          warmup_progress_percent: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', currentOrganization.id)
        .eq('channel', channel)
        .select()
        .single();

      if (error) throw error;
      return data as OrganizationChannelLimit;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-channel-limits'] });
      queryClient.invalidateQueries({ queryKey: ['channel-limits-summary'] });
      toast.success('Warmup reset');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reset warmup');
    },
  });
}

/**
 * Create a new limit report
 */
export function useCreateLimitReport() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      channels?: CrmChannelType[];
      date_range_days?: number;
      show_warmup?: boolean;
      show_risk_zones?: boolean;
    }) => {
      if (!currentOrganization) throw new Error('No organization');

      const { data, error } = await supabase
        .from('channel_limit_reports')
        .insert({
          organization_id: currentOrganization.id,
          name: input.name,
          description: input.description,
          channels: input.channels || ['email', 'linkedin_invitation', 'linkedin_message', 'linkedin_comment'],
          date_range_days: input.date_range_days || 7,
          show_warmup: input.show_warmup ?? true,
          show_risk_zones: input.show_risk_zones ?? true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as ChannelLimitReport;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['limit-reports'] });
      toast.success('Report created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create report');
    },
  });
}

/**
 * Delete a limit report
 */
export function useDeleteLimitReport() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reportId: string) => {
      if (!currentOrganization) throw new Error('No organization');

      const { error } = await supabase
        .from('channel_limit_reports')
        .delete()
        .eq('id', reportId)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['limit-reports'] });
      toast.success('Report deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete report');
    },
  });
}

// ============================================================================
// Utility Functions (for use in message queue processing)
// ============================================================================

/**
 * Check if we can send a message for a channel (client-side helper)
 */
export async function canSendMessage(
  organizationId: string,
  channel: CrmChannelType
): Promise<{ allowed: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('check_channel_limit', {
    p_organization_id: organizationId,
    p_channel: channel,
  });

  if (error) {
    console.error('Error checking channel limit:', error);
    return { allowed: false, reason: 'Error checking limits' };
  }

  const result = data?.[0] as CheckLimitResult | undefined;
  if (!result) {
    return { allowed: true }; // No limits configured
  }

  return {
    allowed: result.allowed,
    reason: result.reason || undefined,
  };
}

/**
 * Record a message send (to be called after sending)
 */
export async function recordMessageSend(
  organizationId: string,
  channel: CrmChannelType,
  status: 'sent' | 'delivered' | 'failed' | 'bounced' = 'sent'
): Promise<boolean> {
  const { data, error } = await supabase.rpc('increment_channel_usage', {
    p_organization_id: organizationId,
    p_channel: channel,
    p_status: status,
  });

  if (error) {
    console.error('Error recording message send:', error);
    return false;
  }

  return data === true;
}
