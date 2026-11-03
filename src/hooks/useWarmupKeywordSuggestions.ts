import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface WarmupKeywordSuggestion {
  keyword: string;
  message_count: number;
  sender_count: number;
  already_excluded: boolean;
}

/**
 * Mines this org's own inbound mail for third-party warmup filler.
 *
 * Warmup networks spray a bounded vocabulary of nonsense hyphenated bigrams
 * ("suitable-pottery", "shrine-training") through otherwise ordinary-looking
 * mail. One token turning up across 20+ unrelated senders is the tell -- real
 * correspondents don't do that. Customers cannot guess these words, which is
 * why a hand-written exclusion list barely dents the noise.
 *
 * Suggestions only. The same frequency signal also surfaces genuine English
 * compounds ("early-stage", "long-term"), so nothing is applied until the
 * operator ticks it.
 */
export function useWarmupKeywordSuggestions() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  return useMutation({
    mutationFn: async (): Promise<WarmupKeywordSuggestion[]> => {
      if (!orgId) throw new Error("No organization selected");
      // Cast: generated types in integrations/supabase/types.ts predate this
      // RPC. Regenerating that file pulls in unrelated schema drift, so the
      // narrow cast stays until types are refreshed deliberately.
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: WarmupKeywordSuggestion[] | null; error: Error | null }>)(
        "suggest_inbox_warmup_keywords",
        { p_org_id: orgId, p_days: 30, p_min_senders: 3, p_limit: 200 },
      );
      if (error) throw error;
      return (data ?? []).filter((s) => !s.already_excluded);
    },
  });
}
