import { useEffect, useMemo, useState } from "react";
import type { UpdateEmailSequenceInput } from "@/types/email";

export type EmailSequenceSaveStatus = "idle" | "saving" | "saved" | "error";
type Save = (payload: UpdateEmailSequenceInput) => Promise<unknown>;
type Snapshot = {
  saveStatus: EmailSequenceSaveStatus;
  saveError: string | null;
};

/** Only intercept ordinary links that leave the current page in this tab. */
export function shouldFlushBeforeSequenceNavigation({
  href,
  currentUrl,
  target = "",
  download = false,
  button = 0,
  defaultPrevented = false,
  altKey = false,
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
}: {
  href: string;
  currentUrl: string;
  target?: string;
  download?: boolean;
  button?: number;
  defaultPrevented?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}) {
  if (defaultPrevented || button !== 0 || altKey || ctrlKey || metaKey || shiftKey || download) return false;
  if (target && target.toLowerCase() !== "_self") return false;
  if (!href.trim() || href.trim().startsWith("#")) return false;
  try {
    const current = new URL(currentUrl);
    const next = new URL(href, current);
    return next.origin === current.origin && (next.pathname !== current.pathname || next.search !== current.search);
  } catch {
    return false;
  }
}

function mergeUpdates(
  previous: UpdateEmailSequenceInput | undefined,
  next: UpdateEmailSequenceInput,
): UpdateEmailSequenceInput {
  return {
    ...previous,
    ...next,
    ...(previous?.settings || next.settings
      ? { settings: { ...previous?.settings, ...next.settings } }
      : {}),
  };
}

/** A single sequence's write queue: newer edits win without dropping other fields. */
export function createEmailSequenceSaveQueue(initialSave: Save, delay = 800) {
  let save = initialSave;
  let pending: { payload: UpdateEmailSequenceInput; save: Save } | undefined;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let snapshot: Snapshot = { saveStatus: "idle", saveError: null };
  const listeners = new Set<(value: Snapshot) => void>();

  const publish = (value: Snapshot) => {
    snapshot = value;
    listeners.forEach((listener) => listener(value));
  };

  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (inFlight) return inFlight;
    if (!pending) return Promise.resolve();
    publish({ saveStatus: "saving", saveError: null });
    inFlight = Promise.resolve()
      .then(async () => {
        while (pending) {
          const batch = pending;
          pending = undefined;
          try {
            await batch.save(batch.payload);
          } catch (error) {
            // Preserve the failed write, with any newer edits taking precedence.
            pending = pending
              ? {
                  payload: mergeUpdates(batch.payload, pending.payload),
                  save: pending.save,
                }
              : batch;
            publish({
              saveStatus: "error",
              saveError:
                error instanceof Error
                  ? error.message
                  : "Could not save changes",
            });
            throw error;
          }
        }
        publish({ saveStatus: "saved", saveError: null });
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    setSave: (callback: Save) => {
      save = callback;
    },
    getSnapshot: () => snapshot,
    hasUnsavedChanges: () => !!pending || !!inFlight,
    subscribe: (listener: (value: Snapshot) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    queueSave: (payload: UpdateEmailSequenceInput) => {
      // Capture the callback with the edit, so a later context render cannot
      // redirect an already-queued write to a different organization.
      pending = { payload: mergeUpdates(pending?.payload, payload), save };
      publish({ saveStatus: "saving", saveError: null });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void flush().catch(() => {});
      }, delay);
    },
    flush,
  };
}

export function useEmailSequenceAutosave({
  sequenceId,
  scopeKey,
  save,
  delay = 800,
}: {
  sequenceId: string | undefined;
  /** Include organization id when the same route can switch tenants. */
  scopeKey?: string;
  save: Save;
  delay?: number;
}) {
  // Each organization/route owns its writes, including its cleanup callback.
  const queueKey = scopeKey ?? sequenceId;
  const queue = useMemo(
    () => createEmailSequenceSaveQueue(save, delay),
    // The callback is refreshed below; scope changes must create a separate queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queueKey, delay],
  );
  queue.setSave(save);
  const [state, setState] = useState<Snapshot>(queue.getSnapshot);

  useEffect(() => {
    let active = true;
    let navigating = false;
    let replaying = false;
    setState(queue.getSnapshot());
    const unsubscribe = queue.subscribe(setState);
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!queue.hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const saveBeforeNavigation = (event: MouseEvent) => {
      if (replaying || !queue.hasUnsavedChanges()) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || !shouldFlushBeforeSequenceNavigation({
        href: anchor.getAttribute("href") || "",
        currentUrl: window.location.href,
        target: anchor.target,
        download: anchor.hasAttribute("download"),
        button: event.button,
        defaultPrevented: event.defaultPrevented,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      })) return;
      event.preventDefault();
      event.stopPropagation();
      if (navigating) return;
      navigating = true;
      void queue.flush().then(() => {
        if (!active || !anchor.isConnected) return;
        // Replay through the router's existing link handler after persistence.
        replaying = true;
        try { anchor.click(); } finally { replaying = false; }
      }).catch(() => {
        // Leave the editor mounted with its error and retry controls intact.
      }).finally(() => { navigating = false; });
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", saveBeforeNavigation, true);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", saveBeforeNavigation, true);
      // A SPA route exit keeps the request alive; a browser exit requires the warning above.
      void queue.flush().catch(() => {});
    };
  }, [queue]);

  return {
    ...state,
    queueSave: queue.queueSave,
    flush: queue.flush,
    retry: queue.flush,
  };
}
