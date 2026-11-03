import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Globe,
  Plus,
  CheckCircle2,
  XCircle,
  Trash2,
  RefreshCw,
  ExternalLink,
  Edit,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Key,
  User,
  Link2,
  Shield,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";

interface WordPressSite {
  id: string;
  name: string;
  site_url: string;
  api_url: string;
  username: string;
  is_active: boolean;
  is_valid: boolean;
  last_tested_at: string | null;
  error_message: string | null;
  default_status: string;
}

export function WordPressIntegrationCard() {
  const { user, currentOrganization } = useAuth();
  const [sites, setSites] = useState<WordPressSite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedSite, setSelectedSite] = useState<WordPressSite | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    site_url: "",
    username: "",
    app_password: "",
    default_status: "draft" as "draft" | "pending" | "publish",
  });

  const fetchSites = async () => {
    if (!user || !currentOrganization) return;

    try {
      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data: sitesData, error } = await supabase
        .from("wordpress_sites")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setSites(sitesData || []);
    } catch (err) {
      console.error("Failed to fetch WordPress sites:", err);
      toast.error("Failed to load WordPress sites");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
  }, [user, currentOrganization?.id]);

  const handleAddSite = async () => {
    if (!user || !currentOrganization) return;

    setIsSubmitting(true);
    try {
      // Use currentOrganization from AuthContext - it already respects impersonation
      const orgId = currentOrganization.id;

      // Normalize site URL
      let siteUrl = formData.site_url.trim();
      if (!siteUrl.startsWith("http://") && !siteUrl.startsWith("https://")) {
        siteUrl = "https://" + siteUrl;
      }
      siteUrl = siteUrl.replace(/\/$/, ""); // Remove trailing slash

      // Derive API URL from site URL
      const apiUrl = `${siteUrl}/wp-json/wp/v2`;

      // Call edge function to test and save credentials
      const { data, error } = await supabase.functions.invoke("validate-wordpress", {
        body: {
          organization_id: orgId,
          site_id: selectedSite?.id,
          name: formData.name,
          site_url: siteUrl,
          api_url: apiUrl,
          username: formData.username,
          app_password: formData.app_password,
          default_status: formData.default_status,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success(selectedSite ? "WordPress site updated" : "WordPress site added");
        setShowAddDialog(false);
        resetForm();
        fetchSites();
      } else {
        toast.error(data.error || "Failed to connect to WordPress");
      }
    } catch (err) {
      console.error("Failed to add WordPress site:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add WordPress site");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestConnection = async (site: WordPressSite) => {
    setIsTesting(site.id);
    try {
      const { data, error } = await supabase.functions.invoke("validate-wordpress", {
        body: {
          site_id: site.id,
          test_only: true,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success("Connection successful!");
        fetchSites();
      } else {
        toast.error(data.error || "Connection failed");
        fetchSites();
      }
    } catch (err) {
      console.error("Failed to test connection:", err);
      toast.error("Failed to test connection");
    } finally {
      setIsTesting(null);
    }
  };

  const handleDeleteSite = async () => {
    if (!selectedSite) return;

    try {
      const { error } = await supabase
        .from("wordpress_sites")
        .delete()
        .eq("id", selectedSite.id);

      if (error) throw error;

      toast.success("WordPress site removed");
      setShowDeleteDialog(false);
      setSelectedSite(null);
      fetchSites();
    } catch (err) {
      console.error("Failed to delete site:", err);
      toast.error("Failed to remove WordPress site");
    }
  };

  const handleEditSite = (site: WordPressSite) => {
    setSelectedSite(site);
    setFormData({
      name: site.name,
      site_url: site.site_url,
      username: site.username,
      app_password: "", // Don't pre-fill password
      default_status: site.default_status as "draft" | "pending" | "publish",
    });
    setShowAddDialog(true);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      site_url: "",
      username: "",
      app_password: "",
      default_status: "draft",
    });
    setSelectedSite(null);
  };

  const handleCloseDialog = () => {
    setShowAddDialog(false);
    resetForm();
    setShowPassword(false);
  };

  return (
    <>
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDeleteSite}
        itemName={selectedSite?.name || "WordPress site"}
        itemType="WordPress site"
        description="Are you sure you want to remove this WordPress site? You will need to re-add it to publish content."
      />

      <Dialog open={showAddDialog} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedSite ? "Edit WordPress Site" : "Add WordPress Site"}
            </DialogTitle>
            <DialogDescription>
              Connect your WordPress site using Application Passwords for secure API access.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Site Name</Label>
              <Input
                id="name"
                placeholder="My Blog"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                A friendly name to identify this site
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="site_url">WordPress Site URL</Label>
              <Input
                id="site_url"
                placeholder="https://myblog.com"
                value={formData.site_url}
                onChange={(e) => setFormData({ ...formData, site_url: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Your WordPress site URL (we'll detect the REST API automatically)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">WordPress Username</Label>
              <Input
                id="username"
                placeholder="admin"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="app_password">Application Password</Label>
              <div className="relative">
                <Input
                  id="app_password"
                  type={showPassword ? "text" : "password"}
                  placeholder={selectedSite ? "Leave blank to keep existing" : "xxxx xxxx xxxx xxxx"}
                  value={formData.app_password}
                  onChange={(e) => setFormData({ ...formData, app_password: e.target.value })}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Generate at: WordPress Admin → Users → Profile → Application Passwords
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="default_status">Default Post Status</Label>
              <Select
                value={formData.default_status}
                onValueChange={(v) =>
                  setFormData({ ...formData, default_status: v as "draft" | "pending" | "publish" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                  <SelectItem value="publish">Published</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleAddSite}
              disabled={
                isSubmitting ||
                !formData.name ||
                !formData.site_url ||
                !formData.username ||
                (!selectedSite && !formData.app_password)
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {selectedSite ? "Updating..." : "Adding..."}
                </>
              ) : selectedSite ? (
                "Update Site"
              ) : (
                "Add Site"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <CardTitle className="text-2xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600/20 to-blue-600/5 flex items-center justify-center">
                  <Globe className="h-5 w-5 text-blue-600" />
                </div>
                WordPress Integration
              </CardTitle>
              <CardDescription className="text-base">
                Connect WordPress sites to publish articles directly from your content
              </CardDescription>
            </div>
            {sites.length > 0 && (
              <Badge
                variant="default"
                className={
                  sites.some((s) => s.is_valid)
                    ? "bg-green-600 text-white"
                    : "bg-muted"
                }
              >
                {sites.filter((s) => s.is_valid).length} of {sites.length} Connected
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Setup Guide */}
          <Collapsible open={showHelp} onOpenChange={setShowHelp}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <HelpCircle className="h-4 w-4" />
                  How to Connect WordPress
                </span>
                {showHelp ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Setup Instructions</h4>

                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                        1
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Log into WordPress Admin</p>
                        <p className="text-xs text-muted-foreground">
                          Go to your WordPress site and log in with an Administrator or Editor account.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                        2
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Navigate to Application Passwords</p>
                        <p className="text-xs text-muted-foreground">
                          Go to <span className="font-mono bg-muted px-1 rounded">Users → Profile</span> and scroll down to the "Application Passwords" section.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                        3
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Create Application Password</p>
                        <p className="text-xs text-muted-foreground">
                          Enter a name like "Content App" and click "Add New Application Password". Copy the generated password immediately - it won't be shown again!
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                        4
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Add Site Here</p>
                        <p className="text-xs text-muted-foreground">
                          Click "Add WordPress Site" below and enter your site URL, username, and the application password you just created.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Security Notes
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-1.5">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-500 flex-shrink-0" />
                      Application Passwords are separate from your main password
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-500 flex-shrink-0" />
                      You can revoke access anytime without changing your password
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-500 flex-shrink-0" />
                      Your credentials are encrypted and stored securely
                    </li>
                  </ul>
                </div>

                <div className="pt-2 border-t">
                  <h4 className="font-semibold text-sm mb-2">Requirements</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center gap-2 p-2 rounded bg-background">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <span>WordPress 5.6+</span>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded bg-background">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span>Editor or Admin role</span>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded bg-background">
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                      <span>REST API enabled</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t space-y-2">
                  <h4 className="font-semibold text-sm flex items-center gap-2 text-[hsl(var(--status-warning))]">
                    <Shield className="h-4 w-4" />
                    Troubleshooting: Security Plugins
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    If you get "You are not currently logged in" or authentication errors, a security plugin may be blocking REST API access.
                  </p>

                  <div className="space-y-3 text-xs">
                    <div className="p-3 rounded bg-background border">
                      <p className="font-semibold mb-1">Wordfence</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Go to <span className="font-mono bg-muted px-1 rounded">Wordfence → Firewall → Manage Firewall</span></li>
                        <li>Set the firewall to <span className="font-semibold text-foreground">"Learning Mode"</span> temporarily</li>
                        <li>Test the connection here, then set firewall back to "Enabled"</li>
                        <li>Alternatively: Go to <span className="font-mono bg-muted px-1 rounded">All Options → Brute Force Protection</span> and ensure "Disable WordPress application passwords" is unchecked</li>
                      </ol>
                    </div>

                    <div className="p-3 rounded bg-background border">
                      <p className="font-semibold mb-1">Sucuri Security</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Go to <span className="font-mono bg-muted px-1 rounded">Sucuri → Settings → API Service</span></li>
                        <li>Ensure "REST API" is not blocked</li>
                        <li>Check the Firewall whitelist if using Sucuri WAF</li>
                      </ol>
                    </div>

                    <div className="p-3 rounded bg-background border">
                      <p className="font-semibold mb-1">iThemes Security / Solid Security</p>
                      <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                        <li>Go to <span className="font-mono bg-muted px-1 rounded">Security → Settings → WordPress Tweaks</span></li>
                        <li>Ensure "Disable REST API" is turned off</li>
                        <li>Check "REST API Access" settings allow authenticated requests</li>
                      </ol>
                    </div>

                    <div className="p-3 rounded bg-background border">
                      <p className="font-semibold mb-1">Managed Hosting (Kinsta, WP Engine, etc.)</p>
                      <p className="text-muted-foreground">
                        Some hosts strip Authorization headers. Contact your host's support to whitelist REST API authentication or check their security settings panel.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sites.length > 0 ? (
            <div className="space-y-3">
              {sites.map((site) => (
                <div
                  key={site.id}
                  className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                    site.is_valid
                      ? "bg-card hover:bg-accent/30 border-border"
                      : "bg-destructive/5 border-destructive/30"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        site.is_valid ? "bg-green-500" : "bg-destructive"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{site.name}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {site.site_url}
                      </div>
                      {!site.is_valid && site.error_message && (
                        <div className="text-xs text-destructive mt-1">
                          {site.error_message}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleTestConnection(site)}
                      disabled={isTesting === site.id}
                      title="Test connection"
                    >
                      {isTesting === site.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => window.open(site.site_url, "_blank")}
                      title="Open site"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditSite(site)}
                      title="Edit"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedSite(site);
                        setShowDeleteDialog(true);
                      }}
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowAddDialog(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Another Site
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <Alert>
                <Globe className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  No WordPress sites configured yet. Click the help section above for setup instructions.
                </AlertDescription>
              </Alert>

              <Button variant="cta" className="w-full" onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add WordPress Site
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
