import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { readTenantFunctionError, tenantOrdersRefetchInterval } from "@/lib/tenant-order-ux";

export type TenantOrderStatus =
  | "pending_payment"
  | "provisioning"
  | "active"
  | "cancelled"
  | "failed";

export interface TenantOrder {
  id: string;
  organization_id: string;
  created_by: string | null;
  company_name: string;
  business_domain: string;
  contact_email: string;
  contact_first_name: string;
  contact_last_name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country_code: string | null;
  phone_country_code: string | null;
  phone_number: string | null;
  terms_accepted_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  pax8_company_id: string | null;
  pax8_order_id: string | null;
  pax8_tenant_id: string | null;
  pax8_subscription_id: string | null;
  m365_tenant_domain: string | null;
  m365_admin_email: string | null;
  m365_admin_temp_password_sent_at: string | null;
  status: TenantOrderStatus;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTenantOrderInput {
  companyName: string;
  businessDomain: string;
  contactEmail: string;
  contactFirstName: string;
  contactLastName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateProvince?: string;
  postalCode: string;
  countryCode: string;
  phoneCountryCode: string;
  phoneNumber: string;
  termsAccepted: boolean;
}

/** List all tenant orders for the current organization */
export function useTenantOrders(checkoutSessionId?: string) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["tenant-orders", currentOrganization?.id],
    queryFn: async (): Promise<TenantOrder[]> => {
      const { data, error } = await supabase
        .from("tenant_orders")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TenantOrder[];
    },
    enabled: !!currentOrganization,
    refetchInterval: query => tenantOrdersRefetchInterval(query.state.data, checkoutSessionId),
  });
}

/** Create a new tenant order - returns a Stripe Checkout URL to redirect to */
export function useCreateTenantOrder() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateTenantOrderInput): Promise<{ checkoutUrl: string }> => {
      const { data, error } = await supabase.functions.invoke(
        "tenant-order-create-checkout",
        { body: input },
      );
      if (error) throw await readTenantFunctionError(error);
      if (!data?.success) throw new Error(data?.error || "Failed to create order");
      return { checkoutUrl: data.checkoutUrl };
    },
    onSuccess: ({ checkoutUrl }) => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-orders", currentOrganization?.id],
      });
      window.location.href = checkoutUrl;
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({
        queryKey: ["tenant-orders", currentOrganization?.id],
      });
      toast.error(`Failed to start checkout: ${error.message}`);
    },
  });
}

/** Open Stripe Customer Portal for an order (invoices, cancel, update card) */
export function useOpenTenantOrderPortal() {
  return useMutation({
    mutationFn: async (tenantOrderId: string): Promise<void> => {
      const { data, error } = await supabase.functions.invoke("tenant-order-portal", {
        body: { tenantOrderId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to open billing portal");
      window.open(data.portalUrl, "_blank", "noopener,noreferrer");
    },
    onError: (error: Error) => {
      toast.error(`Failed to open billing portal: ${error.message}`);
    },
  });
}
