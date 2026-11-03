/**
 * Pexels Video Provider
 *
 * Searches the Pexels Video API for stock footage clips to use as B-roll
 * in presenter videos. Downloads selected clips and uploads them to
 * Supabase Storage for use in the Remotion composition.
 *
 * API key is provided per-organization via the BYOK api_keys table.
 * Docs: https://www.pexels.com/api/documentation/#videos-search
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const PEXELS_BASE_URL = 'https://api.pexels.com/videos';

export interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  fps: number;
  link: string;
}

export interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  width: number;
  height: number;
  image: string; // thumbnail
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  page: number;
  per_page: number;
  total_results: number;
  videos: PexelsVideo[];
}

export interface PexelsSearchOptions {
  orientation?: 'portrait' | 'landscape';
  perPage?: number;
  minDuration?: number;
  maxDuration?: number;
}

export class PexelsProvider {
  /**
   * Search for stock video clips matching the given query.
   * Returns the raw Pexels video objects with all file variants.
   */
  static async searchVideos(
    query: string,
    apiKey: string,
    options: PexelsSearchOptions = {}
  ): Promise<PexelsVideo[]> {
    if (!apiKey) {
      throw new Error(
        'Pexels API key not configured for this organization. ' +
        'Add your Pexels API key in Settings → API Keys.'
      );
    }

    const {
      orientation = 'portrait',
      perPage = 5,
      minDuration,
      maxDuration,
    } = options;

    const params = new URLSearchParams({
      query,
      orientation,
      per_page: String(perPage),
      size: 'medium',
    });

    if (minDuration) params.set('min_duration', String(minDuration));
    if (maxDuration) params.set('max_duration', String(maxDuration));

    console.log(`[PexelsProvider] Searching videos: query="${query}" orientation=${orientation}`);

    const response = await fetch(`${PEXELS_BASE_URL}/search?${params}`, {
      headers: { Authorization: apiKey },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Pexels API error ${response.status}: ${errorBody}`);
    }

    const data: PexelsSearchResponse = await response.json();

    console.log(`[PexelsProvider] Found ${data.total_results} results, returning ${data.videos.length}`);

    return data.videos;
  }

  /**
   * Pick the best video file variant for the given orientation.
   * Prefers HD quality in the matching aspect ratio.
   */
  static pickBestFile(
    video: PexelsVideo,
    orientation: 'portrait' | 'landscape' = 'portrait'
  ): PexelsVideoFile | null {
    const files = video.video_files.filter((f) => f.file_type === 'video/mp4');
    if (files.length === 0) return null;

    // Sort by quality preference: hd > sd > hls
    const sorted = files.sort((a, b) => {
      const qualityOrder: Record<string, number> = { hd: 0, sd: 1, hls: 2 };
      const aOrder = qualityOrder[a.quality] ?? 3;
      const bOrder = qualityOrder[b.quality] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;

      // For same quality, prefer matching orientation
      const isPortrait = orientation === 'portrait';
      const aMatchesOrientation = isPortrait ? a.height > a.width : a.width > a.height;
      const bMatchesOrientation = isPortrait ? b.height > b.width : b.width > b.height;
      if (aMatchesOrientation && !bMatchesOrientation) return -1;
      if (!aMatchesOrientation && bMatchesOrientation) return 1;

      return 0;
    });

    return sorted[0];
  }

  /**
   * Download a video from Pexels and upload it to Supabase Storage.
   * Returns the public URL of the uploaded file.
   */
  static async downloadAndUpload(
    videoUrl: string,
    storagePath: string
  ): Promise<string> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for B-roll upload');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[PexelsProvider] Downloading video from Pexels: ${videoUrl}`);

    // Download the video file
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to download Pexels video: ${response.status}`);
    }

    const videoBuffer = await response.arrayBuffer();

    console.log(`[PexelsProvider] Uploading ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)}MB to storage: ${storagePath}`);

    // Upload to Supabase Storage (auto-create bucket if missing)
    let uploadError: any;
    ({ error: uploadError } = await supabase.storage
      .from('b-roll')
      .upload(storagePath, videoBuffer, {
        contentType: 'video/mp4',
        upsert: true,
      }));

    if (uploadError && (uploadError.message?.includes('not found') || uploadError.message?.includes('Bucket'))) {
      console.log('[PexelsProvider] b-roll bucket not found — creating it');
      await supabase.storage.createBucket('b-roll', { public: true });
      ({ error: uploadError } = await supabase.storage
        .from('b-roll')
        .upload(storagePath, videoBuffer, {
          contentType: 'video/mp4',
          upsert: true,
        }));
    }

    if (uploadError) {
      throw new Error(`Failed to upload B-roll to storage: ${uploadError.message}`);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('b-roll')
      .getPublicUrl(storagePath);

    console.log(`[PexelsProvider] Uploaded B-roll: ${publicUrl}`);

    return publicUrl;
  }
}

export default PexelsProvider;
