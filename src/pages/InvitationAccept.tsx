import { useEffect, useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle, Mail } from "lucide-react";
import { useInvitationByToken, useAcceptInvitation } from "@/hooks/useInvitations";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function InvitationAccept() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, refreshOrganizationContext, switchOrganization } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isAutoAccepting, setIsAutoAccepting] = useState(false);
  const [autoAcceptComplete, setAutoAcceptComplete] = useState(false);

  const { data: invitation, isLoading, error } = useInvitationByToken(token || "");
  const acceptMutation = useAcceptInvitation();

  // Check if user arrived via Supabase magic link (has token_hash in URL)
  const isFromSupabaseMagicLink = searchParams.has("token_hash") && searchParams.get("type") === "invite";

  // Auto-accept invitation when user arrives via Supabase magic link and is authenticated
  useEffect(() => {
    const autoAccept = async () => {
      if (
        isFromSupabaseMagicLink &&
        user &&
        invitation &&
        !isAutoAccepting &&
        !autoAcceptComplete &&
        !acceptMutation.isPending
      ) {
        // User arrived via Supabase invite link and is now authenticated
        // The trigger should have already added them to the org, but let's ensure
        setIsAutoAccepting(true);

        try {
          await acceptMutation.mutateAsync({ token: token! });
          setAutoAcceptComplete(true);
          toast.success(`Welcome to ${invitation.organization?.name}!`);

          // Refresh organization context and switch to the invited organization
          await refreshOrganizationContext();

          // Switch to the organization the user was invited to
          if (invitation.organization_id) {
            await switchOrganization(invitation.organization_id);
          }

          // Short delay to show success message before redirecting
          setTimeout(() => {
            navigate("/jobs", { replace: true });
          }, 1500);
        } catch (err: any) {
          // If already accepted, that's fine - redirect anyway
          if (err.message?.includes("already") || invitation.status === "accepted") {
            setAutoAcceptComplete(true);
            toast.success(`Welcome to ${invitation.organization?.name}!`);
            await refreshOrganizationContext();

            // Switch to the organization the user was invited to
            if (invitation.organization_id) {
              await switchOrganization(invitation.organization_id);
            }

            setTimeout(() => {
              navigate("/jobs", { replace: true });
            }, 1500);
          } else {
            setIsAutoAccepting(false);
            toast.error(err.message || "Failed to accept invitation");
          }
        }
      }
    };

    autoAccept();
  }, [isFromSupabaseMagicLink, user, invitation, token, isAutoAccepting, autoAcceptComplete, acceptMutation, navigate, refreshOrganizationContext, switchOrganization]);

  // Check if invitation is valid
  const isExpired = invitation?.expires_at
    ? new Date(invitation.expires_at) < new Date()
    : false;
  const isAlreadyAccepted = invitation?.status === "accepted";
  const isCancelled = invitation?.status === "cancelled";

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) return;

    // If user is already logged in, just accept
    if (user) {
      try {
        await acceptMutation.mutateAsync({ token });
        toast.success("Invitation accepted!");

        // Switch to the organization the user was invited to
        if (invitation?.organization_id) {
          await switchOrganization(invitation.organization_id);
        }

        navigate("/jobs");
      } catch (error: any) {
        toast.error(error.message || "Failed to accept invitation");
      }
      return;
    }

    // New user registration
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    try {
      await acceptMutation.mutateAsync({
        token,
        password,
        fullName: fullName || undefined,
      });
      toast.success("Account created and invitation accepted!");
      navigate("/auth");
    } catch (error: any) {
      toast.error(error.message || "Failed to accept invitation");
    }
  };

  // Show loading/processing state
  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
            <p className="mt-4 text-muted-foreground">Loading invitation...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show auto-accepting state when user arrived via magic link
  if (isAutoAccepting || autoAcceptComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            {autoAcceptComplete ? (
              <>
                <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
                <h3 className="font-medium mb-2">Welcome!</h3>
                <p className="text-sm text-muted-foreground">
                  You've joined {invitation?.organization?.name}. Redirecting...
                </p>
              </>
            ) : (
              <>
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                <p className="mt-4 text-muted-foreground">
                  Accepting invitation to {invitation?.organization?.name}...
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <XCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
            <h3 className="font-medium mb-2">Invalid Invitation</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This invitation link is invalid or has been removed.
            </p>
            <Button asChild>
              <Link to="/auth">Go to Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isExpired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <XCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
            <h3 className="font-medium mb-2">Invitation Expired</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This invitation has expired. Please contact the organization admin
              to send a new invitation.
            </p>
            <Button asChild>
              <Link to="/auth">Go to Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isAlreadyAccepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
            <h3 className="font-medium mb-2">Invitation Already Accepted</h3>
            <p className="text-sm text-muted-foreground mb-2">
              This invitation to <span className="font-medium">{invitation.organization?.name}</span> has already been accepted.
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              {user
                ? "You can access your workspace now."
                : "Please log in to access your workspace."}
            </p>
            <Button asChild>
              <Link to={user ? "/jobs" : "/auth"}>
                {user ? "Go to Workspace" : "Go to Login"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <XCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="font-medium mb-2">Invitation Cancelled</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This invitation has been cancelled by the organization admin.
            </p>
            <Button asChild>
              <Link to="/auth">Go to Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User is logged in - check if they arrived via Supabase invite (already added to org)
  if (user) {
    // Check if logged in user's email matches invitation
    const emailMatches = user.email === invitation.email;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Mail className="w-12 h-12 mx-auto mb-4 text-primary" />
            <CardTitle>Accept Invitation</CardTitle>
            <CardDescription>
              You've been invited to join{" "}
              <span className="font-medium text-foreground">
                {invitation.organization?.name || "an organization"}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!emailMatches && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                <p>
                  Note: This invitation was sent to{" "}
                  <span className="font-medium">{invitation.email}</span> but you're
                  logged in as <span className="font-medium">{user.email}</span>.
                </p>
              </div>
            )}
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Invited as</p>
                <p className="font-medium capitalize">{invitation.role}</p>
              </div>
              <Button
                className="w-full"
                onClick={handleAccept}
                disabled={acceptMutation.isPending}
              >
                {acceptMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Accepting...
                  </>
                ) : (
                  "Accept Invitation"
                )}
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/jobs">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User is not logged in - show registration form
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Mail className="w-12 h-12 mx-auto mb-4 text-primary" />
          <CardTitle>Accept Invitation</CardTitle>
          <CardDescription>
            You've been invited to join{" "}
            <span className="font-medium text-foreground">
              {invitation.organization?.name || "an organization"}
            </span>
            . Create your account to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAccept} className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input value={invitation.email} disabled className="bg-muted" />
            </div>
            <div>
              <Label htmlFor="fullName">Full Name (optional)</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
              />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Invited as</p>
              <p className="font-medium capitalize">{invitation.role}</p>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={acceptMutation.isPending}
            >
              {acceptMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Create Account & Accept"
              )}
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              Already have an account?{" "}
              <Link to="/auth" className="text-primary hover:underline">
                Log in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
