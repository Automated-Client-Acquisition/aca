import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, XCircle } from "lucide-react";
import "@/styles/aca-home.css";
import { Logo } from "@/components/marketing/Logo";

const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export default function ResetPassword() {
  const [isLoading, setIsLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const form = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    let isMounted = true;
    let settled = false;
    const settle = (valid: boolean) => {
      if (!isMounted || settled) return;
      settled = true;
      setIsValidSession(valid);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) settle(true);
    });

    const establish = async () => {
      // Supabase bounced back an expired / already-used link.
      const linkError = searchParams.get("link_error");
      if (linkError) { setLinkError(linkError); settle(false); return; }

      // Verify-style link: we still hold the one-time token, so redeem it here
      // rather than depending on the client having auto-detected a session.
      const tokenHash = searchParams.get("token_hash");
      if (tokenHash) {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (error) { setLinkError(error.message); settle(false); return; }
        if (data.session) { settle(true); return; }
      }

      // Implicit link: `detectSessionInUrl` is mid-flight. Poll rather than
      // sampling once — a single early read is what used to make a perfectly
      // good link render as "invalid or expired".
      for (let attempt = 0; attempt < 12 && isMounted && !settled; attempt++) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) { settle(true); return; }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      settle(false);
    };

    establish();
    return () => { isMounted = false; subscription.unsubscribe(); };
  }, [searchParams]);

  const handleSubmit = async (data: ResetPasswordFormData) => {
    setIsLoading(true);
    setSubmitError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: data.password });
      if (error) {
        // Most common real failures here: the recovery session expired while
        // the form sat open, or the password was rejected by the breach check.
        const detail = (error as { code?: string }).code === "same_password"
          ? "That's already your current password. Choose a different one."
          : error.message;
        setSubmitError(detail);
        toast({ title: "Couldn't update your password", description: detail, variant: "destructive" });
      } else {
        toast({ title: "Password updated", description: "Your password has been reset." });
        navigate("/jobs");
      }
    } catch {
      const detail = "Couldn't reach the server. Check your connection and try again.";
      setSubmitError(detail);
      toast({ title: "An error occurred", description: detail, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidSession === null) {
    return (
      <div className="aca-marketing aca-auth-shell">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--accent)" }} />
          <p style={{ color: "#6B6759" }}>Validating reset link…</p>
        </div>
      </div>
    );
  }

  if (!isValidSession) {
    return (
      <div className="aca-marketing aca-auth-shell">
        <div className="aca-auth-card">
          <div className="aca-auth-logo">
            <Link to="/"><Logo size={36} /></Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "12px 0 24px" }}>
            <XCircle className="w-10 h-10" style={{ color: "var(--accent)" }} />
          </div>
          <h1>Invalid or <em>expired</em> link.</h1>
          <p className="aca-auth-sub">
            {linkError
              ? `${linkError} Request a new one to continue.`
              : "Reset links work once and expire quickly. Request a new one to continue."}
          </p>
          <button className="aca-auth-submit" onClick={() => navigate("/forgot-password")}>
            Request new link →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="aca-marketing aca-auth-shell">
      <div className="aca-auth-card">
        <div className="aca-auth-logo">
          <Link to="/"><Logo size={36} /></Link>
        </div>
        <h1>Set a new <em>password</em>.</h1>
        <p className="aca-auth-sub">Enter your new password below.</p>

        {submitError && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              background: "rgba(212, 54, 26, 0.07)",
              border: "1px solid rgba(212, 54, 26, 0.28)",
              borderRadius: 12,
              padding: "12px 14px",
              marginBottom: 16,
              fontSize: 12.5,
              lineHeight: 1.45,
              color: "#15140F",
              textAlign: "left",
            }}
          >
            {submitError}
          </div>
        )}

        <form className="aca-auth-form" onSubmit={form.handleSubmit(handleSubmit)}>
          <div>
            <label htmlFor="password">New password</label>
            <div style={{ position: "relative" }}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                {...form.register("password")}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#6B6759", cursor: "pointer" }}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {form.formState.errors.password && <div className="aca-auth-error">{form.formState.errors.password.message}</div>}
            <p style={{ fontSize: 11, color: "#9A9485", marginTop: 6 }}>
              8+ characters with uppercase, lowercase, and a number.
            </p>
          </div>
          <div>
            <label htmlFor="confirmPassword">Confirm password</label>
            <div style={{ position: "relative" }}>
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="••••••••"
                {...form.register("confirmPassword")}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#6B6759", cursor: "pointer" }}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {form.formState.errors.confirmPassword && <div className="aca-auth-error">{form.formState.errors.confirmPassword.message}</div>}
          </div>
          <button type="submit" className="aca-auth-submit" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset password →"}
          </button>
        </form>
      </div>
    </div>
  );
}
