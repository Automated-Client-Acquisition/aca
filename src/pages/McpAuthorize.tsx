import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Check,
  ChevronRight,
  Link2,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const SCOPE_LABELS: Record<string, string> = {
  "workspace:read": "View workspace details",
  "contacts:read": "View contacts",
  "contacts:write": "Create and update contacts",
  "sequences:read": "View outreach sequences",
  "sequences:write": "Manage sequence enrollment",
  "tags:read": "View contact tags",
  "tags:write": "Manage contact tags",
  "stages:read": "View pipeline stages",
  "stages:write": "Update contact stages",
  "conversations:read": "View conversation summaries",
  "messages:read": "Read conversation messages",
  "messages:write": "Send messages",
  "analytics:read": "View outreach analytics",
};

export default function McpAuthorize() {
  const { session, loading, currentOrganization } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const request = useMemo(
    () => Object.fromEntries(new URLSearchParams(location.search)),
    [location.search],
  );
  const permissions = useMemo(
    () =>
      String(request.scope || "")
        .split(/\s+/)
        .filter(Boolean),
    [request.scope],
  );

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate(
        `/auth?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`,
        { replace: true },
      );
      return;
    }
    if (!approved) return;
    if (
      !request.client_id ||
      !request.redirect_uri ||
      !request.state ||
      !request.code_challenge
    ) {
      setError("This connection request is missing required OAuth parameters.");
      return;
    }
    if (!currentOrganization) return;
    let cancelled = false;
    supabase.functions
      .invoke("mcp-oauth", { body: { ...request, operation: "authorize" } })
      .then(({ data, error: invokeError }) => {
        if (cancelled) return;
        if (invokeError || !data?.redirect_to) {
          setError(
            invokeError?.message ||
              data?.error_description ||
              "ACA could not authorize this connection.",
          );
          return;
        }
        window.location.assign(data.redirect_to);
      });
    return () => {
      cancelled = true;
    };
  }, [
    approved,
    currentOrganization,
    loading,
    location.pathname,
    location.search,
    navigate,
    request,
    session,
  ]);

  const isInvalid =
    !request.client_id ||
    !request.redirect_uri ||
    !request.state ||
    !request.code_challenge;
  // client_name is only present when the registering app sent one (RFC 7591;
  // Claude and ChatGPT both do). Dynamically registered clients without one
  // have nothing human-readable to show -- never fall back to the raw
  // client_id, which is an opaque random token, not a name.
  const appLabel = request.client_name?.trim() || "This app";
  const workspaceInitial =
    currentOrganization?.name?.slice(0, 1).toUpperCase() || "A";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#171717] px-5 py-8 text-[#f8f5eb] sm:grid sm:place-items-center">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(circle at 12% 5%, rgba(217,45,32,.27), transparent 25rem), radial-gradient(circle at 92% 90%, rgba(197,160,85,.18), transparent 28rem)",
        }}
      />
      <div className="relative mx-auto w-full max-w-[540px] overflow-hidden rounded-[28px] border border-white/10 bg-[#f8f5eb] text-[#20201e] shadow-2xl shadow-black/35">
        <header className="border-b border-[#ded9cb] bg-[#fffdf7] px-6 py-5 sm:px-8">
          <div className="flex items-center justify-between">
            <img src="/logo.svg" alt="ACA" className="h-8 w-auto" />
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#686357]">
              <LockKeyhole className="size-3.5" /> Secure connection
            </div>
          </div>
        </header>
        <section className="px-6 py-8 sm:px-8 sm:py-9">
          {error ? (
            <div className="text-center">
              <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-red-50 text-[#d92d20]">
                <X className="size-6" />
              </span>
              <h1 className="text-2xl font-semibold">Connection unavailable</h1>
              <p className="mt-3 text-sm leading-6 text-[#686357]">{error}</p>
              <button
                className="mt-6 rounded-xl border border-[#d8d1c0] px-4 py-2 text-sm font-semibold"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </div>
          ) : approved ? (
            <div className="py-8 text-center">
              <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-[#f7e6e2] text-[#d92d20]">
                <LoaderCircle className="size-7 animate-spin" />
              </span>
              <h1 className="text-2xl font-semibold">Connecting securely</h1>
              <p className="mt-3 text-sm text-[#686357]">
                Finishing your authorization with ACA…
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#f7e6e2] text-[#d92d20]">
                  <Link2 className="size-6" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[.14em] text-[#a68a3d]">
                    Connect your workspace
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">
                    Allow {appLabel} to use ACA?
                  </h1>
                </div>
              </div>
              <p className="mt-5 text-sm leading-6 text-[#686357]">
                You’re connecting the app to one ACA workspace. It can only
                access the permissions you approve below.
              </p>
              <div className="mt-7 rounded-2xl border border-[#ded9cb] bg-[#fffdf7] p-4">
                <p className="text-xs font-bold uppercase tracking-[.12em] text-[#7d7668]">
                  Connected workspace
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-[#262521] font-semibold text-[#f8f5eb]">
                    {workspaceInitial}
                  </span>
                  <div>
                    <p className="font-semibold">
                      {currentOrganization?.name || "Loading workspace…"}
                    </p>
                    <p className="mt-0.5 text-xs text-[#7d7668]">
                      Change your active workspace in ACA settings.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-7">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-[#a68a3d]" />
                  <h2 className="text-sm font-semibold">
                    Requested permissions
                  </h2>
                </div>
                <ul className="mt-3 divide-y divide-[#e4dece] overflow-hidden rounded-2xl border border-[#ded9cb] bg-white">
                  {permissions.length ? (
                    permissions.map((scope) => (
                      <li
                        key={scope}
                        className="flex items-center gap-3 px-4 py-3 text-sm"
                      >
                        <Check className="size-4 shrink-0 text-[#2e7d4c]" />
                        <span>{SCOPE_LABELS[scope] || scope}</span>
                      </li>
                    ))
                  ) : (
                    <li className="px-4 py-3 text-sm text-[#686357]">
                      No permissions requested.
                    </li>
                  )}
                </ul>
              </div>
              <button
                disabled={loading || isInvalid || !currentOrganization}
                onClick={() => setApproved(true)}
                className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[#d92d20] px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#d92d20]/20 transition hover:bg-[#bd241a] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Allow connection <ChevronRight className="size-4" />
              </button>
              <p className="mt-4 text-center text-xs leading-5 text-[#7d7668]">
                You can disconnect this app at any time from ACA settings. ACA
                never shares your password with connected apps.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
