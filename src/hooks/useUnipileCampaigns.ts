import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface UnipileCampaign {
  id: string;
  organization_id: string;
  account_id: string | null;
  name: string;
  trigger_keywords: string;
  dm_template: string;
  dm_delay_seconds: number;
  max_dms_per_hour: number;
  max_dms_per_day: number;
  user_cooldown_hours: number;
  webhook_url: string | null;
  auto_accept_connections: boolean;
  require_connection_for_linkedin: boolean;
  comment_link_mode: 'gated' | 'direct';
  is_active: boolean;
  status: 'draft' | 'active' | 'paused';
  created_at: string;
  updated_at: string;
  // ICP scoring
  icp_id: string | null;
  icp_threshold: number;
  // AI chatbot
  ai_chatbot_enabled: boolean;
  ai_chatbot_instructions: string | null;
  ai_chatbot_brand_voice_id: string | null;
  ai_chatbot_model: string | null;
  ai_chatbot_max_turns: number;
  ai_chatbot_handoff_keywords: string[] | null;
  // Auto-add posts
  auto_add_posts: boolean;
  auto_add_posts_account_ids?: string[];
  // Sender accounts (multi-select)
  sender_account_ids?: string[];
  // Knowledge base documents
  knowledge_document_ids?: string[];
  // Agent profile
  agent_profile_id?: string | null;
  account?: {
    id: string;
    provider: 'LINKEDIN' | 'INSTAGRAM';
    display_name: string | null;
    username: string | null;
    status: string;
  };
  stats?: {
    total_leads: number;
    dm_sent: number;
    dm_pending: number;
    monitored_posts: number;
  };
}

export interface UnipileAccountRef {
  id: string;
  provider: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface UnipileMonitoredPost {
  id: string;
  campaign_id: string;
  post_id: string;
  post_url: string;
  provider: 'LINKEDIN' | 'INSTAGRAM';
  post_title: string | null;
  post_content: string | null;
  post_thumbnail_url: string | null;
  post_author_name: string | null;
  post_created_at: string | null;
  comments_processed: number;
  is_active: boolean;
  last_polled_at: string | null;
  created_at: string;
  source_account_id?: string | null;
  source_account?: UnipileAccountRef | null;
}

export interface UnipileLead {
  id: string;
  campaign_id: string;
  post_id: string;
  commenter_id: string;
  commenter_name: string;
  commenter_headline: string | null;
  commenter_profile_url: string | null;
  comment_id: string;
  comment_text: string;
  matched_keyword: string;
  status: 'pending' | 'dm_sent' | 'dm_failed' | 'replied' | 'converted' | 'skipped' | 'awaiting_connection' | 'comment_replied' | 'unresponsive' | 'scoring' | 'low_icp' | 'ai_chatting';
  dm_sent_at: string | null;
  dm_error: string | null;
  captured_at: string;
  // ICP scoring
  icp_score: number | null;
  icp_score_reasoning: string | null;
  // AI chatbot state
  ai_conversation_active: boolean;
  ai_conversation_turn_count: number;
  ai_handoff_requested: boolean;
  // Sender account
  sender_account_id?: string | null;
  sender_account?: UnipileAccountRef | null;
  post?: UnipileMonitoredPost;
}

export interface CreateCampaignInput {
  account_id: string;
  name: string;
  // Sender accounts (multi-select)
  sender_account_ids?: string[];
  trigger_keywords: string;
  dm_template: string;
  dm_delay_seconds?: number;
  max_dms_per_hour?: number;
  max_dms_per_day?: number;
  user_cooldown_hours?: number;
  webhook_url?: string | null;
  auto_accept_connections?: boolean;
  require_connection_for_linkedin?: boolean;
  comment_link_mode?: 'gated' | 'direct';
  // ICP scoring
  icp_id?: string | null;
  icp_threshold?: number;
  // AI chatbot
  ai_chatbot_enabled?: boolean;
  ai_chatbot_instructions?: string | null;
  ai_chatbot_brand_voice_id?: string | null;
  ai_chatbot_model?: string | null;
  ai_chatbot_max_turns?: number;
  ai_chatbot_handoff_keywords?: string[] | null;
  // Auto-add posts
  auto_add_posts?: boolean;
  auto_add_posts_account_ids?: string[];
  // Knowledge base documents
  knowledge_document_ids?: string[];
  // Agent profile
  agent_profile_id?: string | null;
}

export function useUnipileCampaigns() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['unipile-campaigns', currentOrganization?.id],
    queryFn: async () => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      const orgId = currentOrganization.id;

      // Fetch campaigns with account info
      const { data: campaigns, error } = await supabase
        .from('unipile_campaigns')
        .select(`
          *,
          account:unipile_accounts(id, provider, display_name, username, status)
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch stats and auto-add account IDs for each campaign
      const campaignsWithStats = await Promise.all(
        (campaigns || []).map(async (campaign) => {
          // Get lead counts
          const { count: totalLeads } = await supabase
            .from('unipile_leads')
            .select('id', { count: 'exact' })
            .eq('campaign_id', campaign.id);

          const { count: dmSent } = await supabase
            .from('unipile_leads')
            .select('id', { count: 'exact' })
            .eq('campaign_id', campaign.id)
            .eq('status', 'dm_sent');

          const { count: dmPending } = await supabase
            .from('unipile_leads')
            .select('id', { count: 'exact' })
            .eq('campaign_id', campaign.id)
            .eq('status', 'pending');

          const { count: monitoredPosts } = await supabase
            .from('unipile_monitored_posts')
            .select('id', { count: 'exact' })
            .eq('campaign_id', campaign.id)
            .eq('is_active', true);

          // Get auto-add account IDs
          const { data: autoAccounts } = await supabase
            .from('unipile_campaign_auto_accounts')
            .select('account_id')
            .eq('campaign_id', campaign.id);

          // Get knowledge document IDs
          const { data: knowledgeDocs } = await supabase
            .from('campaign_knowledge_documents')
            .select('document_id')
            .eq('campaign_id', campaign.id);

          // Get sender account IDs
          const { data: senderAccounts } = await supabase
            .from('unipile_campaign_sender_accounts')
            .select('account_id')
            .eq('campaign_id', campaign.id);

          return {
            ...campaign,
            auto_add_posts_account_ids: (autoAccounts || []).map(a => a.account_id),
            sender_account_ids: (senderAccounts || []).map(a => a.account_id),
            knowledge_document_ids: (knowledgeDocs || []).map(d => d.document_id),
            stats: {
              total_leads: totalLeads || 0,
              dm_sent: dmSent || 0,
              dm_pending: dmPending || 0,
              monitored_posts: monitoredPosts || 0,
            },
          } as UnipileCampaign;
        })
      );

      return campaignsWithStats;
    },
    enabled: !!currentOrganization,
    staleTime: 30000,
  });
}

export function useCreateCampaign() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCampaignInput) => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      const orgId = currentOrganization.id;

      const { data, error } = await supabase
        .from('unipile_campaigns')
        .insert({
          organization_id: orgId,
          account_id: input.account_id,
          name: input.name,
          trigger_keywords: input.trigger_keywords,
          dm_template: input.dm_template,
          dm_delay_seconds: input.dm_delay_seconds || 30,
          max_dms_per_hour: input.max_dms_per_hour || 10,
          max_dms_per_day: input.max_dms_per_day || 50,
          user_cooldown_hours: input.user_cooldown_hours || 24,
          webhook_url: input.webhook_url || null,
          auto_accept_connections: input.auto_accept_connections ?? true,
          require_connection_for_linkedin: input.require_connection_for_linkedin ?? true,
          comment_link_mode: input.comment_link_mode || 'gated',
          is_active: true,
          // ICP scoring
          icp_id: input.icp_id || null,
          icp_threshold: input.icp_threshold ?? 0,
          // AI chatbot
          ai_chatbot_enabled: input.ai_chatbot_enabled ?? false,
          ai_chatbot_instructions: input.ai_chatbot_instructions || null,
          ai_chatbot_brand_voice_id: input.ai_chatbot_brand_voice_id || null,
          ai_chatbot_model: input.ai_chatbot_model || 'anthropic/claude-sonnet-4.5',
          ai_chatbot_max_turns: input.ai_chatbot_max_turns ?? 10,
          ai_chatbot_handoff_keywords: input.ai_chatbot_handoff_keywords || [],
          // Auto-add posts
          auto_add_posts: input.auto_add_posts ?? false,
          // Agent profile
          agent_profile_id: input.agent_profile_id || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Manage sender accounts junction table
      if (input.sender_account_ids?.length) {
        const senderRows = input.sender_account_ids.map(accountId => ({
          campaign_id: data.id,
          account_id: accountId,
        }));
        await supabase.from('unipile_campaign_sender_accounts').insert(senderRows);
      }

      // Manage auto-add accounts junction table
      if (input.auto_add_posts && input.auto_add_posts_account_ids?.length) {
        const rows = input.auto_add_posts_account_ids.map(accountId => ({
          campaign_id: data.id,
          account_id: accountId,
        }));
        await supabase.from('unipile_campaign_auto_accounts').insert(rows);
      }

      // Fire-and-forget: immediately sync posts for this new campaign
      if (input.auto_add_posts && input.auto_add_posts_account_ids?.length) {
        supabase.functions.invoke('unipile-auto-add-posts', {
          body: { campaignId: data.id },
        }).catch(err => {
          console.warn('Auto-sync posts failed (non-blocking):', err);
        });
      }

      // Manage knowledge documents junction table
      if (input.knowledge_document_ids?.length) {
        const rows = input.knowledge_document_ids.map(documentId => ({
          campaign_id: data.id,
          document_id: documentId,
        }));
        await supabase.from('campaign_knowledge_documents').insert(rows);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unipile-campaigns'] });
      toast.success('Campaign created successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create campaign');
    },
  });
}

export function useUpdateCampaign() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: CreateCampaignInput & { id: string }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data, error } = await supabase
        .from('unipile_campaigns')
        .update({
          name: input.name,
          trigger_keywords: input.trigger_keywords,
          dm_template: input.dm_template,
          dm_delay_seconds: input.dm_delay_seconds,
          max_dms_per_hour: input.max_dms_per_hour,
          max_dms_per_day: input.max_dms_per_day,
          user_cooldown_hours: input.user_cooldown_hours,
          webhook_url: input.webhook_url,
          auto_accept_connections: input.auto_accept_connections,
          require_connection_for_linkedin: input.require_connection_for_linkedin,
          comment_link_mode: input.comment_link_mode,
          // ICP scoring
          icp_id: input.icp_id,
          icp_threshold: input.icp_threshold,
          // AI chatbot
          ai_chatbot_enabled: input.ai_chatbot_enabled,
          ai_chatbot_instructions: input.ai_chatbot_instructions,
          ai_chatbot_brand_voice_id: input.ai_chatbot_brand_voice_id,
          ai_chatbot_model: input.ai_chatbot_model,
          ai_chatbot_max_turns: input.ai_chatbot_max_turns,
          ai_chatbot_handoff_keywords: input.ai_chatbot_handoff_keywords,
          // Auto-add posts
          auto_add_posts: input.auto_add_posts,
          // Agent profile
          agent_profile_id: input.agent_profile_id !== undefined ? (input.agent_profile_id || null) : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('organization_id', currentOrganization.id)
        .select()
        .single();

      if (error) throw error;

      // Sync sender accounts junction table (delete old, insert new)
      if (input.sender_account_ids !== undefined) {
        await supabase
          .from('unipile_campaign_sender_accounts')
          .delete()
          .eq('campaign_id', id);

        if (input.sender_account_ids?.length) {
          const senderRows = input.sender_account_ids.map(accountId => ({
            campaign_id: id,
            account_id: accountId,
          }));
          await supabase.from('unipile_campaign_sender_accounts').insert(senderRows);
        }
      }

      // Sync auto-add accounts junction table (delete old, insert new)
      if (input.auto_add_posts !== undefined) {
        await supabase
          .from('unipile_campaign_auto_accounts')
          .delete()
          .eq('campaign_id', id);

        if (input.auto_add_posts && input.auto_add_posts_account_ids?.length) {
          const rows = input.auto_add_posts_account_ids.map(accountId => ({
            campaign_id: id,
            account_id: accountId,
          }));
          await supabase.from('unipile_campaign_auto_accounts').insert(rows);
        }
      }

      // Sync knowledge documents junction table (delete old, insert new)
      if (input.knowledge_document_ids !== undefined) {
        await supabase
          .from('campaign_knowledge_documents')
          .delete()
          .eq('campaign_id', id);

        if (input.knowledge_document_ids?.length) {
          const rows = input.knowledge_document_ids.map(documentId => ({
            campaign_id: id,
            document_id: documentId,
          }));
          await supabase.from('campaign_knowledge_documents').insert(rows);
        }
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unipile-campaigns'] });
      toast.success('Campaign updated successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update campaign');
    },
  });
}

export function useDeleteCampaign() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from('unipile_campaigns')
        .delete()
        .eq('id', id)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unipile-campaigns'] });
      toast.success('Campaign deleted successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete campaign');
    },
  });
}

export function useToggleCampaignStatus() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data, error } = await supabase
        .from('unipile_campaigns')
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('organization_id', currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, { is_active }) => {
      queryClient.invalidateQueries({ queryKey: ['unipile-campaigns'] });
      toast.success(is_active ? 'Campaign activated' : 'Campaign paused');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update campaign status');
    },
  });
}

export type UnipileCampaignStatus = 'draft' | 'active' | 'paused';

export function useSetCampaignStatus() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status, autoAddPosts }: { id: string; status: UnipileCampaignStatus; autoAddPosts?: boolean }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data, error } = await supabase
        .from('unipile_campaigns')
        .update({ status, updated_at: new Date().toISOString() } as any)
        .eq('id', id)
        .eq('organization_id', currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data, { status, autoAddPosts }) => {
      queryClient.invalidateQueries({ queryKey: ['unipile-campaigns'] });
      const label = status === 'active' ? 'activated' : status === 'draft' ? 'moved to draft' : 'paused';
      toast.success(`Campaign ${label}`);

      // Trigger immediate post sync when activating a campaign with auto_add_posts
      if (status === 'active' && autoAddPosts) {
        supabase.functions.invoke('unipile-auto-add-posts', {
          body: { campaignId: data.id },
        }).catch(err => {
          console.warn('Auto-sync posts on activation failed (non-blocking):', err);
        });
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update campaign status');
    },
  });
}

export function useMonitoredPosts(campaignId: string | null) {
  return useQuery({
    queryKey: ['unipile-posts', campaignId],
    queryFn: async () => {
      if (!campaignId) return [];

      const { data, error } = await supabase
        .from('unipile_monitored_posts')
        .select(`
          *,
          source_account:unipile_accounts!source_account_id(id, provider, display_name, username, avatar_url)
        `)
        .eq('campaign_id', campaignId)
        .order('post_created_at', { ascending: false, nullsFirst: false });

      if (error) throw error;
      return data as UnipileMonitoredPost[];
    },
    enabled: !!campaignId,
  });
}

export function useAddPost() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ postUrl, campaignId }: { postUrl: string; campaignId: string }) => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      const orgId = currentOrganization.id;

      const { data, error } = await supabase.functions.invoke('unipile-add-post', {
        body: {
          postUrl,
          campaignId,
          organizationId: orgId,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to add post');

      return data.post;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unipile-posts'] });
      queryClient.invalidateQueries({ queryKey: ['unipile-campaigns'] });
      toast.success('Post added to monitoring');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add post');
    },
  });
}

export function useRemovePost() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (postId: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from('unipile_monitored_posts')
        .delete()
        .eq('id', postId)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unipile-posts'] });
      queryClient.invalidateQueries({ queryKey: ['unipile-campaigns'] });
      toast.success('Post removed from monitoring');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove post');
    },
  });
}

export function useTogglePostStatus() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from('unipile_monitored_posts')
        .update({ is_active })
        .eq('id', id)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: (_, { is_active }) => {
      queryClient.invalidateQueries({ queryKey: ['unipile-posts'] });
      toast.success(is_active ? 'Post monitoring resumed' : 'Post monitoring paused');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update post status');
    },
  });
}

export function useCampaignLeads(campaignId: string | null) {
  return useQuery({
    queryKey: ['unipile-leads', campaignId],
    queryFn: async () => {
      if (!campaignId) return [];

      const { data, error } = await supabase
        .from('unipile_leads')
        .select(`
          *,
          post:unipile_monitored_posts(*),
          sender_account:unipile_accounts!sender_account_id(id, provider, display_name, username, avatar_url)
        `)
        .eq('campaign_id', campaignId)
        .order('captured_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data as UnipileLead[];
    },
    enabled: !!campaignId,
  });
}

export function useCampaignComments(campaignId: string | null) {
  return useQuery({
    queryKey: ['unipile-comments', campaignId],
    queryFn: async () => {
      if (!campaignId) return [];

      const { data, error } = await supabase
        .from('unipile_leads')
        .select(`
          *,
          post:unipile_monitored_posts(*),
          sender_account:unipile_accounts!sender_account_id(id, provider, display_name, username, avatar_url)
        `)
        .eq('campaign_id', campaignId)
        .order('captured_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return data as UnipileLead[];
    },
    enabled: !!campaignId,
  });
}

export function useSyncPosts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (campaignId: string) => {
      const { data, error } = await supabase.functions.invoke('unipile-auto-add-posts', {
        body: { campaignId },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to sync posts');

      return data as { success: boolean; postsAdded: number; postsDiscovered: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['unipile-posts'] });
      queryClient.invalidateQueries({ queryKey: ['unipile-campaigns'] });
      const added = data?.postsAdded || 0;
      toast.success(added > 0 ? `Synced ${added} new post${added !== 1 ? 's' : ''}` : 'Posts are up to date');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to sync posts');
    },
  });
}

export function useRetryLeadDm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadIds }: { leadIds: string[] }) => {
      // Fetch leads with their original DM messages
      const { data: leads, error: leadsErr } = await supabase
        .from('unipile_leads')
        .select('id, campaign_id, organization_id, commenter_id, commenter_name')
        .in('id', leadIds);

      if (leadsErr) throw leadsErr;
      if (!leads || leads.length === 0) throw new Error('No leads found');

      let retried = 0;
      for (const lead of leads) {
        // Get the original message text from the most recent queue entry
        const { data: originalMsg } = await supabase
          .from('unipile_message_queue')
          .select('message_text, account_id')
          .eq('lead_id', lead.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!originalMsg?.message_text) continue;

        // Reset lead status
        await supabase
          .from('unipile_leads')
          .update({ status: 'pending', dm_error: null, dm_sent_at: null })
          .eq('id', lead.id);

        // Queue a new DM
        await supabase
          .from('unipile_message_queue')
          .insert({
            campaign_id: lead.campaign_id,
            lead_id: lead.id,
            account_id: originalMsg.account_id,
            organization_id: lead.organization_id,
            recipient_platform_id: lead.commenter_id,
            recipient_name: lead.commenter_name,
            message_text: originalMsg.message_text,
            scheduled_for: new Date().toISOString(),
            status: 'pending',
          });

        retried++;
      }

      return { retried };
    },
    onSuccess: ({ retried }) => {
      queryClient.invalidateQueries({ queryKey: ['unipile-leads'] });
      queryClient.invalidateQueries({ queryKey: ['unipile-comments'] });
      toast.success(`Retrying DM for ${retried} lead${retried !== 1 ? 's' : ''}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to retry DM');
    },
  });
}
