import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/ui/copy-button";
import { useLinkedInAudit } from "@/hooks/useLinkedInAudit";
import { Linkedin, Sparkles, ExternalLink, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const SUB_SCORES: { key: "headline_score" | "about_score" | "activity_score" | "banner_score"; label: string }[] = [
  { key: "headline_score", label: "Headline" },
  { key: "about_score", label: "About" },
  { key: "activity_score", label: "Activity" },
  { key: "banner_score", label: "Banner" },
];

function scoreColor(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 8) return "text-green-500";
  if (score >= 5) return "text-amber-500";
  return "text-red-500";
}

export default function LibraryAudits() {
  const navigate = useNavigate();
  const { data: audit, isLoading } = useLinkedInAudit();

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Linkedin className="h-5 w-5 text-primary" />
              Your LinkedIn Audit
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Score, headline rewrite, and About section - paste-ready.
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-40 w-full rounded-2xl" />
              <Skeleton className="h-40 w-full rounded-2xl" />
            </div>
          ) : !audit || audit.status !== "done" ? (
            <div className="text-center py-20 bg-gradient-to-b from-muted/30 to-muted/10 rounded-2xl border border-dashed">
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-muted/50 flex items-center justify-center">
                <Linkedin className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-xl font-semibold mb-2">
                {audit?.status === "pending" ? "Your audit is running" : "No LinkedIn audit yet"}
              </h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
                {audit?.status === "pending"
                  ? "We're scoring your profile now - check back in a few minutes."
                  : "Connect your LinkedIn account and we'll score your profile, then write you a new headline and About section."}
              </p>
              {audit?.status !== "pending" && (
                <Button variant="cta" size="lg" className="shadow-lg" onClick={() => navigate("/settings?tab=senders")}>
                  <Linkedin className="h-4 w-4 mr-2" />
                  Connect LinkedIn + run my audit
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Score card */}
              <div className="border rounded-2xl p-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Overall score
                    </div>
                    <div className={cn("text-4xl font-bold", scoreColor(audit.overall_score))}>
                      {audit.overall_score != null ? `${audit.overall_score}/10` : "-"}
                    </div>
                  </div>
                  {audit.linkedin_url && (
                    <a
                      href={audit.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      View profile <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                  {SUB_SCORES.map(({ key, label }) => (
                    <div key={key} className="border rounded-xl p-3 text-center">
                      <div className={cn("text-lg font-semibold", scoreColor(audit[key]))}>
                        {audit[key] != null ? `${audit[key]}/10` : "-"}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>

                {audit.updated_at && (
                  <div className="text-xs text-muted-foreground mt-4">
                    Last updated {formatDistanceToNow(new Date(audit.updated_at), { addSuffix: true })}
                  </div>
                )}
              </div>

              {/* Headline rewrite */}
              {audit.headline_rewrite && (
                <div className="border rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">New headline</h3>
                    <CopyButton text={audit.headline_rewrite} />
                  </div>
                  <p className="text-sm italic">"{audit.headline_rewrite}"</p>
                </div>
              )}

              {/* About rewrite */}
              {audit.about_rewrite && (
                <div className="border rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">New About section</h3>
                    <CopyButton text={audit.about_rewrite} />
                  </div>
                  <p className="text-sm whitespace-pre-line leading-relaxed">{audit.about_rewrite}</p>
                </div>
              )}

              {/* Summary */}
              {audit.summary && (
                <div className="border rounded-2xl p-6 bg-muted/20">
                  <h3 className="text-sm font-semibold mb-2">Summary</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{audit.summary}</p>
                </div>
              )}

              {/* Recommendations */}
              {Array.isArray(audit.recommendations) && audit.recommendations.length > 0 && (
                <div className="border rounded-2xl p-6">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Recommendations
                  </h3>
                  <ul className="space-y-2">
                    {(audit.recommendations as string[]).map((rec, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-primary/60 mt-0.5 shrink-0" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-center pt-2">
                <Badge variant="secondary" className="text-[11px]">
                  Ask us to re-run your audit any time your profile changes
                </Badge>
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
