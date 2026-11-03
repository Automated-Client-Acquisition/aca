import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, MessageCircle, Sparkles, Target } from "lucide-react";
import type { ContentTeardown } from "@/hooks/useContentTeardown";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-background p-4 sm:p-5">
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
}

/** Read-only view of research_content.ai_analysis written by analyze-scraped-content. */
export function ContentTeardownPanel({
  teardown,
}: {
  teardown: ContentTeardown;
}) {
  const hasAnalysis = Object.entries(teardown).some(
    ([key, value]) =>
      !key.startsWith("_") &&
      !!value &&
      (!Array.isArray(value) || value.length > 0),
  );
  if (!hasAnalysis)
    return (
      <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        This analysis has no details yet. Re-analyze the post to generate a
        breakdown.
      </p>
    );

  return (
    <div className="space-y-4 break-words text-sm leading-6">
      {(teardown.format ||
        teardown.hook?.type ||
        teardown.topic ||
        teardown.summary) && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {teardown.format && (
              <Badge variant="secondary" className="capitalize">
                {teardown.format.replace(/_/g, " ")}
              </Badge>
            )}
            {teardown.hook?.type && (
              <Badge variant="outline" className="capitalize">
                {teardown.hook.type.replace(/_/g, " ")} hook
              </Badge>
            )}
            {teardown.topic && (
              <Badge variant="outline">{teardown.topic}</Badge>
            )}
          </div>
          {teardown.summary && (
            <p className="text-muted-foreground">{teardown.summary}</p>
          )}
        </div>
      )}

      {teardown.formula && (
        <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 sm:p-5">
          <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            <Lightbulb className="h-4 w-4" />
            The reusable formula
          </h4>
          <p className="font-medium leading-7">{teardown.formula}</p>
        </section>
      )}

      {(teardown.hook?.text || teardown.hook?.why_it_works) && (
        <Section title="01 · The hook">
          {teardown.hook.text && (
            <blockquote className="border-l-2 border-amber-500 pl-4 text-base font-medium leading-7">
              “{teardown.hook.text}”
            </blockquote>
          )}
          {teardown.hook.why_it_works && (
            <p className="mt-3 text-muted-foreground">
              {teardown.hook.why_it_works}
            </p>
          )}
        </Section>
      )}

      {!!teardown.structure?.length && (
        <Section title="02 · The content structure">
          <ol className="space-y-4">
            {teardown.structure.map((beat, index) => (
              <li key={index} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <p className="font-medium">
                      {beat.beat || `Beat ${index + 1}`}
                    </p>
                    {beat.approx_seconds != null && (
                      <span className="text-xs text-muted-foreground">
                        ~{beat.approx_seconds}s
                      </span>
                    )}
                  </div>
                  {beat.what_happens && (
                    <p className="mt-1">{beat.what_happens}</p>
                  )}
                  {beat.purpose && (
                    <p className="mt-1 text-muted-foreground">{beat.purpose}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {!!teardown.talking_points?.length && (
        <Section title="Key talking points">
          <ul className="list-disc space-y-2 pl-5 marker:text-amber-500">
            {teardown.talking_points.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        </Section>
      )}

      {(teardown.voice ||
        teardown.pacing ||
        teardown.visual_style ||
        teardown.audience) && (
        <Section title="The creative choices">
          <dl className="grid gap-5 sm:grid-cols-2">
            {[
              { label: "Voice", value: teardown.voice },
              { label: "Pacing", value: teardown.pacing },
              { label: "Visual style", value: teardown.visual_style },
              { label: "Audience", value: teardown.audience },
            ]
              .filter(({ value }) => !!value)
              .map(({ label, value }) => (
                <div key={label}>
                  <dt className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
        </Section>
      )}

      {!!teardown.ctas?.length && (
        <Section title="Calls to action">
          <ul className="space-y-3">
            {teardown.ctas.map((cta, index) => (
              <li key={index} className="flex gap-3">
                <Target className="mt-1 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-medium">{cta.text || "Call to action"}</p>
                  {(cta.type || cta.placement) && (
                    <p className="text-xs capitalize text-muted-foreground">
                      {[cta.type, cta.placement]
                        .filter(Boolean)
                        .join(" · ")
                        .replace(/_/g, " ")}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(teardown.engagement_drivers?.length || teardown.why_it_worked) && (
        <Section title="Why people responded">
          {!!teardown.engagement_drivers?.length && (
            <ul className="space-y-2">
              {teardown.engagement_drivers.map((driver, index) => (
                <li key={index} className="flex gap-2.5">
                  <MessageCircle className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>{driver}</span>
                </li>
              ))}
            </ul>
          )}
          {teardown.why_it_worked && (
            <div
              className={
                teardown.engagement_drivers?.length ? "mt-4 border-t pt-4" : ""
              }
            >
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                The takeaway
              </p>
              <p className="mt-2">{teardown.why_it_worked}</p>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
