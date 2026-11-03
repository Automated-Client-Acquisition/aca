import { Archive, LogOut } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export function ArchivedOrganizationBlock() {
  const { signOut, currentOrganization } = useAuth();

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="max-w-md w-full">
        <CardContent className="py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-6">
            <Archive className="w-8 h-8 text-yellow-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">Organization Archived</h2>
          <p className="text-muted-foreground mb-6">
            Your organization <strong>{currentOrganization?.name}</strong> has been archived
            by the administrator. Access to this account has been temporarily suspended.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Please contact your agency administrator to reactivate your account.
          </p>
          <Button variant="outline" className="w-full" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
