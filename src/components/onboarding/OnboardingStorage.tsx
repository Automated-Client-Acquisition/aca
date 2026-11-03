import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cloud, Check, Loader2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useAddStorageCredentials } from "@/hooks/useAddStorageCredentials";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type StorageProvider = 'cloudflare_r2' | 'aws_s3' | 'backblaze_b2';

interface OnboardingStorageProps {
  onNext: () => void;
  onBack: () => void;
}

export function OnboardingStorage({ onNext, onBack }: OnboardingStorageProps) {
  const [provider, setProvider] = useState<StorageProvider>('cloudflare_r2');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [isValid, setIsValid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const addStorage = useAddStorageCredentials();

  const handleTest = async () => {
    setError(null);
    try {
      await addStorage.mutateAsync({ provider, credentials });
      setIsValid(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate storage credentials');
    }
  };

  const getProviderFields = () => {
    switch (provider) {
      case 'cloudflare_r2':
        return [
          { key: 'accountId', label: 'Account ID', placeholder: 'Your Cloudflare account ID' },
          { key: 'accessKeyId', label: 'Access Key ID', placeholder: 'Your R2 access key' },
          { key: 'secretAccessKey', label: 'Secret Access Key', placeholder: 'Your R2 secret key', type: 'password' },
          { key: 'bucketName', label: 'Bucket Name', placeholder: 'your-bucket-name' },
          { key: 'publicUrl', label: 'Public URL', placeholder: 'https://pub-xxx.r2.dev', description: 'Your R2 public bucket URL (enable Public Access in bucket settings)' },
        ];
      case 'aws_s3':
        return [
          { key: 'region', label: 'Region', placeholder: 'us-east-1' },
          { key: 'accessKeyId', label: 'Access Key ID', placeholder: 'Your AWS access key' },
          { key: 'secretAccessKey', label: 'Secret Access Key', placeholder: 'Your AWS secret key', type: 'password' },
          { key: 'bucketName', label: 'Bucket Name', placeholder: 'your-bucket-name' },
        ];
      case 'backblaze_b2':
        return [
          { key: 'keyId', label: 'Key ID', placeholder: 'Your B2 key ID' },
          { key: 'applicationKey', label: 'Application Key', placeholder: 'Your B2 application key', type: 'password' },
          { key: 'bucketName', label: 'Bucket Name', placeholder: 'your-bucket-name' },
          { key: 'bucketId', label: 'Bucket ID', placeholder: 'Your B2 bucket ID' },
          { key: 'endpoint', label: 'Endpoint', placeholder: 's3.us-west-000.backblazeb2.com' },
        ];
      default:
        return [];
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] px-8 py-8">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 rounded-xl bg-primary/10">
              <Cloud className="h-10 w-10 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">Storage Setup</h2>
            <p className="text-muted-foreground">
              Your generated content is stored in your cloud - you own everything
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-destructive/10 text-sm">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="font-medium text-destructive">Required</span>
          </div>
        </div>

        {/* Provider Selection */}
        <div className="grid md:grid-cols-3 gap-3">
          <Card
            className={`p-4 cursor-pointer transition-all hover:border-primary ${
              provider === 'cloudflare_r2' ? 'border-primary bg-accent ring-2 ring-primary/20' : ''
            }`}
            onClick={() => { setProvider('cloudflare_r2'); setError(null); setCredentials({}); setIsValid(false); }}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Cloudflare R2</span>
                <Badge variant="secondary">Recommended</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Fast & generous free tier</p>
            </div>
          </Card>

          <Card
            className={`p-4 cursor-pointer transition-all hover:border-primary ${
              provider === 'aws_s3' ? 'border-primary bg-accent ring-2 ring-primary/20' : ''
            }`}
            onClick={() => { setProvider('aws_s3'); setError(null); setCredentials({}); setIsValid(false); }}
          >
            <div className="space-y-2">
              <span className="font-semibold">AWS S3</span>
              <p className="text-xs text-muted-foreground">Industry standard</p>
            </div>
          </Card>

          <Card
            className={`p-4 cursor-pointer transition-all hover:border-primary ${
              provider === 'backblaze_b2' ? 'border-primary bg-accent ring-2 ring-primary/20' : ''
            }`}
            onClick={() => { setProvider('backblaze_b2'); setError(null); setCredentials({}); setIsValid(false); }}
          >
            <div className="space-y-2">
              <span className="font-semibold">Backblaze B2</span>
              <p className="text-xs text-muted-foreground">Most affordable</p>
            </div>
          </Card>
        </div>

        {/* Setup Guide */}
        <Collapsible open={showGuide} onOpenChange={setShowGuide}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full">
              {showGuide ? <ChevronUp className="h-4 w-4 mr-2" /> : <ChevronDown className="h-4 w-4 mr-2" />}
              Setup Guide for {provider === 'cloudflare_r2' ? 'Cloudflare R2' : provider === 'aws_s3' ? 'AWS S3' : 'Backblaze B2'}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <Card className="p-4 bg-muted">
              <div className="space-y-2 text-sm text-muted-foreground">
                {provider === 'cloudflare_r2' && (
                  <>
                    <p>1. Go to Cloudflare dashboard → R2</p>
                    <p>2. Create a new bucket</p>
                    <p>3. Go to "Manage R2 API Tokens" → Create API Token</p>
                    <p>4. Copy your Account ID, Access Key, and Secret Key</p>
                    <p>5. Enable "Public Access" in bucket settings and copy the Public URL</p>
                    <p className="font-medium text-amber-500">6. Add a CORS policy: Settings → CORS → allow <code className="text-[11px] bg-background px-1 rounded">{window.location.origin}</code> with PUT and GET methods</p>
                  </>
                )}
                {provider === 'aws_s3' && (
                  <>
                    <p>1. Go to AWS Console → S3</p>
                    <p>2. Create a new bucket</p>
                    <p>3. Go to IAM → Create access key</p>
                    <p>4. Copy your Access Key ID and Secret Access Key</p>
                    <p className="font-medium text-amber-500">5. Add a CORS policy: Bucket → Permissions → CORS → allow <code className="text-[11px] bg-background px-1 rounded">{window.location.origin}</code> with PUT and GET methods</p>
                  </>
                )}
                {provider === 'backblaze_b2' && (
                  <>
                    <p>1. Go to Backblaze → Buckets</p>
                    <p>2. Create a new bucket</p>
                    <p>3. Go to App Keys → Add a New Application Key</p>
                    <p>4. Copy your Key ID, Application Key, Bucket ID, and Endpoint</p>
                    <p className="font-medium text-amber-500">5. Add a CORS rule: Bucket Settings → CORS Rules → allow <code className="text-[11px] bg-background px-1 rounded">{window.location.origin}</code> with PUT and GET methods</p>
                  </>
                )}
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        {/* Credentials Form */}
        <Card className="p-6 space-y-4">
          {getProviderFields().map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Input
                id={field.key}
                type={field.type || 'text'}
                placeholder={field.placeholder}
                value={credentials[field.key] || ''}
                onChange={(e) => {
                  setCredentials({ ...credentials, [field.key]: e.target.value });
                  setError(null);
                }}
              />
              {field.description && (
                <p className="text-xs text-muted-foreground">{field.description}</p>
              )}
            </div>
          ))}

          {isValid && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <Check className="h-4 w-4" />
              <span>Storage connection verified successfully</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}

          {Object.values(credentials).every(v => v) && !isValid && (
            <Button
              className="w-full"
              onClick={handleTest}
              disabled={addStorage.isPending}
            >
              {addStorage.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                'Test & Save Connection'
              )}
            </Button>
          )}
        </Card>

        {/* Navigation */}
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button variant="cta" onClick={onNext} disabled={!isValid}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
