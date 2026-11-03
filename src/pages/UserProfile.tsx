import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Lock, Building2 } from "lucide-react";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { ChangePasswordForm } from "@/components/profile/ChangePasswordForm";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { getRoleLabel, getRoleBadgeColor } from "@/types/organization";

export default function UserProfile() {
  const { extendedUser, currentOrganization, userRole, isAgency, isClient, isSuperAdmin } = useAuth();

  return (
    <div className="container max-w-3xl py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <User className="w-6 h-6" />
          Profile Settings
        </h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      {/* Account Overview Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Account Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Organization</p>
              <p className="font-medium">{currentOrganization?.name || "—"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Your Role</p>
              <div className="flex items-center gap-2 mt-1">
                {userRole && (
                  <Badge variant="outline" className={getRoleBadgeColor(userRole)}>
                    {getRoleLabel(userRole)}
                  </Badge>
                )}
                {isSuperAdmin && (
                  <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                    Super Admin
                  </Badge>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Account Type</p>
              <p className="font-medium">
                {isAgency ? "Agency" : isClient ? "Client" : "Standalone"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="font-medium">{extendedUser?.email || "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settings Tabs */}
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
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Update your personal information and profile photo
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
      </Tabs>
    </div>
  );
}
