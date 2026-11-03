import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  Eye,
  Settings,
  Users,
  Trash2,
  Building2,
  Archive,
  RotateCcw,
} from "lucide-react";
import { useClientOrganizations, useDeleteClientOrganization, useArchiveClientOrganization } from "@/hooks/useClientOrganizations";
import { ClientOrganization, getOrgInitials, getOrgColor } from "@/types/organization";
import { Skeleton } from "@/components/ui/skeleton";
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

interface ClientsTableProps {
  showArchived?: boolean;
}

export function ClientsTable({ showArchived = true }: ClientsTableProps) {
  const navigate = useNavigate();
  const { data: allClients, isLoading } = useClientOrganizations();
  const { mutate: deleteClient, isPending: isDeleting } = useDeleteClientOrganization();
  const { mutate: archiveClient, isPending: isArchiving } = useArchiveClientOrganization();
  const [clientToDelete, setClientToDelete] = useState<ClientOrganization | null>(null);
  const [clientToArchive, setClientToArchive] = useState<{
    client: ClientOrganization;
    action: "archive" | "reactivate";
  } | null>(null);

  // Filter clients based on showArchived prop
  const clients = showArchived
    ? allClients
    : allClients?.filter(c => c.status !== "archived");

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "active":
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
            Active
          </Badge>
        );
      case "inactive":
        return (
          <Badge variant="outline" className="bg-gray-100 text-gray-800 border-gray-200">
            Inactive
          </Badge>
        );
      case "archived":
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
            Archived
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
            Active
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center space-x-4">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-3 w-[150px]" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (!clients || clients.length === 0) {
    return (
      <div className="text-center py-12">
        <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="font-medium mb-1">No clients yet</h3>
        <p className="text-sm text-muted-foreground">
          Create your first client to get started
        </p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Users</TableHead>
            <TableHead>Content</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-[70px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => (
            <TableRow
              key={client.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => navigate(`/clients/${client.id}`)}
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 rounded-lg">
                    {client.logo_url && (
                      <AvatarImage src={client.logo_url} className="object-cover rounded-lg" />
                    )}
                    <AvatarFallback
                      className={`rounded-lg text-white font-bold ${getOrgColor(
                        client.id
                      )}`}
                    >
                      {getOrgInitials(client.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{client.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {client.slug}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>{getStatusBadge(client.status)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  {client.user_count || 0}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{client.content_count || 0}</span>
                  <span className="text-muted-foreground">pieces</span>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDistanceToNow(new Date(client.created_at), {
                  addSuffix: true,
                })}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/clients/${client.id}`);
                      }}
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View Details
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/clients/${client.id}?tab=team`);
                      }}
                    >
                      <Users className="w-4 h-4 mr-2" />
                      Manage Team
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/clients/${client.id}?tab=settings`);
                      }}
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {client.status === "archived" ? (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setClientToArchive({ client, action: "reactivate" });
                        }}
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Reactivate Client
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setClientToArchive({ client, action: "archive" });
                        }}
                        className="text-yellow-600 focus:text-yellow-600"
                      >
                        <Archive className="w-4 h-4 mr-2" />
                        Archive Client
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setClientToDelete(client);
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Client
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!clientToDelete}
        onOpenChange={() => setClientToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{clientToDelete?.name}</strong>? This action cannot be
              undone. All client data will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (clientToDelete) {
                  deleteClient(clientToDelete.id);
                  setClientToDelete(null);
                }
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive/Reactivate Confirmation Dialog */}
      <AlertDialog
        open={!!clientToArchive}
        onOpenChange={() => setClientToArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {clientToArchive?.action === "archive" ? "Archive Client" : "Reactivate Client"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {clientToArchive?.action === "archive" ? (
                  <>
                    Are you sure you want to archive{" "}
                    <strong>{clientToArchive?.client.name}</strong>?
                    <p className="mt-2 text-yellow-600 font-medium">
                      All users in this organization will lose access until the client is reactivated.
                    </p>
                  </>
                ) : (
                  <>
                    Reactivate <strong>{clientToArchive?.client.name}</strong>?
                    <p className="mt-2">
                      Users will regain access to their organization.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (clientToArchive) {
                  archiveClient({
                    id: clientToArchive.client.id,
                    archive: clientToArchive.action === "archive",
                  });
                  setClientToArchive(null);
                }
              }}
              disabled={isArchiving}
              className={clientToArchive?.action === "archive"
                ? "bg-yellow-600 text-white hover:bg-yellow-700"
                : ""}
            >
              {clientToArchive?.action === "archive" ? "Archive Client" : "Reactivate Client"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
