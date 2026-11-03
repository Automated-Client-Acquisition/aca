import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useProxyPool,
  useUpsertProxy,
  type ProxyPoolEntry,
  type UpsertProxyInput,
} from "@/hooks/useListBuilding";

const PROVIDERS: ProxyPoolEntry["provider"][] = [
  "brightdata",
  "smartproxy",
  "oxylabs",
  "custom",
];
const TYPES: ProxyPoolEntry["proxy_type"][] = [
  "datacenter",
  "residential",
  "dedicated_smtp",
];

export function ProxyPoolManager() {
  const { data: proxies = [], isLoading } = useProxyPool();
  const upsert = useUpsertProxy();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<UpsertProxyInput>({
    provider: "custom",
    proxy_type: "datacenter",
    host: "",
    port: 8080,
    username: "",
    password: "",
    active: true,
  });

  const reset = () => {
    setForm({
      provider: "custom",
      proxy_type: "datacenter",
      host: "",
      port: 8080,
      username: "",
      password: "",
      active: true,
    });
  };

  const handleSubmit = () => {
    upsert.mutate(form, {
      onSuccess: () => {
        setOpen(false);
        reset();
      },
    });
  };

  const handleRetire = (proxy: ProxyPoolEntry) => {
    upsert.mutate({
      id: proxy.id,
      provider: proxy.provider,
      proxy_type: proxy.proxy_type,
      host: proxy.host,
      port: proxy.port,
      retired: true,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Proxy Pool</h2>
          <p className="text-sm text-muted-foreground">
            BYO proxies used across discovery and SMTP verification.
          </p>
        </div>
        <Button variant="cta" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Proxy
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Host</TableHead>
              <TableHead className="text-right">Port</TableHead>
              <TableHead className="text-right">Success</TableHead>
              <TableHead className="text-right">Fail</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : proxies.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  No proxies configured.
                </TableCell>
              </TableRow>
            ) : (
              proxies.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.provider}</TableCell>
                  <TableCell>{p.proxy_type}</TableCell>
                  <TableCell className="font-mono text-xs">{p.host}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {p.port}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.success_count}
                  </TableCell>
                  <TableCell className="text-right">{p.fail_count}</TableCell>
                  <TableCell>
                    {p.retired_at ? (
                      <Badge variant="outline">retired</Badge>
                    ) : p.active ? (
                      <Badge
                        variant="outline"
                        className="bg-green-500/15 text-green-600 border-green-500/30"
                      >
                        active
                      </Badge>
                    ) : (
                      <Badge variant="outline">inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!p.retired_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRetire(p)}
                        disabled={upsert.isPending}
                      >
                        Retire
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add proxy</DialogTitle>
            <DialogDescription>
              Credentials are encrypted server-side.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={form.provider}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      provider: v as ProxyPoolEntry["provider"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.proxy_type}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      proxy_type: v as ProxyPoolEntry["proxy_type"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-4">
              <div className="space-y-2">
                <Label htmlFor="host">Host</Label>
                <Input
                  id="host"
                  placeholder="proxy.example.com"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  value={form.port}
                  onChange={(e) =>
                    setForm({ ...form, port: Number(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="user">Username</Label>
                <Input
                  id="user"
                  value={form.username ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pass">Password</Label>
                <Input
                  id="pass"
                  type="password"
                  value={form.password ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleSubmit}
              disabled={!form.host || !form.port || upsert.isPending}
            >
              {upsert.isPending ? "Saving..." : "Add Proxy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
