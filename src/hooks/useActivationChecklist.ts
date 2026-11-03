import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSetupStatus } from "./useSetupStatus";
import { useOnboardingState } from "./useOnboardingState";

export interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  link: string;
  isRequired: boolean;
  isCompleted: boolean;
  category: "setup" | "content" | "outreach" | "integration";
}

export interface ActivationChecklist {
  items: ChecklistItem[];
  completedCount: number;
  totalCount: number;
  requiredCompletedCount: number;
  requiredTotalCount: number;
  progress: number; // 0-100
  isActivated: boolean; // All required items complete
  isDismissed: boolean;
  isLoading: boolean;
  /** Whether the onboarding wizard itself has been completed */
  onboardingCompleted: boolean;
  /** Mutation to dismiss the checklist */
  dismissChecklist: { mutate: () => void };
}

export function useActivationChecklist(): ActivationChecklist {
  const { currentOrganization } = useAuth();
  const setupStatus = useSetupStatus();
  const { checklistDismissed, isLoading: onboardingLoading, isCompleted: onboardingCompleted, dismissChecklist } = useOnboardingState();

  // Check for outreach-related items (Unipile, mailboxes, leads)
  const { data: outreachStatus, isLoading: outreachLoading } = useQuery({
    queryKey: ["activation-outreach", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return null;

      // The checklist only needs existence, never an exact total. These bounded
      // probes avoid counting large tenant tables on every application page.
      const [unipile, mailbox, leads] = await Promise.all([
        supabase
          .from("unipile_accounts")
          .select("id")
          .eq("organization_id", currentOrganization.id)
          .eq("status", "active")
          .limit(1),
        supabase
          .from("email_mailboxes")
          .select("id")
          .eq("organization_id", currentOrganization.id)
          .neq("status", "disconnected")
          .limit(1),
        supabase
          .from("leads")
          .select("id")
          .eq("organization_id", currentOrganization.id)
          .limit(1),
      ]);

      const firstError = unipile.error ?? mailbox.error ?? leads.error;
      if (firstError) throw firstError;

      return {
        hasUnipile: (unipile.data?.length ?? 0) > 0,
        hasMailbox: (mailbox.data?.length ?? 0) > 0,
        hasLeads: (leads.data?.length ?? 0) > 0,
      };
    },
    enabled: !!currentOrganization,
    staleTime: 30000,
  });

  const isLoading =
    setupStatus.isLoading ||
    onboardingLoading ||
    outreachLoading;

  return useMemo(() => {
    // The checklist focuses on the few steps a new user actually has to
    // take to start landing replies. Onboarding (/get-started) already
    // built the ICP / sequences / blueprint / campaign / agent / strategy
    // doc. We surface only the gates that block real outbound activity.
    const items: ChecklistItem[] = [
      // OUTREACH FIRST. The AI key used to sit here marked "required", which
      // was not true: generation and campaign messaging fall back to the
      // platform key (see _shared/llm-client.ts), and the onboarding wizard
      // builds every asset without one. Leading with "go get an API key"
      // told a brand-new agency owner to do homework before anything worked,
      // when in fact the only thing gated on their own key is the always-on
      // reply agent. It now sits last, and is honestly labelled as an upgrade.
      {
        id: "unipile",
        label: "Connect LinkedIn",
        description: "Pair your LinkedIn account so your campaign can enroll prospects",
        link: "/settings?tab=senders",
        isRequired: false,
        isCompleted: outreachStatus?.hasUnipile ?? false,
        category: "outreach",
      },
      {
        id: "mailbox",
        label: "Connect an email mailbox",
        description: "SMTP / Microsoft 365 / ZapMail so your sequence can actually send",
        link: "/settings?tab=mailboxes",
        isRequired: false,
        isCompleted: outreachStatus?.hasMailbox ?? false,
        category: "outreach",
      },
      {
        id: "leads",
        label: "Import your first leads",
        description: "Drop in prospects to enroll in the campaign we built you",
        link: "/people",
        isRequired: false,
        isCompleted: outreachStatus?.hasLeads ?? false,
        category: "outreach",
      },
      // The BYO-key pitch, at the point where it is a benefit rather than a
      // chore: everything above already runs, so this reads as "unlock more,
      // at cost" instead of "do homework before you can start".
      {
        id: "openrouter",
        label: "Plug in your own AI key · pay cost, not markup",
        description: "Everything above already runs. Add your key and the reply agent starts answering your inbox - billed straight by the provider, with nothing added by us.",
        link: "/settings?tab=integrations",
        isRequired: false,
        isCompleted: setupStatus.hasOpenRouter,
        category: "setup",
      },
      // OPTIONAL: only needed if you want to save generated images / video / files
      {
        id: "storage",
        label: "Configure Cloud Storage",
        description: "Only if you want to save generated images / video / files",
        link: "/settings?tab=storage",
        isRequired: false,
        isCompleted: setupStatus.hasStorage,
        category: "integration",
      },
    ];

    const completedCount = items.filter((i) => i.isCompleted).length;
    const totalCount = items.length;

    const requiredItems = items.filter((i) => i.isRequired);
    const requiredCompletedCount = requiredItems.filter(
      (i) => i.isCompleted
    ).length;
    const requiredTotalCount = requiredItems.length;

    const progress = Math.round((completedCount / totalCount) * 100);

    // Activation is "this workspace can actually send to someone": a channel
    // plus prospects. Deriving it from isRequired used to make it vacuously
    // true the moment nothing was marked required - and it was measuring
    // whether an API key existed, which is not the same as being able to run.
    const hasChannel = (outreachStatus?.hasUnipile ?? false) || (outreachStatus?.hasMailbox ?? false);
    const isActivated = hasChannel && (outreachStatus?.hasLeads ?? false);

    return {
      items,
      completedCount,
      totalCount,
      requiredCompletedCount,
      requiredTotalCount,
      progress,
      isActivated,
      isDismissed: checklistDismissed,
      isLoading,
      onboardingCompleted,
      dismissChecklist,
    };
  }, [
    setupStatus,
    outreachStatus,
    checklistDismissed,
    isLoading,
    onboardingCompleted,
    dismissChecklist,
  ]);
}
