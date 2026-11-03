import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import type { UnipileCampaign } from "@/hooks/useUnipileCampaigns";
import { supabase } from "@/integrations/supabase/client";

interface CampaignDeliveryMessageProps {
  campaign: Pick<UnipileCampaign, "id" | "organization_id" | "dm_template">;
}

export function CampaignDeliveryMessage({
  campaign,
}: CampaignDeliveryMessageProps) {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(campaign.dm_template);
  const [savedMessage, setSavedMessage] = useState(campaign.dm_template);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const savedMessageRef = useRef(campaign.dm_template);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDirty = draft !== savedMessage;
  const isBlank = !draft.trim();
  const fieldId = `delivery-message-${campaign.id}`;

  // Refresh saved content without replacing an in-progress draft.
  useEffect(() => {
    const previousMessage = savedMessageRef.current;
    setDraft((current) =>
      current === previousMessage ? campaign.dm_template : current,
    );
    savedMessageRef.current = campaign.dm_template;
    setSavedMessage(campaign.dm_template);
  }, [campaign.dm_template]);

  const fitMessage = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(144, textarea.scrollHeight + 2)}px`;
  }, []);

  useLayoutEffect(fitMessage, [draft, fitMessage]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth !== width) {
        width = textarea.clientWidth;
        fitMessage();
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [fitMessage]);

  const saveMutation = useMutation({
    scope: { id: `lead-magnet-settings-${campaign.id}` },
    mutationFn: async (message: string) => {
      if (
        !currentOrganization ||
        currentOrganization.id !== campaign.organization_id
      )
        throw new Error("No organization selected");
      const { data, error } = await supabase
        .from("unipile_campaigns")
        .update({ dm_template: message })
        .eq("id", campaign.id)
        .eq("organization_id", currentOrganization.id)
        .select("id, dm_template")
        .single();
      if (error) throw error;
      return data.dm_template;
    },
    onSuccess: (message) => {
      savedMessageRef.current = message;
      setSavedMessage(message);
      setDraft(message);
      const queryKey = ["unipile-campaigns", campaign.organization_id];
      queryClient.setQueryData<UnipileCampaign[]>(queryKey, (campaigns) =>
        campaigns?.map((entry) =>
          entry.id === campaign.id ? { ...entry, dm_template: message } : entry,
        ),
      );
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return (
    <form
      noValidate
      className="min-w-0 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isDirty || saveMutation.isPending) return;
        setValidationAttempted(true);
        if (isBlank) {
          textareaRef.current?.focus();
          return;
        }
        saveMutation.mutate(draft);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={fieldId}>Delivery message</Label>
        <span role="status" className="text-xs text-muted-foreground">
          {saveMutation.isPending ? (
            "Saving…"
          ) : isDirty ? (
            "Unsaved changes"
          ) : saveMutation.isSuccess ? (
            <span className="flex items-center gap-1">
              <Check className="h-3.5 w-3.5" />
              Saved
            </span>
          ) : null}
        </span>
      </div>
      <Textarea
        ref={textareaRef}
        id={fieldId}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          saveMutation.reset();
        }}
        disabled={saveMutation.isPending}
        aria-invalid={validationAttempted && isBlank}
        aria-describedby={`${fieldId}-help${validationAttempted && isBlank ? ` ${fieldId}-validation` : ""}`}
        className="min-h-36 resize-none overflow-y-hidden bg-muted/20 text-base leading-relaxed sm:text-sm"
      />
      <p id={`${fieldId}-help`} className="text-xs text-muted-foreground">
        Sent when a comment matches your keywords. Personalize with {"{name}"},{" "}
        {"{full_name}"} and {"{keyword}"}.
      </p>
      {validationAttempted && isBlank && (
        <p
          id={`${fieldId}-validation`}
          role="alert"
          className="text-sm text-destructive"
        >
          Write a delivery message before saving.
        </p>
      )}
      {saveMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn’t save your message. Your changes are still here; try again.
        </p>
      )}
      {(isDirty || saveMutation.isPending) && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saveMutation.isPending}
            onClick={() => {
              setDraft(savedMessage);
              setValidationAttempted(false);
              saveMutation.reset();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" variant="cta" disabled={saveMutation.isPending}>
            {saveMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {saveMutation.isPending ? "Saving…" : "Save message"}
          </Button>
        </div>
      )}
    </form>
  );
}
