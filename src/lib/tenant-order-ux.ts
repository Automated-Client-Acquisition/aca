import { SUPPORT_EMAIL } from "@/config/site";
/** Keep this format rule aligned with _shared/tenant-order-validation.ts. */
export function normalizeTenantPostcode(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  const completePostcode = /^(?:GIR0AA|[A-PR-UWYZ](?:\d{1,2}|[A-HK-Y]\d{1,2}|\d[A-HJKPSTUW]|[A-HK-Y]\d[ABEHMNPRVWXY])\d[ABD-HJLNP-UW-Z]{2})$/;
  if (!completePostcode.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

interface TenantBillingState {
  status: string;
  stripe_subscription_id?: string | null;
}

export function isPaidTenantFailure(order: TenantBillingState): boolean {
  return order.status === "failed" && !!order.stripe_subscription_id;
}

export function findTenantPurchaseConflict<T extends TenantBillingState & {
  business_domain: string;
  contact_email: string;
}>(orders: readonly T[] | undefined, domain: string, email: string): T | null {
  const normalizedDomain = domain.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  return orders?.find(order => {
    const blocksPurchase = isPaidTenantFailure(order)
      || (order.status !== "cancelled" && order.status !== "failed");
    return blocksPurchase && (
      (!!normalizedDomain && order.business_domain.trim().toLowerCase() === normalizedDomain)
      || (!!normalizedEmail && order.contact_email.trim().toLowerCase() === normalizedEmail)
    );
  }) ?? null;
}

export function tenantFailureMessage(reason: string | null | undefined, postalCode?: string | null): string {
  if ((postalCode && !normalizeTenantPostcode(postalCode)) || /postal|post.?code|zip.?code/i.test(reason ?? "")) {
    return "The billing postcode needs checking. Contact support with your complete UK postcode and full address so we can complete your existing order.";
  }
  if (/address/i.test(reason ?? "")) {
    return "The billing address could not be verified. Contact support with your full company address and UK postcode so we can complete your existing order.";
  }
  if (/(?:company|name).*(?:already|exists|unique|duplicate)|duplicate.*(?:company|name)/i.test(reason ?? "")) {
    return "A company with this name already exists. Contact support so we can resolve the company record and complete your existing order.";
  }
  return "We could not finish setting up this tenant. Contact support with the order reference so we can complete your existing order.";
}

export function tenantSupportHref(order: {
  id: string;
  company_name: string;
  business_domain: string;
  contact_email: string;
}): string {
  const subject = `Help completing tenant order ${order.id}`;
  const body = [
    "Please help complete my existing Microsoft 365 tenant order.",
    "",
    `Order reference: ${order.id}`,
    `Company: ${order.company_name}`,
    `Business domain: ${order.business_domain}`,
    `Contact email: ${order.contact_email}`,
    "",
    "My full corrected company address (including the complete UK postcode):",
    "[Enter street address, city, county, and full postcode]",
  ].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Poll in-flight provisioning and only the checkout session being returned from. */
export function tenantOrdersRefetchInterval(
  orders: readonly { status: string; stripe_checkout_session_id?: string | null }[] | undefined,
  checkoutSessionId?: string,
): 5000 | false {
  if (orders?.some(order => order.status === "provisioning")) return 5000;
  if (!checkoutSessionId) return false;
  const returnedOrder = orders?.find(order => order.stripe_checkout_session_id === checkoutSessionId);
  return !returnedOrder || returnedOrder.status === "pending_payment" ? 5000 : false;
}

/** Supabase wraps an actionable non-2xx JSON response in FunctionsHttpError. */
export async function readTenantFunctionError(error: unknown): Promise<Error> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === "string" && payload.error.trim()) {
        return new Error(payload.error);
      }
    } catch {
      // Relay/network errors or non-JSON responses retain their original message.
    }
  }
  return error instanceof Error ? error : new Error("Failed to start checkout. Please try again.");
}
