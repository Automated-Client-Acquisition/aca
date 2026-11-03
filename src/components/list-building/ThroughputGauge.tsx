import { useEffect, useRef } from "react";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useListBuildingThroughput,
  type ListBuildingThroughput,
} from "@/hooks/useListBuilding";
import { formatDistanceToNowStrict } from "date-fns";

interface ThroughputGaugeProps {
  jobId: string;
  enabled?: boolean;
}

const STAGES: Array<{ key: string; label: string }> = [
  { key: "discovery", label: "Discovery" },
  { key: "dm", label: "DM ID" },
  { key: "pattern", label: "Pattern" },
  { key: "smtp", label: "SMTP" },
  { key: "icp", label: "ICP" },
];

const WINDOW = 60;

type SparkPoint = { t: number; v: number };

export function ThroughputGauge({ jobId, enabled = true }: ThroughputGaugeProps) {
  const { data, isLoading } = useListBuildingThroughput(jobId, enabled);
  const historyRef = useRef<Record<string, SparkPoint[]>>({});

  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    for (const stage of STAGES) {
      const arr = historyRef.current[stage.key] ?? [];
      const per = data.per_stage[stage.key]?.per_sec ?? 0;
      arr.push({ t: now, v: per });
      while (arr.length > WINDOW) arr.shift();
      historyRef.current[stage.key] = arr;
    }
  }, [data]);

  if (isLoading && !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Throughput</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Connecting to workers...
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Live throughput</span>
            <span className="text-xs text-muted-foreground font-normal">
              updated {formatDistanceToNowStrict(new Date(data.generated_at))} ago
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {STAGES.map((stage) => {
              const info = data.per_stage[stage.key];
              const hist = historyRef.current[stage.key] ?? [];
              return (
                <div key={stage.key} className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{stage.label}</span>
                    <span className="text-muted-foreground">
                      {info?.per_sec ?? 0}/s
                    </span>
                  </div>
                  <div className="h-10">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={hist}>
                        <YAxis hide domain={[0, "dataMax + 1"]} />
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>in-flight {info?.in_flight ?? 0}</span>
                    <span>pend {info?.pending ?? 0}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <WorkersCard data={data} />
        <MxHotspotsCard data={data} />
      </div>
    </div>
  );
}

function WorkersCard({ data }: { data: ListBuildingThroughput }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Active workers ({data.workers.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {data.workers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No workers heartbeating.</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-auto">
            {data.workers.map((w) => (
              <div
                key={w.worker_id}
                className="flex items-center justify-between text-xs border-b border-border/40 py-1 last:border-b-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="font-mono truncate">{w.worker_id}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {w.kind}
                  </Badge>
                </div>
                <div className="text-muted-foreground shrink-0 ml-2">
                  {w.throughput_per_sec}/s · {formatDistanceToNowStrict(new Date(w.last_seen_at))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MxHotspotsCard({ data }: { data: ListBuildingThroughput }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">MX hotspots (5 min)</CardTitle>
      </CardHeader>
      <CardContent>
        {data.mx_hotspots.length === 0 ? (
          <p className="text-xs text-muted-foreground">No MX traffic yet.</p>
        ) : (
          <div className="space-y-1">
            {data.mx_hotspots.map((mx) => {
              const ratio = mx.attempts > 0 ? mx.rate_limit_hits / mx.attempts : 0;
              const dot =
                ratio > 0.2 ? "bg-red-500" : ratio > 0.05 ? "bg-amber-500" : "bg-emerald-500";
              return (
                <div
                  key={mx.mx_host}
                  className="flex items-center justify-between text-xs border-b border-border/40 py-1 last:border-b-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
                    <span className="font-mono truncate">{mx.mx_host}</span>
                  </div>
                  <div className="text-muted-foreground shrink-0 ml-2">
                    {mx.successes}/{mx.attempts} ok · {mx.rate_limit_hits} 4xx
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
