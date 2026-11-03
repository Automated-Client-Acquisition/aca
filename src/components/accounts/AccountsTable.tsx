import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { AccountStatusBadge } from "./AccountStatusBadge";
import type { AccountWithLimits } from "@/hooks/useAccountsWithLimits";
import { Badge } from "@/components/ui/badge";
import { Link2, Mail, MessageSquare, Settings2, MoreVertical, Search, RefreshCw, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { AccountOwnerPicker } from "./AccountOwnerPicker";

interface AccountsTableProps {
  accounts: AccountWithLimits[];
  onConfigureLimits: (account: AccountWithLimits) => void;
  onConfigureSchedule: (account: AccountWithLimits) => void;
  onReconnect?: (account: AccountWithLimits) => void;
  onDelete?: (account: AccountWithLimits) => void;
  onOwnerChange?: (accountId: string, userId: string | null) => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  isLoading?: boolean;
}

export function AccountsTable({
  accounts,
  onConfigureLimits,
  onConfigureSchedule,
  onReconnect,
  onDelete,
  onOwnerChange,
  selectedIds = new Set(),
  onSelectionChange,
  isLoading,
}: AccountsTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deletingAccount, setDeletingAccount] = useState<AccountWithLimits | null>(null);

  // Filter accounts
  const filteredAccounts = accounts.filter((account) => {
    // Search filter
    const matchesSearch =
      !searchQuery ||
      account.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.username?.toLowerCase().includes(searchQuery.toLowerCase());

    // Status filter
    const matchesStatus =
      statusFilter === "all" || account.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const allSelected =
    filteredAccounts.length > 0 && filteredAccounts.every((a) => selectedIds.has(a.id));
  const someSelected =
    filteredAccounts.some((a) => selectedIds.has(a.id)) && !allSelected;

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(filteredAccounts.map((a) => a.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const getInitials = (name: string | null) => {
    if (!name) return "??";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const PROVIDER_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
    LINKEDIN: { label: 'LinkedIn', color: 'text-white', bgColor: 'bg-[#0A66C2]' },
    INSTAGRAM: { label: 'Instagram', color: 'text-white', bgColor: 'bg-[#E1306C]' },
    WHATSAPP: { label: 'WhatsApp', color: 'text-white', bgColor: 'bg-[#25D366]' },
    TELEGRAM: { label: 'Telegram', color: 'text-white', bgColor: 'bg-[#0088cc]' },
    MESSENGER: { label: 'Messenger', color: 'text-white', bgColor: 'bg-[#0084FF]' },
    TWITTER: { label: 'X', color: 'text-white', bgColor: 'bg-black' },
    GOOGLE: { label: 'Gmail', color: 'text-white', bgColor: 'bg-[#EA4335]' },
    OUTLOOK: { label: 'Outlook', color: 'text-white', bgColor: 'bg-[#0078D4]' },
    MAIL: { label: 'Email', color: 'text-white', bgColor: 'bg-gray-600' },
    EMAIL: { label: 'Email', color: 'text-white', bgColor: 'bg-gray-600' },
  };

  const getProviderBadge = (provider: string) => {
    const config = PROVIDER_CONFIG[provider] || { label: provider, color: 'text-white', bgColor: 'bg-gray-500' };
    return (
      <Badge variant="secondary" className={`${config.bgColor} ${config.color} text-xs font-medium`}>
        {config.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search senders"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {onSelectionChange && (
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              <TableHead className="w-[300px]">Account</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead className="w-[200px]">Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sending limits</TableHead>
              <TableHead className="w-[200px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={onSelectionChange ? 7 : 6} className="text-center py-8">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    Loading accounts...
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredAccounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={onSelectionChange ? 7 : 6} className="text-center py-8 text-muted-foreground">
                  No accounts found
                </TableCell>
              </TableRow>
            ) : (
              filteredAccounts.map((account) => (
                <TableRow key={account.id}>
                  {onSelectionChange && (
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(account.id)}
                        onCheckedChange={() => handleSelectOne(account.id)}
                        aria-label={`Select ${account.display_name || account.username}`}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage
                          src={account.avatar_url || undefined}
                          referrerPolicy="no-referrer"
                        />
                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-blue-600 text-white text-sm">
                          {getInitials(account.display_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">
                          {account.display_name || account.username || "Unknown"}
                        </div>
                        {account.username && account.display_name && (
                          <div className="text-sm text-muted-foreground">
                            @{account.username}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {getProviderBadge(account.provider)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <AccountOwnerPicker
                      value={(account as any).owner_user_id ?? null}
                      onChange={(userId) => onOwnerChange?.(account.id, userId)}
                      disabled={!onOwnerChange}
                    />
                  </TableCell>
                  <TableCell>
                    <AccountStatusBadge status={account.status} errorMessage={account.error_message} />
                  </TableCell>
                  <TableCell>
                    {account.provider === 'LINKEDIN' ? (
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Link2 className="h-4 w-4" />
                          <span>{account.limits.connection_requests}/day</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Mail className="h-4 w-4" />
                          <span>{account.limits.messages}/day</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MessageSquare className="h-4 w-4" />
                          <span>{account.limits.inmails}/day</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {account.limits.messages}/day messages
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onConfigureLimits(account)}
                        className="gap-2"
                      >
                        <Settings2 className="h-4 w-4" />
                        Configure limits
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onConfigureLimits(account)}>
                            <Settings2 className="h-4 w-4 mr-2" />
                            Configure limits
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onConfigureSchedule(account)}>
                            <Settings2 className="h-4 w-4 mr-2" />
                            Configure schedule
                          </DropdownMenuItem>
                          {onReconnect && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onReconnect(account)}>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Reconnect
                              </DropdownMenuItem>
                            </>
                          )}
                          {onDelete && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeletingAccount(account)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination footer */}
        {filteredAccounts.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
            <div>
              Showing {filteredAccounts.length} of {accounts.length}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deletingAccount} onOpenChange={(open) => !open && setDeletingAccount(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete sender account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{deletingAccount?.display_name || deletingAccount?.username || 'this account'}</strong>?
              This will remove the account from your senders list. Active campaigns using this sender may be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingAccount && onDelete) {
                  onDelete(deletingAccount);
                  setDeletingAccount(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
