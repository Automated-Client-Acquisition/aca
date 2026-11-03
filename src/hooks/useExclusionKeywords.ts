import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

function getStorageKey(orgId: string | undefined) {
  return `inbox-exclusion-keywords-${orgId ?? 'default'}`;
}

function getFallbackKey(orgId: string | undefined) {
  return `warmup-keywords-${orgId ?? 'default'}`;
}

function readLocalKeywords(orgId: string | undefined): string[] {
  try {
    const stored =
      localStorage.getItem(getStorageKey(orgId)) ??
      localStorage.getItem(getFallbackKey(orgId));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function writeLocalKeywords(orgId: string | undefined, keywords: string[]) {
  try {
    localStorage.setItem(getStorageKey(orgId), JSON.stringify(keywords));
  } catch {
    // localStorage is only a migration/cache layer. Database persistence is authoritative.
  }
}

function getMigratedKey(orgId: string | undefined) {
  return `inbox-exclusion-keywords-migrated-${orgId ?? 'default'}`;
}

/** Has this org's DB row ever been read (or written) successfully before? */
function isMigrated(orgId: string | undefined): boolean {
  try {
    return localStorage.getItem(getMigratedKey(orgId)) === 'true';
  } catch {
    return false;
  }
}

function markMigrated(orgId: string | undefined) {
  try {
    localStorage.setItem(getMigratedKey(orgId), 'true');
  } catch {
    // best-effort only
  }
}

export function normalizeExclusionKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const keyword of keywords) {
    const value = keyword.trim().replace(/\s+/g, " ");
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }

  return normalized.sort((a, b) => a.localeCompare(b));
}

export function useExclusionKeywords(): string[] {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  const query = useQuery({
    queryKey: ["inbox-keyword-exclusions", orgId],
    queryFn: async () => {
      if (!orgId) return readLocalKeywords(orgId);

      const { data, error } = await supabase
        .from("inbox_keyword_exclusions")
        .select("keyword")
        .eq("organization_id", orgId)
        .order("normalized_keyword", { ascending: true });

      if (error) throw error;

      const dbKeywords = normalizeExclusionKeywords((data ?? []).map((row) => row.keyword));

      // Once the DB has been read successfully even once, it is authoritative:
      // an empty result means the org genuinely has no exclusions (e.g. the
      // user cleared their list), not "never migrated". Re-running the
      // localStorage migration on every empty read was silently resurrecting
      // keywords the user had just deleted.
      if (dbKeywords.length > 0 || isMigrated(orgId)) {
        writeLocalKeywords(orgId, dbKeywords);
        markMigrated(orgId);
        return dbKeywords;
      }

      const localKeywords = normalizeExclusionKeywords(readLocalKeywords(orgId));
      if (localKeywords.length > 0) {
        const { error: migrateError } = await supabase.rpc("set_inbox_keyword_exclusions", {
          p_org_id: orgId,
          p_keywords: localKeywords,
        });
        if (migrateError) throw migrateError;
        writeLocalKeywords(orgId, localKeywords);
      }
      markMigrated(orgId);
      return localKeywords;
    },
    enabled: !!orgId,
    staleTime: 30000,
  });

  // Memoized: callers put this array in effect/memo dependencies, so building a
  // fresh one on every render would re-fire those effects until the query lands.
  const fallback = useMemo(
    () => normalizeExclusionKeywords(readLocalKeywords(orgId)),
    [orgId],
  );

  return query.data ?? fallback;
}

export function useSaveExclusionKeywords() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (keywords: string[]) => {
      if (!orgId) throw new Error("No organization selected");
      const normalized = normalizeExclusionKeywords(keywords);

      const { data, error } = await supabase.rpc("set_inbox_keyword_exclusions", {
        p_org_id: orgId,
        p_keywords: normalized,
      });

      if (error) throw error;
      writeLocalKeywords(orgId, normalized);
      markMigrated(orgId);
      return {
        keywords: normalized,
        cleanup: Array.isArray(data) ? data[0] : data,
      };
    },
    // A failed save used to be invisible: the Inbox set its local state before
    // the mutation resolved, so a rejected write looked like a successful one
    // until the next reload quietly restored the old list. Say so, and pull the
    // authoritative list back so what is on screen is what is stored.
    onError: (error) => {
      toast({
        title: "Couldn't save exclusion keywords",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["inbox-keyword-exclusions", orgId] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-keyword-exclusions", orgId] });
      queryClient.invalidateQueries({ queryKey: ["crm-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["crm-conversations-infinite"] });
      queryClient.invalidateQueries({ queryKey: ["crm-conversations-favorites"] });
      queryClient.invalidateQueries({ queryKey: ["crm-unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      window.dispatchEvent(new Event("exclusion-keywords-changed"));
    },
  });
}

/** Call this after writing exclusion keywords to localStorage (same-tab notification). */
export function notifyExclusionKeywordsChanged() {
  window.dispatchEvent(new Event("exclusion-keywords-changed"));
}
