export interface PlatformContent {
  caption: string;
  images: string[];
  videoUrl?: string;
  videoThumbnail?: string;
  tags: string[];
  postType: string; // 'feed', 'reel', 'story', 'short', 'video', 'post'
  followUpComment?: string;
  categoryId?: string;
  organizationTagIds?: string[];
}

export interface PublishingPayload {
  baseContent: PlatformContent;
  customizePerChannel: boolean;
  platformOverrides: Record<string, Partial<PlatformContent>>;
  scheduleDate?: string;
  staggerMinutes?: number;
  followUpComment?: string;
  categoryId?: string;
  organizationTagIds?: string[];
}
