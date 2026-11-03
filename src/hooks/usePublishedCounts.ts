import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PublishedCount {
  content_output_id: string;
  total: number;
  published: number;
  scheduled: number;
  platforms: string[];
  accountNames: string[];
  nextScheduledAt?: string; // Earliest scheduled time from publish_queue
  autopilotName?: string; // Name of the autopilot that scheduled it
}

/**
 * Hook to fetch published post counts for multiple content outputs
 * Queries both ghl_published_posts (manual publishing) and publish_queue (autopilot scheduling)
 */
export function usePublishedCounts(contentOutputIds: string[]) {
  const query = useQuery({
    queryKey: ['published-counts', contentOutputIds],
    queryFn: async () => {
      if (!contentOutputIds.length) return {};

      // Query both tables in parallel
      const [publishedPostsResult, publishQueueResult] = await Promise.all([
        supabase
          .from('ghl_published_posts')
          .select('content_output_id, platform, platform_account_name, status')
          .in('content_output_id', contentOutputIds),
        supabase
          .from('publish_queue')
          .select('output_id, platform, status, scheduled_for, autopilots:autopilot_id(name)')
          .in('output_id', contentOutputIds)
          .in('status', ['pending', 'publishing'])
          .order('scheduled_for', { ascending: true })
      ]);

      if (publishedPostsResult.error) throw publishedPostsResult.error;
      if (publishQueueResult.error) throw publishQueueResult.error;

      // Group by content_output_id
      const counts: Record<string, PublishedCount> = {};

      // Process ghl_published_posts (manual publishing)
      publishedPostsResult.data?.forEach((post) => {
        if (!counts[post.content_output_id]) {
          counts[post.content_output_id] = {
            content_output_id: post.content_output_id,
            total: 0,
            published: 0,
            scheduled: 0,
            platforms: [],
            accountNames: [],
          };
        }

        counts[post.content_output_id].total++;

        if (post.status === 'published') {
          counts[post.content_output_id].published++;
        } else if (post.status === 'scheduled') {
          counts[post.content_output_id].scheduled++;
        }

        if (post.platform && !counts[post.content_output_id].platforms.includes(post.platform)) {
          counts[post.content_output_id].platforms.push(post.platform);
        }

        if (post.platform_account_name && !counts[post.content_output_id].accountNames.includes(post.platform_account_name)) {
          counts[post.content_output_id].accountNames.push(post.platform_account_name);
        }
      });

      // Process publish_queue (autopilot scheduling)
      publishQueueResult.data?.forEach((queueItem: any) => {
        const outputId = queueItem.output_id;
        if (!counts[outputId]) {
          counts[outputId] = {
            content_output_id: outputId,
            total: 0,
            published: 0,
            scheduled: 0,
            platforms: [],
            accountNames: [],
          };
        }

        counts[outputId].total++;
        counts[outputId].scheduled++;

        if (queueItem.platform && !counts[outputId].platforms.includes(queueItem.platform)) {
          counts[outputId].platforms.push(queueItem.platform);
        }

        // Track the earliest scheduled time
        if (queueItem.scheduled_for && (!counts[outputId].nextScheduledAt || queueItem.scheduled_for < counts[outputId].nextScheduledAt)) {
          counts[outputId].nextScheduledAt = queueItem.scheduled_for;
          counts[outputId].autopilotName = queueItem.autopilots?.name;
        }
      });

      return counts;
    },
    enabled: contentOutputIds.length > 0,
  });

  return query;
}

/**
 * Hook to fetch published counts for all outputs in a job
 */
export function useJobPublishedCounts(jobId: string | null) {
  const query = useQuery({
    queryKey: ['job-published-counts', jobId],
    queryFn: async () => {
      if (!jobId) return { publishedOutputs: 0, totalPublished: 0, totalScheduled: 0 };

      // First get all output IDs for this job
      const { data: outputs, error: outputsError } = await supabase
        .from('content_outputs')
        .select('id')
        .eq('job_id', jobId);

      if (outputsError) throw outputsError;
      if (!outputs?.length) return { publishedOutputs: 0, totalPublished: 0, totalScheduled: 0 };

      const outputIds = outputs.map(o => o.id);

      // Then get published posts for these outputs
      const { data: posts, error: postsError } = await supabase
        .from('ghl_published_posts')
        .select('content_output_id, status')
        .in('content_output_id', outputIds);

      if (postsError) throw postsError;

      // Count unique outputs that have been published
      const publishedOutputIds = new Set<string>();
      let totalPublished = 0;
      let totalScheduled = 0;

      posts?.forEach((post) => {
        publishedOutputIds.add(post.content_output_id);
        if (post.status === 'published') {
          totalPublished++;
        } else if (post.status === 'scheduled') {
          totalScheduled++;
        }
      });

      return {
        publishedOutputs: publishedOutputIds.size,
        totalPublished,
        totalScheduled,
      };
    },
    enabled: !!jobId,
  });

  return query;
}
