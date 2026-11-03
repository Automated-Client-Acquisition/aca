import { useState, useMemo } from "react";
import { ContentOutputCard } from "./ContentOutputCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBulkUpdateOutputs } from "@/hooks/useBulkUpdateOutputs";
import { useBulkDeleteOutputs } from "@/hooks/useBulkDeleteOutputs";
import { Search, CheckCircle, XCircle, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";

interface ContentOutputsGridProps {
  outputs: any[];
}

export function ContentOutputsGrid({ outputs }: ContentOutputsGridProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('newest');
  const bulkUpdate = useBulkUpdateOutputs();
  const bulkDelete = useBulkDeleteOutputs();

  // Filter and sort outputs
  const filteredOutputs = useMemo(() => {
    let filtered = outputs;

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(output => 
        output.data?.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        output.data?.text?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(output => output.status === statusFilter);
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'oldest':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'alphabetical':
          return (a.data?.title || '').localeCompare(b.data?.title || '');
        default:
          return 0;
      }
    });

    return filtered;
  }, [outputs, searchQuery, statusFilter, sortBy]);

  const handleSelectAll = () => {
    if (selectedIds.size === filteredOutputs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredOutputs.map(o => o.id)));
    }
  };

  const handleSelect = (id: string, selected: boolean) => {
    const newSet = new Set(selectedIds);
    if (selected) {
      newSet.add(id);
    } else {
      newSet.delete(id);
    }
    setSelectedIds(newSet);
  };

  const handleBulkApprove = () => {
    bulkUpdate.mutate({ ids: Array.from(selectedIds), status: 'approved' });
    setSelectedIds(new Set());
  };

  const handleBulkReject = () => {
    bulkUpdate.mutate({ ids: Array.from(selectedIds), status: 'rejected' });
    setSelectedIds(new Set());
  };

  const handleBulkDelete = () => {
    if (confirm(`Delete ${selectedIds.size} output${selectedIds.size !== 1 ? 's' : ''}?`)) {
      // Bulk operations may span multiple jobs, so we don't scope to a specific jobId
      bulkDelete.mutate({ ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
    }
  };

  const stats = useMemo(() => {
    const total = outputs.length;
    const approved = outputs.filter(o => o.status === 'approved').length;
    const review = outputs.filter(o => o.status === 'review').length;
    const rejected = outputs.filter(o => o.status === 'rejected').length;
    return { total, approved, review, rejected };
  }, [outputs]);

  return (
    <div className="space-y-6">
      {/* Stats Summary - Compact Horizontal Bar */}
      <div className="bg-card border rounded-lg p-4">
        <div className="flex items-center justify-around divide-x">
          <div className="flex-1 text-center px-4">
            <div className="text-3xl font-bold text-foreground">{stats.total}</div>
            <div className="text-xs text-muted-foreground mt-1">Total</div>
          </div>
          <div className="flex-1 text-center px-4">
            <div className="text-3xl font-bold text-green-600 dark:text-green-400">{stats.approved}</div>
            <div className="text-xs text-muted-foreground mt-1">Approved</div>
          </div>
          <div className="flex-1 text-center px-4">
            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{stats.review}</div>
            <div className="text-xs text-muted-foreground mt-1">Review</div>
          </div>
          <div className="flex-1 text-center px-4">
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">{stats.rejected}</div>
            <div className="text-xs text-muted-foreground mt-1">Rejected</div>
          </div>
        </div>
      </div>

      {/* Toolbar - Streamlined */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <div className="flex gap-2 items-center">
          <Button
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('all')}
          >
            All
          </Button>
          <Button
            variant={statusFilter === 'review' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('review')}
          >
            Review
          </Button>
          <Button
            variant={statusFilter === 'approved' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('approved')}
          >
            Approved
          </Button>
          <Button
            variant={statusFilter === 'rejected' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('rejected')}
          >
            Rejected
          </Button>
        </div>

        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="alphabetical">A-Z</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={handleSelectAll}>
          {selectedIds.size === filteredOutputs.length ? 'Clear' : 'Select All'}
        </Button>
      </div>

      {/* Bulk Actions Bar - Floating Bottom */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
          <Card className="shadow-lg border-2 px-6 py-4">
            <div className="flex items-center gap-6">
              <span className="font-semibold text-sm">{selectedIds.size} selected</span>
              <div className="h-6 w-px bg-border" />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleBulkApprove} className="bg-green-600 hover:bg-green-700">
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={handleBulkReject}>
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject
                </Button>
                <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Outputs Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredOutputs.map((output) => (
          <ContentOutputCard
            key={output.id}
            output={output}
            isSelected={selectedIds.has(output.id)}
            onSelect={(selected) => handleSelect(output.id, selected)}
          />
        ))}
      </div>

      {filteredOutputs.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No outputs found matching your filters.
        </div>
      )}
    </div>
  );
}
