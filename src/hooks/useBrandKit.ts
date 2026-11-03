import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { useICPs } from "@/hooks/useICPs";
import { useProducts } from "@/hooks/useProducts";
import { useCharacters } from "@/hooks/useCharacters";
import { DEFAULT_COLUMN, KIND_LABEL, LIBRARY_KINDS, type LibraryKind } from "@/lib/blueprint-context";

export interface BrandKitElement {
  id: string;
  name: string;
  updated_at?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export type ResolvedSource = "pinned" | "default" | "most_recent";

export interface ResolvedBrandKitElement {
  element: BrandKitElement;
  source: ResolvedSource;
}

function mostRecent(list: BrandKitElement[]): BrandKitElement | null {
  if (list.length === 0) return null;
  return [...list].sort((a, b) =>
    String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")),
  )[0];
}

/**
 * The workspace Brand Kit: every brand voice, audience, product and person,
 * plus which one is the default for each kind. `resolve(kind)` returns what a
 * run will actually use when nothing more specific is pinned — the explicit
 * default, else the most recently edited element (the backend's last fallback).
 */
export function useBrandKit() {
  const { data: settings, isLoading: settingsLoading } = useOrganizationSettings();
  const brand = useBrandVoices();
  const audience = useICPs();
  const product = useProducts();
  const person = useCharacters();

  const lists = useMemo<Record<LibraryKind, BrandKitElement[]>>(
    () => ({
      brand: (brand.brandVoices ?? []) as unknown as BrandKitElement[],
      audience: (audience.icps ?? []) as unknown as BrandKitElement[],
      product: (product.products ?? []) as unknown as BrandKitElement[],
      person: (person.characters ?? []) as unknown as BrandKitElement[],
    }),
    [brand.brandVoices, audience.icps, product.products, person.characters],
  );

  const defaults = useMemo<Record<LibraryKind, string | null>>(() => {
    const s = (settings ?? {}) as Record<string, string | null | undefined>;
    return {
      brand: s[DEFAULT_COLUMN.brand] ?? null,
      audience: s[DEFAULT_COLUMN.audience] ?? null,
      product: s[DEFAULT_COLUMN.product] ?? null,
      person: s[DEFAULT_COLUMN.person] ?? null,
    };
  }, [settings]);

  const resolve = useMemo(() => {
    return (kind: LibraryKind, pinnedId?: string | null): ResolvedBrandKitElement | null => {
      const list = lists[kind];
      const pinned = pinnedId ? list.find((e) => e.id === pinnedId) : undefined;
      if (pinned) return { element: pinned, source: "pinned" };
      const def = defaults[kind] ? list.find((e) => e.id === defaults[kind]) : undefined;
      if (def) return { element: def, source: "default" };
      const recent = mostRecent(list);
      return recent ? { element: recent, source: "most_recent" } : null;
    };
  }, [lists, defaults]);

  const byId = useMemo(() => {
    const map = new Map<string, BrandKitElement>();
    for (const kind of LIBRARY_KINDS) for (const e of lists[kind]) map.set(e.id, e);
    return map;
  }, [lists]);

  return {
    lists,
    defaults,
    resolve,
    byId,
    isLoading: settingsLoading || brand.isLoading || audience.isLoading || product.isLoading || person.isLoading,
  };
}

export function useSetBrandKitDefault() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ kind, elementId }: { kind: LibraryKind; elementId: string | null }) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { data, error } = await supabase
        .from("organization_settings")
        .update({ [DEFAULT_COLUMN[kind]]: elementId })
        .eq("organization_id", currentOrganization.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        // Older workspaces may not have a settings row yet.
        const { error: insertError } = await supabase
          .from("organization_settings")
          .insert({ organization_id: currentOrganization.id, [DEFAULT_COLUMN[kind]]: elementId });
        if (insertError) throw insertError;
      }
    },
    onSuccess: (_, { kind, elementId }) => {
      queryClient.invalidateQueries({ queryKey: ["organization-settings"] });
      toast.success(elementId ? `Default ${KIND_LABEL[kind].toLowerCase()} saved` : `Default ${KIND_LABEL[kind].toLowerCase()} cleared`);
    },
    onError: (error: Error) => {
      toast.error(`Couldn't save the default: ${error.message}`);
    },
  });
}
