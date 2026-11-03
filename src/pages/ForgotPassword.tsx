import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import "@/styles/aca-home.css";
import { Logo } from "@/components/marketing/Logo";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailSent, setIsEmailSent] = useState(false);

  const form = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const handleSubmit = async (data: ForgotPasswordFormData) => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        if (error.message.includes("rate limit")) {
          toast({ title: "Too many requests", description: "Please wait a few minutes.", variant: "destructive" });
        } else {
          toast({ title: "Error", description: error.message, variant: "destructive" });
        }
      } else {
        setIsEmailSent(true);
      }
    } catch {
      toast({ title: "An error occurred", description: "Please try again later.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="aca-marketing aca-auth-shell">
      <div className="aca-auth-card">
        <div className="aca-auth-logo">
          <Link to="/"><Logo size={36} /></Link>
        </div>

        {isEmailSent ? (
          <>
            <h1>Check your <em>email</em>.</h1>
            <p className="aca-auth-sub">
              We've sent a reset link to <strong>{form.getValues("email")}</strong>. If you don't see it, check spam.
            </p>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0" }}>
              <CheckCircle2 className="w-10 h-10" style={{ color: "var(--accent)" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button
                type="button"
                className="aca-auth-submit"
                onClick={() => { setIsEmailSent(false); form.reset(); }}
                style={{ background: "transparent", color: "var(--ink)", border: "1px solid var(--ink)", boxShadow: "none" }}
              >
                Try another email
              </button>
              <Link to="/auth" style={{ textAlign: "center", fontSize: 13, color: "#6B6759" }}>
                <ArrowLeft style={{ width: 12, height: 12, display: "inline", marginRight: 4 }} />
                Back to sign in
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1>Reset your <em>password</em>.</h1>
            <p className="aca-auth-sub">Enter your email and we'll send you a reset link.</p>
            <form className="aca-auth-form" onSubmit={form.handleSubmit(handleSubmit)}>
              <div>
                <label htmlFor="email">Email</label>
                <input id="email" type="email" placeholder="you@example.com" {...form.register("email")} disabled={isLoading} />
                {form.formState.errors.email && <div className="aca-auth-error">{form.formState.errors.email.message}</div>}
              </div>
              <button type="submit" className="aca-auth-submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link →"}
              </button>
            </form>
            <div className="aca-auth-foot">
              <Link to="/auth"><ArrowLeft style={{ width: 12, height: 12, display: "inline", marginRight: 4 }} />Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
