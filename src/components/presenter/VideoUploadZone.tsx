import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Upload, X, Film, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ──────────────────────────────────────────────────────────────────

interface VideoUploadZoneProps {
  value?: string;
  onChange: (url: string | undefined) => void;
}

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const ACCEPTED_EXTENSIONS = '.mp4, .mov, .webm';
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

// ── Component ──────────────────────────────────────────────────────────────

export function VideoUploadZone({ value, onChange }: VideoUploadZoneProps) {
  const { currentOrganization } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(`Unsupported format. Please use ${ACCEPTED_EXTENSIONS}`);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large. Maximum size is 500MB.`);
      return;
    }

    if (!currentOrganization?.id) {
      setError('No organization selected.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setFileName(file.name);

    try {
      // Step 1: Get presigned upload URL from edge function (lightweight JSON call)
      const response = await supabase.functions.invoke('upload-media', {
        body: {
          fileName: file.name,
          contentType: file.type || 'video/mp4',
          mediaType: 'video',
          folder: 'presenter-uploads',
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to get upload URL');
      }

      const result = response.data as {
        uploadUrl?: string;
        publicUrl?: string;
        headers?: Record<string, string>;
        error?: string;
      };

      if (result.error) throw new Error(result.error);
      if (!result.uploadUrl || !result.publicUrl) {
        throw new Error('No upload URL returned');
      }

      // Step 2: Upload file directly to storage provider via XHR (for real progress)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(pct);
          }
        });

        xhr.addEventListener('load', () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
          }
        });

        xhr.addEventListener('error', () => {
          xhrRef.current = null;
          reject(new Error('Upload failed — network error'));
        });

        xhr.addEventListener('abort', () => {
          xhrRef.current = null;
          reject(new Error('Upload cancelled'));
        });

        xhr.open('PUT', result.uploadUrl!);

        // Set required headers from the presigned URL response
        if (result.headers) {
          for (const [key, val] of Object.entries(result.headers)) {
            xhr.setRequestHeader(key, val);
          }
        }

        xhr.send(file);
      });

      setUploadProgress(100);
      onChange(result.publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      onChange(undefined);
    } finally {
      setIsUploading(false);
      xhrRef.current = null;
    }
  }, [currentOrganization?.id, onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleRemove = useCallback(() => {
    onChange(undefined);
    setFileName(null);
    setUploadProgress(0);
    setError(null);
  }, [onChange]);

  const handleCancel = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
    }
    setIsUploading(false);
    setUploadProgress(0);
    setError(null);
  }, []);

  // ── Uploaded state ─────────────────────────────────────────────────────

  if (value) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
          <div className="w-16 h-10 rounded bg-black flex items-center justify-center flex-shrink-0 overflow-hidden">
            <video
              src={value}
              className="w-full h-full object-cover"
              muted
              preload="metadata"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{fileName || 'Uploaded video'}</p>
            <p className="text-[10px] text-muted-foreground truncate">{value}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={handleRemove}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Uploading state ────────────────────────────────────────────────────

  if (isUploading) {
    return (
      <div className="space-y-3 p-4 rounded-lg border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-cta animate-pulse" />
            <span className="text-sm">Uploading {fileName}...</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground hover:text-destructive"
            onClick={handleCancel}
          >
            Cancel
          </Button>
        </div>
        <Progress value={uploadProgress} className="h-1.5" />
        <p className="text-xs text-muted-foreground">{uploadProgress}%</p>
      </div>
    );
  }

  // ── Drop zone ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-all',
          isDragging
            ? 'border-cta bg-cta/5 scale-[1.01]'
            : 'border-border hover:border-cta/50 hover:bg-muted/20',
        )}
      >
        <Upload className={cn('h-8 w-8', isDragging ? 'text-cta' : 'text-muted-foreground')} />
        <div className="text-center">
          <p className="text-sm font-medium">
            {isDragging ? 'Drop video here' : 'Drag & drop your video'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            or click to browse — {ACCEPTED_EXTENSIONS}, max 500MB
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
