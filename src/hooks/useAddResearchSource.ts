import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateSchedule } from "@/hooks/useCreateSchedule";
import type { ResearchScheduleDraft } from "@/lib/research-schedule";

interface SavedSource {
  id: string;
  name: string;
  organizationId: string;
}

// Keep the saved source when the second write fails, so Retry only creates its schedule.
export function useAddResearchSource(type: "creator" | "search_term") {
  const { currentOrganization } = useAuth();
  const currentOrgId = useRef(currentOrganization?.id);
  currentOrgId.current = currentOrganization?.id;
  const savedSourceRef = useRef<SavedSource | null>(null);
  const savingRef = useRef(false);
  const [savedSource, setSavedSource] = useState<SavedSource | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createSchedule = useCreateSchedule();

  const save = async (
    createSource: () => Promise<SavedSource>,
    schedule: ResearchScheduleDraft,
    onComplete: () => void,
  ) => {
    if (savingRef.current) return;
    setError(null);
    const maxItems = Number(schedule.maxItems);
    if (schedule.enabled && (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 1000)) {
      setError("Enter a whole number from 1 to 1,000 posts per scheduled run.");
      return;
    }
    savingRef.current = true;
    setIsPending(true);
    try {
      const source = savedSourceRef.current ?? await createSource();
      savedSourceRef.current = source;
      setSavedSource(source);
      if (schedule.enabled) {
        if (source.organizationId !== currentOrgId.current) {
          throw new Error("Your organization changed. Return to the source's organization to finish its schedule.");
        }
        await createSchedule.mutateAsync({
          type, targetId: source.id, targetName: source.name,
          frequency: schedule.frequency, maxItems, autoPause: schedule.autoPause,
        });
      }
      onComplete();
    } catch (cause) {
      const detail = cause && typeof cause === "object" && "message" in cause
        ? String(cause.message) : "Please try again.";
      setError(savedSourceRef.current
        ? `Your source was added, but its schedule could not be saved. Retry the schedule or turn scheduling off to finish. ${detail}`
        : `Could not add this source. ${detail}`);
    } finally {
      savingRef.current = false;
      setIsPending(false);
    }
  };

  const reset = () => {
    savedSourceRef.current = null;
    setSavedSource(null);
    setError(null);
  };

  return { save, reset, savedSource, isPending, error };
}
