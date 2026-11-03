import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// whatsapp_templates is not in the generated types yet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type TemplateApprovalStatus = "draft" | "submitted" | "pending" | "approved" | "rejected" | "paused" | "disabled";

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: "marketing" | "utility" | "authentication";
  body: string;
  /** Template slot → contact field ("1" → "first_name") */
  variables: Record<string, string>;
  buttons: { title: string; id: string }[];
  approval_status: TemplateApprovalStatus;
  rejected_reason: string | null;
  synced_at: string | null;
}

/** Contact fields a template slot can be filled from (same keys as _shared/messaging/whatsapp.ts). */
export const TEMPLATE_FIELDS: { value: string; label: string }[] = [
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "full_name", label: "Full name" },
  { value: "company", label: "Company" },
  { value: "job_title", label: "Job title" },
  { value: "city", label: "City" },
  { value: "country", label: "Country" },
  { value: "email", label: "Email" },
];

/** "{{1}} … {{2}}" → ["1", "2"] */
export function templateSlots(body: string): string[] {
  const slots = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) slots.add(m[1]);
  return [...slots].sort((a, b) => Number(a) - Number(b));
}

export function useWhatsAppTemplates() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["whatsapp-templates", currentOrganization?.id],
    queryFn: async (): Promise<WhatsAppTemplate[]> => {
      const { data, error } = await db
        .from("whatsapp_templates")
        .select("id, name, language, category, body, variables, buttons, approval_status, rejected_reason, synced_at")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentOrganization,
  });
}

async function invokeTemplates(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("whatsapp-templates", { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const detail = await Promise.resolve(context?.json?.()).catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export interface NewTemplateInput {
  name: string;
  language: string;
  category: "marketing" | "utility";
  body: string;
  variables: Record<string, string>;
  samples: Record<string, string>;
  buttons: string[];
}

export function useCreateWhatsAppTemplate() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewTemplateInput) =>
      invokeTemplates({ action: "create", organization_id: currentOrganization!.id, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      toast.success("Template submitted to Meta. Approval usually takes minutes, sometimes a day.");
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      toast.error(err.message);
    },
  });
}

export function useSyncWhatsAppTemplates() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invokeTemplates({ action: "sync", organization_id: currentOrganization!.id }),
    onSuccess: (data: { synced: number }) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      toast.success(`Synced ${data.synced} template${data.synced === 1 ? "" : "s"} from Twilio`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteWhatsAppTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => invokeTemplates({ action: "delete", template_id: templateId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      toast.success("Template deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Map a synced template's slots to contact fields (templates made in the Twilio Console start unmapped). */
export function useUpdateTemplateVariables() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, variables }: { id: string; variables: Record<string, string> }) => {
      const { error } = await db.from("whatsapp_templates").update({ variables }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] }),
    onError: (err: Error) => toast.error(err.message),
  });
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Meta's 24h customer service window on a WhatsApp Business (Twilio) thread:
 * free text is allowed until 24h after the contact's last message.
 */
export function useWhatsAppWindow(conversationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["whatsapp-window", conversationId],
    queryFn: async (): Promise<{ open: boolean; closesAt: Date | null }> => {
      const { data, error } = await supabase
        .from("crm_messages")
        .select("created_at")
        .eq("conversation_id", conversationId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { open: false, closesAt: null };
      const closesAt = new Date(new Date(data.created_at).getTime() + WINDOW_MS);
      return { open: closesAt.getTime() > Date.now(), closesAt };
    },
    enabled,
    refetchInterval: 60_000,
  });
}

export function useSendWhatsAppTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, templateId }: { conversationId: string; templateId: string }) =>
      invokeTemplates({ action: "send_template", conversation_id: conversationId, template_id: templateId }),
    onSuccess: (_data, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: ["crm-messages", conversationId] });
      toast.success("Template sent. You can write freely once they reply.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
