export type SavedContentType = 'text' | 'image' | 'video' | 'audio';

export interface SavedContent {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  content_type: SavedContentType;
  content: SavedContentData;
  source_output_id: string | null;
  source_job_id: string | null;
  source_stage: string | null;
  linked_brand_voice_ids: string[];
  linked_character_ids: string[];
  linked_product_ids: string[];
  linked_icp_ids: string[];
  tags: string[];
  is_favorite: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

// Union type for different content data structures
export type SavedContentData =
  | TextContentData
  | ImageContentData
  | VideoContentData
  | AudioContentData;

export interface TextContentData {
  text: string;
  format?: 'plain' | 'markdown';
  metadata?: Record<string, unknown>;
}

export interface ImageContentData {
  url: string;
  width?: number;
  height?: number;
  prompt?: string;
  metadata?: Record<string, unknown>;
}

export interface VideoContentData {
  url: string;
  duration?: number;
  thumbnail_url?: string;
  metadata?: Record<string, unknown>;
}

export interface AudioContentData {
  url: string;
  duration?: number;
  transcript?: string;
  metadata?: Record<string, unknown>;
}

export interface SavedContentFilters {
  contentType?: SavedContentType;
  tags?: string[];
  linkedBrandVoiceId?: string;
  linkedProductId?: string;
  linkedCharacterId?: string;
  linkedIcpId?: string;
  search?: string;
  isFavorite?: boolean;
}

export interface CreateSavedContentInput {
  name: string;
  description?: string;
  content_type: SavedContentType;
  content: SavedContentData;
  source_output_id?: string;
  source_job_id?: string;
  source_stage?: string;
  linked_brand_voice_ids?: string[];
  linked_character_ids?: string[];
  linked_product_ids?: string[];
  linked_icp_ids?: string[];
  tags?: string[];
}

export interface UpdateSavedContentInput {
  name?: string;
  description?: string;
  content?: SavedContentData;
  linked_brand_voice_ids?: string[];
  linked_character_ids?: string[];
  linked_product_ids?: string[];
  linked_icp_ids?: string[];
  tags?: string[];
  is_favorite?: boolean;
}
