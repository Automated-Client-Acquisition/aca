import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface PostPreviewData {
  authorName?: string;
  authorHeadline?: string;
  authorAvatarUrl?: string;
  content?: string;
  reactionCount?: number;
  commentCount?: number;
  shareCount?: number;
  reactions?: {
    type: string;
    count: number;
  }[];
}

interface EventPreviewData {
  title?: string;
  description?: string;
  imageUrl?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  attendeeCount?: number;
  hostName?: string;
  hostAvatarUrl?: string;
}

type PreviewType = "post" | "event";

interface UseLinkedInPreviewParams {
  type: PreviewType;
  url: string;
  accountId: string;
  enabled?: boolean;
}

async function fetchPreview(
  type: PreviewType,
  url: string,
  accountId: string
): Promise<PostPreviewData | EventPreviewData> {
  const { data, error } = await supabase.functions.invoke("linkedin-fetch-preview", {
    body: {
      type,
      url,
      accountId,
    },
  });

  if (error) {
    throw new Error(error.message || "Failed to fetch preview");
  }

  return data;
}

export function useLinkedInPreview({
  type,
  url,
  accountId,
  enabled = true,
}: UseLinkedInPreviewParams) {
  return useQuery({
    queryKey: ["linkedin-preview", type, url, accountId],
    queryFn: () => fetchPreview(type, url, accountId),
    enabled: enabled && !!url && !!accountId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
}

export function usePostPreview(url: string, accountId: string, enabled = true) {
  return useLinkedInPreview({
    type: "post",
    url,
    accountId,
    enabled,
  }) as ReturnType<typeof useQuery<PostPreviewData>>;
}

export function useEventPreview(url: string, accountId: string, enabled = true) {
  return useLinkedInPreview({
    type: "event",
    url,
    accountId,
    enabled,
  }) as ReturnType<typeof useQuery<EventPreviewData>>;
}
