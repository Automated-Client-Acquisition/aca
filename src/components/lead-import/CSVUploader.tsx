import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileSpreadsheet, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface CSVUploaderProps {
  onFileSelected: (file: File) => void;
  selectedFile: File | null;
  onClear: () => void;
}

export function CSVUploader({ onFileSelected, selectedFile, onClear }: CSVUploaderProps) {
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: { file: File; errors: { message: string }[] }[]) => {
      setError(null);

      if (rejectedFiles.length > 0) {
        const errorMessage = rejectedFiles[0].errors[0]?.message || "Invalid file type";
        setError(errorMessage);
        return;
      }

      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        if (file.size > 500 * 1024 * 1024) {
          setError("File size must be less than 500MB");
          return;
        }
        onFileSelected(file);
      }
    },
    [onFileSelected]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".csv"],
    },
    maxFiles: 1,
  });

  if (selectedFile) {
    return (
      <div className="space-y-4">
        <div className="border rounded-lg p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{selectedFile.name}</p>
            <p className="text-sm text-muted-foreground">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClear}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          {isDragActive ? (
            <p className="text-primary font-medium">Drop your CSV file here</p>
          ) : (
            <>
              <p className="font-medium">
                Drag and drop your CSV file here, or{" "}
                <span className="text-primary">browse</span>
              </p>
              <p className="text-sm text-muted-foreground">
                CSV files only. Maximum file size: 500MB
              </p>
            </>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
