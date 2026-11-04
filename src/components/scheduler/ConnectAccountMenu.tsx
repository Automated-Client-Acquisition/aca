import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Loader2, Plug } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useConnectZernioAccount, ZernioConnectError } from "@/hooks/useScheduler";
import { ruleFor } from "@/lib/scheduler";
import { PlatformGlyph } from "./PlatformGlyph";

/** Platforms connected through the org's own Zernio key, in ACA names. */
const ZERNIO_PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "google", "threads", "pinterest", "twitter"];
const KEYS_SETTINGS = "/settings?tab=integrations";

/**
 * "Connect account": signs a social account in through Zernio's hosted flow (the org's own key),
 * or LinkedIn through ACA's native Unipile connection, without leaving ACA.
 */
export function ConnectAccountMenu({ variant = "outline", size = "default", className, label = "Connect account" }: {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  label?: string;
}) {
  const navigate = useNavigate();
  const { data: keys } = useApiKeys();
  const hasKey = (keys ?? []).some((k: { provider: string; is_valid?: boolean | null }) => k.provider === "zernio" && k.is_valid !== false);
  const connect = useConnectZernioAccount();
  const [pending, setPending] = useState<string | null>(null);

  const start = (platform: string) => {
    setPending(platform);
    connect.mutate(platform, {
      onSuccess: (result) => {
        if (!result) return; // popup closed, or the page navigated to the sign-in
        if (result.ok) {
          toast.success(`${ruleFor(platform).label} connected${result.username ? ` as @${result.username}` : ""}`, {
            description: "It's in your account list now.",
          });
        } else {
          toast.error(result.error || "The account couldn't be connected");
        }
      },
      onError: (err) => {
        if (err instanceof ZernioConnectError && err.code === "no_key") {
          toast.error("Add your Zernio API key first", { action: { label: "Open Settings", onClick: () => navigate(KEYS_SETTINGS) } });
        } else {
          toast.error(err.message);
        }
      },
      onSettled: () => setPending(null),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className} disabled={!!pending}>
          {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plug className="mr-1.5 h-4 w-4" />}
          {pending ? `Connecting ${ruleFor(pending).label}…` : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {!hasKey && (
          <>
            <DropdownMenuItem onSelect={() => navigate(KEYS_SETTINGS)} className="items-start gap-2 py-2">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span className="text-xs leading-snug">
                <span className="block font-medium text-foreground">Add your Zernio API key first</span>
                <span className="text-muted-foreground">These platforms connect through your own Zernio account.</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Connect through Zernio</DropdownMenuLabel>
        {ZERNIO_PLATFORMS.map((p) => (
          <DropdownMenuItem key={p} onSelect={() => start(p)} className="gap-2.5">
            <PlatformGlyph platform={p} className="h-4 w-4" />
            {ruleFor(p).label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings?tab=senders")} className="gap-2.5">
          <PlatformGlyph platform="linkedin" className="h-4 w-4" />
          <span className="flex-1">LinkedIn</span>
          <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">Native</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
