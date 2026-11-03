import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMcpApiKeys } from "@/hooks/useMcpApiKeys";
import { useAuth } from "@/contexts/AuthContext";
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
import { Badge } from "@/components/ui/badge";
import { Copy, Check, AlertTriangle, Building2 } from "lucide-react";
import { toast } from "sonner";
import { MCP_SERVER_URL } from "@/config/site";


const createKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  expiresIn: z.enum(["never", "30d", "90d", "1y"]).default("never"),
  targetOrganizationId: z.string().optional(),
});

type CreateKeyFormData = z.infer<typeof createKeySchema>;

interface CreateMcpApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateMcpApiKeyDialog({ open, onOpenChange }: CreateMcpApiKeyDialogProps) {
  const { createKey, isCreating } = useMcpApiKeys();
  const { isAgency, accessibleOrganizations, currentOrganization } = useAuth();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<CreateKeyFormData>({
    resolver: zodResolver(createKeySchema),
    defaultValues: {
      name: "",
      expiresIn: "never",
      targetOrganizationId: undefined,
    },
  });

  const calculateExpiry = (expiresIn: string): Date | null => {
    const now = new Date();
    switch (expiresIn) {
      case "30d":
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      case "90d":
        return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      case "1y":
        return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      default:
        return null;
    }
  };

  const onSubmit = async (data: CreateKeyFormData) => {
    try {
      const result = await createKey({
        name: data.name,
        permissions: ["admin:*"], // Full access for now
        expiresAt: calculateExpiry(data.expiresIn),
        targetOrganizationId: data.targetOrganizationId || null,
      });
      setCreatedKey(result.fullKey);
    } catch (error) {
      // Error handled by hook
    }
  };

  const handleCopy = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      toast.success("API key copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = (openState: boolean) => {
    if (!openState) {
      // Reset state when closing
      setCreatedKey(null);
      setCopied(false);
      form.reset();
    }
    onOpenChange(openState);
  };

  // Get client organizations for agency users
  const clientOrgs = accessibleOrganizations?.filter(
    (org) => org.id !== currentOrganization?.id
  ) || [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {createdKey ? "API Key Created" : "Create MCP API Key"}
          </DialogTitle>
          <DialogDescription>
            {createdKey
              ? "Copy your API key now. You won't be able to see it again!"
              : "Create a new API key for Claude Desktop or other MCP clients"
            }
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="space-y-4 overflow-hidden">
            {/* Warning */}
            <div className="flex items-start gap-3 p-4 rounded-lg bg-status-warning/10 border border-status-warning/30">
              <AlertTriangle className="h-5 w-5 text-status-warning shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-status-warning">
                  Save your API key now
                </p>
                <p className="text-xs text-status-warning/80">
                  For security reasons, we only show you the full key once. Copy it now and store it securely.
                </p>
              </div>
            </div>

            {/* Key Display */}
            <div className="relative">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted font-mono text-sm break-all">
                <code className="flex-1">{createdKey}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Claude Cloud URL */}
            <div className="space-y-2">
              <p className="text-sm font-medium">For Claude Cloud (claude.ai):</p>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted">
                <code className="flex-1 text-xs break-all">
                  {MCP_SERVER_URL}?api_key={createdKey}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(`${MCP_SERVER_URL}?api_key=${createdKey}`);
                    toast.success("URL copied to clipboard");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Claude Desktop Config */}
            <details className="text-sm">
              <summary className="font-medium cursor-pointer text-muted-foreground hover:text-foreground">
                For Claude Desktop (config file)
              </summary>
              <div className="mt-2 relative rounded-lg bg-muted">
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-1.5 right-1.5 z-10 bg-muted hover:bg-muted/80"
                  onClick={() => {
                    const config = JSON.stringify({
                      mcpServers: {
                        aca: {
                          url: MCP_SERVER_URL,
                          transport: "streamable-http",
                          headers: {
                            Authorization: `Bearer ${createdKey}`
                          }
                        }
                      }
                    }, null, 2);
                    navigator.clipboard.writeText(config);
                    toast.success("Config copied to clipboard");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <div className="overflow-auto max-h-64">
                  <pre className="text-xs p-3 pr-12 min-w-0">
                    <code className="whitespace-pre block">{`{
  "mcpServers": {
    "aca": {
      "url": "${MCP_SERVER_URL}",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer ${createdKey}"
      }
    }
  }
}`}</code>
                  </pre>
                </div>
              </div>
            </details>

            <div className="flex justify-end pt-2">
              <Button variant="cta" onClick={() => handleClose(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Key Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Claude Desktop, My MacBook"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      A friendly name to identify this key
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="expiresIn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expiration</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select expiration" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="never">Never expires</SelectItem>
                        <SelectItem value="30d">30 days</SelectItem>
                        <SelectItem value="90d">90 days</SelectItem>
                        <SelectItem value="1y">1 year</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      When should this key expire?
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Agency: Target Organization Selection */}
              {isAgency && clientOrgs.length > 0 && (
                <FormField
                  control={form.control}
                  name="targetOrganizationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Target Organization
                        <Badge variant="secondary" className="ml-1">Agency</Badge>
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Use for your own organization" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">Your organization ({currentOrganization?.name})</SelectItem>
                          {clientOrgs.map((org) => (
                            <SelectItem key={org.id} value={org.id}>
                              {org.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Create a key that operates on a specific client's data
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Permissions Info */}
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Permissions:</span> This key will have full access to manage ideas, tags, brand voices, products, prompts, and blueprints.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleClose(false)}
                >
                  Cancel
                </Button>
                <Button variant="cta" type="submit" disabled={isCreating}>
                  {isCreating ? "Creating..." : "Create API Key"}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
