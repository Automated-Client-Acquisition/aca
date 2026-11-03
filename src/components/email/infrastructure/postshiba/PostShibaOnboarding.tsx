import { ArrowUpRight, CheckCircle2, Globe, KeyRound, Plug, Send, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: Plug,
    title: "Connect your team",
    body: "Paste your PostShiba team id and an API key, pick the cluster to send through, then choose or create the tenant your domains live in.",
  },
  {
    icon: Globe,
    title: "Add a sending domain",
    body: "ACA creates it in PostShiba and publishes the DNS records to Cloudflare for you.",
  },
  {
    icon: Users,
    title: "Add senders",
    body: "Name the people who send from each domain and set how many emails each sends a day.",
  },
];

const NEEDS = [
  {
    title: "A verified PostShiba account",
    detail: "PostShiba checks new businesses before they can email anyone outside their own team.",
  },
  {
    title: "A sending cluster in that account",
    detail: "The servers your email goes out through. Each cluster is a paid PostShiba plan you create in PostShiba. Choose Bulk for cold email.",
  },
  {
    title: "An API key",
    detail: "Create one on PostShiba's API keys page, where you'll also find your team id.",
  },
];

export const POSTSHIBA_APP_URL = "https://app.postshiba.com";

export function PostShibaOnboarding({ onConnect }: { onConnect: () => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-gradient-to-br from-cta/25 via-cta/5 to-transparent px-6 py-6 sm:px-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-cta text-cta-foreground shadow-sm">
            <Send className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <h3 className="text-lg font-semibold leading-tight">Send cold email at volume with PostShiba</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Send from dedicated domains through your own PostShiba team. ACA handles the domain
              setup, and replies come back to the ACA inbox like any other mailbox.
            </p>
          </div>
        </div>
      </div>

      <CardContent className="space-y-6 px-6 py-6 sm:px-8">
        <ol className="grid gap-3 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-xl border bg-muted/20 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
                  {i + 1}
                </span>
                <step.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-sm font-medium">{step.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-5 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" />
              Before you start
            </div>
            <ul className="space-y-2.5">
              {NEEDS.map((need) => (
                <li key={need.title} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-500" />
                  <div>
                    <div className="text-sm">{need.title}</div>
                    <div className="text-xs text-muted-foreground">{need.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-shrink-0 flex-col gap-2 sm:items-end">
            <Button variant="cta" onClick={onConnect}>
              <Plug className="h-4 w-4" />
              Connect PostShiba
            </Button>
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <a href={POSTSHIBA_APP_URL} target="_blank" rel="noreferrer">
                Open PostShiba
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
