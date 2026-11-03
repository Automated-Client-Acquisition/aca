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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Mail,
  AlertCircle,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Loader2,
  Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmailToolLogo } from "@/components/icons/EmailToolLogos";

const TOOL_INFO: Record<string, { name: string; color: string; docsUrl: string; description: string }> = {
  smartlead: {
    name: "Smartlead",
    color: "blue",
    docsUrl: "https://help.smartlead.ai/API-Documentation",
    description: "Cold email outreach platform with AI personalization",
  },
  instantly: {
    name: "Instantly",
    color: "orange",
    docsUrl: "https://developer.instantly.ai/",
    description: "Email outreach and lead generation platform",
  },
  successai: {
    name: "Success.ai",
    color: "purple",
    docsUrl: "https://api.success.ai/api/docs",
    description: "AI-powered cold email outreach platform",
  },
};

export function EmailToolConnections() {
  const { data: allConnections, isLoading } = useToolConnections();
  const connections = allConnections?.filter(c => c.tool_type !== 'notion');
  const createConnection = useCreateToolConnection();
  const deleteConnection = useDeleteToolConnection();
  const { toast } = useToast();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deletingConnection, setDeletingConnection] = useState<string | null>(null);

  // Form state for adding new connection
  const [toolType, setToolType] = useState<"smartlead" | "instantly" | "successai">("smartlead");
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
        toolType,
        name: connectionName.trim(),
        apiKey: apiKey.trim(),
      });

      toast({
        title: "Connection added",
        description: `Successfully connected to ${TOOL_INFO[toolType].name}`,
      });

      // Reset form
      setShowAddDialog(false);
      setConnectionName("");
      setApiKey("");
      setToolType("smartlead");
    } catch (error) {
      toast({
        title: "Connection failed",
        description: error instanceof Error ? error.message : "Failed to connect to email tool",
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
        description: "Email tool connection has been deleted",
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
                <Mail className="h-5 w-5" />
                Email Tool Connections
              </CardTitle>
              <CardDescription>
                Connect to external email tools (Smartlead, Instantly, Success.ai) for campaign handoffs
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
            <div className="text-center py-12">
              <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Email Tools Connected</h3>
              <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                Connect your Smartlead, Instantly, or Success.ai account to enable campaign handoffs.
                Leads will be pushed with fully personalized email content.
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
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  onDelete={() => setDeletingConnection(connection.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Connection Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Email Tool Connection</DialogTitle>
            <DialogDescription>
              Connect to Smartlead, Instantly, or Success.ai to enable campaign handoffs with personalized emails.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="toolType">Email Tool</Label>
              <Select
                value={toolType}
                onValueChange={(v) => setToolType(v as "smartlead" | "instantly" | "successai")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smartlead" textValue="Smartlead">
                    <div className="flex items-center gap-2">
                      <EmailToolLogo toolType="smartlead" size="sm" />
                      Smartlead
                    </div>
                  </SelectItem>
                  <SelectItem value="instantly" textValue="Instantly">
                    <div className="flex items-center gap-2">
                      <EmailToolLogo toolType="instantly" size="sm" />
                      Instantly
                    </div>
                  </SelectItem>
                  <SelectItem value="successai" textValue="Success.ai">
                    <div className="flex items-center gap-2">
                      <EmailToolLogo toolType="successai" size="sm" />
                      Success.ai
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {TOOL_INFO[toolType].description}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="connectionName">Connection Name</Label>
              <Input
                id="connectionName"
                placeholder="e.g., Main Account, Sales Team"
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A friendly name to identify this connection
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="Enter your API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Your API key will be encrypted and stored securely.{" "}
                <a
                  href={TOOL_INFO[toolType].docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  Get your API key
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
        onOpenChange={(open) => !open && !deleteConnection.isPending && setDeletingConnection(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Connection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this email tool connection? Campaigns using this
              connection will no longer be able to push leads to the external tool.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteConnection.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleteConnection.isPending}
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

// Subcomponent for displaying a single connection
function ConnectionCard({
  connection,
  onDelete,
}: {
  connection: ToolConnection;
  onDelete: () => void;
}) {
  const toolInfo = TOOL_INFO[connection.tool_type];
  const isActive = connection.status === "active";

  const bgClass = isActive
    ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900"
    : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900";

  return (
    <div className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${bgClass}`}>
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-2">
          <EmailToolLogo toolType={connection.tool_type as "smartlead" | "instantly" | "successai"} size="md" />
          <div>
            <h4 className="font-semibold">{connection.name}</h4>
            <p className="text-xs text-muted-foreground">{toolInfo?.name || connection.tool_type}</p>
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
