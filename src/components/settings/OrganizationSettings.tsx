import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Building2, Users, Loader2, Image } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { OrganizationLogoUpload } from "./OrganizationLogoUpload";

export function OrganizationSettings() {
  const { currentOrganization, isAgency, refreshOrganizationContext } = useAuth();
  const [isEnabling, setIsEnabling] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Fetch current logo URL
  useEffect(() => {
    async function fetchLogoUrl() {
      if (!currentOrganization) return;

      const { data } = await supabase
        .from("organizations")
        .select("logo_url")
        .eq("id", currentOrganization.id)
        .single();

      if (data) {
        setLogoUrl((data as any).logo_url ?? null);
      }
    }

    fetchLogoUrl();
  }, [currentOrganization]);

  const isAgencyType = currentOrganization?.type === "agency";
  const showAgencySection = isAgency || isAgencyType;

  const handleEnableAgencyMode = async () => {
    if (!currentOrganization) return;

    setIsEnabling(true);
    try {
      const { error } = await supabase
        .from("organizations")
        .update({ type: "agency" })
        .eq("id", currentOrganization.id);

      if (error) throw error;

      await refreshOrganizationContext();
      toast.success("Agency mode enabled", {
        description: "You can now create and manage client accounts.",
      });
    } catch (error) {
      console.error("Error enabling agency mode:", error);
      toast.error("Failed to enable agency mode");
    } finally {
      setIsEnabling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Organization Logo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Image className="w-5 h-5" />
            Branding
          </CardTitle>
          <CardDescription>
            Customize your organization's appearance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationLogoUpload logoUrl={logoUrl} onLogoChange={setLogoUrl} />
        </CardContent>
      </Card>

      {/* Organization Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Organization
          </CardTitle>
          <CardDescription>
            Manage your organization settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-muted-foreground text-xs">Name</Label>
              <p className="font-medium">{currentOrganization?.name || "—"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Slug</Label>
              <p className="font-medium font-mono text-sm">{currentOrganization?.slug || "—"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Type</Label>
              <p className="font-medium capitalize">{currentOrganization?.type || "standalone"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Status</Label>
              <p className="font-medium capitalize">{currentOrganization?.status || "active"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agency Mode */}
      {!showAgencySection && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Agency Mode
            </CardTitle>
            <CardDescription>
              Enable agency features to create and manage client sub-accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
              <div className="space-y-1">
                <p className="font-medium">Become an Agency</p>
                <p className="text-sm text-muted-foreground">
                  Create client workspaces, share assets, and manage multiple accounts from one place.
                </p>
              </div>
              <Button onClick={handleEnableAgencyMode} disabled={isEnabling}>
                {isEnabling && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Enable Agency Mode
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agency Status (if already agency) */}
      {showAgencySection && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Agency Status
            </CardTitle>
            <CardDescription>
              Your organization has agency features enabled
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 p-4 border rounded-lg bg-green-500/10 border-green-500/20">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <div>
                <p className="font-medium text-green-700 dark:text-green-400">Agency Mode Active</p>
                <p className="text-sm text-muted-foreground">
                  You can manage client accounts from the Clients page in the sidebar.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
