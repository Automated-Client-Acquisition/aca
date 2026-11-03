import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { ChangePasswordForm } from "@/components/profile/ChangePasswordForm";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingState } from "@/hooks/useOnboardingState";
import { useActivationChecklist } from "@/hooks/useActivationChecklist";
import { Button } from "@/components/ui/button";
import { User, Lock, ListChecks, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export function AccountSettings() {
  const { user } = useAuth();
  const { checklistDismissed, restoreChecklist } = useOnboardingState();
  const { completedCount, totalCount } = useActivationChecklist();

  const handleRestoreChecklist = () => {
    restoreChecklist.mutate(undefined, {
      onSuccess: () => {
        toast.success("Getting started checklist restored");
      },
      onError: () => {
        toast.error("Failed to restore checklist");
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Account Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage your personal account and security settings
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profile" className="gap-2">
            <User className="w-4 h-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Lock className="w-4 h-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-2">
            <ListChecks className="w-4 h-4" />
            Preferences
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Update your personal details
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>
                Update your password to keep your account secure
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences">
          <Card>
            <CardHeader>
              <CardTitle>Getting Started Checklist</CardTitle>
              <CardDescription>
                The checklist helps you set up your account and get the most out of the platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              {checklistDismissed ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      You dismissed the getting started checklist. You can restore it to continue tracking your progress.
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Progress: {completedCount}/{totalCount} items completed
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleRestoreChecklist}
                    disabled={restoreChecklist.isPending}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Restore Checklist
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The getting started checklist is visible. Progress: {completedCount}/{totalCount} items completed.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
