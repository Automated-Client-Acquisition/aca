import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUpdateApiKey } from "@/hooks/useUpdateApiKey";
import { useApiKeys } from "@/hooks/useApiKeys";

interface UpdateApiKeyDialogProps {
  apiKeyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PLAN_OPTIONS: Record<string, { value: string; label: string }[]> = {
  mailtester_ninja: [
    { value: "starter", label: "Starter — 50k/day ($6.99/wk)" },
    { value: "pro", label: "Pro — 100k/day, 11 / 10s ($16.99/mo)" },
    { value: "ultimate", label: "Ultimate — 500k/day, 57 / 10s ($49.99/mo)" },
  ],
  moltsets: [
    { value: "tier_27", label: "$27/mo — 30 req/min, 1,000/day" },
    { value: "tier_97", label: "$97/mo — 1,000 req/min, 15,000/day" },
    { value: "tier_997", label: "$997/mo — 5,000 req/min, 100,000/day" },
  ],
  quickenrich: [
    { value: "standard", label: "Standard — 1000 req/min (300 domain, 120 finder)" },
    { value: "gtm_unlimited", label: "GTM Unlimited — 6000 req/min on all endpoints" },
  ],
};

const updateSchema = z.object({
  apiKey: z.string().min(10, "API key is too short").optional().or(z.literal("")),
  plan: z.string().optional(),
});

type UpdateFormData = z.infer<typeof updateSchema>;

export function UpdateApiKeyDialog({
  apiKeyId,
  open,
  onOpenChange,
}: UpdateApiKeyDialogProps) {
  const { data: apiKeys } = useApiKeys();
  const updateApiKey = useUpdateApiKey();
  const currentKey = apiKeys?.find((k) => k.id === apiKeyId);
  const planOptions = currentKey ? PLAN_OPTIONS[currentKey.provider] : undefined;
  const currentPlan =
    currentKey?.metadata && typeof currentKey.metadata === "object" && !Array.isArray(currentKey.metadata)
      ? (currentKey.metadata as Record<string, unknown>).plan
      : undefined;

  const form = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      apiKey: "",
      plan: typeof currentPlan === "string" ? currentPlan : undefined,
    },
  });

  // Re-sync the plan default once the key (and its current plan) loads
  useEffect(() => {
    if (open && typeof currentPlan === "string") {
      form.setValue("plan", currentPlan);
    }
  }, [open, currentPlan, form]);

  const onSubmit = async (data: UpdateFormData) => {
    if (!currentKey) return;

    if (!data.apiKey && (!planOptions || data.plan === currentPlan)) return;

    await updateApiKey.mutateAsync({
      id: apiKeyId,
      apiKey: data.apiKey || undefined,
      provider: currentKey.provider,
      plan: planOptions
        ? (data.plan as 'starter' | 'growth' | 'pro' | 'ultimate' | 'tier_27' | 'tier_97' | 'tier_997' | 'standard' | 'gtm_unlimited' | undefined)
        : undefined,
    });
    form.reset();
    onOpenChange(false);
  };

  if (!currentKey) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update API Key</DialogTitle>
          <DialogDescription>
            Update your {currentKey.provider} API key
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New API Key {planOptions ? "(Optional)" : ""}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Enter your new API key"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {planOptions
                      ? "Leave blank to keep the current key and only change the plan below"
                      : "Your key will be validated and encrypted"}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {planOptions && (
              <FormField
                control={form.control}
                name="plan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plan</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your plan" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {planOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Updates take effect on the next run — we pace requests to this plan's rate cap.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button variant="cta" type="submit" disabled={updateApiKey.isPending}>
                {updateApiKey.isPending ? "Updating..." : "Update API Key"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
