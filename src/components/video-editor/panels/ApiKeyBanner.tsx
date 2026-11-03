import { useState } from "react";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useAddApiKey } from "@/hooks/useAddApiKey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Key, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Keys required for full video editor AI functionality
const REQUIRED_KEYS = [
  {
    provider: "openrouter",
    label: "OpenRouter",
    description: "AI chat & video generation",
    required: true,
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    provider: "replicate",
    label: "Replicate",
    description: "AI image generation (Flux)",
    required: false,
    docsUrl: "https://replicate.com/account/api-tokens",
  },
  {
    provider: "pixabay",
    label: "Pixabay",
    description: "Background music (free)",
    required: false,
    docsUrl: "https://pixabay.com/api/docs/",
  },
  {
    provider: "elevenlabs",
    label: "ElevenLabs",
    description: "AI voiceover generation",
    required: false,
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
];

interface InlineAddKeyProps {
  provider: string;
  label: string;
  docsUrl: string;
  onClose: () => void;
  onSuccess: () => void;
}

function InlineAddKey({ provider, label, docsUrl, onClose, onSuccess }: InlineAddKeyProps) {
  const [value, setValue] = useState("");
  const addApiKey = useAddApiKey();

  const handleSave = async () => {
    if (!value.trim()) return;
    await addApiKey.mutateAsync({ provider, apiKey: value.trim(), capability: "", dsnUrl: "" });
    onSuccess();
  };

  return (
    <div className="mt-1.5 flex flex-col gap-1.5 p-2 rounded-md bg-muted/50 border border-border">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-foreground">Add {label} key</span>
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[9px] text-primary flex items-center gap-0.5 hover:underline"
        >
          Get key <ExternalLink className="h-2 w-2" />
        </a>
      </div>
      <div className="flex gap-1">
        <Input
          type="password"
          placeholder="Paste API key..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 text-xs flex-1"
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          autoFocus
        />
        <Button
          size="sm"
          variant="cta"
          className="h-7 px-2 text-xs"
          onClick={handleSave}
          disabled={!value.trim() || addApiKey.isPending}
        >
          {addApiKey.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function ApiKeyBanner() {
  const { data: apiKeys = [], refetch } = useApiKeys();
  const [expanded, setExpanded] = useState(false);
  const [addingProvider, setAddingProvider] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const configuredProviders = new Set(apiKeys.map((k: any) => k.provider));

  const missingRequired = REQUIRED_KEYS.filter(
    (k) => k.required && !configuredProviders.has(k.provider)
  );
  const missingOptional = REQUIRED_KEYS.filter(
    (k) => !k.required && !configuredProviders.has(k.provider)
  );
  const allConfigured = missingRequired.length === 0 && missingOptional.length === 0;

  if (dismissed || allConfigured) return null;

  const hasBlocker = missingRequired.length > 0;

  return (
    <div
      className={cn(
        "mx-2.5 mt-2 rounded-lg border text-[10px] overflow-hidden",
        hasBlocker
          ? "border-destructive/30 bg-destructive/5"
          : "border-amber-500/20 bg-amber-500/5"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        {hasBlocker ? (
          <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0" />
        ) : (
          <Key className="h-3 w-3 text-amber-400 flex-shrink-0" />
        )}
        <span className={cn("flex-1 font-medium", hasBlocker ? "text-destructive" : "text-amber-400")}>
          {hasBlocker
            ? `Missing required key: ${missingRequired[0].label}`
            : `${missingOptional.length} optional key${missingOptional.length > 1 ? "s" : ""} not configured`}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {!hasBlocker && (
          <button
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground transition-colors ml-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Expanded list */}
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-1 border-t border-border/50 pt-2">
          {REQUIRED_KEYS.map((key) => {
            const configured = configuredProviders.has(key.provider);
            const isAdding = addingProvider === key.provider;

            return (
              <div key={key.provider}>
                <div className="flex items-center gap-1.5">
                  {configured ? (
                    <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <AlertCircle className={cn("h-2.5 w-2.5 flex-shrink-0", key.required ? "text-destructive" : "text-amber-400/60")} />
                  )}
                  <span className={cn("flex-1", configured ? "text-muted-foreground line-through" : "text-foreground")}>
                    {key.label}
                    <span className="text-muted-foreground ml-1">— {key.description}</span>
                  </span>
                  {!configured && !isAdding && (
                    <button
                      onClick={() => setAddingProvider(key.provider)}
                      className="text-primary hover:underline text-[9px]"
                    >
                      Add
                    </button>
                  )}
                </div>

                {isAdding && (
                  <InlineAddKey
                    provider={key.provider}
                    label={key.label}
                    docsUrl={key.docsUrl}
                    onClose={() => setAddingProvider(null)}
                    onSuccess={() => {
                      setAddingProvider(null);
                      refetch();
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
