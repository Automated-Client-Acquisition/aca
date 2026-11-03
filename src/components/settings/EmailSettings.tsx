import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Loader2,
  RefreshCw,
  Building2,
  Download,
  Zap,
  Globe,
  Trash2,
  Star,
  Plus,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useZapMailApiKeys,
  useImportFromStoredKey,
} from "@/hooks/useZapMailApiKeys";
import {
  useTrackingDomains,
  useCreateTrackingDomain,
  useDeleteTrackingDomain,
  useSetDefaultTrackingDomain,
} from "@/hooks/useTrackingDomains";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ZapMailApiKey } from "@/types/email";

interface Workspace {
  id: string;
  name: string;
  domainCount: string;
  mailboxCount: string;
}

export function EmailSettings() {
  const { currentOrganization } = useAuth();
  const { data: storedKeys, isLoading: keysLoading } = useZapMailApiKeys();

  const importFromKey = useImportFromStoredKey();

  // Workspace picker
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string>>(new Set());
  const [isListingWorkspaces, setIsListingWorkspaces] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Sync
  const [isSyncing, setIsSyncing] = useState(false);

  const handleImportSelectedWorkspaces = async () => {
    if (!pendingKeyId || selectedWorkspaceIds.size === 0) return;

    setIsImporting(true);
    try {
      for (const wsId of selectedWorkspaceIds) {
        const wsName = workspaces.find((w) => w.id === wsId)?.name;
        await importFromKey.mutateAsync({
          key_id: pendingKeyId,
          workspace_id: wsId,
          workspace_name: wsName,
        });
      }
      resetWorkspacePicker();
    } catch {
      // Error toast handled by mutation hooks
    } finally {
      setIsImporting(false);
    }
  };

  const handleReimportWithWorkspaces = async (keyId: string) => {
    setPendingKeyId(keyId);
    setIsListingWorkspaces(true);
    try {
      const wsResponse = await supabase.functions.invoke("zapmail-connect", {
        body: {
          action: "list_workspaces",
          key_id: keyId,
        },
      });

      if (wsResponse.error || !wsResponse.data?.success) {
        // Can't list workspaces — import all
        await importFromKey.mutateAsync({ key_id: keyId });
        setPendingKeyId(null);
        return;
      }

      const ws: Workspace[] = wsResponse.data.workspaces || [];

      if (ws.length <= 1) {
        // Single/no workspace — import directly
        await importFromKey.mutateAsync({
          key_id: keyId,
          workspace_id: ws[0]?.id,
          workspace_name: ws[0]?.name,
        });
        setPendingKeyId(null);
      } else {
        // Multiple workspaces — show picker
        setWorkspaces(ws);
        setSelectedWorkspaceIds(new Set(ws.map((w) => w.id)));
      }
    } catch {
      // Error toast handled by mutation hooks
    } finally {
      setIsListingWorkspaces(false);
    }
  };

  const handleSyncAll = async () => {
    if (!currentOrganization) return;

    setIsSyncing(true);
    try {
      const response = await supabase.functions.invoke("zapmail-sync", {
        body: { organization_id: currentOrganization.id },
      });

      if (response.error) {
        throw new Error(response.error.message || "Sync failed");
      }

      const data = response.data;
      toast.success(
        `Sync complete: ${data.synced} synced, ${data.disconnected} disconnected`
      );
    } catch (error) {
      toast.error(
        `Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const resetWorkspacePicker = () => {
    setPendingKeyId(null);
    setWorkspaces([]);
    setSelectedWorkspaceIds(new Set());
    setIsListingWorkspaces(false);
  };

  const toggleWorkspace = (id: string) => {
    const next = new Set(selectedWorkspaceIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedWorkspaceIds(next);
  };

  const hasKeys = storedKeys && storedKeys.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Tracking &amp; imports</h2>
        <p className="text-muted-foreground">
          Tracking domains for opens and clicks, and mailbox imports from ZapMail.
        </p>
      </div>

      {/* ZapMail Import */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                ZapMail Import
              </CardTitle>
              <CardDescription>
                Import mailboxes from ZapMail. Add your ZapMail API key in the API
                Keys section above, then import workspaces here.
              </CardDescription>
            </div>
            {hasKeys && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncAll}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Sync All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {keysLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading keys...
            </div>
          ) : (
            <>
              {/* Stored ZapMail key list */}
              {hasKeys && (
                <div className="space-y-2">
                  {storedKeys!.map((key) => (
                    <KeyRow
                      key={key.id}
                      storedKey={key}
                      onImportWorkspaces={(keyId) =>
                        handleReimportWithWorkspaces(keyId)
                      }
                      isImporting={
                        importFromKey.isPending && pendingKeyId === key.id
                      }
                    />
                  ))}
                </div>
              )}

              {!hasKeys && (
                <div className="text-center py-6">
                  <Zap className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No ZapMail API keys found. Add one in the API Keys section
                    (provider: ZapMail) to get started.
                  </p>
                </div>
              )}

              {/* Workspace picker (shown after re-import when multiple workspaces exist) */}
              {pendingKeyId && workspaces.length > 1 && (
                <div className="space-y-4 p-4 rounded-lg border border-primary/20 bg-primary/5">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">
                      Select workspaces to import ({workspaces.length} found)
                    </Label>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {workspaces.map((ws) => (
                      <label
                        key={ws.id}
                        className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={selectedWorkspaceIds.has(ws.id)}
                          onCheckedChange={() => toggleWorkspace(ws.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{ws.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {ws.domainCount} domain{ws.domainCount !== "1" ? "s" : ""},{" "}
                            {ws.mailboxCount} mailbox{ws.mailboxCount !== "1" ? "es" : ""}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleImportSelectedWorkspaces}
                      disabled={selectedWorkspaceIds.size === 0 || isImporting}
                    >
                      {isImporting ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      Import from {selectedWorkspaceIds.size} workspace
                      {selectedWorkspaceIds.size !== 1 ? "s" : ""}
                    </Button>
                    <Button variant="outline" onClick={resetWorkspacePicker}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Loading workspaces indicator */}
              {isListingWorkspaces && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading workspaces...
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Tracking Domains */}
      <TrackingDomainsCard />
    </div>
  );
}

// ============================================================================
// Tracking Domains Card
// ============================================================================

function TrackingDomainsCard() {
  const { data: domains, isLoading } = useTrackingDomains();
  const createDomain = useCreateTrackingDomain();
  const deleteDomain = useDeleteTrackingDomain();
  const setDefault = useSetDefaultTrackingDomain();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleAdd = () => {
    if (!newDomain.trim()) return;
    createDomain.mutate(newDomain, {
      onSuccess: () => {
        setShowAddDialog(false);
        setNewDomain("");
      },
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteDomain.mutate(deleteTarget, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const supabaseHost = (() => {
    try {
      return new URL(import.meta.env.VITE_SUPABASE_URL).hostname;
    } catch {
      return "your-project.supabase.co";
    }
  })();

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Tracking Domains
              </CardTitle>
              <CardDescription>
                Custom domains for email tracking. Required before activating
                any email sequence.
              </CardDescription>
            </div>
            {domains && domains.length > 0 && (
              <Button
                variant="cta"
                size="sm"
                onClick={() => setShowAddDialog(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Domain
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : !domains || domains.length === 0 ? (
            <div className="text-center py-8">
              <Globe className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium mb-1">
                No tracking domains configured
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
                Add a custom tracking domain to protect your sender reputation
                and avoid blacklisting. This is required before you can activate
                any email sequence.
              </p>
              <Button variant="cta" onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Domain
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {domains.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {d.domain}
                    </span>
                    {d.is_default && (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20 shrink-0"
                      >
                        Default
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!d.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setDefault.mutate(d.id)}
                        disabled={setDefault.isPending}
                      >
                        <Star className="h-3 w-3 mr-1" />
                        Set Default
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(d.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Domain Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tracking Domain</DialogTitle>
            <DialogDescription>
              Add a custom subdomain for email tracking (e.g.
              track.yourdomain.com).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Domain</Label>
              <Input
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="track.yourdomain.com"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            <div className="rounded-md bg-muted/50 p-3 space-y-2">
              <p className="text-xs font-medium text-foreground">
                DNS Setup Instructions
              </p>
              <p className="text-xs text-muted-foreground">
                Add a CNAME record in your DNS settings:
              </p>
              <div className="flex items-center gap-2 bg-background rounded border px-3 py-2">
                <code className="text-xs flex-1 text-foreground">
                  {newDomain || "track.yourdomain.com"} &rarr; {supabaseHost}
                </code>
              </div>
              <p className="text-xs text-muted-foreground">
                This routes tracking requests through your domain so your sender
                reputation stays separate. SSL is handled automatically.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleAdd}
              disabled={!newDomain.trim() || createDomain.isPending}
            >
              {createDomain.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Add Domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tracking domain?</AlertDialogTitle>
            <AlertDialogDescription>
              Any email sequences using this domain will need a new tracking
              domain assigned before they can send. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============================================================================
// Key Row Component
// ============================================================================

function KeyRow({
  storedKey,
  onImportWorkspaces,
  isImporting,
}: {
  storedKey: ZapMailApiKey;
  onImportWorkspaces: (keyId: string) => void;
  isImporting: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{storedKey.name}</p>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] shrink-0",
                storedKey.is_valid
                  ? "bg-green-500/10 text-green-600 border-green-500/20"
                  : "bg-red-500/10 text-red-500 border-red-500/20"
              )}
            >
              {storedKey.is_valid ? "Valid" : "Invalid"}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-muted-foreground font-mono">
              {storedKey.key_hint}
            </span>
            {storedKey.workspace_ids.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {storedKey.workspace_ids.length} workspace
                {storedKey.workspace_ids.length !== 1 ? "s" : ""}
              </span>
            )}
            {storedKey.last_sync_at && (
              <span className="text-xs text-muted-foreground">
                Synced{" "}
                {new Date(storedKey.last_sync_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onImportWorkspaces(storedKey.id)}
          disabled={isImporting || !storedKey.is_valid}
          className="h-7 px-2 text-xs shrink-0"
        >
          {isImporting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3 mr-1" />
          )}
          Re-import
        </Button>
      </div>
    </div>
  );
}
