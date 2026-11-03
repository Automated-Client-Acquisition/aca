import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

// One refresh per contact per page load. The inbox remounts avatar rows on every
// refetch/scroll, and a per-component "tried" flag let each remount fire again:
// thousands of calls an hour, 429s from the gateway and CORS-failed preflights.
// Results (including "no fresh URL") are cached here; calls are capped so a
// screen full of expired LinkedIn URLs drains slowly instead of all at once.
const MAX_CONCURRENT = 2;
const results = new Map<string, Promise<string | null>>();
const queue: Array<() => void> = [];
let active = 0;

function runNext() {
  if (active >= MAX_CONCURRENT) return;
  const next = queue.shift();
  if (next) next();
}

function refreshAvatar(contactId: string): Promise<string | null> {
  const cached = results.get(contactId);
  if (cached) return cached;

  const promise = new Promise<string | null>((resolve) => {
    queue.push(async () => {
      active++;
      try {
        const { data } = await supabase.functions.invoke("refresh-avatar", {
          body: { contact_id: contactId },
        });
        resolve(data?.success && data.avatar_url ? data.avatar_url : null);
      } catch {
        resolve(null);
      } finally {
        active--;
        runNext();
      }
    });
    runNext();
  });

  results.set(contactId, promise);
  return promise;
}

/**
 * Returns a potentially-refreshed avatar URL and an onError handler.
 * On first load failure (404), calls refresh-avatar to fetch a fresh URL from Unipile,
 * at most once per contact per page load.
 * If the refresh also fails, returns undefined so AvatarFallback shows.
 */
export function useAvatarRefresh(
  contactId: string | undefined,
  originalUrl: string | null | undefined
) {
  const [refreshedUrl, setRefreshedUrl] = useState<string | null>(null);

  // A remounted row picks up an earlier refresh without failing the old URL first
  useEffect(() => {
    if (!contactId || !results.has(contactId)) return;
    let cancelled = false;
    results.get(contactId)!.then((url) => {
      if (!cancelled && url) setRefreshedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const onError = useCallback(async () => {
    if (!contactId || !originalUrl) return;
    const url = await refreshAvatar(contactId);
    if (url) setRefreshedUrl(url);
  }, [contactId, originalUrl]);

  const src = refreshedUrl || originalUrl || undefined;

  return { src, onError };
}
