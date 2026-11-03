import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface StockMediaItem {
  id: string;
  url: string;
  thumbnail_url: string;
  duration?: number;
  width: number;
  height: number;
}

export function useStockMedia() {
  const [searchResults, setSearchResults] = useState<StockMediaItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { currentOrganization } = useAuth();

  const search = useCallback(
    async (query: string, type: "videos" | "photos" = "videos", aspectRatio?: string) => {
      if (!currentOrganization?.id) return;
      setIsSearching(true);

      try {
        const { data, error } = await supabase.functions.invoke(
          "search-stock-media",
          {
            body: {
              query,
              type,
              per_page: 20,
              organization_id: currentOrganization.id,
              aspect_ratio: aspectRatio,
            },
          }
        );

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        const results = data?.results ?? [];
        setSearchResults(results);

        if (results.length === 0) {
          toast.info(`No ${type} found`, {
            description: `Try a different search term`,
          });
        }
      } catch (err: any) {
        console.error("Stock media search failed:", err);
        const message = err?.message || "Unknown error";
        if (message.includes("PEXELS_API_KEY")) {
          toast.error("Pexels API not configured", {
            description:
              "The PEXELS_API_KEY environment variable is not set on the server.",
          });
        } else {
          toast.error("Stock media search failed", { description: message });
        }
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [currentOrganization]
  );

  return { searchResults, isSearching, search };
}
