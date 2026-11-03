import { Button } from "@/components/ui/button";
import { AlertTriangle, X, Eye } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";

export function ImpersonationBanner() {
  const { isImpersonating, currentOrganization, endImpersonation } = useAuth();
  const queryClient = useQueryClient();

  if (!isImpersonating) return null;

  const handleExit = async () => {
    await endImpersonation();
    // Clear all React Query caches to ensure fresh data for the original organization
    await queryClient.invalidateQueries();
  };

  return (
    <div className="bg-amber-500 text-amber-950 py-2 px-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Eye className="w-4 h-4" />
        <span className="font-medium">
          Viewing as: {currentOrganization?.name}
        </span>
        <span className="text-amber-800">
          (You are impersonating this organization)
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleExit}
        className="text-amber-950 hover:text-amber-900 hover:bg-amber-400"
      >
        <X className="w-4 h-4 mr-1" />
        Exit Impersonation
      </Button>
    </div>
  );
}
