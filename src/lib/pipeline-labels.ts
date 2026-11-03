// Human-readable labels for content_outputs.pipeline values (singular/plural).
const PIPELINE_LABELS: Record<string, [string, string]> = {
  'generative_video_oneshot': ['Video', 'Videos'],
  'generative_video': ['Video', 'Videos'],
  'social_media_post': ['Post', 'Posts'],
  'youtube_script': ['Script', 'Scripts'],
  'image_only': ['Image', 'Images'],
  'blog_post': ['Article', 'Articles'],
  'rich_article': ['Article', 'Articles'],
  'article': ['Article', 'Articles'],
  'instagram_carousel': ['Carousel', 'Carousels'],
  'ugc_video': ['UGC Video', 'UGC Videos'],
  'talking_head': ['Video', 'Videos'],
};

export function getPipelineLabel(pipeline: string | null | undefined, count: number = 1): string {
  if (!pipeline) return '';

  const [singular, plural] = PIPELINE_LABELS[pipeline] || [
    pipeline.replace(/_/g, ' '),
    pipeline.replace(/_/g, ' ') + 's'
  ];

  return count === 1 ? singular : plural;
}
