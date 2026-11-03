import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Trash2,
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLeadHandoffs, useLeadHandoffsStats, type LeadHandoff, type ToolType } from "@/hooks/useLeadHandoffs";
import { useToolConnections } from "@/hooks/useToolConnections";
import { DeleteFromEmailToolDialog } from "./DeleteFromEmailToolDialog";
import { cn } from "@/lib/utils";

interface LeadHandoffsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactIds?: string[];
}

const toolNames: Record<ToolType, string> = {
  smartlead: 'SmartLead',
  instantly: 'Instantly',
  successai: 'Success.ai',
};

export function LeadHandoffsManager({
  open,
  onOpenChange,
  contactIds,
}: LeadHandoffsManagerProps) {
  // Filters
  const [selectedTool, setSelectedTool] = useState<ToolType | 'all'>('all');
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | 'all'>('all');
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);

  // Selection state
  const [selectedHandoffIds, setSelectedHandoffIds] = useState<Set<string>>(new Set());

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch data
  const { data: connections, isLoading: connectionsLoading } = useToolConnections();
  const { data: stats } = useLeadHandoffsStats();

  const filters = useMemo(() => ({
    toolType: selectedTool !== 'all' ? selectedTool : undefined,
    connectionId: selectedConnectionId !== 'all' ? selectedConnectionId : undefined,
    deletionStatus: showDeletedOnly ? 'deleted' as const : 'not_deleted' as const,
    contactIds,
  }), [selectedTool, selectedConnectionId, showDeletedOnly, contactIds]);

  const { data: handoffs, isLoading: handoffsLoading } = useLeadHandoffs(filters);

  // Get connection for selected handoffs
  const selectedHandoffs = useMemo(() => {
    return handoffs?.filter(h => selectedHandoffIds.has(h.id)) || [];
  }, [handoffs, selectedHandoffIds]);

  // Group selected by connection for deletion
  const selectedByConnection = useMemo(() => {
    const groups = new Map<string, { connection: { id: string; name: string }; toolType: ToolType; handoffs: LeadHandoff[] }>();

    for (const handoff of selectedHandoffs) {
      if (!handoff.connection_id || !handoff.connection) continue;

      const key = handoff.connection_id;
      if (!groups.has(key)) {
        groups.set(key, {
          connection: handoff.connection,
          toolType: handoff.tool_type,
          handoffs: [],
        });
      }
      groups.get(key)!.handoffs.push(handoff);
    }

    return Array.from(groups.values());
  }, [selectedHandoffs]);

  // Deletable handoffs (sent but not already deleted)
  const deletableHandoffs = useMemo(() => {
    return handoffs?.filter(h => h.status === 'sent' && !h.deletion_status) || [];
  }, [handoffs]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedHandoffIds(new Set(deletableHandoffs.map(h => h.id)));
    } else {
      setSelectedHandoffIds(new Set());
    }
  };

  const handleSelectOne = (handoffId: string, checked: boolean) => {
    const newSet = new Set(selectedHandoffIds);
    if (checked) {
      newSet.add(handoffId);
    } else {
      newSet.delete(handoffId);
    }
    setSelectedHandoffIds(newSet);
  };

  const handleDeleteComplete = () => {
    setSelectedHandoffIds(new Set());
    setDeleteDialogOpen(false);
  };

  const handleClose = () => {
    setSelectedHandoffIds(new Set());
    onOpenChange(false);
  };

  const isLoading = connectionsLoading || handoffsLoading;

  const getStatusBadge = (handoff: LeadHandoff) => {
    if (handoff.deletion_status === 'deleted') {
      return (
        <Badge variant="secondary" className="bg-gray-100 text-gray-700">
          <Trash2 className="h-3 w-3 mr-1" />
          Deleted
        </Badge>
      );
    }
    if (handoff.deletion_status === 'failed') {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Delete Failed
        </Badge>
      );
    }
    if (handoff.deletion_status === 'pending') {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">
          <Clock className="h-3 w-3 mr-1" />
          Deleting...
        </Badge>
      );
    }
    if (handoff.status === 'sent') {
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-700">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Active
        </Badge>
      );
    }
    if (handoff.status === 'failed') {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Push Failed
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <Clock className="h-3 w-3 mr-1" />
        {handoff.status}
      </Badge>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-primary/20 flex items-center justify-center">
                <Mail className="h-4 w-4 text-blue-600" />
              </div>
              Manage Pushed Contacts
            </DialogTitle>
            <DialogDescription>
              View and delete contacts pushed to email tools. Deleting contacts frees up slots in your subscription.
            </DialogDescription>
          </DialogHeader>

          {/* Stats summary */}
          {stats && (
            <div className="flex gap-4 py-2">
              <div className="bg-muted/50 rounded-lg px-4 py-2 text-center">
                <div className="text-lg font-bold">{stats.total}</div>
                <div className="text-xs text-muted-foreground">Total Pushed</div>
              </div>
              <div className="bg-green-50 rounded-lg px-4 py-2 text-center">
                <div className="text-lg font-bold text-green-600">{stats.deletable}</div>
                <div className="text-xs text-green-600/80">Active (Deletable)</div>
              </div>
              {Object.entries(stats.byTool).map(([tool, count]) => (
                <div key={tool} className="bg-muted/50 rounded-lg px-4 py-2 text-center">
                  <div className="text-lg font-bold">{count}</div>
                  <div className="text-xs text-muted-foreground">{toolNames[tool as ToolType]}</div>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-3 items-center py-2 border-b">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Tool:</span>
              <Select value={selectedTool} onValueChange={(v) => setSelectedTool(v as ToolType | 'all')}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tools</SelectItem>
                  <SelectItem value="smartlead">SmartLead</SelectItem>
                  <SelectItem value="instantly">Instantly</SelectItem>
                  <SelectItem value="successai">Success.ai</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Connection:</span>
              <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Connections</SelectItem>
                  {connections?.map(conn => (
                    <SelectItem key={conn.id} value={conn.id}>
                      {conn.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="show-deleted"
                checked={showDeletedOnly}
                onCheckedChange={(checked) => setShowDeletedOnly(!!checked)}
              />
              <label htmlFor="show-deleted" className="text-sm text-muted-foreground cursor-pointer">
                Show deleted only
              </label>
            </div>

            <div className="flex-1" />

            {selectedHandoffIds.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete {selectedHandoffIds.size} from Tool
              </Button>
            )}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !handoffs || handoffs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <Mail className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="font-medium">No pushed contacts found</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {showDeletedOnly
                    ? "No deleted contacts match your filters."
                    : "Push contacts to email tools first to manage them here."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={deletableHandoffs.length > 0 && selectedHandoffIds.size === deletableHandoffs.length}
                        onCheckedChange={handleSelectAll}
                        disabled={deletableHandoffs.length === 0}
                      />
                    </TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Pushed</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {handoffs.map((handoff) => {
                    const isDeletable = handoff.status === 'sent' && !handoff.deletion_status;
                    return (
                      <TableRow
                        key={handoff.id}
                        className={cn(
                          handoff.deletion_status === 'deleted' && "opacity-60"
                        )}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedHandoffIds.has(handoff.id)}
                            onCheckedChange={(checked) => handleSelectOne(handoff.id, !!checked)}
                            disabled={!isDeletable}
                          />
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">
                              {handoff.contact?.display_name || 'Unknown'}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {handoff.contact?.primary_email || '-'}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {toolNames[handoff.tool_type]}
                            </Badge>
                            {handoff.connection?.name && (
                              <span className="text-xs text-muted-foreground">
                                {handoff.connection.name}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-mono">
                            {handoff.external_campaign_id || '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {handoff.pushed_at
                              ? formatDistanceToNow(new Date(handoff.pushed_at), { addSuffix: true })
                              : '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(handoff)}
                          {handoff.deletion_error && (
                            <div className="text-xs text-red-500 mt-1 max-w-[200px] truncate" title={handoff.deletion_error}>
                              {handoff.deletion_error}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              {handoffs?.length || 0} contacts shown
              {selectedHandoffIds.size > 0 && ` • ${selectedHandoffIds.size} selected`}
            </div>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <DeleteFromEmailToolDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        selectedByConnection={selectedByConnection}
        onComplete={handleDeleteComplete}
      />
    </>
  );
}
