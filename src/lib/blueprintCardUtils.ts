import { FileText, Video, Image as ImageIcon, Mic, Share2, LucideIcon } from "lucide-react";

export const getPipelineIcon = (pipeline?: string): LucideIcon => {
  if (!pipeline) return FileText;
  
  const pipelineLower = pipeline.toLowerCase();
  
  if (pipelineLower.includes('video') || pipelineLower.includes('script')) {
    return Video;
  }
  if (pipelineLower.includes('image')) {
    return ImageIcon;
  }
  if (pipelineLower.includes('audio') || pipelineLower.includes('tts') || pipelineLower.includes('voice')) {
    return Mic;
  }
  if (pipelineLower.includes('social') || pipelineLower.includes('post')) {
    return Share2;
  }
  return FileText;
};

export const getPipelineColor = (pipeline?: string): string => {
  if (!pipeline) return 'from-primary/20 to-primary/30 border-primary/30';
  
  const pipelineLower = pipeline.toLowerCase();
  
  if (pipelineLower.includes('video') || pipelineLower.includes('script')) {
    return 'from-blue-500/20 to-blue-600/20 border-blue-500/30';
  }
  if (pipelineLower.includes('image')) {
    return 'from-pink-500/20 to-pink-600/20 border-pink-500/30';
  }
  if (pipelineLower.includes('audio') || pipelineLower.includes('tts') || pipelineLower.includes('voice')) {
    return 'from-orange-500/20 to-orange-600/20 border-orange-500/30';
  }
  if (pipelineLower.includes('social') || pipelineLower.includes('post')) {
    return 'from-green-500/20 to-green-600/20 border-green-500/30';
  }
  return 'from-primary/20 to-primary/30 border-primary/30';
};

export const getPipelineBadgeColor = (pipeline?: string): string => {
  if (!pipeline) return 'bg-muted text-muted-foreground border-border';
  
  const pipelineLower = pipeline.toLowerCase();
  
  if (pipelineLower.includes('video') || pipelineLower.includes('script')) {
    return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20';
  }
  if (pipelineLower.includes('image')) {
    return 'bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20';
  }
  if (pipelineLower.includes('audio') || pipelineLower.includes('tts') || pipelineLower.includes('voice')) {
    return 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20';
  }
  if (pipelineLower.includes('social') || pipelineLower.includes('post')) {
    return 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20';
  }
  return 'bg-muted text-muted-foreground border-border';
};

// Legacy functions kept for backwards compatibility but deprecated
export const getContentTypeColor = getPipelineColor;
export const getContentTypeIcon = getPipelineIcon;
export const getContentTypeBadgeColor = getPipelineBadgeColor;

export const formatRelativeTime = (date: string): string => {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};

export const formatLabel = (text: string): string => {
  return text
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};
