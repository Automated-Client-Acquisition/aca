import { useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Check,
  X,
  MoreHorizontal,
  Loader2,
  User,
  Mail,
  ExternalLink,
  Clock,
  UserCheck,
  UserX,
  Star,
  Crown,
  Gem,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useSignupRequests,
  useApproveSignupRequest,
  useRejectSignupRequest,
  SignupRequest,
  SignupRequestStatus,
} from "@/hooks/useSignupRequests";
import { PlanTier, PLAN_TIERS } from "@/types/admin";

interface SignupRequestsQueueProps {
  statusFilter?: SignupRequestStatus;
}

export function SignupRequestsQueue({ statusFilter }: SignupRequestsQueueProps) {
  const { data: requests, isLoading } = useSignupRequests(statusFilter);
  const approveRequest = useApproveSignupRequest();
  const rejectRequest = useRejectSignupRequest();

  const [selectedRequest, setSelectedRequest] = useState<SignupRequest | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>("pro");
  const [adminNotes, setAdminNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const handleApprove = async () => {
    if (!selectedRequest) return;

    await approveRequest.mutateAsync({
      requestId: selectedRequest.id,
      planTier: selectedPlan,
      adminNotes: adminNotes || undefined,
    });

    setApproveDialogOpen(false);
    setSelectedRequest(null);
    setAdminNotes("");
  };

  const handleReject = async () => {
    if (!selectedRequest) return;

    await rejectRequest.mutateAsync({
      requestId: selectedRequest.id,
      reason: rejectionReason || undefined,
    });

    setRejectDialogOpen(false);
    setSelectedRequest(null);
    setRejectionReason("");
  };

  const openApproveDialog = (request: SignupRequest) => {
    setSelectedRequest(request);
    setSelectedPlan("pro");
    setAdminNotes("");
    setApproveDialogOpen(true);
  };

  const openRejectDialog = (request: SignupRequest) => {
    setSelectedRequest(request);
    setRejectionReason("");
    setRejectDialogOpen(true);
  };

  type SkoolPlan = "standard" | "premium" | "vip";

  const SKOOL_PLANS: Record<SkoolPlan, { label: string; price: string; icon: React.ElementType; color: string }> = {
    standard: { label: "Standard", price: "$1/mo", icon: Star, color: "text-slate-600 bg-slate-100 border-slate-200" },
    premium: { label: "Premium", price: "$67/mo", icon: Crown, color: "text-amber-600 bg-amber-100 border-amber-200" },
    vip: { label: "VIP", price: "$297/mo", icon: Gem, color: "text-primary bg-primary/10 border-primary/20" },
  };

  const getSkoolPlanBadge = (sourceData: Record<string, unknown> | null) => {
    const skoolPlan = sourceData?.skool_plan as SkoolPlan | undefined;
    if (!skoolPlan || !SKOOL_PLANS[skoolPlan]) {
      return <span className="text-muted-foreground text-sm">-</span>;
    }
    const plan = SKOOL_PLANS[skoolPlan];
    const Icon = plan.icon;
    return (
      <Badge variant="outline" className={plan.color}>
        <Icon className="w-3 h-3 mr-1" />
        {plan.label}
      </Badge>
    );
  };

  const getStatusBadge = (status: SignupRequestStatus) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
            <UserCheck className="w-3 h-3 mr-1" />
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
            <UserX className="w-3 h-3 mr-1" />
            Rejected
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!requests || requests.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <User className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No signup requests {statusFilter ? `with status "${statusFilter}"` : ""}</p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Applicant</TableHead>
            <TableHead>Skool Username</TableHead>
            <TableHead>Skool Plan</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((request) => (
            <TableRow key={request.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{request.full_name}</span>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    {request.email}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                {request.skool_username ? (
                  <a
                    href={`https://www.skool.com/@${request.skool_username.replace("@", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    @{request.skool_username.replace("@", "")}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-muted-foreground">Not provided</span>
                )}
              </TableCell>
              <TableCell>
                {getSkoolPlanBadge(request.source_data as Record<string, unknown> | null)}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  {getStatusBadge(request.status)}
                  {request.assigned_plan_tier && (
                    <Badge variant="outline" className={PLAN_TIERS[request.assigned_plan_tier].color}>
                      {PLAN_TIERS[request.assigned_plan_tier].label}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
                </span>
              </TableCell>
              <TableCell className="text-right">
                {request.status === "pending" ? (
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-green-600 border-green-200 hover:bg-green-50"
                      onClick={() => openApproveDialog(request)}
                    >
                      <Check className="w-4 h-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => openRejectDialog(request)}
                    >
                      <X className="w-4 h-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          // View details
                          console.log("View details", request);
                        }}
                      >
                        View Details
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Approve Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Signup Request</DialogTitle>
            <DialogDescription>
              Create an account for <strong>{selectedRequest?.full_name}</strong> (
              {selectedRequest?.email})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Assign Plan</Label>
              <Select value={selectedPlan} onValueChange={(v) => setSelectedPlan(v as PlanTier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={PLAN_TIERS.free.color}>
                        {PLAN_TIERS.free.label}
                      </Badge>
                      <span className="text-muted-foreground text-sm">
                        {PLAN_TIERS.free.description}
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="pro">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={PLAN_TIERS.pro.color}>
                        Pro
                      </Badge>
                      <span className="text-muted-foreground text-sm">
                        {PLAN_TIERS.pro.description}
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="enterprise">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={PLAN_TIERS.enterprise.color}>
                        Enterprise
                      </Badge>
                      <span className="text-muted-foreground text-sm">
                        {PLAN_TIERS.enterprise.description}
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(selectedRequest?.skool_username || (selectedRequest?.source_data as Record<string, unknown>)?.skool_plan) && (
              <div className="p-3 bg-muted rounded-lg space-y-2">
                {selectedRequest?.skool_username && (
                  <>
                    <Label className="text-sm">Skool Profile</Label>
                    <a
                      href={`https://www.skool.com/@${selectedRequest.skool_username.replace("@", "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      @{selectedRequest.skool_username.replace("@", "")}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </>
                )}
                {(selectedRequest?.source_data as Record<string, unknown>)?.skool_plan && (
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Skool Membership:</Label>
                    {getSkoolPlanBadge(selectedRequest?.source_data as Record<string, unknown>)}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Verify their Skool membership before approving
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="adminNotes">Admin Notes (optional)</Label>
              <Textarea
                id="adminNotes"
                placeholder="Any notes about this approval..."
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approveRequest.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {approveRequest.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Approve & Create Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Signup Request</DialogTitle>
            <DialogDescription>
              Reject the signup request from <strong>{selectedRequest?.full_name}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rejectionReason">Reason (optional)</Label>
              <Textarea
                id="rejectionReason"
                placeholder="Why is this request being rejected?"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectRequest.isPending}
            >
              {rejectRequest.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
