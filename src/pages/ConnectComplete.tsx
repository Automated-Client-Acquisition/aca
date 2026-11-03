import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Plug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  LinkedInIcon,
  WhatsAppIcon,
  TelegramIcon,
  InstagramIcon,
  MessengerIcon,
  TwitterXIcon,
  GmailIcon,
  OutlookIcon,
} from "@/components/marketing/BrandIcons";

type ProviderInfo = { label: string; Icon: ComponentType<SVGProps<SVGSVGElement>>; color: string };

const PROVIDERS: Record<string, ProviderInfo> = {
  linkedin: { label: "LinkedIn", Icon: LinkedInIcon, color: "#0A66C2" },
  whatsapp: { label: "WhatsApp", Icon: WhatsAppIcon, color: "#25D366" },
  telegram: { label: "Telegram", Icon: TelegramIcon, color: "#0088cc" },
  instagram: { label: "Instagram", Icon: InstagramIcon, color: "#E1306C" },
  messenger: { label: "Messenger", Icon: MessengerIcon, color: "#0084FF" },
  twitter: { label: "X", Icon: TwitterXIcon, color: "#000000" },
  google: { label: "Gmail", Icon: GmailIcon, color: "#EA4335" },
  outlook: { label: "Outlook", Icon: OutlookIcon, color: "#0078D4" },
};

const CLOSE_AFTER_MS = 2000;

// Where the Unipile hosted-auth popup lands after connecting or reconnecting an account
// (redirected here by unipile-v2-auth-callback, or by Unipile directly on v1). Tells the Senders
// page that opened the popup, then closes itself. Public route: no branding, no data.
export default function ConnectComplete() {
  const [params] = useSearchParams();
  const ok = params.get("status") === "success";
  const providerKey = (params.get("provider") || "").toLowerCase();
  const provider = PROVIDERS[providerKey];
  const label = provider?.label ?? "Your";
  const message = params.get("message");
  const [hasOpener] = useState(() => !!window.opener && !window.opener.closed);

  useEffect(() => {
    if (!hasOpener) return;
    window.opener.postMessage(
      ok
        ? { type: "UNIPILE_OAUTH_SUCCESS", provider: providerKey }
        : { type: "UNIPILE_OAUTH_ERROR", error: message || "The account could not be connected" },
      window.location.origin,
    );
    // Errors stay on screen so they can be read; the Senders page shows them too.
    if (!ok) return;
    const timer = window.setTimeout(() => window.close(), CLOSE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [hasOpener, ok, providerKey, message]);

  const ProviderIcon = provider?.Icon;
  const accountsHref = ok
    ? `/settings?tab=senders&unipile_connected=true&provider=${encodeURIComponent(providerKey)}`
    : "/settings?tab=senders";

  return (
    // data-app-shell keeps the marketing stylesheet's italic headings off this page.
    <div data-app-shell className="min-h-screen bg-background flex items-center justify-center p-5">
      <div className="bg-card rounded-2xl border shadow-sm max-w-sm w-full px-8 py-10 text-center">
        <div className="relative mx-auto mb-6 h-16 w-16">
          <div className="h-16 w-16 rounded-2xl border bg-background flex items-center justify-center">
            {ProviderIcon ? (
              <ProviderIcon className="h-8 w-8" style={{ color: provider.color }} />
            ) : (
              <Plug className="h-7 w-7 text-muted-foreground" />
            )}
          </div>
          <div
            className={`absolute -bottom-1.5 -right-1.5 h-7 w-7 rounded-full border-2 border-card flex items-center justify-center ${
              ok ? "bg-green-500" : "bg-destructive"
            }`}
          >
            {ok ? (
              <Check className="h-4 w-4 text-white" strokeWidth={3} />
            ) : (
              <X className="h-4 w-4 text-white" strokeWidth={3} />
            )}
          </div>
        </div>

        <h1 className="text-xl font-semibold text-foreground mb-2">
          {ok ? `${label} account connected` : `${provider ? label : "The account"} couldn't be connected`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {ok
            ? "It's ready to use in your campaigns and inbox."
            : message || "Something went wrong while connecting. Please try again."}
        </p>

        {ok && hasOpener ? (
          <div className="mt-8">
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-green-500"
                style={{ animation: `connect-complete-progress ${CLOSE_AFTER_MS}ms linear forwards` }}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">This window closes on its own.</p>
            <style>{`@keyframes connect-complete-progress { from { width: 0% } to { width: 100% } }`}</style>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-2">
            {hasOpener ? (
              <Button variant="outline" onClick={() => window.close()}>
                Close window
              </Button>
            ) : (
              <Button variant="cta" asChild>
                <Link to={accountsHref}>Go to your accounts</Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
