import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  Users,
  AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface SkoolCommunity {
  id: string;
  slug: string;
  group_id: string;
  name: string;
  is_active: boolean;
  plan_mapping: Record<string, string>;
  last_synced_at: string | null;
  last_sync_result: {
    active_count?: number;
    churned_count?: number;
    cancelling_count?: number;
    error?: string;
  } | null;
  created_at: string;
}

export function SkoolCommunitiesPanel() {
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newCommunity, setNewCommunity] = useState({
    slug: "",
    group_id: "",
    name: "",
  });

  // Fetch communities
  const { data: communities, isLoading } = useQuery({
    queryKey: ["skool-communities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("skool_communities")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as SkoolCommunity[];
    },
  });

  // Toggle active status
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("skool_communities")
        .update({ is_active })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skool-communities"] });
      toast.success("Community status updated");
    },
    onError: (error) => {
      toast.error("Failed to update community: " + error.message);
    },
  });

  // Add new community
  const addCommunityMutation = useMutation({
    mutationFn: async (community: typeof newCommunity) => {
      const { error } = await supabase.from("skool_communities").insert({
        slug: community.slug,
        group_id: community.group_id,
        name: community.name,
        is_active: true,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skool-communities"] });
      setIsAddDialogOpen(false);
      setNewCommunity({ slug: "", group_id: "", name: "" });
      toast.success("Community added successfully");
    },
    onError: (error) => {
      toast.error("Failed to add community: " + error.message);
    },
  });

  // Delete community
  const deleteCommunityMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("skool_communities")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skool-communities"] });
      toast.success("Community removed");
    },
    onError: (error) => {
      toast.error("Failed to remove community: " + error.message);
    },
  });

  // Trigger manual sync
  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sync-skool-memberships", {
        body: { source: "manual" },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["skool-communities"] });
      toast.success(
        `Sync completed: ${data.synced} synced, ${data.upgraded} upgraded, ${data.downgraded} downgraded`
      );
    },
    onError: (error) => {
      toast.error("Sync failed: " + error.message);
    },
  });

  const handleAddCommunity = () => {
    if (!newCommunity.slug || !newCommunity.name) {
      toast.error("Please fill in all required fields");
      return;
    }
    addCommunityMutation.mutate(newCommunity);
  };

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Manage Skool communities for membership sync. Members are matched by email.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Now"}
          </Button>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Community
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Skool Community</DialogTitle>
                <DialogDescription>
                  Add a new Skool community to sync memberships from.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Display Name</Label>
                  <Input
                    id="name"
                    placeholder="My Community"
                    value={newCommunity.name}
                    onChange={(e) =>
                      setNewCommunity((prev) => ({ ...prev, name: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">
                    Community Slug
                    <span className="text-muted-foreground ml-1 font-normal">
                      (from URL: skool.com/your-slug)
                    </span>
                  </Label>
                  <Input
                    id="slug"
                    placeholder="your-community-slug"
                    value={newCommunity.slug}
                    onChange={(e) =>
                      setNewCommunity((prev) => ({ ...prev, slug: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="group_id">
                    Group ID
                    <span className="text-muted-foreground ml-1 font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="group_id"
                    placeholder="f9a312577d14409a92d1f8674a8b4e4d"
                    value={newCommunity.group_id}
                    onChange={(e) =>
                      setNewCommunity((prev) => ({ ...prev, group_id: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Found in the page source or API responses. Leave empty if unknown.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleAddCommunity}
                  disabled={addCommunityMutation.isPending}
                >
                  {addCommunityMutation.isPending ? "Adding..." : "Add Community"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Communities table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Community</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Sync</TableHead>
                <TableHead>Members</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    Loading communities...
                  </TableCell>
                </TableRow>
              ) : communities?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No Skool communities configured yet
                  </TableCell>
                </TableRow>
              ) : (
                communities?.map((community) => (
                  <TableRow key={community.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{community.name}</span>
                        <a
                          href={`https://www.skool.com/${community.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
                        >
                          skool.com/{community.slug}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={community.is_active}
                          onCheckedChange={(checked) =>
                            toggleActiveMutation.mutate({
                              id: community.id,
                              is_active: checked,
                            })
                          }
                        />
                        <Badge variant="secondary" className={community.is_active ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-100" : ""}>
                          {community.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {community.last_synced_at ? (
                        <div className="flex items-center gap-1.5">
                          {community.last_sync_result?.error ? (
                            <XCircle className="w-4 h-4 text-red-500" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          )}
                          <span className="text-sm">
                            {formatDistanceToNow(new Date(community.last_synced_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="w-4 h-4" />
                          <span className="text-sm">Never synced</span>
                        </div>
                      )}
                      {community.last_sync_result?.error && (
                        <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {community.last_sync_result.error}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {community.last_sync_result && !community.last_sync_result.error ? (
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">
                            {community.last_sync_result.active_count || 0} active
                          </span>
                          {(community.last_sync_result.churned_count || 0) > 0 && (
                            <span className="text-xs text-muted-foreground">
                              ({community.last_sync_result.churned_count} churned)
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Remove ${community.name}?`)) {
                            deleteCommunityMutation.mutate(community.id);
                          }
                        }}
                        disabled={deleteCommunityMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Plan mapping info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan Mapping</CardTitle>
          <CardDescription>
            How Skool membership plans map to ACA tiers
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div className="space-y-1">
              <Badge variant="outline">$1/month</Badge>
              <p className="text-muted-foreground">Free tier</p>
            </div>
            <div className="space-y-1">
              <Badge variant="outline">$49/month</Badge>
              <p className="text-muted-foreground">Pro tier</p>
            </div>
            <div className="space-y-1">
              <Badge variant="outline">$67/month</Badge>
              <p className="text-muted-foreground">Pro tier</p>
            </div>
            <div className="space-y-1">
              <Badge variant="outline">Yearly</Badge>
              <p className="text-muted-foreground">Enterprise tier</p>
            </div>
            <div className="space-y-1">
              <Badge variant="outline">Free (Zapier)</Badge>
              <p className="text-muted-foreground">Enterprise tier</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
