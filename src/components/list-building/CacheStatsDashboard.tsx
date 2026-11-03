import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCacheStats,
  useInvalidateCachedDomain,
} from "@/hooks/useListBuilding";

export function CacheStatsDashboard() {
  const { data: stats, isLoading } = useCacheStats();
  const invalidate = useInvalidateCachedDomain();
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");

  const handleInvalidate = () => {
    if (!domain.trim()) return;
    invalidate.mutate(domain.trim(), {
      onSuccess: () => {
        setOpen(false);
        setDomain("");
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Domain Pattern Cache</h2>
          <p className="text-sm text-muted-foreground">
            The moat: cached patterns make pattern inference instant.
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Invalidate domain
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total domains
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {isLoading ? "..." : (stats?.total_domains ?? 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Hit rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {isLoading ? "..." : `${stats?.hit_rate ?? 0}%`}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Avg confidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {isLoading ? "..." : `${stats?.avg_confidence ?? 0}%`}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By tier</CardTitle>
        </CardHeader>
        <CardContent>
          {stats?.by_tier && stats.by_tier.length > 0 ? (
            <div className="space-y-2">
              {stats.by_tier.map((t) => (
                <div
                  key={t.tier}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">Tier {t.tier}</span>
                  <span className="font-medium">
                    {t.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No tier data yet.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invalidate domain</DialogTitle>
            <DialogDescription>
              Force re-inference for this domain on the next job.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleInvalidate}
              disabled={!domain.trim() || invalidate.isPending}
            >
              Invalidate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
