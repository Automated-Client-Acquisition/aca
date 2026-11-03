import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Loader2, AlertCircle, Check } from "lucide-react";
import { loginSchema, signupSchema, type LoginFormData, type SignupFormData } from "@/lib/auth-validation";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import "@/styles/aca-home.css";
import { Logo } from "@/components/marketing/Logo";
import { connectingAppName, safeNextPath } from "@/lib/safe-next";
import { SELF_HOSTED } from "@/config/site";

/** Shown in-form, not just as a toast: a toast auto-dismisses and is easy to
 *  miss, and "nothing visibly happened" is exactly how a wrong password used to
 *  read on this page. */
type AuthAlert = { title: string; detail?: string; action?: "reset" };

export default function Auth() {
  const [isLoading, setIsLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"signup" | "login">(() => searchParams.get("mode") === "login" ? "login" : "signup");
  const [alert, setAlert] = useState<AuthAlert | null>(null);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  // Where to land after auth. An MCP consent request must resume, not drop
  // the user on the dashboard or onboarding.
  const next = safeNextPath(searchParams.get("next"));
  const afterLogin = next ?? "/jobs";
  const connectingApp = connectingAppName(next);
  const googleSignInEnabled = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const signupForm = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: "", email: "", password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (user) navigate(afterLogin, { replace: true });
  }, [user, navigate, afterLogin]);

  // Surface an alert in the form AND as a toast, so the outcome is impossible
  // to miss whichever one the user is looking at.
  const raise = (next: AuthAlert) => {
    setAlert(next);
    toast({ title: next.title, description: next.detail, variant: "destructive" });
  };

  const handleLogin = async (data: LoginFormData) => {
    setIsLoading(true);
    setAlert(null);
    try {
      const { error } = await signIn(data.email, data.password);
      if (error) {
        // Supabase exposes a stable `code` on newer GoTrue versions; the
        // message match is the fallback for older responses.
        const code = (error as { code?: string }).code;
        const status = (error as { status?: number }).status;
        const message = error.message ?? "";

        if (code === "invalid_credentials" || message.includes("Invalid login credentials")) {
          raise({
            title: "Wrong email or password",
            detail: "That password doesn't match this account. Check for caps lock, or reset it.",
            action: "reset",
          });
          loginForm.setValue("password", "");
          loginForm.setFocus("password");
        } else if (code === "email_not_confirmed" || message.includes("Email not confirmed")) {
          raise({ title: "Email not confirmed", detail: "Confirm your account from the signup email first." });
        } else if (code === "over_request_rate_limit" || status === 429) {
          raise({ title: "Too many attempts", detail: "Wait a minute, then try again." });
        } else if (code === "user_banned") {
          raise({ title: "Account locked", detail: "Contact support to get this account reopened." });
        } else {
          raise({ title: "Login failed", detail: message || "Please try again." });
        }
      } else {
        toast({ title: "Welcome back!", description: "You've successfully logged in." });
        navigate(afterLogin);
      }
    } catch {
      raise({ title: "Couldn't reach the server", detail: "Check your connection and try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (data: SignupFormData) => {
    setIsLoading(true);
    setAlert(null);
    try {
      const { error } = await signUp(data.email, data.password, data.fullName, next ?? undefined);
      if (error) {
        if (error.message.includes("User already registered")) {
          raise({ title: "Account already exists", detail: "Sign in instead — or reset your password.", action: "reset" });
          setMode("login");
          loginForm.setValue("email", data.email);
        } else if (error.message.includes("pwned") || error.message.includes("leaked") || error.message.includes("compromised") || error.message.includes("data breach")) {
          raise({ title: "Password found in a data breach", detail: "Please choose a different password." });
        } else if (error.message.includes("Password")) {
          raise({ title: "Weak password", detail: "Please choose a stronger password." });
        } else {
          raise({ title: "Signup failed", detail: error.message });
        }
      } else {
        if (connectingApp) {
          toast({ title: "Account created!", description: `Finish connecting ${connectingApp}.` });
        } else {
          toast({ title: "Account created!", description: "Let's set up your content engine." });
        }
        navigate(next ?? "/onboarding");
      }
    } catch {
      toast({ title: "An error occurred", description: "Please try again later.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="aca-marketing aca-auth-shell aca-auth-shell--split">
      <style>{`
        .aca-auth-shell--split {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          align-items: stretch;
          min-height: 100vh;
          gap: 0;
          padding: 0; /* base .aca-auth-shell pads 80px for the centered card */
        }
        /* Same world as the homepage hero: cream paper, upright Inter headline
           with the coral second line, the $67 offer, and Ember the fox. */
        .aca-auth-hero {
          /* Sticky + viewport-capped so the offer stays in view while the
             signup form (taller than the screen on laptops) scrolls. */
          position: sticky;
          top: 0;
          height: 100vh;
          align-self: start;
          overflow: hidden;
          background: #f6efe2;
          border-right: 1px solid var(--auth-line);
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: clamp(32px, 5vw, 72px);
        }
        .aca-auth-hero__logo { position: absolute; top: clamp(24px, 3vw, 40px); left: clamp(32px, 5vw, 72px); }
        .aca-auth-hero__body { position: relative; z-index: 1; max-width: 480px; }
        .aca-auth-hero h2 {
          font-family: var(--font-sans);
          font-style: normal;
          font-size: clamp(34px, 3.6vw, 52px);
          line-height: 1.04;
          letter-spacing: -0.04em;
          font-weight: 720;
          text-wrap: balance;
          color: var(--auth-ink);
          margin: 0 0 28px;
        }
        .aca-auth-hero h2 em { font-style: normal; color: var(--auth-coral); }
        .aca-auth-hero__offer {
          display: flex;
          align-items: center;
          gap: 16px;
          margin: 0 0 24px;
        }
        .aca-auth-hero__offer strong {
          font-size: 40px;
          font-weight: 720;
          letter-spacing: -0.04em;
          line-height: 1;
          color: var(--auth-ink);
        }
        .aca-auth-hero__offer strong span { font-size: 15px; font-weight: 500; letter-spacing: 0; color: var(--auth-muted); }
        .aca-auth-hero__offer > span {
          padding-left: 16px;
          border-left: 1px solid #d9d2c2;
          font-size: 14px;
          line-height: 1.5;
          color: var(--auth-muted);
        }
        .aca-auth-hero ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
        .aca-auth-hero li {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          font-size: 15px;
          line-height: 1.5;
          color: var(--auth-muted);
        }
        .aca-auth-hero li svg { flex: none; margin-top: 3px; color: #578668; }
        .aca-auth-hero__fox {
          position: absolute;
          right: clamp(16px, 3vw, 48px);
          bottom: -18px;
          width: clamp(110px, 11vw, 160px);
          height: auto;
          pointer-events: none;
        }
        .aca-auth-formcol { display: flex; align-items: center; justify-content: center; padding: 48px 24px; }
        /* The panel carries the logo on wide screens. */
        .aca-auth-shell--split .aca-auth-logo { display: none; }
        .aca-auth-alert {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          background: #fdf1ec;
          border: 1px solid #efc4b4;
          border-radius: 12px;
          padding: 12px 14px;
          margin-bottom: 16px;
          text-align: left;
        }
        .aca-auth-alert svg { flex: none; margin-top: 1px; color: var(--auth-error); }
        .aca-auth-alert strong { display: block; font-size: 14px; font-weight: 600; color: var(--auth-ink); }
        .aca-auth-alert p { margin: 3px 0 0; font-size: 13px; line-height: 1.5; color: var(--auth-muted); }
        .aca-auth-alert a { color: var(--auth-link); font-weight: 600; }
        .aca-auth-connect {
          background: #fff9ef;
          border: 1px solid var(--auth-line);
          border-radius: 12px;
          padding: 12px 14px;
          margin-bottom: 16px;
          text-align: left;
        }
        .aca-auth-connect strong { display: block; font-size: 14px; font-weight: 600; color: var(--auth-ink); }
        .aca-auth-connect p { margin: 3px 0 0; font-size: 13px; line-height: 1.5; color: var(--auth-muted); }
        .aca-auth-inline-link {
          background: none;
          border: none;
          padding: 0;
          color: var(--auth-link);
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        .aca-auth-inline-link:hover { text-decoration: underline; text-underline-offset: 3px; }
        @media (max-width: 900px) {
          /* One column: the form leads, the card carries the logo again. */
          .aca-auth-shell--split { grid-template-columns: 1fr; }
          .aca-auth-hero { display: none; }
          .aca-auth-shell--split .aca-auth-logo { display: flex; }
          .aca-auth-formcol { padding: 32px 18px 48px; }
          .aca-auth-card { padding: 32px 24px; }
        }
        @media (max-width: 380px) {
          .aca-auth-formcol { padding: 24px 14px 40px; }
          .aca-auth-card { padding: 28px 18px; }
          .aca-auth-card h1 { font-size: 30px; }
          .aca-auth-toggle button { font-size: 13px; }
        }
      `}</style>
      <aside className="aca-auth-hero" aria-hidden="true">
        <div className="aca-auth-hero__logo"><Logo size={40} /></div>
        <div className="aca-auth-hero__body">
          <h2>Outbound and inbound on every channel, <em>run from one place.</em></h2>
          <div className="aca-auth-hero__offer">
            {SELF_HOSTED ? (
              <>
                <strong>Self-hosted</strong>
                <span>Running on your own servers.<br />Your whole team included.</span>
              </>
            ) : (
              <>
                <strong>$67<span>/month</span></strong>
                <span>One flat platform subscription.<br />Your whole team included.</span>
              </>
            )}
          </div>
          <ul>
            <li><Check size={17} />Unlimited leads, seats and inboxes</li>
            <li><Check size={17} />Bring your own keys. No seat or AI credit tax</li>
            <li><Check size={17} />Runs itself, or let Claude, Codex, Hermes and OpenClaw run it</li>
          </ul>
        </div>
        <svg className="aca-auth-hero__fox" viewBox="182 279 721 947" focusable="false">
          <image href="/media/mascot/fox-wave-cut.png" width="1024" height="1536" />
        </svg>
      </aside>
      <div className="aca-auth-formcol">
      <div className="aca-auth-card">
        <div className="aca-auth-logo">
          <Link to="/"><Logo size={36} /></Link>
        </div>

        <div className="aca-auth-toggle">
          <button
            type="button"
            className={mode === "signup" ? "active" : ""}
            onClick={() => { setMode("signup"); setAlert(null); }}
          >
            Create account
          </button>
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => { setMode("login"); setAlert(null); }}
          >
            Sign in
          </button>
        </div>

        {connectingApp && (
          <div className="aca-auth-connect">
            <strong>Connect {connectingApp} to ACA</strong>
            <p>
              Create a free account or sign in. You'll come straight back to approve
              the connection, then continue in {connectingApp}.
            </p>
          </div>
        )}

        {alert && (
          <div className="aca-auth-alert" role="alert" aria-live="assertive">
            <AlertCircle className="h-4 w-4" />
            <div>
              <strong>{alert.title}</strong>
              {alert.detail && (
                <p>
                  {alert.detail}
                  {alert.action === "reset" && <> <Link to="/forgot-password">Reset your password</Link>.</>}
                </p>
              )}
            </div>
          </div>
        )}

        {mode === "signup" ? (
          <>
            <h1>Start booking <em>meetings</em>.</h1>
            <p className="aca-auth-sub">
              {SELF_HOSTED
                ? "Your own install. No credits. Unlimited everything."
                : "Free to start. No card. No credits. Unlimited everything."}
            </p>

            {googleSignInEnabled && (
              <>
                <GoogleSignInButton
                  onSuccess={() => { toast({ title: "Welcome!" }); navigate(afterLogin); }}
                  onError={(error) => toast({ title: "Google sign-in failed", description: error.message, variant: "destructive" })}
                />
                <div className="aca-auth-divider">or with email</div>
              </>
            )}

            <form className="aca-auth-form" onSubmit={signupForm.handleSubmit(handleSignup)}>
              <div>
                <label htmlFor="signup-name">Full name</label>
                <input id="signup-name" type="text" placeholder="John Doe" {...signupForm.register("fullName")} disabled={isLoading} />
                {signupForm.formState.errors.fullName && <div className="aca-auth-error">{signupForm.formState.errors.fullName.message}</div>}
              </div>
              <div>
                <label htmlFor="signup-email">Work email</label>
                <input id="signup-email" type="email" placeholder="you@company.com" {...signupForm.register("email")} disabled={isLoading} />
                {signupForm.formState.errors.email && <div className="aca-auth-error">{signupForm.formState.errors.email.message}</div>}
              </div>
              <div>
                <label htmlFor="signup-password">Password</label>
                <input id="signup-password" type="password" placeholder="Create a strong password" {...signupForm.register("password")} disabled={isLoading} />
                {signupForm.formState.errors.password && <div className="aca-auth-error">{signupForm.formState.errors.password.message}</div>}
              </div>
              <div>
                <label htmlFor="signup-confirm">Confirm password</label>
                <input id="signup-confirm" type="password" placeholder="Confirm your password" {...signupForm.register("confirmPassword")} disabled={isLoading} />
                {signupForm.formState.errors.confirmPassword && <div className="aca-auth-error">{signupForm.formState.errors.confirmPassword.message}</div>}
              </div>
              <button type="submit" className="aca-auth-submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create account →</>}
              </button>
            </form>

            <div className="aca-auth-foot">
              By signing up you agree to our{" "}
              <Link to="/terms">Terms</Link> and{" "}
              <Link to="/privacy">Privacy</Link>.
            </div>
          </>
        ) : (
          <>
            <h1>Welcome <em>back</em>.</h1>
            <p className="aca-auth-sub">Sign in to continue to your workspace.</p>

            {googleSignInEnabled && (
              <>
                <GoogleSignInButton
                  onSuccess={() => { toast({ title: "Welcome back!" }); navigate(afterLogin); }}
                  onError={(error) => toast({ title: "Google sign-in failed", description: error.message, variant: "destructive" })}
                />
                <div className="aca-auth-divider">or with email</div>
              </>
            )}

            <form className="aca-auth-form" onSubmit={loginForm.handleSubmit(handleLogin)}>
              <div>
                <label htmlFor="login-email">Email</label>
                <input id="login-email" type="email" placeholder="you@example.com" {...loginForm.register("email")} disabled={isLoading} />
                {loginForm.formState.errors.email && <div className="aca-auth-error">{loginForm.formState.errors.email.message}</div>}
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label htmlFor="login-password" style={{ marginBottom: 0 }}>Password</label>
                  <Link to="/forgot-password" style={{ fontSize: 13, color: "var(--auth-link)", fontWeight: 600 }}>Forgot password?</Link>
                </div>
                <input id="login-password" type="password" placeholder="••••••••" {...loginForm.register("password")} disabled={isLoading} />
                {loginForm.formState.errors.password && <div className="aca-auth-error">{loginForm.formState.errors.password.message}</div>}
              </div>
              <button type="submit" className="aca-auth-submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in →"}
              </button>
            </form>

            <div className="aca-auth-foot">
              No account yet?{" "}
              <button
                type="button"
                className="aca-auth-inline-link"
                onClick={() => setMode("signup")}
              >
                Create one
              </button>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
