import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Cloud,
  Plus,
  ExternalLink,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import {
  useTenantOrders,
  useCreateTenantOrder,
  useOpenTenantOrderPortal,
  type TenantOrder,
  type TenantOrderStatus,
} from "@/hooks/useTenantOrders";
import {
  normalizeTenantPostcode,
  isPaidTenantFailure,
  findTenantPurchaseConflict,
  tenantFailureMessage,
  tenantSupportHref,
} from "@/lib/tenant-order-ux";

const FREE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);
const DOMAIN_REGEX = /^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/i;
const POSTCODE_HELP =
  "Enter the full UK postcode, including the last three characters, e.g. BN2 1AA. A district such as BN2 is incomplete.";

function StatusBadge({ order }: { order: TenantOrder }) {
  const map: Record<
    TenantOrderStatus,
    { label: string; className: string; Icon: typeof CheckCircle2 }
  > = {
    pending_payment: {
      label: "Awaiting payment",
      className: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
      Icon: Clock,
    },
    provisioning: {
      label: "Setting up",
      className: "bg-blue-500/15 text-blue-600 border-blue-500/30",
      Icon: Clock,
    },
    active: {
      label: "Active",
      className: "bg-green-500/15 text-green-600 border-green-500/30",
      Icon: CheckCircle2,
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-muted text-muted-foreground border-border",
      Icon: XCircle,
    },
    failed: {
      label: "Setup failed",
      className: "bg-red-500/15 text-red-600 border-red-500/30",
      Icon: AlertTriangle,
    },
  };
  const { label, className, Icon } = map[order.status];
  return (
    <Badge variant="outline" className={`gap-1 ${className}`}>
      <Icon className="w-3 h-3" />
      {isPaidTenantFailure(order) ? "Paid · setup needs attention" : label}
    </Badge>
  );
}

function TenantRecoveryDialog({
  order,
  onClose,
}: {
  order: TenantOrder | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!order}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete your existing tenant order</DialogTitle>
          <DialogDescription>
            Your payment is recorded, but tenant setup failed. Keep this order
            and contact support to complete it.
          </DialogDescription>
        </DialogHeader>
        {order && (
          <>
            <div
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-2"
              role="status"
            >
              <p className="font-medium text-sm">
                Do not purchase again for this domain or contact email.
              </p>
              <p className="text-sm text-muted-foreground">
                {tenantFailureMessage(order.failure_reason, order.postal_code)}
              </p>
            </div>
            <dl className="text-sm space-y-3">
              <div>
                <dt className="text-muted-foreground">Company and domain</dt>
                <dd className="break-words">
                  {order.company_name} · {order.business_domain}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contact email</dt>
                <dd className="break-all">{order.contact_email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Billing address on this order
                </dt>
                <dd className="break-words">
                  {[
                    order.address_line1,
                    order.address_line2,
                    order.city,
                    order.postal_code,
                    order.country_code === "GB"
                      ? "United Kingdom"
                      : order.country_code,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Order reference</dt>
                <dd className="flex items-center gap-2">
                  <span className="font-mono text-xs break-all">
                    {order.id}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    aria-label="Copy order reference"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(order.id);
                        toast.success("Order reference copied");
                      } catch {
                        toast.error(
                          "Unable to copy. Select and copy the order reference above.",
                        );
                      }
                    }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">
              Send support your correct full billing address and postcode.
              Include this order reference so we can check the existing purchase
              before retrying setup.
            </p>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button variant="cta" asChild>
                <a href={tenantSupportHref(order)}>Contact support</a>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function M365Tenants() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: orders = [], isLoading, isError, refetch } = useTenantOrders();
  const createOrder = useCreateTenantOrder();
  const openPortal = useOpenTenantOrderPortal();
  const [recoveryOrder, setRecoveryOrder] = useState<TenantOrder | null>(null);
  const [step, setStep] = useState<"details" | "review">("details");
  const [postcodeTouched, setPostcodeTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    companyName: "",
    businessDomain: "",
    contactFirstName: "",
    contactLastName: "",
    contactEmail: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    postalCode: "",
    countryCode: "GB",
    phoneNumber: "",
    termsAccepted: false,
  });
  const dialogOpen = searchParams.get("new") === "1";
  const setDialogOpen = (open: boolean) => {
    if (createOrder.isPending) return;
    setSearchParams((prior) => {
      const next = new URLSearchParams(prior);
      if (open) next.set("new", "1");
      else next.delete("new");
      return next;
    });
    setStep("details");
    setFieldErrors({});
    setPostcodeTouched(false);
    setForm((prior) => ({ ...prior, termsAccepted: false }));
    createOrder.reset();
  };
  const updateField = (key: keyof typeof form, value: string) => {
    setForm((prior) => ({ ...prior, [key]: value, termsAccepted: false }));
    setFieldErrors((prior) => {
      const next = { ...prior };
      delete next[key];
      return next;
    });
    createOrder.reset();
  };
  const normalizedPostcode = normalizeTenantPostcode(form.postalCode);
  const postcodeError =
    fieldErrors.postalCode ||
    (postcodeTouched && !normalizedPostcode ? POSTCODE_HELP : undefined);
  const conflict = findTenantPurchaseConflict(
    orders,
    form.businessDomain,
    form.contactEmail,
  );
  const paidFailures = orders.filter(isPaidTenantFailure);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || isError || createOrder.isPending || conflict) return;
    const errors: Record<string, string> = {};
    const domain = form.businessDomain.trim().toLowerCase();
    if (!DOMAIN_REGEX.test(domain))
      errors.businessDomain =
        "Enter a business domain such as acme.com, without https:// or a page path.";
    else if (FREE_DOMAINS.has(domain))
      errors.businessDomain =
        "Use your company's own domain, rather than a free email provider.";
    for (const field of [
      "companyName",
      "contactFirstName",
      "contactLastName",
      "contactEmail",
      "addressLine1",
      "city",
      "phoneNumber",
    ] as const) {
      if (!form[field].trim()) errors[field] = "This field is required.";
    }
    if (!normalizedPostcode) errors.postalCode = POSTCODE_HELP;
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setStep("details");
      setPostcodeTouched(true);
      requestAnimationFrame(() =>
        document.getElementById(Object.keys(errors)[0])?.focus(),
      );
      return;
    }
    if (step === "details") {
      setForm((prior) => ({
        ...prior,
        businessDomain: domain,
        postalCode: normalizedPostcode!,
        contactEmail: prior.contactEmail.trim().toLowerCase(),
        termsAccepted: false,
      }));
      setStep("review");
      requestAnimationFrame(() =>
        document.getElementById("tenant-review-summary")?.focus(),
      );
      return;
    }
    if (!form.termsAccepted) return;
    createOrder.mutate({
      companyName: form.companyName.trim(),
      businessDomain: domain,
      contactEmail: form.contactEmail.trim().toLowerCase(),
      contactFirstName: form.contactFirstName.trim(),
      contactLastName: form.contactLastName.trim(),
      addressLine1: form.addressLine1.trim(),
      addressLine2: form.addressLine2.trim() || undefined,
      city: form.city.trim(),
      postalCode: normalizedPostcode!,
      countryCode: "GB",
      phoneCountryCode: "+44",
      phoneNumber: form.phoneNumber.trim(),
      termsAccepted: true,
    });
  };
  const field = (
    key: Exclude<keyof typeof form, "termsAccepted">,
    label: string,
    options: {
      optional?: boolean;
      placeholder?: string;
      autoComplete?: string;
      type?: string;
    } = {},
  ) => {
    const error = key === "postalCode" ? postcodeError : fieldErrors[key];
    return (
      <div className="space-y-2">
        <Label htmlFor={key}>
          {label}
          {options.optional ? (
            <span className="text-muted-foreground font-normal">
              {" "}
              (optional)
            </span>
          ) : (
            <span className="text-red-500"> *</span>
          )}
        </Label>
        <Input
          id={key}
          name={key}
          required={!options.optional}
          type={options.type ?? "text"}
          autoComplete={options.autoComplete}
          placeholder={options.placeholder}
          value={form[key]}
          aria-invalid={!!error}
          aria-describedby={
            error
              ? `${key}-error`
              : key === "postalCode"
                ? "postcode-help"
                : undefined
          }
          onChange={(e) => updateField(key, e.target.value)}
          onBlur={
            key === "postalCode"
              ? () => {
                  setPostcodeTouched(true);
                  if (normalizedPostcode)
                    setForm((prior) => ({
                      ...prior,
                      postalCode: normalizedPostcode,
                    }));
                }
              : undefined
          }
        />
        {error && (
          <p
            id={`${key}-error`}
            className="text-xs text-red-600 dark:text-red-400"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <AppLayout
      hideActivationChecklist
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="container max-w-6xl py-6 space-y-6">
        <PageHeader
          icon={Cloud}
          title="Microsoft 365 Tenants"
          description={
            <>
              One isolated tenant and one Business Basic (no Teams) license per
              order.{" "}
              <span className="font-medium text-foreground">$9.70/month</span>,
              billed through Stripe.
            </>
          }
          actions={
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="cta"
                onClick={() => setDialogOpen(true)}
                disabled={isLoading || isError}
              >
                <Plus className="w-4 h-4 mr-2" />
                Order Tenant
              </Button>
              <span className="text-xs text-muted-foreground">
                UK businesses only
              </span>
            </div>
          }
        />
        {paidFailures.length > 0 && (
          <div
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-4"
            role="status"
          >
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
            <div className="flex-1 space-y-1">
              <p className="font-medium">
                {paidFailures.length === 1
                  ? "A paid order needs attention"
                  : `${paidFailures.length} paid orders need attention`}
              </p>
              <p className="text-sm text-muted-foreground">
                Payment is recorded, but setup failed. Contact support to
                complete the existing purchase before ordering again for the
                same domain or contact email.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setRecoveryOrder(paidFailures[0])}
            >
              View recovery details
            </Button>
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Your tenants</CardTitle>
            <CardDescription>
              Track setup here. Manage invoices and cancellation through the
              billing portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Loading tenant orders…
              </div>
            ) : isError ? (
              <div className="py-8 space-y-3 text-center" role="alert">
                <p className="text-sm">
                  We couldn't load your orders. Check them before starting
                  another purchase.
                </p>
                <Button variant="outline" onClick={() => refetch()}>
                  Reload orders
                </Button>
              </div>
            ) : !orders.length ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No tenants yet. Order your first tenant to get started.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company / domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>M365 admin</TableHead>
                    <TableHead>Ordered</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <div className="font-medium">{order.company_name}</div>
                        <div className="text-muted-foreground text-xs">
                          {order.business_domain}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge order={order} />
                        {order.status === "failed" && (
                          <p className="text-xs text-muted-foreground mt-2 max-w-xs">
                            {tenantFailureMessage(
                              order.failure_reason,
                              order.postal_code,
                            )}
                          </p>
                        )}
                        {order.status === "provisioning" && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Setup in progress. This page updates automatically.
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {order.m365_admin_email ?? "Not available yet"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(order.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-end gap-2">
                          {isPaidTenantFailure(order) && (
                            <Button
                              variant="cta"
                              size="sm"
                              onClick={() => setRecoveryOrder(order)}
                            >
                              Complete setup
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              !order.stripe_customer_id || openPortal.isPending
                            }
                            onClick={() => openPortal.mutate(order.id)}
                          >
                            <ExternalLink className="w-3 h-3 mr-1" />
                            Billing
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <TenantRecoveryDialog
        order={recoveryOrder}
        onClose={() => setRecoveryOrder(null)}
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden grid-rows-[auto_auto_minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>
              {step === "details"
                ? "Order a Microsoft 365 tenant"
                : "Review your tenant order"}
            </DialogTitle>
            <DialogDescription>
              {step === "details"
                ? "Use the company's real UK billing address. Microsoft checks the address during setup."
                : "Check the address and contact details carefully before continuing to Stripe."}
            </DialogDescription>
          </DialogHeader>
          <p
            className="text-xs text-muted-foreground"
            aria-label={`Step ${step === "details" ? "1" : "2"} of 2`}
          >
            1. Company details <span aria-hidden="true">→</span> 2. Review{" "}
            <span aria-hidden="true">→</span> Stripe payment
          </p>
          <form onSubmit={handleSubmit} className="min-h-0 flex flex-col gap-4">
            <div className="min-h-0 overflow-y-auto space-y-6 pr-1 pb-1">
              {isError && (
                <p
                  className="rounded-md border border-red-500/30 p-3 text-sm"
                  role="alert"
                >
                  We couldn't check your existing orders. Close this form and
                  reload your orders before paying.
                </p>
              )}
              {conflict && (
                <div
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-3"
                  role="alert"
                >
                  <p className="font-medium text-sm">
                    {isPaidTenantFailure(conflict)
                      ? "You already paid for an order with this domain or contact email."
                      : "An existing order uses this domain or contact email."}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {isPaidTenantFailure(conflict)
                      ? "Complete the existing order instead of paying again."
                      : "Check its status and billing before starting another purchase."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDialogOpen(false);
                      if (isPaidTenantFailure(conflict))
                        setRecoveryOrder(conflict);
                    }}
                  >
                    {isPaidTenantFailure(conflict)
                      ? "View recovery details"
                      : "View existing orders"}
                  </Button>
                </div>
              )}
              {createOrder.error && (
                <div
                  className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm"
                  role="alert"
                >
                  {createOrder.error.message}
                </div>
              )}
              {step === "details" ? (
                <>
                  <section
                    className="space-y-4"
                    aria-labelledby="company-heading"
                  >
                    <h3 id="company-heading" className="text-sm font-medium">
                      Company
                    </h3>
                    {field("companyName", "Company name", {
                      placeholder: "Acme Ltd",
                      autoComplete: "organization",
                    })}
                    {field("businessDomain", "Business domain", {
                      placeholder: "acme.com",
                    })}
                    <p className="text-xs text-muted-foreground">
                      Use the domain for this tenant's email. Enter it without
                      https:// or www.
                    </p>
                  </section>
                  <section
                    className="space-y-4"
                    aria-labelledby="address-heading"
                  >
                    <h3 id="address-heading" className="text-sm font-medium">
                      Company billing address
                    </h3>
                    {field("addressLine1", "Building number and street", {
                      placeholder: "123 High Street",
                      autoComplete: "address-line1",
                    })}
                    {field("addressLine2", "Address line 2", {
                      optional: true,
                      placeholder: "Flat, suite or building",
                      autoComplete: "address-line2",
                    })}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {field("city", "Town or city", {
                        autoComplete: "address-level2",
                      })}
                      {field("postalCode", "Full UK postcode", {
                        placeholder: "BN2 1AA",
                        autoComplete: "postal-code",
                      })}
                    </div>
                    <p
                      id="postcode-help"
                      className="text-xs text-muted-foreground"
                    >
                      Use both parts of the postcode, e.g.{" "}
                      <span className="font-medium">BN2 1AA</span>. A postcode
                      district such as BN2 will fail setup.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="countryCode">Country</Label>
                      <Input id="countryCode" value="United Kingdom" readOnly />
                      <p className="text-xs text-muted-foreground">
                        Tenant ordering is currently available for UK billing
                        addresses only.
                      </p>
                    </div>
                    {field("phoneNumber", "UK phone number (+44)", {
                      placeholder: "20 7946 0000",
                      autoComplete: "tel-national",
                      type: "tel",
                    })}
                  </section>
                  <section
                    className="space-y-4"
                    aria-labelledby="contact-heading"
                  >
                    <h3 id="contact-heading" className="text-sm font-medium">
                      Authorized contact
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Use an email you can access. This contact receives setup
                      updates and is the authorized signer for the Microsoft
                      Customer Agreement.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {field("contactFirstName", "First name", {
                        autoComplete: "given-name",
                      })}
                      {field("contactLastName", "Last name", {
                        autoComplete: "family-name",
                      })}
                    </div>
                    {field("contactEmail", "Contact email", {
                      placeholder: "you@example.com",
                      type: "email",
                      autoComplete: "email",
                    })}
                  </section>
                </>
              ) : (
                <>
                  <div
                    id="tenant-review-summary"
                    tabIndex={-1}
                    aria-label="Order details to review"
                    className="rounded-lg border p-4 space-y-4"
                  >
                    <dl className="text-sm space-y-4">
                      <div>
                        <dt className="text-muted-foreground">
                          Company and domain
                        </dt>
                        <dd className="font-medium break-words">
                          {form.companyName} · {form.businessDomain}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          Full billing address
                        </dt>
                        <dd className="break-words">
                          {[
                            form.addressLine1,
                            form.addressLine2,
                            form.city,
                            form.postalCode,
                            "United Kingdom",
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          Authorized contact
                        </dt>
                        <dd className="break-words">
                          {form.contactFirstName} {form.contactLastName}
                          <br />
                          {form.contactEmail}
                          <br />
                          +44 {form.phoneNumber}
                        </dd>
                      </div>
                    </dl>
                    <div className="border-t pt-4 flex justify-between gap-3 text-sm">
                      <span>
                        1 tenant · 1 Business Basic (no Teams) license
                      </span>
                      <span className="font-semibold whitespace-nowrap">
                        $9.70/month
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Payment starts the setup process. If setup needs attention,
                    use this existing order to get help before making another
                    purchase.
                  </p>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="termsAccepted"
                      checked={form.termsAccepted}
                      onCheckedChange={(v) =>
                        setForm((prior) => ({
                          ...prior,
                          termsAccepted: v === true,
                        }))
                      }
                    />
                    <label
                      htmlFor="termsAccepted"
                      className="text-xs text-muted-foreground leading-relaxed cursor-pointer"
                    >
                      I checked the full billing address and contact details, am
                      authorized to purchase for this company, and accept the
                      Microsoft Customer Agreement and ACA terms of service.
                    </label>
                  </div>
                </>
              )}
            </div>
            <DialogFooter className="shrink-0 gap-2 border-t bg-background pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={createOrder.isPending}
                onClick={() =>
                  step === "review" ? setStep("details") : setDialogOpen(false)
                }
              >
                {step === "review" && <ArrowLeft className="w-4 h-4 mr-2" />}
                {step === "review" ? "Edit details" : "Cancel"}
              </Button>
              <Button
                type="submit"
                variant="cta"
                disabled={
                  createOrder.isPending ||
                  isLoading ||
                  isError ||
                  !!conflict ||
                  (step === "review" && !form.termsAccepted)
                }
              >
                {createOrder.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {createOrder.isPending
                  ? "Opening secure checkout…"
                  : step === "review"
                    ? "Continue to payment · $9.70/month"
                    : "Review order"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

export function M365TenantSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id") ?? "";
  const {
    data: orders = [],
    isError,
    refetch,
  } = useTenantOrders(sessionId || undefined);
  const order = sessionId
    ? orders.find((item) => item.stripe_checkout_session_id === sessionId)
    : undefined;
  const [showRecovery, setShowRecovery] = useState(false);
  const paidFailure = !!order && isPaidTenantFailure(order);
  const failed = order?.status === "failed";
  const active =
    order?.status === "active" &&
    !!(order.pax8_order_id || order.pax8_subscription_id);
  const cancelled = order?.status === "cancelled";
  const paid = !!order?.stripe_subscription_id;
  const Icon =
    isError || failed
      ? AlertTriangle
      : active
        ? CheckCircle2
        : cancelled
          ? XCircle
          : Clock;
  const heading = isError
    ? "We couldn't check your order"
    : paidFailure
      ? "Payment recorded — setup needs attention"
      : failed
        ? "Tenant setup needs attention"
        : active
          ? "Your tenant order is provisioned"
          : cancelled
            ? "This order was cancelled"
            : paid
              ? "Payment recorded — setting up your tenant"
              : "Checking your checkout status";
  const message = isError
    ? "Reload your order status before starting another purchase."
    : paidFailure
      ? `${tenantFailureMessage(order.failure_reason, order.postal_code)} Use your existing paid order to get help. Do not purchase again.`
      : failed
        ? `${tenantFailureMessage(order.failure_reason, order.postal_code)} Check this order's billing before starting another purchase.`
        : active
          ? "Check your contact email for setup information and manage this tenant from your orders."
          : cancelled
            ? "Review this order's billing for payment and cancellation details."
            : paid
              ? "This page updates as setup progresses. If setup fails, you'll see recovery instructions here."
              : "We're waiting for the checkout update. You can safely return to your orders; check there before purchasing again.";
  return (
    <AppLayout
      hideActivationChecklist
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="container max-w-xl py-16">
        <Card>
          <CardContent
            className="py-10 text-center space-y-4"
            aria-live="polite"
          >
            <Icon
              className={`w-12 h-12 mx-auto ${paidFailure || isError ? "text-amber-600" : active ? "text-green-500" : "text-muted-foreground"}`}
            />
            <h2 className="text-xl font-semibold">{heading}</h2>
            <p className="text-sm text-muted-foreground">{message}</p>
            {order && (
              <p className="text-sm font-medium break-words">
                {order.company_name} · {order.business_domain}
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              {isError && (
                <Button variant="outline" onClick={() => refetch()}>
                  Reload status
                </Button>
              )}
              {paidFailure && (
                <Button variant="cta" onClick={() => setShowRecovery(true)}>
                  Complete existing order
                </Button>
              )}
              <Button
                variant={paidFailure ? "outline" : "cta"}
                onClick={() => navigate("/m365-tenants")}
              >
                View my tenant orders
              </Button>
            </div>
          </CardContent>
        </Card>
        <TenantRecoveryDialog
          order={showRecovery && paidFailure ? order! : null}
          onClose={() => setShowRecovery(false)}
        />
      </div>
    </AppLayout>
  );
}

export function M365TenantCancelled() {
  const navigate = useNavigate();
  return (
    <AppLayout
      hideActivationChecklist
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="container max-w-xl py-16">
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <XCircle className="w-12 h-12 mx-auto text-muted-foreground" />
            <h2 className="text-xl font-semibold">Checkout closed</h2>
            <p className="text-sm text-muted-foreground">
              Review your existing orders and billing before starting another
              purchase. You can return to your orders at any time.
            </p>
            <Button variant="cta" onClick={() => navigate("/m365-tenants")}>
              View my tenant orders
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
