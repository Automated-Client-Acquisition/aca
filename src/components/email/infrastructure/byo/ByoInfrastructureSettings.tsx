import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Server, Info } from "lucide-react";
import { useAllByoIps, useByoServers, useDeleteByoServer } from "@/hooks/useByoServers";
import { ByoServerCard } from "./ByoServerCard";
import { ConnectByoServerWizard } from "./ConnectByoServerWizard";
import { DeliverabilityPanel } from "./DeliverabilityPanel";

export function ByoInfrastructureSettings() {
  const { data: servers = [], isLoading } = useByoServers();
  const { data: allIps = [] } = useAllByoIps();
  const deleteServer = useDeleteByoServer();
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const totalIps = allIps.filter((i) => i.status === "active").length;
  const readyServers = servers.filter((s) => s.status === "ready").length;

  const handleRemove = () => {
    if (!removeTarget) return;
    deleteServer.mutate(removeTarget.id);
    setRemoveTarget(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Bring Your Own Server</h2>
        <p className="text-muted-foreground">
          Deploy Postfix + OpenDKIM + Dovecot onto a server you own. We handle the install, DNS, IP
          rotation, and blocklist monitoring. You keep full control of the infrastructure.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Port 25 outbound is required</AlertTitle>
        <AlertDescription>
          Most cloud providers (AWS, GCP, Azure, DigitalOcean) block outbound port 25 by default. Use a
          provider that allows it: <strong>Hetzner, OVH, IONOS, contabo</strong>, or request unblock
          from Vultr/Linode. We probe port 25 connectivity from your server before deploying.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold">{servers.length}</div>
            <div className="text-sm text-muted-foreground">Servers</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold">{readyServers}</div>
            <div className="text-sm text-muted-foreground">Ready</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold">{totalIps}</div>
            <div className="text-sm text-muted-foreground">Sending IPs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold">—</div>
            <div className="text-sm text-muted-foreground">Active mailboxes</div>
          </CardContent>
        </Card>
      </div>

      <DeliverabilityPanel />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Server className="w-5 h-5" />
            Servers
          </h3>
          <p className="text-sm text-muted-foreground">
            Connect a server, deploy the mail stack, then add domains and mailboxes.
          </p>
        </div>
        <Button variant="cta" size="sm" onClick={() => setShowWizard(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Connect Server
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : servers.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No servers connected yet.</p>
              <p className="text-sm">Connect your first server to deploy the BYO mail stack.</p>
              <Button variant="cta" size="sm" className="mt-4" onClick={() => setShowWizard(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Connect Server
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <ByoServerCard
              key={server.id}
              server={server}
              onRemove={() => setRemoveTarget({ id: server.id, name: server.name })}
              removing={deleteServer.isPending}
            />
          ))}
        </div>
      )}

      <ConnectByoServerWizard open={showWizard} onOpenChange={setShowWizard} />

      <AlertDialog open={!!removeTarget} onOpenChange={() => setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove server</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <strong>{removeTarget?.name}</strong> from ACA. The server itself is
              untouched — you'll still need to clean up Postfix, DNS, and any mailboxes manually if
              you want a full teardown.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
