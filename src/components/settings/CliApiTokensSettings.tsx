import { useState } from "react";
import { useApiTokens, type ApiToken, type IssuedToken } from "@/hooks/useApiTokens";
import { useNetworkAccess } from "@/hooks/useNetworkAccess";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Copy, Trash2, Terminal, Clock, ShieldCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const DEFAULT_EXPIRES_IN_DAYS = 365;

export function CliApiTokensSettings() {
  const { tokens, isLoading, createToken, revokeToken, isCreating, isRevoking } =
    useApiTokens();
  const [showCreate, setShowCreate] = useState(false);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [tokenToRevoke, setTokenToRevoke] = useState<ApiToken | null>(null);
  const [newName, setNewName] = useState("");
  const [newExpiresDays, setNewExpiresDays] = useState<number>(DEFAULT_EXPIRES_IN_DAYS);
  const [newNetwork, setNewNetwork] = useState(false);
  const [newCredentials, setNewCredentials] = useState(false);
  const { data: networkAccess } = useNetworkAccess();
  const networkApproved = networkAccess?.network_status === "approved";

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error("Name is required");
      return;
    }
    const scopes: string[] = [];
    if (networkApproved && (newNetwork || newCredentials)) scopes.push("network");
    if (networkApproved && newCredentials) scopes.push("network:credentials");
    try {
      const result = await createToken({
        name: newName.trim(),
        expires_in_days: newExpiresDays,
        scopes,
      });
      setIssued(result);
      setShowCreate(false);
      setNewName("");
      setNewExpiresDays(DEFAULT_EXPIRES_IN_DAYS);
      setNewNetwork(false);
      setNewCredentials(false);
    } catch {
      // toast handled inside hook
    }
  };

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  };

  const handleRevoke = () => {
    if (tokenToRevoke) {
      revokeToken(tokenToRevoke.id);
      setTokenToRevoke(null);
    }
  };

  const visibleTokens = tokens.filter((t) => !t.revoked_at);
  const revokedCount = tokens.length - visibleTokens.length;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                CLI API Tokens
              </CardTitle>
              <CardDescription>
                Long-lived tokens for the <code className="text-xs">aca-cli</code> command-line tool.
                Each token is bound to your account and current organization.
              </CardDescription>
            </div>
            <Button variant="cta" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Generate token
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading tokens…</div>
          ) : visibleTokens.length === 0 ? (
            <div className="text-center py-12 border border-dashed rounded-lg">
              <Terminal className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">No CLI tokens yet</p>
              <p className="text-xs text-muted-foreground mb-4">
                Generate one to authenticate <code>aca login</code> from your terminal.
              </p>
              <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Generate your first token
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleTokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium truncate">{token.name}</span>
                      {token.scopes
                        ?.filter((s) => s !== "cli")
                        .map((s) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">
                            {s}
                          </Badge>
                        ))}
                      {isExpired(token) ? (
                        <Badge variant="destructive" className="text-[10px]">Expired</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <code className="font-mono">{token.token_prefix}…</code>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Created {formatDistanceToNow(new Date(token.created_at), { addSuffix: true })}
                      </span>
                      {token.last_used_at ? (
                        <span>
                          Last used {formatDistanceToNow(new Date(token.last_used_at), { addSuffix: true })}
                        </span>
                      ) : (
                        <span>Never used</span>
                      )}
                      {token.expires_at && !isExpired(token) && (
                        <span>
                          Expires {formatDistanceToNow(new Date(token.expires_at), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTokenToRevoke(token)}
                    disabled={isRevoking}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              {revokedCount > 0 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  {revokedCount} revoked token{revokedCount === 1 ? "" : "s"} hidden.
                </p>
              )}
            </div>
          )}

          <div className="mt-6 p-4 rounded-lg bg-muted/50 border">
            <h4 className="font-medium text-sm mb-2">How to use</h4>
            <ol className="text-xs text-muted-foreground space-y-1.5 ml-4 list-decimal">
              <li>
                Install the CLI:{" "}
                <code className="bg-background px-1.5 py-0.5 rounded">npm install -g @seguelac/aca-cli</code>
              </li>
              <li>
                Generate a token above, copy it (shown once)
              </li>
              <li>
                Run{" "}
                <code className="bg-background px-1.5 py-0.5 rounded">aca login --token &lt;paste-here&gt;</code>{" "}
                in your terminal
              </li>
              <li>
                Use any command —{" "}
                <code className="bg-background px-1.5 py-0.5 rounded">aca --help</code>
              </li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate a new CLI token</DialogTitle>
            <DialogDescription>
              The token's plaintext is shown only once after creation. Store it somewhere safe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="token-name">Token name</Label>
              <Input
                id="token-name"
                placeholder="e.g. CLI on my MacBook"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
              />
              <p className="text-xs text-muted-foreground mt-1">
                A label to identify this token in the list. Must be unique within your account.
              </p>
            </div>
            <div>
              <Label htmlFor="token-expires">Expires in (days)</Label>
              <Input
                id="token-expires"
                type="number"
                min={1}
                max={730}
                value={newExpiresDays}
                onChange={(e) => setNewExpiresDays(parseInt(e.target.value, 10) || DEFAULT_EXPIRES_IN_DAYS)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Default is 365 days. Max 730. Revoke at any time below.
              </p>
            </div>
            {networkApproved && (
              <div className="space-y-2">
                <Label>ACA Network</Label>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="token-scope-network"
                    checked={newNetwork || newCredentials}
                    disabled={newCredentials}
                    onCheckedChange={(v) => setNewNetwork(v === true)}
                  />
                  <Label htmlFor="token-scope-network" className="text-sm font-normal leading-snug">
                    Network access: tenants, mailboxes and warmup through <code>/v1/network</code>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="token-scope-credentials"
                    checked={newCredentials}
                    onCheckedChange={(v) => setNewCredentials(v === true)}
                  />
                  <Label htmlFor="token-scope-credentials" className="text-sm font-normal leading-snug">
                    Mailbox credentials: lets this token read sending passwords. Only give it to the
                    install that sends.
                  </Label>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button variant="cta" onClick={handleCreate} disabled={isCreating || !newName.trim()}>
              {isCreating ? "Generating…" : "Generate token"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issued (one-time) display */}
      <Dialog open={!!issued} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Token created</DialogTitle>
            <DialogDescription>
              Copy this now — <strong>you won't see it again</strong>.
            </DialogDescription>
          </DialogHeader>
          {issued && (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg border bg-muted/50">
                <div className="text-xs text-muted-foreground mb-1.5">Name</div>
                <div className="font-medium">{issued.name}</div>
              </div>
              <div className="p-3 rounded-lg border bg-muted/50">
                <div className="text-xs text-muted-foreground mb-1.5">Token</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs break-all bg-background p-2 rounded border">
                    {issued.token}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(issued.token)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="p-3 rounded-lg border bg-muted/50">
                <div className="text-xs text-muted-foreground mb-1.5">Quick start</div>
                <code className="text-xs block bg-background p-2 rounded border break-all">
                  aca login --token {issued.token}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => handleCopy(`aca login --token ${issued.token}`)}
                >
                  <Copy className="h-3.5 w-3.5 mr-2" />
                  Copy command
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIssued(null)}>I've saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog open={!!tokenToRevoke} onOpenChange={(open) => !open && setTokenToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this token?</AlertDialogTitle>
            <AlertDialogDescription>
              Any device or script using "<strong>{tokenToRevoke?.name}</strong>" will immediately
              lose access. This cannot be undone — to restore CLI access, generate a new token.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function isExpired(token: ApiToken): boolean {
  if (!token.expires_at) return false;
  return new Date(token.expires_at).getTime() < Date.now();
}
