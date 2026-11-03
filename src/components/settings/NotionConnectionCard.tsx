import { useState } from "react";
import {
  useToolConnections,
  useCreateToolConnection,
  useDeleteToolConnection,
  type ToolConnection,
} from "@/hooks/useToolConnections";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Plus,
  AlertCircle,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Loader2,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { NotionLogo } from "@/components/icons/EmailToolLogos";

export function NotionConnectionCard() {
  const { data: connections, isLoading } = useToolConnections("notion");
  const createConnection = useCreateToolConnection();
  const deleteConnection = useDeleteToolConnection();
  const { toast } = useToast();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deletingConnection, setDeletingConnection] = useState<string | null>(null);

  const [connectionName, setConnectionName] = useState("");
  const [apiKey, setApiKey] = useState("");

  const handleAdd = async () => {
    if (!connectionName.trim() || !apiKey.trim()) {
      toast({
        title: "Missing fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      await createConnection.mutateAsync({
        toolType: "notion",
        name: connectionName.trim(),
        apiKey: apiKey.trim(),
      });

      toast({
        title: "Connection added",
        description: "Successfully connected to Notion",
      });

      setShowAddDialog(false);
      setConnectionName("");
      setApiKey("");
    } catch (error) {
      toast({
        title: "Connection failed",
        description: error instanceof Error ? error.message : "Failed to connect to Notion",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingConnection) return;

    try {
      await deleteConnection.mutateAsync(deletingConnection);
      toast({
        title: "Connection removed",
        description: "Notion connection has been deleted",
      });
      setDeletingConnection(null);
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Failed to delete connection",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <NotionLogo size="sm" />
                Notion
              </CardTitle>
              <CardDescription>
                Generate personalized preview pages for high-ICP prospects during email campaigns
              </CardDescription>
            </div>
            <Button
              variant="cta"
              onClick={() => setShowAddDialog(true)}
              className="font-medium shadow-lg"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Connection
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!connections || connections.length === 0 ? (
            <div className="text-center py-8">
              <NotionLogo size="lg" className="mx-auto mb-4 opacity-40" />
              <h3 className="text-lg font-semibold mb-2">No Notion Connections</h3>
              <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                Connect your Notion workspace to auto-generate personalized deliverable pages
                for high-ICP contacts during email sequence generation.
              </p>
              <Button
                variant="cta"
                onClick={() => setShowAddDialog(true)}
                className="font-medium shadow-lg"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Connection
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  onDelete={() => setDeletingConnection(connection.id)}
                />
              ))}

              <div className="flex gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <p className="font-medium">Publish your database to the web</p>
                  <p className="text-amber-700 dark:text-amber-400 mt-1">
                    For leads to view their pages without a Notion account, open your
                    target database in Notion, click <strong>Share → Publish</strong>, then
                    disable <strong>Search engine indexing</strong>. This only needs to be done once.
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Connection Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <NotionLogo size="sm" />
              Connect Notion
            </DialogTitle>
            <DialogDescription>
              Create a Notion internal integration and paste the token here.
              The integration needs access to the database where pages will be created.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="connectionName">Connection Name</Label>
              <Input
                id="connectionName"
                placeholder="e.g., Sales Workspace, Deliverables"
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A friendly name to identify this connection
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">Internal Integration Token</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="ntn_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Your token will be encrypted and stored securely.{" "}
                <a
                  href="https://www.notion.so/my-integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  Create an integration
                  <ExternalLink className="h-3 w-3" />
                </a>
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
              disabled={createConnection.isPending}
            >
              {createConnection.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deletingConnection}
        onOpenChange={(open) => !open && setDeletingConnection(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Notion Connection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this Notion connection? Deliverable preview
              generation will no longer work for campaigns using this connection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteConnection.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConnectionRow({
  connection,
  onDelete,
}: {
  connection: ToolConnection;
  onDelete: () => void;
}) {
  const isActive = connection.status === "active";

  const bgClass = isActive
    ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900"
    : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900";

  return (
    <div className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${bgClass}`}>
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-2">
          <NotionLogo size="md" />
          <div>
            <h4 className="font-semibold">{connection.name}</h4>
            <p className="text-xs text-muted-foreground">Notion</p>
          </div>
          {isActive ? (
            <Badge className="gap-1 bg-green-600 hover:bg-green-700 text-white">
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              Error
            </Badge>
          )}
        </div>
        {connection.last_verified_at && (
          <p className="text-xs text-muted-foreground">
            Last verified: {new Date(connection.last_verified_at).toLocaleDateString()}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
