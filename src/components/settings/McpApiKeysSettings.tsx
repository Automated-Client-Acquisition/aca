import { useState } from "react";
import { useMcpApiKeys, McpApiKey } from "@/hooks/useMcpApiKeys";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Terminal, Copy, ExternalLink, Clock, ShieldCheck, ShieldOff, Trash2, Info, Cloud, Monitor, BookOpen, Lock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateMcpApiKeyDialog } from "./CreateMcpApiKeyDialog";
import { McpRecipeBookDialog } from "./McpRecipeBookDialog";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { formatDistanceToNow } from "date-fns";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { MCP_SERVER_URL } from "@/config/site";


export function McpApiKeysSettings() {
  const { keys, isLoading, revokeKey, deleteKey, isRevoking, isDeleting } = useMcpApiKeys();
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseMcpApiKeys = hasFeature("mcp_api_keys");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRecipeBook, setShowRecipeBook] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<McpApiKey | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<McpApiKey | null>(null);

  const handleRevoke = () => {
    if (keyToRevoke) {
      revokeKey(keyToRevoke.id);
      setKeyToRevoke(null);
    }
  };

  const handleDelete = () => {
    if (keyToDelete) {
      deleteKey(keyToDelete.id);
      setKeyToDelete(null);
    }
  };

  const copyConfigToClipboard = () => {
    const config = `{
  "mcpServers": {
    "aca": {
      "url": "${MCP_SERVER_URL}",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY_HERE"
      }
    }
  }
}`;
    navigator.clipboard.writeText(config);
    toast.success("Config copied to clipboard");
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading MCP API keys...</div>;
  }

  // Show upgrade prompt for free plan users
  if (!canUseMcpApiKeys && showUpgradePrompts) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                MCP API Keys
                <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700 bg-amber-50">
                  <Lock className="h-3 w-3 mr-1" />
                  Pro
                </Badge>
              </CardTitle>
              <CardDescription>
                Create API keys to use ACA with Claude Desktop or other MCP clients
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <UpgradePrompt feature="mcp_api_keys" variant="card" />
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
                <Terminal className="h-5 w-5" />
                MCP API Keys
              </CardTitle>
              <CardDescription>
                Create API keys to use ACA with Claude Desktop or other MCP clients
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowRecipeBook(true)}>
                <BookOpen className="h-4 w-4 mr-2" />
                Recipe Book
              </Button>
              <Button variant="cta" onClick={() => setShowCreateDialog(true)} className="font-medium shadow-lg">
                <Plus className="h-4 w-4 mr-2" />
                Create API Key
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Setup Instructions */}
          <Tabs defaultValue="cloud" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="cloud" className="flex items-center gap-2">
                <Cloud className="h-4 w-4" />
                Claude Cloud
              </TabsTrigger>
              <TabsTrigger value="desktop" className="flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                Claude Desktop
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cloud" className="mt-4">
              <div className="p-4 rounded-lg bg-muted/50 space-y-4">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Claude Cloud Setup (claude.ai)</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Add ACA as an MCP server in Claude's settings. Just enter the URL with your API key:
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Server URL</label>
                    <div className="relative mt-1">
                      <code className="block text-sm bg-background p-3 rounded border break-all">
                        {MCP_SERVER_URL}?api_key=YOUR_API_KEY_HERE
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-1.5 right-1.5"
                        onClick={() => {
                          navigator.clipboard.writeText(`${MCP_SERVER_URL}?api_key=YOUR_API_KEY_HERE`);
                          toast.success("URL copied to clipboard");
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave OAuth Client ID and Secret empty - not required.
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="desktop" className="mt-4">
              <div className="p-4 rounded-lg bg-muted/50 space-y-3">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Claude Desktop Setup</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Add this configuration to your <code className="px-1 py-0.5 rounded bg-muted">claude_desktop_config.json</code> file:
                </p>
                <div className="relative">
                  <pre className="text-xs bg-background p-3 rounded border overflow-x-auto">
{`{
  "mcpServers": {
    "aca": {
      "url": "${MCP_SERVER_URL}",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY_HERE"
      }
    }
  }
}`}
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={copyConfigToClipboard}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://modelcontextprotocol.io/quickstart"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      MCP Documentation
                    </a>
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* API Keys List */}
          {!keys || keys.length === 0 ? (
            <div className="text-center py-12 border-t pt-8">
              <Terminal className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No API Keys</h3>
              <p className="text-muted-foreground mb-4">
                Create your first API key to start using ACA with Claude
              </p>
              <Button variant="cta" onClick={() => setShowCreateDialog(true)} className="font-medium shadow-lg">
                <Plus className="h-4 w-4 mr-2" />
                Create API Key
              </Button>
            </div>
          ) : (
            <div className="space-y-3 border-t pt-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Your API Keys</h3>
              {keys.map((key) => (
                <div
                  key={key.id}
                  className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${
                    key.is_active
                      ? 'bg-background hover:bg-muted/30'
                      : 'bg-muted/20 opacity-60'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h4 className="font-semibold truncate">{key.name}</h4>
                      {key.is_active ? (
                        <Badge className="gap-1 bg-green-600 hover:bg-green-700 text-white shrink-0">
                          <ShieldCheck className="h-3 w-3" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 shrink-0">
                          <ShieldOff className="h-3 w-3" />
                          Revoked
                        </Badge>
                      )}
                      {key.expires_at && new Date(key.expires_at) < new Date() && (
                        <Badge variant="destructive" className="shrink-0">Expired</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground font-mono truncate">
                      {key.key_prefix}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Created {formatDistanceToNow(new Date(key.created_at), { addSuffix: true })}
                          </TooltipTrigger>
                          <TooltipContent>
                            {new Date(key.created_at).toLocaleString()}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {key.last_used_at && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1">
                              Last used {formatDistanceToNow(new Date(key.last_used_at), { addSuffix: true })}
                            </TooltipTrigger>
                            <TooltipContent>
                              {new Date(key.last_used_at).toLocaleString()}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {key.expires_at && (
                        <span>
                          Expires {formatDistanceToNow(new Date(key.expires_at), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    {key.is_active && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setKeyToRevoke(key)}
                        disabled={isRevoking}
                      >
                        Revoke
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setKeyToDelete(key)}
                      disabled={isDeleting}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateMcpApiKeyDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
      <McpRecipeBookDialog open={showRecipeBook} onOpenChange={setShowRecipeBook} />

      {/* Revoke Confirmation */}
      <AlertDialog open={!!keyToRevoke} onOpenChange={(open) => !open && setKeyToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke "{keyToRevoke?.name}"? This will immediately stop any applications using this key from accessing your ACA data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke}>Revoke Key</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!keyToDelete} onOpenChange={(open) => !open && setKeyToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete "{keyToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              Delete Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
