import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { FeatureGate } from "@/components/UpgradePrompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSequences,
  useCreateSequence,
  useDeleteSequence,
  useToggleSequenceStatus,
  useDuplicateSequence,
  getStepTypeLabel,
  type SequenceStatus,
} from "@/hooks/crm";
import {
  Plus,
  Search,
  MoreVertical,
  Play,
  Pause,
  Copy,
  Trash2,
  Edit,
  Users,
  Mail,
  Clock,
  Zap,
  TrendingUp,
  Filter,
  Workflow,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

export default function Sequences() {
  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <FeatureGate feature="messaging">
        <SequencesContent />
      </FeatureGate>
    </AppLayout>
  );
}

function SequencesContent() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SequenceStatus | "all">("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteSequenceId, setDeleteSequenceId] = useState<string | null>(null);

  // Form state for new sequence
  const [newSequenceName, setNewSequenceName] = useState("");
  const [newSequenceDescription, setNewSequenceDescription] = useState("");

  const { data: sequences, isLoading } = useSequences({
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const createMutation = useCreateSequence();
  const deleteMutation = useDeleteSequence();
  const toggleStatusMutation = useToggleSequenceStatus();
  const duplicateMutation = useDuplicateSequence();

  // Filter sequences by search
  const filteredSequences = sequences?.filter((seq) =>
    seq.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = () => {
    if (!newSequenceName.trim()) return;

    createMutation.mutate(
      {
        name: newSequenceName.trim(),
        description: newSequenceDescription.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          setShowCreateDialog(false);
          setNewSequenceName("");
          setNewSequenceDescription("");
          navigate(`/sequences/${data.id}`);
        },
      }
    );
  };

  const handleDelete = () => {
    if (!deleteSequenceId) return;
    deleteMutation.mutate(deleteSequenceId, {
      onSuccess: () => setDeleteSequenceId(null),
    });
  };

  // Calculate stats
  const stats = {
    total: sequences?.length || 0,
    active: sequences?.filter((s) => s.status === "active").length || 0,
    paused: sequences?.filter((s) => s.status === "paused").length || 0,
    totalEnrolled: sequences?.reduce(
      (acc, s) => acc + (s.enrolled_count || 0),
      0
    ) || 0,
  };

  return (
    <div className="flex-1 p-8">
      <div className="max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <PageHeader
        icon={Workflow}
        title="Contact Sequences"
        description="Create automated drip campaigns to nurture your contacts"
        actions={
          <Button variant="cta" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Sequence
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-primary/10">
                <Workflow className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Sequences</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Play className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Pause className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Paused</p>
                <p className="text-2xl font-bold">{stats.paused}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Users className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Enrolled</p>
                <p className="text-2xl font-bold">{stats.totalEnrolled}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sequences..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as SequenceStatus | "all")}
        >
          <SelectTrigger className="w-[150px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Sequences List */}
      {isLoading ? (
        <div className="grid gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-72" />
                  </div>
                  <Skeleton className="h-9 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredSequences?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Workflow className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No sequences found</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              {search
                ? "No sequences match your search. Try a different term."
                : "Create your first sequence to start automating your outreach."}
            </p>
            {!search && (
              <Button variant="cta" onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Sequence
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredSequences?.map((sequence) => (
            <Card
              key={sequence.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => navigate(`/sequences/${sequence.id}`)}
            >
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  {/* Status indicator */}
                  <div
                    className={cn(
                      "p-3 rounded-lg",
                      sequence.status === "active"
                        ? "bg-green-500/10"
                        : sequence.status === "paused"
                        ? "bg-yellow-500/10"
                        : "bg-muted"
                    )}
                  >
                    {sequence.status === "active" ? (
                      <Play className="h-5 w-5 text-green-500" />
                    ) : sequence.status === "paused" ? (
                      <Pause className="h-5 w-5 text-yellow-500" />
                    ) : (
                      <Workflow className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{sequence.name}</h3>
                      <Badge
                        variant={
                          sequence.status === "active"
                            ? "default"
                            : sequence.status === "paused"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {sequence.status}
                      </Badge>
                    </div>
                    {sequence.description && (
                      <p className="text-sm text-muted-foreground truncate">
                        {sequence.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {sequence.step_count || 0} steps
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {sequence.enrolled_count || 0} enrolled
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        {sequence.completed_count || 0} completed
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Updated{" "}
                        {formatDistanceToNow(new Date(sequence.updated_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {sequence.status !== "archived" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          toggleStatusMutation.mutate({
                            sequenceId: sequence.id,
                            status:
                              sequence.status === "active" ? "paused" : "active",
                          })
                        }
                        disabled={toggleStatusMutation.isPending}
                      >
                        {sequence.status === "active" ? (
                          <>
                            <Pause className="h-4 w-4 mr-1" />
                            Pause
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-1" />
                            Activate
                          </>
                        )}
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => navigate(`/sequences/${sequence.id}`)}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => duplicateMutation.mutate(sequence.id)}
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setDeleteSequenceId(sequence.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Sequence</DialogTitle>
            <DialogDescription>
              Create an automated sequence to nurture your contacts over time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g., Welcome Series"
                value={newSequenceName}
                onChange={(e) => setNewSequenceName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="Describe what this sequence does..."
                value={newSequenceDescription}
                onChange={(e) => setNewSequenceDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newSequenceName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Sequence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteSequenceId}
        onOpenChange={() => setDeleteSequenceId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Sequence</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this sequence? This will also
              remove all enrolled contacts from this sequence. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteSequenceId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
