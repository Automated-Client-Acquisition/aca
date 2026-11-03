import { useState } from "react";
import { Github, Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

// Community-only page (link shared inside the private community): anyone who
// submits a GitHub username gets invited to the org by github-org-invite.

const ORG = "Automated-Client-Acquisition";

type Result = {
  status: "invited" | "already_invited" | "already_member";
  login: string;
  invitation_url?: string;
  org_url?: string;
};

const GithubAccess = () => {
  const [username, setUsername] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setIsSubmitting(true);
    setError(null);

    const { data, error: fnError } = await supabase.functions.invoke("github-org-invite", {
      body: { username },
    });

    if (fnError) {
      // Non-2xx: the function's JSON error message is on the response context
      let message = "Something went wrong. Try again in a minute.";
      try {
        const body = await (fnError as { context?: Response }).context?.json();
        if (body?.error) message = body.error;
      } catch {
        // keep the generic message
      }
      setError(message);
    } else {
      setResult(data as Result);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-5">
      <div className="bg-card rounded-xl p-8 sm:p-10 max-w-md w-full shadow-sm border">
        {result ? (
          <div className="text-center">
            <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-6" />
            {result.status === "already_member" ? (
              <>
                <h1 className="text-2xl font-semibold text-foreground mb-3">You're already in</h1>
                <p className="text-muted-foreground mb-8">
                  <span className="font-medium text-foreground">@{result.login}</span> is already a member of the org.
                </p>
                <Button variant="cta" className="w-full" asChild>
                  <a href={result.org_url}>
                    Open the org <ExternalLink className="h-4 w-4 ml-2" />
                  </a>
                </Button>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-semibold text-foreground mb-3">Invite sent</h1>
                <p className="text-muted-foreground mb-8">
                  GitHub emailed <span className="font-medium text-foreground">@{result.login}</span> an invite.
                  Accept it to see the repos.
                </p>
                <Button variant="cta" className="w-full" asChild>
                  <a href={result.invitation_url}>
                    Accept the invite <ExternalLink className="h-4 w-4 ml-2" />
                  </a>
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            <Github className="h-12 w-12 text-foreground mx-auto mb-6" />
            <h1 className="text-2xl font-semibold text-foreground text-center mb-3">
              Get access to my GitHub
            </h1>
            <p className="text-muted-foreground text-center mb-8">
              Enter your GitHub username and you'll get an invite to the{" "}
              <span className="font-medium text-foreground">{ORG}</span> org, with every repo I share with the community.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="github-username">GitHub username</Label>
                <Input
                  id="github-username"
                  placeholder="octocat"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" variant="cta" className="w-full" disabled={isSubmitting || !username.trim()}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send me the invite"}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground/70 text-center mt-6">
              No account yet?{" "}
              <a href="https://github.com/signup" className="underline">
                Create one on GitHub
              </a>{" "}
              first.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default GithubAccess;
