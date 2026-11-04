import { useState } from "react";
import { useApiKeys } from "@/hooks/useApiKeys";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Key, AlertCircle, CheckCircle2, Trash2, Clock, AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { AddApiKeyDialog } from "./AddApiKeyDialog";
import { UpdateApiKeyDialog } from "./UpdateApiKeyDialog";
import { useDeleteApiKey } from "@/hooks/useDeleteApiKey";
import { useRecheckApiKey } from "@/hooks/useRecheckApiKey";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Links to API key management pages for each provider
const PROVIDER_API_KEY_URLS: Record<string, string> = {
  apify: "https://console.apify.com/account/integrations",
  openrouter: "https://openrouter.ai/keys",
  ollama: "https://ollama.com/settings/keys",
  alibaba: "https://bailian.console.alibabacloud.com/?apiKey=1",
  openai: "https://platform.openai.com/api-keys",
  replicate: "https://replicate.com/account/api-tokens",
  elevenlabs: "https://elevenlabs.io/app/settings/api-keys",
  youtube: "https://console.cloud.google.com/apis/credentials",
  zapmail: "https://app.zapmail.ai",
  heygen: "https://app.heygen.com/settings/api",
  mailtester_ninja: "https://mailtester.ninja/",
  quickenrich: "https://app.quickenrich.io/docs",
  zernio: "https://zernio.com/dashboard/api-keys",
};

const PROVIDER_LABELS: Record<string, string> = {
  // Content Generation
  openrouter: "OpenRouter (LLM)",
  ollama: "Ollama (LLM)",
  alibaba: "Alibaba Cloud (Qwen LLM)",
  openai: "OpenAI (Multiturn Image)",
  replicate: "Replicate (Video/Image)",
  elevenlabs: "ElevenLabs (Voice)",
  fal: "Fal.ai (Image)",
  // Data & Scraping
  apify: "Apify (Web Scraping)",
  youtube: "YouTube API",
  // CRM & Social
  gohighlevel: "GoHighLevel",
  unipile: "Unipile (Leads)",
  unipile_v2: "Unipile v2",
  zernio: "Zernio (Social Publishing)",
  // Contact Enrichment
  apollo: "Apollo.io (Enrichment)",
  prospeo: "Prospeo (Email Finder)",
  moltsets: "MoltSets (LinkedIn Resolution)",
  quickenrich: "QuickEnrich (Email, Phone & Domain)",
  // Email Infrastructure
  zapmail: "ZapMail (Mailboxes)",
  // Email Verification
  mailtester_ninja: "Mailtester Ninja (Email Verification)",
  // UGC Video
  heygen: "HeyGen (UGC Video)",
};

// Calculate expiration status for API keys
function getExpirationStatus(expiresAt: string | null): {
  isExpired: boolean;
  isExpiringSoon: boolean;
  daysUntilExpiry: number | null;
  message: string | null;
} {
  if (!expiresAt) {
    return { isExpired: false, isExpiringSoon: false, daysUntilExpiry: null, message: null };
  }

  const now = new Date();
  const expiry = new Date(expiresAt);
  const diffMs = expiry.getTime() - now.getTime();
  const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry <= 0) {
    return {
      isExpired: true,
      isExpiringSoon: false,
      daysUntilExpiry: 0,
      message: "This API key has expired and needs to be refreshed.",
    };
  }

  if (daysUntilExpiry <= 14) {
    return {
      isExpired: false,
      isExpiringSoon: true,
      daysUntilExpiry,
      message: `This API key expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}. Please refresh it soon.`,
    };
  }

  return {
    isExpired: false,
    isExpiringSoon: false,
    daysUntilExpiry,
    message: null,
  };
}

function getKeyHealth(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { isBlocked: false, message: null as string | null };
  }
  const values = metadata as Record<string, unknown>;
  return {
    isBlocked: values.health_status === "blocked",
    message: typeof values.last_error === "string" ? values.last_error : null,
  };
}

export function ApiKeysSettings() {
  const { data: apiKeys, isLoading } = useApiKeys();
  const deleteApiKey = useDeleteApiKey();
  const recheckApiKey = useRecheckApiKey();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const handleDelete = () => {
    if (deletingKey) {
      deleteApiKey.mutate(deletingKey, {
        onSuccess: () => setDeletingKey(null),
      });
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading API keys...</div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API Keys
              </CardTitle>
              <CardDescription>
                Your keys, your rates. Every provider bills you directly at their price -
                we never resell tokens, credits or lookups at a markup, and there is no
                per-lead or per-message fee on top.
              </CardDescription>
            </div>
            <Button variant="cta" onClick={() => setShowAddDialog(true)} className="font-medium shadow-lg">
              <Plus className="h-4 w-4 mr-2" />
              Add API Key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!apiKeys || apiKeys.length === 0 ? (
            <div className="text-center py-12 max-w-xl mx-auto">
              <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Run at cost, not at markup</h3>
              <p className="text-muted-foreground mb-3">
                Most outbound tools resell AI and data as "credits", with the markup baked
                into the price. ACA connects straight to your own provider accounts, so you
                pay for tokens and lookups at cost - whatever the provider charges, and
                nothing on top.
              </p>
              <p className="text-muted-foreground mb-4 text-sm">
                Your keys stay yours. The accounts, the data and the usage history belong
                to you - if you ever leave, you keep all of it.
              </p>
              <Button variant="cta" onClick={() => setShowAddDialog(true)} className="font-medium shadow-lg">
                <Plus className="h-4 w-4 mr-2" />
                Add API Key
              </Button>
            </div>
          ) : (
            <TooltipProvider>
            <div className="space-y-4">
              {apiKeys.map((key) => {
                const expirationStatus = getExpirationStatus(key.expires_at);
                const hasExpirationIssue = expirationStatus.isExpired || expirationStatus.isExpiringSoon;
                const keyHealth = getKeyHealth(key.metadata);
                const hasKeyIssue = keyHealth.isBlocked || !key.is_valid || expirationStatus.isExpired;

                // Determine background color based on validity and expiration
                let bgClass = 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900';
                if (hasKeyIssue) {
                  bgClass = 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900';
                } else if (expirationStatus.isExpiringSoon) {
                  bgClass = 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900';
                }

                return (
                <div
                  key={key.id}
                  className={`flex flex-wrap items-center justify-between gap-3 p-4 border rounded-lg transition-colors ${bgClass}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <h4 className="font-semibold break-words">
                        {PROVIDER_LABELS[key.provider] || key.provider}
                      </h4>
                      {keyHealth.isBlocked ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Blocked
                        </Badge>
                      ) : key.is_valid && !expirationStatus.isExpired ? (
                        <Badge className="gap-1 bg-green-600 hover:bg-green-700 text-white">
                          <CheckCircle2 className="h-3 w-3" />
                          Valid
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {expirationStatus.isExpired ? 'Expired' : 'Invalid'}
                        </Badge>
                      )}
                      {expirationStatus.isExpiringSoon && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3" />
                              Expires in {expirationStatus.daysUntilExpiry}d
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{expirationStatus.message}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {key.capability && (
                        <Badge variant="secondary">{key.capability}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground font-mono">
                      {key.key_hint}
                    </p>
                    {keyHealth.isBlocked && keyHealth.message && (
                      <div className="text-sm mt-2 text-red-600 dark:text-red-400">
                        <p className="break-words">{keyHealth.message}</p>
                        {PROVIDER_API_KEY_URLS[key.provider] && (
                          <a
                            href={PROVIDER_API_KEY_URLS[key.provider]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-1 underline hover:no-underline"
                          >
                            Resolve in {PROVIDER_LABELS[key.provider] || key.provider}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    )}
                    {hasExpirationIssue && expirationStatus.message && (
                      <div className={`text-sm mt-2 ${expirationStatus.isExpired ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        <p className="break-words">{expirationStatus.message}</p>
                        {PROVIDER_API_KEY_URLS[key.provider] && (
                          <a
                            href={PROVIDER_API_KEY_URLS[key.provider]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-1 underline hover:no-underline"
                          >
                            Get a new API key
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {keyHealth.isBlocked && key.provider === 'openrouter' && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={recheckApiKey.isPending}
                        onClick={() => recheckApiKey.mutate(key.id)}
                      >
                        <RefreshCw className={`h-4 w-4 mr-2 ${recheckApiKey.isPending ? 'animate-spin' : ''}`} />
                        Recheck
                      </Button>
                    )}
                    <Button
                      variant={hasKeyIssue || hasExpirationIssue ? "cta" : "outline"}
                      size="sm"
                      onClick={() => setEditingKey(key.id)}
                    >
                      {hasKeyIssue || hasExpirationIssue ? 'Resolve Key' : 'Update'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeletingKey(key.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );})}
            </div>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      <AddApiKeyDialog open={showAddDialog} onOpenChange={setShowAddDialog} />

      {editingKey && (
        <UpdateApiKeyDialog
          apiKeyId={editingKey}
          open={!!editingKey}
          onOpenChange={(open) => !open && setEditingKey(null)}
        />
      )}

      <AlertDialog open={!!deletingKey} onOpenChange={(open) => !open && setDeletingKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this API key? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
