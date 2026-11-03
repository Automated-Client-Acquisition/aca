/**
 * Snapshot of a password-recovery / invite landing, taken at module-eval time.
 *
 * Supabase is created with `detectSessionInUrl: true`, which means the client
 * asynchronously consumes `#access_token=...&type=recovery` and then rewrites
 * the URL with `history.replaceState`. Any React effect that tries to read that
 * hash — or to catch the `PASSWORD_RECOVERY` event it emits — is racing an
 * async step that has usually already finished by the time the tree mounts.
 * When it loses that race the user is dropped on the marketing homepage with a
 * live recovery session and never sees a "set a new password" form.
 *
 * So we read `window.location` synchronously, before anything imports the
 * Supabase client. IMPORTANT: this module must be imported first in main.tsx —
 * ES modules evaluate in import order, and the client's URL detection starts
 * the moment `createClient` runs.
 */

export type RecoveryLanding =
  /** Implicit flow: tokens were in the hash, Supabase is establishing a session. */
  | { kind: "session"; type: "recovery" | "invite" }
  /** Verify-style link: we still hold the one-time token and must exchange it. */
  | { kind: "token"; type: "recovery" | "invite"; tokenHash: string }
  /** Supabase bounced us back with an error (expired or already-used link). */
  | { kind: "error"; message: string };

function detect(): RecoveryLanding | null {
  if (typeof window === "undefined") return null;

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const get = (key: string) => hash.get(key) ?? query.get(key);

  const rawType = get("type");
  const type = rawType === "recovery" || rawType === "invite" ? rawType : null;

  const errorCode = get("error_code");
  const error = get("error");
  if (errorCode || error) {
    // `otp_expired` is by far the common one: the link was already opened once,
    // or it sat in an inbox past the token lifetime.
    const description = get("error_description")?.replace(/\+/g, " ");
    return {
      kind: "error",
      message:
        errorCode === "otp_expired"
          ? "That reset link has expired or was already used."
          : description || "That reset link is no longer valid.",
    };
  }

  if (!type) return null;

  const tokenHash = get("token_hash");
  if (tokenHash) return { kind: "token", type, tokenHash };

  if (get("access_token")) return { kind: "session", type };

  return null;
}

export const recoveryLanding: RecoveryLanding | null = detect();

/** Where a given landing should be handled. Invites set a first password. */
export function recoveryLandingPath(landing: RecoveryLanding): string {
  if (landing.kind === "error") {
    return `/reset-password?link_error=${encodeURIComponent(landing.message)}`;
  }
  const base = landing.type === "invite" ? "/auth/set-password" : "/reset-password";
  if (landing.kind === "token") {
    return `${base}?token_hash=${encodeURIComponent(landing.tokenHash)}&type=${landing.type}`;
  }
  return base;
}

/** Routes that already know how to handle a recovery landing themselves. */
export const RECOVERY_ROUTES = ["/reset-password", "/auth/set-password"];
