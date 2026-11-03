import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProductData {
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  sku: string | null;
  price: number | null;
  currency: string | null;
  images: string[] | null;
  videos: string[] | null;
  features: string[] | null;
  specifications: any;
  tags: string[] | null;
  
  // ICP Fields (flat) - matching database schema
  icp_age_range: string | null;
  icp_gender: string | null;
  icp_income: string | null;
  icp_location: string | null;
  icp_job_titles: string[] | null;
  icp_psychographics: string[] | null;
  icp_pain_points: string[] | null;
  icp_desires: string[] | null;
  icp_buying_motivations: string[] | null;
  
  // Marketing Fields (flat)
  marketing_primary_angle: string | null;
  marketing_hooks: string[] | null;
  marketing_urgency_factors: string[] | null;
  marketing_alternative_angles: string[] | null;
  marketing_emotional_triggers: string[] | null;
  
  // Affiliate Fields (flat)
  affiliate_key_messages: string[] | null;
  affiliate_content_ideas: string[] | null;
  affiliate_calls_to_action: string[] | null;
  affiliate_target_platforms: string[] | null;
  affiliate_recommended_approach: string | null;
}

interface ScrapeProductParams {
  url: string;
  onProgress?: (status: string, message: string) => void;
}

export function useScrapeProduct() {
  return useMutation({
    mutationFn: async ({
      url,
      onProgress,
    }: ScrapeProductParams): Promise<ProductData> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scrape-and-analyze-product`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url }),
        }
      );

      if (!response.ok) {
        let errorMsg = 'Failed to scrape product';
        
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorMsg;
        } catch (e) {
          // If can't parse JSON, use default message
        }
        
        throw new Error(errorMsg);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let productData: ProductData | null = null;
      let buffer = '';

      const processLine = (line: string) => {
        if (!line.startsWith('data: ')) return;
        const payload = line.slice(6);
        if (!payload) return;

        let data: any;
        try {
          data = JSON.parse(payload);
        } catch (err) {
          console.warn('Skipping malformed SSE line:', payload.slice(0, 200), err);
          return;
        }

        if (data.status && data.message) {
          onProgress?.(data.status, data.message);
        }
        if (data.status === 'complete' && data.data) {
          productData = data.data;
        }
        if (data.status === 'error') {
          throw new Error(data.message);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          processLine(line);
        }
      }

      buffer += decoder.decode();
      if (buffer) {
        for (const line of buffer.split('\n')) {
          processLine(line);
        }
      }

      if (!productData) {
        throw new Error('No product data received');
      }

      return productData;
    },
    onError: (error) => {
      console.error('Scrape product error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to scrape product');
    },
  });
}
