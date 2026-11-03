import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { storageCredentialsSchema, type StorageCredentialsFormData } from "@/lib/validations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAddStorageCredentials } from "@/hooks/useAddStorageCredentials";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, AlertCircle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AddStorageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function HelpLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function AddStorageDialog({ open, onOpenChange }: AddStorageDialogProps) {
  const addStorage = useAddStorageCredentials();
  const [provider, setProvider] = useState<"cloudflare_r2" | "aws_s3" | "backblaze_b2">("cloudflare_r2");
  const [error, setError] = useState<string | null>(null);

  const form = useForm<StorageCredentialsFormData>({
    resolver: zodResolver(storageCredentialsSchema),
    defaultValues: {
      provider: "cloudflare_r2",
    },
  });

  const onSubmit = async (data: StorageCredentialsFormData) => {
    setError(null);
    try {
      const { provider, ...credentials } = data;
      await addStorage.mutateAsync({ provider, credentials });
      form.reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add storage credentials');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add Storage Credentials</DialogTitle>
          <DialogDescription>
            Configure your cloud storage for storing generated content. Your credentials are encrypted before storage.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[calc(90vh-120px)] px-6">
          <Tabs value={provider} onValueChange={(v: any) => {
          setProvider(v);
          form.setValue("provider", v);
          setError(null);
        }}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="cloudflare_r2">Cloudflare R2</TabsTrigger>
            <TabsTrigger value="aws_s3">AWS S3</TabsTrigger>
            <TabsTrigger value="backblaze_b2">Backblaze B2</TabsTrigger>
          </TabsList>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
              <TabsContent value="cloudflare_r2" className="space-y-4">
                <div className="text-sm text-muted-foreground pb-2 border-b">
                  <HelpLink href="https://dash.cloudflare.com/?to=/:account/r2/api-tokens">
                    Create R2 API Token in Cloudflare Dashboard
                  </HelpLink>
                </div>

                <FormField
                  control={form.control}
                  name="accountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account ID</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., a1b2c3d4e5f6..." {...field} />
                      </FormControl>
                      <FormDescription>
                        Found in the Cloudflare dashboard URL or R2 overview page
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accessKeyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Access Key ID</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., abc123..." {...field} />
                      </FormControl>
                      <FormDescription>
                        From your R2 API token - "Access Key ID" field
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="secretAccessKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secret Access Key</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Your R2 secret key" {...field} />
                      </FormControl>
                      <FormDescription>
                        From your R2 API token - "Secret Access Key" field (only shown once when created)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bucketName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bucket Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., my-content-bucket" {...field} />
                      </FormControl>
                      <FormDescription>
                        The name of your R2 bucket (must already exist)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="publicUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Public URL</FormLabel>
                      <FormControl>
                        <Input placeholder="https://pub-xxx.r2.dev" {...field} />
                      </FormControl>
                      <FormDescription>
                        Your R2 public bucket URL. Enable "Public Access" in bucket settings, then copy the URL.{" "}
                        <HelpLink href="https://developers.cloudflare.com/r2/buckets/public-buckets/">
                          How to enable public access
                        </HelpLink>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Alert className="border-amber-500/30 bg-amber-500/5">
                  <Info className="h-4 w-4 text-amber-500" />
                  <AlertDescription className="text-xs">
                    <strong>CORS setup required.</strong> In your R2 bucket settings, add a CORS policy allowing{" "}
                    <code className="text-[11px] bg-muted px-1 rounded">{window.location.origin}</code>{" "}
                    as an allowed origin with <code className="text-[11px] bg-muted px-1 rounded">PUT</code> and{" "}
                    <code className="text-[11px] bg-muted px-1 rounded">GET</code> methods. Without this, file uploads will fail.{" "}
                    <HelpLink href="https://developers.cloudflare.com/r2/buckets/cors/">
                      R2 CORS docs
                    </HelpLink>
                  </AlertDescription>
                </Alert>
              </TabsContent>

              <TabsContent value="aws_s3" className="space-y-4">
                <div className="text-sm text-muted-foreground pb-2 border-b">
                  <HelpLink href="https://console.aws.amazon.com/iam/home#/security_credentials">
                    Create Access Keys in AWS IAM Console
                  </HelpLink>
                </div>

                <FormField
                  control={form.control}
                  name="accessKeyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Access Key ID</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., AKIAIOSFODNN7EXAMPLE" {...field} />
                      </FormControl>
                      <FormDescription>
                        Your AWS IAM access key ID (starts with AKIA...)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="secretAccessKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secret Access Key</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Your AWS secret key" {...field} />
                      </FormControl>
                      <FormDescription>
                        Your AWS IAM secret access key (only shown once when created)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Region</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., us-east-1" {...field} />
                      </FormControl>
                      <FormDescription>
                        The AWS region where your bucket is located (e.g., us-east-1, eu-west-1)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bucketName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bucket Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., my-content-bucket" {...field} />
                      </FormControl>
                      <FormDescription>
                        The name of your S3 bucket (must already exist with public read access)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Alert className="border-amber-500/30 bg-amber-500/5">
                  <Info className="h-4 w-4 text-amber-500" />
                  <AlertDescription className="text-xs">
                    <strong>CORS setup required.</strong> In your S3 bucket permissions, add a CORS configuration allowing{" "}
                    <code className="text-[11px] bg-muted px-1 rounded">{window.location.origin}</code>{" "}
                    as an allowed origin with <code className="text-[11px] bg-muted px-1 rounded">PUT</code> and{" "}
                    <code className="text-[11px] bg-muted px-1 rounded">GET</code> methods. Without this, file uploads will fail.{" "}
                    <HelpLink href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/enabling-cors-examples.html">
                      S3 CORS docs
                    </HelpLink>
                  </AlertDescription>
                </Alert>
              </TabsContent>

              <TabsContent value="backblaze_b2" className="space-y-4">
                <div className="text-sm text-muted-foreground pb-2 border-b">
                  <HelpLink href="https://secure.backblaze.com/app_keys.htm">
                    Create Application Keys in Backblaze B2
                  </HelpLink>
                </div>

                <FormField
                  control={form.control}
                  name="keyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Key ID</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 0012345678abcdef..." {...field} />
                      </FormControl>
                      <FormDescription>
                        Your B2 application key ID (keyID field)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="applicationKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Application Key</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Your B2 application key" {...field} />
                      </FormControl>
                      <FormDescription>
                        Your B2 application key (only shown once when created)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bucketName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bucket Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., my-content-bucket" {...field} />
                      </FormControl>
                      <FormDescription>
                        The name of your B2 bucket (must be set to "Public")
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bucketId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bucket ID</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 4a48fe8875c6214145260818" {...field} />
                      </FormControl>
                      <FormDescription>
                        Found in bucket settings - different from bucket name
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endpoint"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>S3 Endpoint</FormLabel>
                      <FormControl>
                        <Input placeholder="https://s3.us-west-001.backblazeb2.com" {...field} />
                      </FormControl>
                      <FormDescription>
                        Your B2 S3-compatible endpoint URL (found in bucket details under "Endpoint")
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Alert className="border-amber-500/30 bg-amber-500/5">
                  <Info className="h-4 w-4 text-amber-500" />
                  <AlertDescription className="text-xs">
                    <strong>CORS setup required.</strong> In your B2 bucket settings, add a CORS rule allowing{" "}
                    <code className="text-[11px] bg-muted px-1 rounded">{window.location.origin}</code>{" "}
                    as an allowed origin with <code className="text-[11px] bg-muted px-1 rounded">PUT</code> and{" "}
                    <code className="text-[11px] bg-muted px-1 rounded">GET</code> methods. Without this, file uploads will fail.{" "}
                    <HelpLink href="https://www.backblaze.com/docs/cloud-storage-cross-origin-resource-sharing-cors">
                      B2 CORS docs
                    </HelpLink>
                  </AlertDescription>
                </Alert>
              </TabsContent>

              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button variant="cta" type="submit" disabled={addStorage.isPending}>
                  {addStorage.isPending ? "Adding..." : "Add Storage"}
                </Button>
              </div>
            </form>
          </Form>
        </Tabs>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
