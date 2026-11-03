import { LucideIcon } from 'lucide-react';

export interface PlatformRequirements {
  name: string;
  color: string;
  icon: LucideIcon;
  postTypes: string[];
  characterLimit: number;
  requires: {
    image?: boolean;
    video?: boolean;
    text?: boolean;
  };
  accepts: {
    text?: boolean;
    image?: boolean;
    video?: boolean;
  };
}

import { Instagram, Facebook, Linkedin, Music, Youtube, Globe, Hash } from 'lucide-react';

export const PLATFORMS: Record<string, PlatformRequirements> = {
  instagram: {
    name: 'Instagram',
    color: 'hsl(340, 75%, 55%)',
    icon: Instagram,
    postTypes: ['feed', 'carousel', 'reel', 'story'],
    characterLimit: 2200,
    requires: { image: true },
    accepts: { text: true, image: true, video: true }
  },
  facebook: {
    name: 'Facebook',
    color: 'hsl(221, 44%, 41%)',
    icon: Facebook,
    postTypes: ['post', 'reel', 'story'],
    characterLimit: 63206,
    requires: {},
    accepts: { text: true, image: true, video: true }
  },
  linkedin: {
    name: 'LinkedIn',
    color: 'hsl(201, 100%, 35%)',
    icon: Linkedin,
    postTypes: ['post'],
    characterLimit: 3000,
    requires: {},
    accepts: { text: true, image: true, video: true }
  },
  tiktok: {
    name: 'TikTok',
    color: 'hsl(180, 100%, 50%)',
    icon: Music,
    postTypes: ['video'],
    characterLimit: 2200,
    requires: { video: true },
    accepts: { text: true, video: true }
  },
  youtube: {
    name: 'YouTube',
    color: 'hsl(0, 100%, 50%)',
    icon: Youtube,
    postTypes: ['video', 'short'],
    characterLimit: 5000,
    requires: { video: true },
    accepts: { text: true, image: true, video: true }
  },
  google_business: {
    name: 'Google Business',
    color: 'hsl(217, 89%, 61%)',
    icon: Globe,
    postTypes: ['post'],
    characterLimit: 1500,
    requires: {},
    accepts: { text: true, image: true }
  },
  twitter: {
    name: 'Twitter/X',
    color: 'hsl(0, 0%, 0%)',
    icon: Hash,
    postTypes: ['tweet'],
    characterLimit: 280,
    requires: {},
    accepts: { text: true, image: true, video: true }
  },
  x: {
    name: 'Twitter/X',
    color: 'hsl(0, 0%, 0%)',
    icon: Hash,
    postTypes: ['tweet'],
    characterLimit: 280,
    requires: {},
    accepts: { text: true, image: true, video: true }
  }
};

export interface ContentCapabilities {
  hasText: boolean;
  hasImage: boolean;
  hasVideo: boolean;
}

export interface PlatformReadiness extends PlatformRequirements {
  id: string;
  isReady: boolean;
  canPublish: boolean;
  missingRequirements: string[];
}

function checkRequirements(
  requires: Record<string, boolean>,
  capabilities: ContentCapabilities
): boolean {
  if (requires.image && !capabilities.hasImage) return false;
  if (requires.video && !capabilities.hasVideo) return false;
  if (requires.text && !capabilities.hasText) return false;
  return true;
}

function getMissingRequirements(
  requires: Record<string, boolean>,
  capabilities: ContentCapabilities
): string[] {
  const missing: string[] = [];
  if (requires.image && !capabilities.hasImage) missing.push('image');
  if (requires.video && !capabilities.hasVideo) missing.push('video');
  if (requires.text && !capabilities.hasText) missing.push('text');
  return missing;
}

export function getPlatformReadiness(outputData: any): PlatformReadiness[] {
  // Strict validation - only count as having media if there's a valid, non-empty URL
  const hasText = !!(
    (outputData?.text && outputData.text.trim().length > 0) || 
    (outputData?.content && outputData.content.trim().length > 0) || 
    (outputData?.markdown && outputData.markdown.trim().length > 0)
  );
  
  const hasImage = !!(
    (outputData?.imageUrl && outputData.imageUrl.trim().length > 0) || 
    (outputData?.image_url && outputData.image_url.trim().length > 0) || 
    (outputData?.images && Array.isArray(outputData.images) && outputData.images.length > 0 && outputData.images.some((img: any) => img?.url || typeof img === 'string')) ||
    (outputData?.media_urls && Array.isArray(outputData.media_urls) && outputData.media_urls.some((url: string) => url && /\.(jpg|jpeg|png|gif|webp)$/i.test(url)))
  );
  
  const hasVideo = !!(
    (outputData?.videoUrl && outputData.videoUrl.trim().length > 0) || 
    (outputData?.video_url && outputData.video_url.trim().length > 0) || 
    (outputData?.media_urls && Array.isArray(outputData.media_urls) && outputData.media_urls.some((url: string) => url && /\.(mp4|mov|avi|webm)$/i.test(url)))
  );

  const capabilities: ContentCapabilities = { hasText, hasImage, hasVideo };

  return Object.entries(PLATFORMS).map(([id, platform]) => ({
    id,
    ...platform,
    isReady: checkRequirements(platform.requires, capabilities),
    canPublish: Object.keys(platform.accepts).length === 0 || 
                (platform.accepts.text && hasText) ||
                (platform.accepts.image && hasImage) ||
                (platform.accepts.video && hasVideo),
    missingRequirements: getMissingRequirements(platform.requires, capabilities)
  }));
}
