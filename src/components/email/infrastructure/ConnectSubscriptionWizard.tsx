import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import {
  useValidateAzureSubscription,
  useConnectAzureSubscription,
} from "@/hooks/useAzureSubscriptions";
import type { AzureTenant } from "@/types/email";

type WizardStep = "subscription" | "validate" | "confirm";

interface ConnectSubscriptionWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: AzureTenant;
}

export function ConnectSubscriptionWizard({
  open,
  onOpenChange,
  tenant,
}: ConnectSubscriptionWizardProps) {
  const [step, setStep] = useState<WizardStep>("subscription");
  const [form, setForm] = useState({
    subscription_id: "",
    display_name: "",
    region: "eastus",
    resource_group: "aca-email-infra",
  });
  const [validationResult, setValidationResult] = useState<{
    subscription?: { id: string; name: string; state: string };
    available_regions?: Array<{ name: string; displayName: string }>;
  } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const validate = useValidateAzureSubscription();
  const connect = useConnectAzureSubscription();

  const resetWizard = () => {
    setStep("subscription");
    setForm({
      subscription_id: "",
      display_name: "",
      region: "eastus",
      resource_group: "aca-email-infra",
    });
    setValidationResult(null);
    setValidationError(null);
    validate.reset();
    connect.reset();
  };

  const handleClose = (open: boolean) => {
    if (!open) resetWizard();
    onOpenChange(open);
  };

  const handleValidate = async () => {
    setValidationError(null);
    setStep("validate");
    try {
      const result = await validate.mutateAsync({
        subscription_id: form.subscription_id.trim(),
        azure_tenant_id: tenant.id,
      });
      setValidationResult(result);
      if (result.subscription?.name) {
        setForm((prev) => ({ ...prev, display_name: result.subscription!.name }));
      }
      setStep("confirm");
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Validation failed");
      setStep("subscription");
    }
  };

  const handleConnect = async () => {
    try {
      await connect.mutateAsync({
        subscription_id: form.subscription_id.trim(),
        azure_tenant_id: tenant.id,
        display_name: form.display_name,
        region: form.region,
        resource_group: form.resource_group,
      });
      handleClose(false);
    } catch {
      // Error handled by mutation
    }
  };

  const canValidate = form.subscription_id.length > 10;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Subscription</DialogTitle>
          <DialogDescription>
            {step === "subscription" && `Add a subscription under tenant "${tenant.display_name || tenant.tenant_id.slice(0, 8) + '...'}".`}
            {step === "validate" && "Validating subscription access..."}
            {step === "confirm" && "Confirm your subscription details."}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Enter Subscription ID */}
        {step === "subscription" && (
          <div className="space-y-4">
            {validationError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="space-y-1">
                <p>After connecting, we'll use this subscription to provision email infrastructure (Communication Services, DNS zones).</p>
                <p className="text-xs text-muted-foreground">
                  Make sure the subscription is active and the required resource providers are registered (see below).
                </p>
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <div>
                <Label htmlFor="subscription_id">Subscription ID</Label>
                <Input
                  id="subscription_id"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={form.subscription_id}
                  onChange={(e) => setForm({ ...form, subscription_id: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Find this in{" "}
                  <a href="https://portal.azure.com/#view/Microsoft_Azure_Billing/SubscriptionsBlade" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                    Azure Portal &rarr; Subscriptions <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                  {" "}&rarr; Overview
                </p>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <h4 className="font-medium">Required resource providers</h4>
              <p className="text-muted-foreground text-xs">
                Open your subscription in{" "}
                <a href="https://portal.azure.com/#view/Microsoft_Azure_Billing/SubscriptionsBlade" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                  Azure Portal <ExternalLink className="w-2.5 h-2.5" />
                </a>
                {" "}&rarr; <strong className="text-foreground">Resource providers</strong> &rarr; search and register each:
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground font-mono text-xs">
                <li>Microsoft.Communication</li>
                <li>Microsoft.EventGrid</li>
                <li>Microsoft.Network</li>
              </ul>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                variant="cta"
                onClick={handleValidate}
                disabled={!canValidate || validate.isPending}
              >
                {validate.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Validate
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Validating */}
        {step === "validate" && (
          <div className="flex flex-col items-center py-8 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Validating subscription access...</p>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === "confirm" && validationResult && (
          <div className="space-y-4">
            <Alert>
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertDescription>
                Successfully verified access to <strong>{validationResult.subscription?.name}</strong>.
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <div>
                <Label htmlFor="display_name">Display Name</Label>
                <Input
                  id="display_name"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="region">Region</Label>
                <Select value={form.region} onValueChange={(v) => setForm({ ...form, region: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(validationResult.available_regions || []).map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {r.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="resource_group">Resource Group</Label>
                <Input
                  id="resource_group"
                  value={form.resource_group}
                  onChange={(e) => setForm({ ...form, resource_group: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  All email infrastructure will be created in this resource group.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("subscription")}>
                Back
              </Button>
              <Button
                variant="cta"
                onClick={handleConnect}
                disabled={connect.isPending}
              >
                {connect.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Add Subscription
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
