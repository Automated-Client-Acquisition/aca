/**
 * Hook to resolve a LinkedIn URL to a platform identity
 *
 * When a contact has a LinkedIn URL but no identity record, this hook:
 * 1. Extracts the public_identifier from the LinkedIn URL
 * 2. Fetches the profile via Unipile to get the provider_id
 * 3. Creates the crm_contact_identities record
 *
 * This enables CSV-imported contacts to have their LinkedIn profiles resolved
 * lazily when viewing the contact detail page.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface ResolveLinkedInIdentityInput {
  contactId: string;
  linkedInUrl: string;
  accountId: string; // Unipile account ID
}

interface ResolveLinkedInIdentityResult {
  identityId: string;
  platformUserId: string;
  profile: {
    first_name?: string;
    last_name?: string;
    headline?: string;
    profile_picture_url?: string;
    public_profile_url?: string;
  };
}

/**
 * Extract the public identifier (username) from a LinkedIn URL
 *
 * Supports formats like:
 * - https://www.linkedin.com/in/john-doe/
 * - https://linkedin.com/in/john-doe
 * - linkedin.com/in/john-doe
 * - /in/john-doe
 */
export function extractLinkedInIdentifier(url: string): string | null {
  if (!url) return null;

  // Clean up the URL
  let cleanUrl = url.trim();

  // Handle cases where it's just the identifier
  if (!cleanUrl.includes("/") && !cleanUrl.includes(".")) {
    return cleanUrl;
  }

  // Try to extract from /in/ pattern
  const inMatch = cleanUrl.match(/\/in\/([^\/\?#]+)/i);
  if (inMatch) {
    return inMatch[1];
  }

  // Try to extract from /pub/ pattern (older format)
  const pubMatch = cleanUrl.match(/\/pub\/([^\/\?#]+)/i);
  if (pubMatch) {
    return pubMatch[1];
  }

  return null;
}

/**
 * Hook to resolve a LinkedIn URL to a contact identity
 *
 * This mutation will:
 * 1. Extract the public identifier from the LinkedIn URL
 * 2. Fetch the profile via Unipile API
 * 3. Create a crm_contact_identities record with the resolved provider_id
 */
export function useResolveLinkedInIdentity() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      linkedInUrl,
      accountId,
    }: ResolveLinkedInIdentityInput): Promise<ResolveLinkedInIdentityResult> => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization selected");

      // Extract identifier from URL
      const identifier = extractLinkedInIdentifier(linkedInUrl);
      if (!identifier) {
        throw new Error("Could not extract LinkedIn identifier from URL");
      }

      console.log(
        "[ResolveLinkedInIdentity] Resolving identifier:",
        identifier
      );

      // Fetch profile via Unipile to get the provider_id
      const { data: response, error: fetchError } =
        await supabase.functions.invoke("unipile-fetch-profile", {
          body: {
            identifier,
            accountId,
            sections: [], // We only need basic profile info
            notify: false,
          },
        });

      if (fetchError) {
        console.error("[ResolveLinkedInIdentity] Fetch error:", fetchError);
        throw new Error(
          fetchError.message || "Failed to fetch LinkedIn profile"
        );
      }

      if (!response?.success || !response?.profile) {
        console.error("[ResolveLinkedInIdentity] Invalid response:", response);
        throw new Error(response?.error || "Failed to fetch LinkedIn profile");
      }

      const profile = response.profile;
      const providerId = profile.provider_id;

      if (!providerId) {
        throw new Error("LinkedIn profile does not have a provider_id");
      }

      console.log("[ResolveLinkedInIdentity] Got provider_id:", providerId);

      // Check if identity already exists (race condition protection)
      const { data: existingIdentity } = await supabase
        .from("crm_contact_identities")
        .select("id")
        .eq("organization_id", currentOrganization.id)
        .eq("contact_id", contactId)
        .eq("channel", "linkedin")
        .maybeSingle();

      if (existingIdentity) {
        console.log(
          "[ResolveLinkedInIdentity] Identity already exists:",
          existingIdentity.id
        );
        return {
          identityId: existingIdentity.id,
          platformUserId: providerId,
          profile: {
            first_name: profile.first_name,
            last_name: profile.last_name,
            headline: profile.headline,
            profile_picture_url: profile.profile_picture_url,
            public_profile_url: profile.public_profile_url,
          },
        };
      }

      // Create the identity record
      const { data: identity, error: insertError } = await supabase
        .from("crm_contact_identities")
        .insert({
          organization_id: currentOrganization.id,
          contact_id: contactId,
          channel: "linkedin",
          platform_user_id: providerId,
          platform_username:
            profile.first_name && profile.last_name
              ? `${profile.first_name} ${profile.last_name}`
              : identifier,
          platform_profile_url: profile.public_profile_url || linkedInUrl,
          platform_avatar_url: profile.profile_picture_url,
          platform_metadata: {
            headline: profile.headline,
            public_identifier: profile.public_identifier,
            resolved_at: new Date().toISOString(),
          },
          is_primary: true,
        })
        .select()
        .single();

      if (insertError) {
        console.error(
          "[ResolveLinkedInIdentity] Insert error:",
          insertError
        );
        throw new Error(
          insertError.message || "Failed to create LinkedIn identity"
        );
      }

      console.log("[ResolveLinkedInIdentity] Created identity:", identity.id);

      // Also update the contact with profile info if missing
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      // Update avatar if we got one
      if (profile.profile_picture_url) {
        updateData.avatar_url = profile.profile_picture_url;
      }

      await supabase
        .from("crm_contacts")
        .update(updateData)
        .eq("id", contactId);

      return {
        identityId: identity.id,
        platformUserId: providerId,
        profile: {
          first_name: profile.first_name,
          last_name: profile.last_name,
          headline: profile.headline,
          profile_picture_url: profile.profile_picture_url,
          public_profile_url: profile.public_profile_url,
        },
      };
    },
    onSuccess: (_, { contactId }) => {
      // Invalidate contact query to refetch with new identity
      queryClient.invalidateQueries({ queryKey: ["crm-contact"] });
      toast.success("LinkedIn profile connected");
    },
    onError: (error) => {
      console.error("[ResolveLinkedInIdentity] Error:", error);
      // Don't show toast for common expected errors
      const message =
        error instanceof Error ? error.message : "Failed to resolve identity";
      // Suppress toasts for expected/non-actionable errors
      if (
        !message.includes("not found") &&
        !message.includes("throttl") &&
        !message.includes("cannot be reached") &&
        !message.includes("invalid_recipient")
      ) {
        toast.error(message);
      }
    },
  });
}
