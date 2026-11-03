import { useState } from "react";
import { useStorageCredentials } from "@/hooks/useStorageCredentials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, HardDrive, CheckCircle2, AlertCircle, Trash2, Circle } from "lucide-react";
import { AddStorageDialog } from "./AddStorageDialog";
import { useDeleteStorageCredentials } from "@/hooks/useDeleteStorageCredentials";
import { useTestStorageConnection } from "@/hooks/useTestStorageConnection";
import { useSetActiveStorage } from "@/hooks/useSetActiveStorage";
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

const PROVIDER_LABELS: Record<string, string> = {
  cloudflare_r2: "Cloudflare R2",
  aws_s3: "AWS S3",
  backblaze_b2: "Backblaze B2",
};

export function StorageSettings() {
  const { data: credentials, isLoading } = useStorageCredentials();
  const deleteCredentials = useDeleteStorageCredentials();
  const testConnection = useTestStorageConnection();
  const setActiveStorage = useSetActiveStorage();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleTest = (credentialId: string) => {
    testConnection.mutate({ credentialId });
  };

  const handleSetActive = (credentialId: string) => {
    setActiveStorage.mutate(credentialId);
  };

  const handleDelete = () => {
    if (deletingId) {
      deleteCredentials.mutate(deletingId, {
        onSuccess: () => setDeletingId(null),
      });
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading storage credentials...</div>;
  }

  // Sort credentials: active first, then by created date
  const sortedCredentials = credentials?.slice().sort((a, b) => {
    if (a.is_active && !b.is_active) return -1;
    if (!a.is_active && b.is_active) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                Storage Credentials
              </CardTitle>
              <CardDescription>
                Manage your cloud storage credentials for storing generated content. Only one storage can be active at a time.
              </CardDescription>
            </div>
            <Button onClick={() => setShowAddDialog(true)} className="bg-gradient-cta hover:opacity-90 text-cta-foreground font-medium shadow-lg">
              <Plus className="h-4 w-4 mr-2" />
              Add Storage
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!sortedCredentials || sortedCredentials.length === 0 ? (
            <div className="text-center py-12">
              <HardDrive className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Storage Configured</h3>
              <p className="text-muted-foreground mb-4">
                Add your cloud storage credentials to store generated videos and images
              </p>
              <Button onClick={() => setShowAddDialog(true)} className="bg-gradient-cta hover:opacity-90 text-cta-foreground font-medium shadow-lg">
                <Plus className="h-4 w-4 mr-2" />
                Add Storage
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedCredentials.map((cred) => (
                <div
                  key={cred.id}
                  className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${
                    cred.is_active
                      ? "border-primary/50 bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h4 className="font-semibold">
                        {PROVIDER_LABELS[cred.provider] || cred.provider}
                      </h4>
                      {cred.is_active ? (
                        <Badge className="gap-1 bg-primary">
                          <CheckCircle2 className="h-3 w-3" />
                          In Use
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <Circle className="h-3 w-3" />
                          Inactive
                        </Badge>
                      )}
                      {cred.is_valid ? (
                        <Badge variant="outline" className="gap-1 text-green-600 border-green-200">
                          <CheckCircle2 className="h-3 w-3" />
                          Valid
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Invalid
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Bucket: {cred.bucket_name}
                    </p>
                    {cred.total_uploads > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {cred.total_uploads} uploads • {(cred.total_size_bytes / 1024 / 1024).toFixed(2)} MB
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!cred.is_active && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetActive(cred.id)}
                        disabled={setActiveStorage.isPending}
                      >
                        Set Active
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTest(cred.id)}
                      disabled={testConnection.isPending}
                    >
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeletingId(cred.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AddStorageDialog open={showAddDialog} onOpenChange={setShowAddDialog} />

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Storage Credentials</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete these storage credentials? This action cannot be undone.
              {credentials?.find(c => c.id === deletingId)?.is_active && (
                <span className="block mt-2 text-amber-600 font-medium">
                  Warning: This is your currently active storage. You'll need to add new credentials or activate another storage after deletion.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
