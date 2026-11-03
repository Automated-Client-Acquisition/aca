import { Ban, LogOut, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export function SuspendedOrganizationBlock() {
  const { signOut, currentOrganization } = useAuth();

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="max-w-md w-full">
        <CardContent className="py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
            <Ban className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">Account Suspended</h2>
          <p className="text-muted-foreground mb-4">
            Your organization <strong>{currentOrganization?.name}</strong> has been suspended
            by the platform administrator.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Access to this account has been temporarily restricted. Please contact
            support if you believe this is an error or to resolve any outstanding issues.
          </p>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.location.href = "mailto:support@example.com"}
            >
              <Mail className="w-4 h-4 mr-2" />
              Contact Support
            </Button>
            <Button variant="ghost" className="w-full" onClick={signOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
