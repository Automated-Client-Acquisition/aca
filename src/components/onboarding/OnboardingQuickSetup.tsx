import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  Video,
  Cloud,
  ExternalLink,
  Check,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { useTestApiKey } from "@/hooks/useTestApiKey";
import { useAddApiKey } from "@/hooks/useAddApiKey";
import { useAddStorageCredentials } from "@/hooks/useAddStorageCredentials";
import { useSetupStatus } from "@/hooks/useSetupStatus";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type StorageProvider = "cloudflare_r2" | "aws_s3" | "backblaze_b2";

interface OnboardingQuickSetupProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function OnboardingQuickSetup({
  onNext,
  onBack,
  onSkip,
}: OnboardingQuickSetupProps) {
  const setupStatus = useSetupStatus();

  // OpenRouter state
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [openRouterValid, setOpenRouterValid] = useState(false);

  // Replicate state
  const [replicateKey, setReplicateKey] = useState("");
  const [replicateValid, setReplicateValid] = useState(false);

  // Storage state
  const [storageProvider, setStorageProvider] =
    useState<StorageProvider>("cloudflare_r2");
  const [storageCredentials, setStorageCredentials] = useState<
    Record<string, string>
  >({});
  const [storageValid, setStorageValid] = useState(false);
  const [showStorageGuide, setShowStorageGuide] = useState(true);

  // Hooks
  const testApiKey = useTestApiKey();
  const addApiKey = useAddApiKey();
  const addStorage = useAddStorageCredentials();

  // Expanded sections
  const [expandedSection, setExpandedSection] = useState<
    "openrouter" | "replicate" | "storage" | null
  >("openrouter");

  const handleTestOpenRouter = async () => {
    const result = await testApiKey.mutateAsync({
      provider: "openrouter",
      apiKey: openRouterKey,
    });

    if (result?.valid) {
      setOpenRouterValid(true);
      await addApiKey.mutateAsync({
        provider: "openrouter",
        apiKey: openRouterKey,
      });
      // Auto-expand next section
      setExpandedSection("replicate");
    }
  };

  const handleTestReplicate = async () => {
    const result = await testApiKey.mutateAsync({
      provider: "replicate",
      apiKey: replicateKey,
    });

    if (result?.valid) {
      setReplicateValid(true);
      await addApiKey.mutateAsync({
        provider: "replicate",
        apiKey: replicateKey,
      });
      // Auto-expand next section
      setExpandedSection("storage");
    }
  };

  const handleTestStorage = async () => {
    try {
      // addStorage validates, encrypts, and saves in one step
      await addStorage.mutateAsync({
        provider: storageProvider,
        credentials: storageCredentials,
      });
      setStorageValid(true);
    } catch (error) {
      // Error is already handled by the hook's onError
    }
  };

  const getStorageFields = () => {
    switch (storageProvider) {
      case "cloudflare_r2":
        return [
          {
            key: "accountId",
            label: "Account ID",
            placeholder: "Your Cloudflare account ID",
          },
          {
            key: "accessKeyId",
            label: "Access Key ID",
            placeholder: "Your R2 access key",
          },
          {
            key: "secretAccessKey",
            label: "Secret Access Key",
            placeholder: "Your R2 secret key",
            type: "password",
          },
          {
            key: "bucketName",
            label: "Bucket Name",
            placeholder: "your-bucket-name",
          },
          {
            key: "publicUrl",
            label: "Public URL",
            placeholder: "https://pub-xxx.r2.dev",
            description: "Your R2 public bucket URL (enable Public Access in bucket settings)",
          },
        ];
      case "aws_s3":
        return [
          { key: "region", label: "Region", placeholder: "us-east-1" },
          {
            key: "accessKeyId",
            label: "Access Key ID",
            placeholder: "Your AWS access key",
          },
          {
            key: "secretAccessKey",
            label: "Secret Access Key",
            placeholder: "Your AWS secret key",
            type: "password",
          },
          {
            key: "bucketName",
            label: "Bucket Name",
            placeholder: "your-bucket-name",
          },
        ];
      case "backblaze_b2":
        return [
          {
            key: "keyId",
            label: "Key ID",
            placeholder: "Your B2 key ID",
          },
          {
            key: "applicationKey",
            label: "Application Key",
            placeholder: "Your B2 application key",
            type: "password",
          },
          {
            key: "bucketName",
            label: "Bucket Name",
            placeholder: "your-bucket-name",
          },
          {
            key: "bucketId",
            label: "Bucket ID",
            placeholder: "Your B2 bucket ID",
          },
          {
            key: "endpoint",
            label: "S3 Endpoint",
            placeholder: "https://s3.us-west-001.backblazeb2.com",
            description: "Your B2 S3-compatible endpoint URL (found in bucket details)",
          },
        ];
      default:
        return [];
    }
  };

  const allValid =
    (openRouterValid || setupStatus.hasOpenRouter) &&
    (replicateValid || setupStatus.hasReplicate) &&
    (storageValid || setupStatus.hasStorage);

  const completedCount = [
    openRouterValid || setupStatus.hasOpenRouter,
    replicateValid || setupStatus.hasReplicate,
    storageValid || setupStatus.hasStorage,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] px-8 py-8">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 rounded-xl bg-primary/10">
              <Sparkles className="h-10 w-10 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">Bring Your Own Keys</h2>
            <p className="text-muted-foreground">
              Your keys, your rates. This is why you never pay per credit and
              nothing here is metered. You can also skip and explore first.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Badge
              variant={completedCount === 3 ? "default" : "secondary"}
              className="text-sm"
            >
              {completedCount}/3 connected
            </Badge>
          </div>
        </div>

        {/* Setup Cards */}
        <div className="space-y-3">
          {/* OpenRouter */}
          <Card
            className={cn(
              "transition-all",
              (openRouterValid || setupStatus.hasOpenRouter) &&
                "border-green-500/50 bg-green-500/5"
            )}
          >
            <Collapsible
              open={expandedSection === "openrouter"}
              onOpenChange={(open) =>
                setExpandedSection(open ? "openrouter" : null)
              }
            >
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-accent/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Brain className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">OpenRouter</span>
                        <Badge variant="outline" className="text-xs">
                          Required
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Text generation & idea analysis
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {openRouterValid || setupStatus.hasOpenRouter ? (
                      <Check className="h-5 w-5 text-green-500" />
                    ) : expandedSection === "openrouter" ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-4">
                  {/* Helper info */}
                  <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-primary">OpenRouter</a> is a unified API gateway for accessing 100+ AI models from various providers.
                    </p>
                    <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
                      <li>Create an account at <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">openrouter.ai</a></li>
                      <li>Go to <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Keys</a> in the dashboard</li>
                      <li>Click <span className="font-medium">Create Key</span> and copy it</li>
                      <li>Add <a href="https://openrouter.ai/credits" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">credits</a> to your account</li>
                    </ol>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="openrouter-key">API Key</Label>
                    <Input
                      id="openrouter-key"
                      type="password"
                      placeholder="sk-or-v1-..."
                      value={openRouterKey}
                      onChange={(e) => setOpenRouterKey(e.target.value)}
                      disabled={openRouterValid || setupStatus.hasOpenRouter}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open("https://openrouter.ai/keys", "_blank")
                      }
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Get API Key
                    </Button>
                    {openRouterKey &&
                      !openRouterValid &&
                      !setupStatus.hasOpenRouter && (
                        <Button
                          size="sm"
                          onClick={handleTestOpenRouter}
                          disabled={testApiKey.isPending}
                        >
                          {testApiKey.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : null}
                          Test & Save
                        </Button>
                      )}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Replicate */}
          <Card
            className={cn(
              "transition-all",
              (replicateValid || setupStatus.hasReplicate) &&
                "border-green-500/50 bg-green-500/5"
            )}
          >
            <Collapsible
              open={expandedSection === "replicate"}
              onOpenChange={(open) =>
                setExpandedSection(open ? "replicate" : null)
              }
            >
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-accent/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Video className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Replicate</span>
                        <Badge variant="outline" className="text-xs">
                          Required
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Image & video generation
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {replicateValid || setupStatus.hasReplicate ? (
                      <Check className="h-5 w-5 text-green-500" />
                    ) : expandedSection === "replicate" ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-4">
                  {/* Helper info */}
                  <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      <a href="https://replicate.com" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-primary">Replicate</a> is a platform for running AI image and video generation models.
                    </p>
                    <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
                      <li>Sign up with GitHub at <a href="https://replicate.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">replicate.com</a></li>
                      <li>Go to <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Account → API tokens</a></li>
                      <li>Create a token and copy it</li>
                      <li>Add <a href="https://replicate.com/account/billing" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">billing</a> to your account</li>
                    </ol>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="replicate-key">API Token</Label>
                    <Input
                      id="replicate-key"
                      type="password"
                      placeholder="r8_..."
                      value={replicateKey}
                      onChange={(e) => setReplicateKey(e.target.value)}
                      disabled={replicateValid || setupStatus.hasReplicate}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(
                          "https://replicate.com/account/api-tokens",
                          "_blank"
                        )
                      }
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Get API Token
                    </Button>
                    {replicateKey &&
                      !replicateValid &&
                      !setupStatus.hasReplicate && (
                        <Button
                          size="sm"
                          onClick={handleTestReplicate}
                          disabled={testApiKey.isPending}
                        >
                          {testApiKey.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : null}
                          Test & Save
                        </Button>
                      )}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Storage */}
          <Card
            className={cn(
              "transition-all",
              (storageValid || setupStatus.hasStorage) &&
                "border-green-500/50 bg-green-500/5"
            )}
          >
            <Collapsible
              open={expandedSection === "storage"}
              onOpenChange={(open) =>
                setExpandedSection(open ? "storage" : null)
              }
            >
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-accent/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Cloud className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Cloud Storage</span>
                        <Badge variant="outline" className="text-xs">
                          Required
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Store your generated content
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {storageValid || setupStatus.hasStorage ? (
                      <Check className="h-5 w-5 text-green-500" />
                    ) : expandedSection === "storage" ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-4">
                  {/* Helper info */}
                  <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Cloud Storage</span> is where your generated images and videos are saved. We recommend Cloudflare R2 for its free egress and simple setup.
                    </p>
                  </div>

                  {/* Provider Selection */}
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        {
                          id: "cloudflare_r2",
                          name: "Cloudflare R2",
                          badge: "Recommended",
                        },
                        { id: "aws_s3", name: "AWS S3" },
                        { id: "backblaze_b2", name: "Backblaze B2" },
                      ] as const
                    ).map((provider) => (
                      <button
                        key={provider.id}
                        onClick={() => setStorageProvider(provider.id)}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-all",
                          storageProvider === provider.id
                            ? "border-primary bg-accent"
                            : "hover:border-primary/50"
                        )}
                        disabled={storageValid || setupStatus.hasStorage}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {provider.name}
                          </span>
                          {provider.badge && (
                            <Badge variant="secondary" className="text-xs">
                              {provider.badge}
                            </Badge>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Setup Guide Toggle */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowStorageGuide(!showStorageGuide)}
                  >
                    {showStorageGuide ? "Hide" : "Show"} setup guide
                    {showStorageGuide ? (
                      <ChevronUp className="h-4 w-4 ml-2" />
                    ) : (
                      <ChevronDown className="h-4 w-4 ml-2" />
                    )}
                  </Button>

                  {showStorageGuide && (
                    <Card className="p-3 bg-muted text-sm text-muted-foreground space-y-3">
                      {storageProvider === "cloudflare_r2" && (
                        <ol className="list-decimal list-inside space-y-1.5">
                          <li>Go to <a href="https://dash.cloudflare.com/?to=/:account/r2/overview" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Cloudflare R2 Dashboard</a></li>
                          <li>Click <span className="font-medium">"Create bucket"</span> and name it (e.g., "content-studio")</li>
                          <li>Go to <span className="font-medium">"Manage R2 API Tokens"</span> in the sidebar</li>
                          <li>Click <span className="font-medium">"Create API Token"</span> with Object Read & Write permissions</li>
                          <li>Copy your <span className="font-medium">Account ID</span> (shown in the sidebar)</li>
                          <li>Copy the <span className="font-medium">Access Key ID</span> and <span className="font-medium">Secret Access Key</span> from the token</li>
                        </ol>
                      )}
                      {storageProvider === "aws_s3" && (
                        <ol className="list-decimal list-inside space-y-1.5">
                          <li>Go to <a href="https://s3.console.aws.amazon.com/s3/buckets" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">AWS S3 Console</a></li>
                          <li>Click <span className="font-medium">"Create bucket"</span> and choose a region</li>
                          <li>Go to <a href="https://console.aws.amazon.com/iam/home#/security_credentials" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">IAM Security Credentials</a></li>
                          <li>Create an <span className="font-medium">Access Key</span> for programmatic access</li>
                          <li>Copy the <span className="font-medium">Access Key ID</span> and <span className="font-medium">Secret Access Key</span></li>
                        </ol>
                      )}
                      {storageProvider === "backblaze_b2" && (
                        <ol className="list-decimal list-inside space-y-1.5">
                          <li>Go to <a href="https://secure.backblaze.com/b2_buckets.htm" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Backblaze B2 Buckets</a></li>
                          <li>Click <span className="font-medium">"Create a Bucket"</span> (set to Public or Private)</li>
                          <li>Note down the <span className="font-medium">Bucket ID</span> and <span className="font-medium">Endpoint</span></li>
                          <li>Go to <a href="https://secure.backblaze.com/app_keys.htm" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">App Keys</a> and create a new key</li>
                          <li>Copy the <span className="font-medium">keyID</span> and <span className="font-medium">applicationKey</span></li>
                        </ol>
                      )}
                    </Card>
                  )}

                  {/* Credential Fields */}
                  {!storageValid && !setupStatus.hasStorage && (
                    <>
                      <div className="space-y-3">
                        {getStorageFields().map((field) => (
                          <div key={field.key} className="space-y-1">
                            <Label htmlFor={field.key} className="text-sm">
                              {field.label}
                            </Label>
                            <Input
                              id={field.key}
                              type={field.type || "text"}
                              placeholder={field.placeholder}
                              value={storageCredentials[field.key] || ""}
                              onChange={(e) =>
                                setStorageCredentials({
                                  ...storageCredentials,
                                  [field.key]: e.target.value,
                                })
                              }
                            />
                            {field.description && (
                              <p className="text-xs text-muted-foreground">
                                {field.description}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      {Object.keys(storageCredentials).length ===
                        getStorageFields().length &&
                        Object.values(storageCredentials).every((v) => v) && (
                          <Button
                            size="sm"
                            onClick={handleTestStorage}
                            disabled={addStorage.isPending}
                            className="w-full"
                          >
                            {addStorage.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : null}
                            Test & Save Connection
                          </Button>
                        )}
                    </>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSkip}>
              Skip for now
            </Button>
            <Button onClick={onNext} disabled={!allValid}>
              {allValid ? "Continue" : `Complete setup (${completedCount}/3)`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
