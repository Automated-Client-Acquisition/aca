import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Plug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformGlyph } from "@/components/scheduler/PlatformGlyph";
import { ruleFor } from "@/lib/scheduler";

const CLOSE_AFTER_MS = 2000;

/** Zernio's error codes people can act on; anything else falls back to Zernio's own message. */
const ERRORS: Record<string, string> = {
  oauth_denied: "Sign-in was cancelled or declined.",
  account_limit_exceeded: "Your Zernio plan has reached its account limit. Upgrade in Zernio or remove an account, then try again.",
  profile_limit_exceeded: "Your Zernio plan has reached its profile limit. Upgrade in Zernio, then try again.",
  payment_required: "Your Zernio plan needs attention before more accounts can be connected.",
  missing_google_permissions: "Some Google permissions were unchecked. Connect again and keep every box ticked.",
  missing_tiktok_permissions: "Some TikTok permissions were declined. Connect again and accept every permission.",
  personal_account_not_supported: "This platform needs a business or creator account, not a personal one.",
};

// Where Zernio's hosted sign-in lands after connecting an account (redirect_url set by
// zernio-connect). Tells the Scheduler that opened the popup, then closes itself. Public route:
// no data, only Zernio's query params (connected/username or error/error_message).
export default function ZernioConnectComplete() {
  const [params] = useSearchParams();
  const raw = (params.get("connected") || params.get("platform") || "").toLowerCase();
  const platform = raw === "googlebusiness" ? "google" : raw;
  const ok = !!params.get("connected") && !params.get("error");
  const username = params.get("username") || undefined;
  const errorCode = params.get("error") || "";
  const message = ok ? undefined : ERRORS[errorCode] || params.get("error_message") || "The account couldn't be connected. Please try again.";
  const label = platform ? ruleFor(platform).label : "Your";
  const [hasOpener] = useState(() => !!window.opener && !window.opener.closed);

  useEffect(() => {
    if (!hasOpener) return;
    window.opener.postMessage({ type: "ZERNIO_CONNECT_RESULT", result: { ok, platform, username, error: message } }, window.location.origin);
    // Errors stay on screen so they can be read; the Scheduler shows them too.
    if (!ok) return;
    const timer = window.setTimeout(() => window.close(), CLOSE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [hasOpener, ok, platform, username, message]);

  return (
    // data-app-shell keeps the marketing stylesheet's italic headings off this page.
    <div data-app-shell className="flex min-h-screen items-center justify-center bg-background p-5">
      <div className="w-full max-w-sm rounded-2xl border bg-card px-8 py-10 text-center shadow-sm">
        <div className="relative mx-auto mb-6 h-16 w-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border bg-background">
            {platform ? <PlatformGlyph platform={platform} className="h-8 w-8" /> : <Plug className="h-7 w-7 text-muted-foreground" />}
          </div>
          <div className={`absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card ${ok ? "bg-green-500" : "bg-destructive"}`}>
            {ok ? <Check className="h-4 w-4 text-white" strokeWidth={3} /> : <X className="h-4 w-4 text-white" strokeWidth={3} />}
          </div>
        </div>

        <h1 className="mb-2 text-xl font-semibold text-foreground">
          {ok ? `${label} account connected` : `${platform ? label : "The account"} couldn't be connected`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {ok ? `${username ? `@${username} is` : "It's"} ready to post from the Scheduler.` : message}
        </p>

        {ok && hasOpener ? (
          <div className="mt-8">
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-green-500" style={{ animation: `zernio-connect-progress ${CLOSE_AFTER_MS}ms linear forwards` }} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">This window closes on its own.</p>
            <style>{`@keyframes zernio-connect-progress { from { width: 0% } to { width: 100% } }`}</style>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-2">
            {hasOpener ? (
              <Button variant="outline" onClick={() => window.close()}>
                Close window
              </Button>
            ) : (
              <Button variant="cta" asChild>
                <Link to="/scheduler">Back to the Scheduler</Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
