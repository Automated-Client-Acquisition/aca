/**
 * Content-centric field categorization for the creation wizard
 * Organizes fields by their purpose in content creation rather than database structure
 */

export interface FieldCategory {
  key: string;
  label: string;
  icon: string;
  fields: string[];
  demographics?: string[]; // Bundled fields displayed as one toggle
}

export const CONTENT_FIELD_CATEGORIES: Record<string, FieldCategory[]> = {
  library_products: [
    {
      key: 'audience',
      label: 'Audience Targeting',
      icon: '👥',
      fields: [
        'icp_job_titles',
        'icp_pain_points',
        'icp_desires',
        'icp_psychographics',
        'icp_buying_motivations',
      ],
      demographics: ['icp_age_range', 'icp_gender', 'icp_income', 'icp_location'],
    },
    {
      key: 'product',
      label: 'Product Story',
      icon: '📦',
      fields: ['name', 'category', 'benefits', 'features', 'description', 'price', 'tags'],
    },
    {
      key: 'marketing',
      label: 'Marketing Angles',
      icon: '📢',
      fields: [
        'marketing_primary_angle',
        'marketing_hooks',
        'marketing_urgency_factors',
        'marketing_emotional_triggers',
        'marketing_alternative_angles',
      ],
    },
    {
      key: 'affiliate',
      label: 'Affiliate Strategy',
      icon: '💰',
      fields: [
        'affiliate_key_messages',
        'affiliate_content_ideas',
        'affiliate_calls_to_action',
        'affiliate_target_platforms',
        'affiliate_recommended_approach',
      ],
    },
  ],
  library_brand_voices: [
    {
      key: 'brand',
      label: 'Brand Voice',
      icon: '🎤',
      fields: ['tone', 'style_guidelines', 'key_phrases', 'writing_style', 'personality'],
    },
  ],
  library_characters: [
    {
      key: 'character',
      label: 'Character Details',
      icon: '🎭',
      fields: ['personality', 'visual_style', 'voice_config', 'reference_images'],
    },
  ],
  library_content_angles: [
    {
      key: 'angle',
      label: 'Content Angle',
      icon: '🎯',
      fields: ['angle', 'framework', 'target_emotion', 'key_message'],
    },
  ],
  library_story_elements: [
    {
      key: 'story',
      label: 'Story Elements',
      icon: '📖',
      fields: ['narrative', 'themes', 'arc', 'conflict'],
    },
  ],
};

export const FIELD_LABELS: Record<string, string> = {
  // ICP fields
  icp_job_titles: 'Job Titles',
  icp_psychographics: 'Psychographics',
  icp_pain_points: 'Pain Points',
  icp_desires: 'Desires',
  icp_buying_motivations: 'Buying Motivations',
  icp_age_range: 'Age Range',
  icp_gender: 'Gender',
  icp_income: 'Income Level',
  icp_location: 'Location',

  // Marketing fields
  marketing_hooks: 'Marketing Hooks',
  marketing_urgency_factors: 'Urgency Factors',
  marketing_alternative_angles: 'Alternative Angles',
  marketing_emotional_triggers: 'Emotional Triggers',
  marketing_primary_angle: 'Primary Angle',

  // Affiliate fields
  affiliate_key_messages: 'Key Messages',
  affiliate_content_ideas: 'Content Ideas',
  affiliate_calls_to_action: 'Calls to Action',
  affiliate_target_platforms: 'Target Platforms',
  affiliate_recommended_approach: 'Recommended Approach',

  // Product fields
  name: 'Product Name',
  category: 'Category',
  benefits: 'Key Benefits',
  features: 'Features',
  description: 'Description',
  price: 'Price',
  tags: 'Tags',
  images: 'Product Images',

  // Brand voice fields
  tone: 'Tone',
  style_guidelines: 'Style Guidelines',
  key_phrases: 'Key Phrases',
  writing_style: 'Writing Style',
  personality: 'Personality',

  // Character fields
  visual_style: 'Visual Style',
  voice_config: 'Voice Configuration',
  reference_images: 'Reference Images',

  // Content angle fields
  angle: 'Angle',
  framework: 'Framework',
  target_emotion: 'Target Emotion',
  key_message: 'Key Message',

  // Story element fields
  narrative: 'Narrative',
  themes: 'Themes',
  arc: 'Story Arc',
  conflict: 'Conflict',
};

/**
 * Get formatted label for a field
 */
export function getFieldLabel(fieldKey: string): string {
  return FIELD_LABELS[fieldKey] || fieldKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
