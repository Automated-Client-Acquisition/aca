import { useMemo, useState } from "react";
import { AlertCircle, KeyRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useApiKeys } from "@/hooks/useApiKeys";
import { AddApiKeyDialog } from "@/components/settings/AddApiKeyDialog";
import {
  getRequiredProviders,
  isHardRequirement,
  providerLabel,
  type Provider,
} from "@/lib/required-api-keys";

interface MissingApiKeyAlertProps {
  /** A single pipeline id, or an array (e.g. for autopilots with multiple blueprints). */
  pipeline?: string | string[] | null;
  /** Optional copy override for context-specific messaging. */
  contextLabel?: string;
  /** Called after the dialog closes — parent can re-check and update UI. */
  onAdded?: () => void;
}

function unionRequired(pipeline: string | string[] | null | undefined): Provider[] {
  if (!pipeline) return [];
  const list = Array.isArray(pipeline) ? pipeline : [pipeline];
  const out = new Set<Provider>();
  for (const p of list) {
    for (const provider of getRequiredProviders(p)) {
      out.add(provider);
    }
  }
  return Array.from(out);
}

export function MissingApiKeyAlert({ pipeline, contextLabel, onAdded }: MissingApiKeyAlertProps) {
  const { data: apiKeys, isLoading } = useApiKeys();
  const [openDialog, setOpenDialog] = useState<Provider | null>(null);

  // A key counts as "missing" for the purposes of this alert if it's either
  // genuinely absent OR present-but-flagged-invalid (is_valid=false). The
  // nightly validate-openrouter-keys cron flips is_valid on revoked keys, and
  // a stale-but-green badge in Settings led to confused bug reports — surface
  // the invalid state here so users can actually fix it.
  const { unusable, invalid } = useMemo(() => {
    if (isLoading) return { unusable: [] as Provider[], invalid: new Set<Provider>() };
    const required = unionRequired(pipeline);
    if (required.length === 0) return { unusable: [] as Provider[], invalid: new Set<Provider>() };
    const keysByProvider = new Map<string, { is_valid: boolean | null }>();
    for (const k of (apiKeys ?? []) as Array<{ provider: string; is_valid: boolean | null }>) {
      keysByProvider.set(k.provider, k);
    }
    const unusableList: Provider[] = [];
    const invalidSet = new Set<Provider>();
    for (const p of required) {
      const row = keysByProvider.get(p);
      if (!row) {
        unusableList.push(p);
      } else if (row.is_valid === false) {
        unusableList.push(p);
        invalidSet.add(p);
      }
    }
    return { unusable: unusableList, invalid: invalidSet };
  }, [pipeline, apiKeys, isLoading]);

  const hardUnusable = unusable.filter(isHardRequirement);
  const softUnusable = unusable.filter((p) => !isHardRequirement(p));

  if (unusable.length === 0) return null;

  const isHard = hardUnusable.length > 0;
  const visible = isHard ? hardUnusable : softUnusable;
  const visibleInvalid = visible.filter((p) => invalid.has(p));
  const visibleMissing = visible.filter((p) => !invalid.has(p));
  const allInvalid = visibleInvalid.length > 0 && visibleMissing.length === 0;

  const title = isHard
    ? allInvalid
      ? `${visibleInvalid.map(providerLabel).join(" and ")} key${visibleInvalid.length > 1 ? "s" : ""} flagged invalid — can't ${contextLabel ?? "generate"}`
      : `Missing API key${hardUnusable.length > 1 ? "s" : ""} required to ${contextLabel ?? "generate"}`
    : `Optional API key${softUnusable.length > 1 ? "s" : ""} not configured`;

  const description = isHard
    ? allInvalid
      ? `The key${visibleInvalid.length > 1 ? "s are" : " is"} still in your settings but the provider rejected ${visibleInvalid.length > 1 ? "them" : "it"} on the last check (likely revoked or rotated). Rotate the key to fix.`
      : `This pipeline can't run without ${visible.map(providerLabel).join(" and ")}.`
    : `Some features may be limited without ${visible.map(providerLabel).join(" and ")}.`;

  return (
    <>
      <Alert
        variant={isHard ? "destructive" : "default"}
        className={isHard ? undefined : "border-amber-500/50 bg-amber-500/10"}
      >
        <AlertCircle className={`h-4 w-4 ${isHard ? "" : "text-amber-500"}`} />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="text-sm">{description}</p>
          <div className="flex flex-wrap gap-2">
            {visible.map((provider) => (
              <Button
                key={provider}
                size="sm"
                variant={isHard ? "secondary" : "outline"}
                onClick={() => setOpenDialog(provider)}
              >
                <KeyRound className="mr-2 h-3 w-3" />
                {invalid.has(provider) ? "Rotate" : "Add"} {providerLabel(provider)} key
              </Button>
            ))}
          </div>
        </AlertDescription>
      </Alert>

      <AddApiKeyDialog
        open={openDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            const wasOpen = openDialog !== null;
            setOpenDialog(null);
            if (wasOpen) onAdded?.();
          }
        }}
        defaultProvider={openDialog ?? undefined}
      />
    </>
  );
}

/** Programmatic check for callers that need to gate an action (e.g. a submit button).
 * "missing" here means unusable — either absent or present-but-flagged-invalid.
 * Callers gate on this; both states should block the action. */
export function useMissingApiKeys(pipeline: string | string[] | null | undefined): {
  missing: Provider[];
  hardMissing: Provider[];
  isLoading: boolean;
} {
  const { data: apiKeys, isLoading } = useApiKeys();
  return useMemo(() => {
    if (isLoading) {
      return { missing: [], hardMissing: [], isLoading: true };
    }
    const required = unionRequired(pipeline);
    if (required.length === 0) {
      return { missing: [], hardMissing: [], isLoading: false };
    }
    const usable = new Set(
      ((apiKeys ?? []) as Array<{ provider: string; is_valid: boolean | null }>)
        .filter((k) => k.is_valid !== false)
        .map((k) => k.provider),
    );
    const missing = required.filter((p) => !usable.has(p));
    return {
      missing,
      hardMissing: missing.filter(isHardRequirement),
      isLoading: false,
    };
  }, [pipeline, apiKeys, isLoading]);
}
