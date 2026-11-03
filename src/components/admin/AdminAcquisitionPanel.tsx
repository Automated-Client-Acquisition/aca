import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Megaphone } from "lucide-react";
import { useAcquisitionMetrics, type AcquisitionRange } from "@/hooks/useAcquisitionMetrics";

/**
 * First-party view of where signups come from and what happens to them.
 * The ad platforms each report only their own traffic and none of them know
 * whether the workspace built or the subscription stuck - this does.
 */
export function AdminAcquisitionPanel() {
  const [range, setRange] = useState<AcquisitionRange>("30d");
  const { data, isLoading } = useAcquisitionMetrics(range);

  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "-");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="w-5 h-5" />
                Acquisition
              </CardTitle>
              <CardDescription>
                Signup to built workspace to paying customer, split by where the traffic came from.
              </CardDescription>
            </div>
            <Select value={range} onValueChange={(v) => setRange(v as AcquisitionRange)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Signups" value={data?.totals.signups ?? 0} />
              <Stat
                label="Workspaces built"
                value={data?.totals.built ?? 0}
                sub={pct(data?.totals.built ?? 0, data?.totals.signups ?? 0)}
              />
              <Stat
                label="Paying"
                value={data?.totals.paying ?? 0}
                sub={pct(data?.totals.paying ?? 0, data?.totals.signups ?? 0)}
              />
              <Stat
                label="From paid ads"
                value={data?.totals.paidTraffic ?? 0}
                sub={pct(data?.totals.paidTraffic ?? 0, data?.totals.signups ?? 0)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By channel</CardTitle>
          <CardDescription>
            Built is the honest activation number - a signup whose workspace never
            generated is not a customer, whatever the pixel reported.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-32" /> : !data?.channels.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No signups in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="text-left font-medium py-2">Channel</th>
                    <th className="text-left font-medium py-2">Campaign</th>
                    <th className="text-right font-medium py-2">Signups</th>
                    <th className="text-right font-medium py-2">Built</th>
                    <th className="text-right font-medium py-2">Paying</th>
                    <th className="text-right font-medium py-2">Signup → paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.channels.map((c) => (
                    <tr key={`${c.channel}-${c.campaign ?? ""}`} className="border-b last:border-0">
                      <td className="py-2">
                        <span className="font-medium">{c.channel}</span>
                        {c.paid && <Badge variant="secondary" className="ml-2">paid</Badge>}
                      </td>
                      <td className="py-2 text-muted-foreground">{c.campaign || "-"}</td>
                      <td className="py-2 text-right">{c.signups}</td>
                      <td className="py-2 text-right">{c.built}</td>
                      <td className="py-2 text-right font-medium">{c.paying}</td>
                      <td className="py-2 text-right">{pct(c.paying, c.signups)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent signups</CardTitle>
          <CardDescription>Most recent 50, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-40" /> : !data?.recent.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nothing yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="text-left font-medium py-2">When</th>
                    <th className="text-left font-medium py-2">Email</th>
                    <th className="text-left font-medium py-2">Channel</th>
                    <th className="text-left font-medium py-2">Build</th>
                    <th className="text-left font-medium py-2">Subscription</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => (
                    <tr key={`${r.email}-${r.submittedAt}`} className="border-b last:border-0">
                      <td className="py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(r.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </td>
                      <td className="py-2">{r.email}</td>
                      <td className="py-2">
                        {r.channel}
                        {r.campaign && <span className="text-muted-foreground"> · {r.campaign}</span>}
                      </td>
                      <td className="py-2">
                        <Badge variant={r.buildStatus === "done" ? "default" : r.buildStatus === "running" ? "secondary" : "outline"}>
                          {r.buildStatus === "none" ? "never started" : r.buildStatus}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <Badge variant={r.subscription === "paying" ? "default" : "outline"}>
                          {r.subscription}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub} of signups</div>}
    </div>
  );
}
