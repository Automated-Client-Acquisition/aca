import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCallback } from "react";
import { toast } from "sonner";
import { backgroundTasks } from "@/hooks/useBackgroundTasks";
import { chunkedIn } from "@/hooks/crm/useContacts";

/**
 * Preview data for bulk email finding
 */
export interface BulkEmailFindingPreview {
  contacts: Array<{
    id: string;
    display_name: string | null;
    hasEmail: boolean;
    linkedinUrl: string | null;
    companyDomain: string | null;
  }>;
  summary: {
    total: number;
    withEmail: number;
    withoutEmail: number;
    canEnrich: number; // has LinkedIn OR company domain
  };
}

/**
 * Progress state for bulk enrichment
 */
export interface BulkEnrichProgress {
  current: number;
  total: number;
  currentContactName?: string;
  found: number;
  skipped: number;
  failed: number;
}

/**
 * Result from bulk enrichment
 */
export interface BulkEnrichResult {
  total: number;
  found: number;
  skipped: number;
  failed: number;
  errors: Array<{ contactId: string; error: string }>;
}

/**
 * Hook to get preview data for bulk email finding
 */
export function useBulkEmailFindingPreview(contactIds: string[]) {
  return useQuery({
    queryKey: ["bulk-email-finding-preview", contactIds.sort().join(",")],
    queryFn: async (): Promise<BulkEmailFindingPreview> => {
      if (contactIds.length === 0) {
        return {
          contacts: [],
          summary: { total: 0, withEmail: 0, withoutEmail: 0, canEnrich: 0 },
        };
      }

      // Fetch contacts with email and enrichable data
      const contacts = await chunkedIn(contactIds, (chunk) =>
        supabase
          .from("crm_contacts")
          .select(`
            id,
            display_name,
            primary_email,
            linkedin_url,
            company_website
          `)
          .in("id", chunk)
      );

      const mappedContacts = contacts.map((c) => ({
        id: c.id,
        display_name: c.display_name,
        hasEmail: !!c.primary_email && c.primary_email.trim() !== "",
        linkedinUrl: c.linkedin_url,
        companyDomain: c.company_website,
      }));

      const withEmail = mappedContacts.filter((c) => c.hasEmail).length;
      const withoutEmail = mappedContacts.filter((c) => !c.hasEmail).length;
      const canEnrich = mappedContacts.filter(
        (c) => !c.hasEmail && (c.linkedinUrl || c.companyDomain)
      ).length;

      return {
        contacts: mappedContacts,
        summary: {
          total: mappedContacts.length,
          withEmail,
          withoutEmail,
          canEnrich,
        },
      };
    },
    enabled: contactIds.length > 0,
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Fire-and-forget bulk email enrichment with global progress bar.
 * Returns a `run()` function — call it and the dialog can close immediately.
 */
export function useBulkEnrichContacts() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  const run = useCallback(
    async ({
      contactIds,
      preferredProvider,
      skipIfHasEmail = true,
    }: {
      contactIds: string[];
      preferredProvider?: string;
      skipIfHasEmail?: boolean;
    }) => {
      if (!currentOrganization) return;

      const taskId = `find-emails-${Date.now()}`;

      // Fetch contacts to check which need enrichment
      let contacts: { id: string; display_name: string | null; primary_email: string | null }[];
      try {
        contacts = await chunkedIn(contactIds, (chunk) =>
          supabase
            .from("crm_contacts")
            .select("id, display_name, primary_email")
            .in("id", chunk)
        );
      } catch (fetchError: any) {
        toast.error(`Failed to load contacts: ${fetchError.message}`);
        return;
      }

      // Filter contacts if skipIfHasEmail is true
      const contactsToProcess = skipIfHasEmail
        ? contacts.filter(
            (c) => !c.primary_email || c.primary_email.trim() === ""
          )
        : contacts;

      const total = contactsToProcess.length;

      if (total === 0) {
        toast.info("All selected contacts already have emails");
        return;
      }

      toast.success(`Finding emails for ${total.toLocaleString()} contacts`, { duration: 3000 });

      const onCancel = () => {
        backgroundTasks.update(taskId, { cancelling: true });
      };

      backgroundTasks.start({
        id: taskId,
        type: "find-emails",
        label: "Finding emails",
        checked: 0,
        total,
        color: "emerald",
        onCancel,
      });

      let found = 0;
      let failed = 0;
      let cancelled = false;

      // Process each contact sequentially
      for (let i = 0; i < contactsToProcess.length; i++) {
        // Check if user cancelled
        if (backgroundTasks.isCancelling(taskId)) {
          cancelled = true;
          break;
        }

        const contact = contactsToProcess[i];

        backgroundTasks.update(taskId, {
          checked: i,
          extra: found > 0 ? `${found} found` : contact.display_name || undefined,
        });

        try {
          const { data, error } = await supabase.functions.invoke(
            "enrich-contact",
            {
              body: {
                contactId: contact.id,
                enrichmentTypes: ["email", "company", "social"],
                preferredProvider: preferredProvider || undefined,
                applyToContact: true,
              },
            }
          );

          if (error) {
            failed++;
          } else if (data?.success && data?.data?.email) {
            found++;
          } else if (data?.error && data.error.code !== "NOT_FOUND") {
            failed++;
          }
        } catch {
          failed++;
        }

        // Rate limit delay
        if (i < contactsToProcess.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      backgroundTasks.finish(taskId);

      // Invalidate queries to refresh contact data
      queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["lead-list-members"] });
      queryClient.invalidateQueries({ queryKey: ["lead-list-channel-stats"] });

      // Brief completion toast
      if (cancelled) {
        toast.info(`Email finding cancelled. Found ${found} email${found !== 1 ? "s" : ""} before stopping.`, { duration: 4000 });
      } else if (found > 0) {
        toast.success(`Found ${found} email${found !== 1 ? "s" : ""} across ${total.toLocaleString()} contacts`, { duration: 4000 });
      } else if (failed === 0) {
        toast.info("No emails found for selected contacts", { duration: 4000 });
      } else {
        toast.warning(`Completed with ${failed} error${failed !== 1 ? "s" : ""}`, { duration: 4000 });
      }
    },
    [currentOrganization, queryClient]
  );

  return { run };
}
