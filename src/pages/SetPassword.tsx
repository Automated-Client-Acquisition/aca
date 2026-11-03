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

const setPasswordSchema = z.object({
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

type SetPasswordFormData = z.infer<typeof setPasswordSchema>;

export default function SetPassword() {
  const [isLoading, setIsLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const form = useForm<SetPasswordFormData>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    const initializeSession = async () => {
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      if (tokenHash && (type === "invite" || type === "recovery")) {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as "invite" | "recovery",
        });
        if (error) { setIsValidSession(false); return; }
        if (data.session) { setIsValidSession(true); return; }
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
          setIsValidSession(true);
        }
      });

      const checkSession = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        setIsValidSession(!!session);
      };
      const timeout = setTimeout(checkSession, 500);
      return () => { subscription.unsubscribe(); clearTimeout(timeout); };
    };
    initializeSession();
  }, [searchParams]);

  const handleSubmit = async (data: SetPasswordFormData) => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: data.password });
      if (error) {
        toast({ title: "Error setting password", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Password set!", description: "Welcome aboard." });
        navigate("/onboarding");
      }
    } catch {
      toast({ title: "An error occurred", description: "Please try again later.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidSession === null) {
    return (
      <div className="aca-marketing aca-auth-shell">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--accent)" }} />
          <p style={{ color: "#6B6759" }}>Setting up your account…</p>
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
          <p className="aca-auth-sub">This invitation has expired. Contact support or request a new link.</p>
          <button className="aca-auth-submit" onClick={() => navigate("/auth")}>
            Go to sign in →
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
        <h1>Create your <em>password</em>.</h1>
        <p className="aca-auth-sub">Set a secure password for your new account.</p>

        <form className="aca-auth-form" onSubmit={form.handleSubmit(handleSubmit)}>
          <div>
            <label htmlFor="password">Password</label>
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
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create password & continue →"}
          </button>
        </form>
      </div>
    </div>
  );
}
