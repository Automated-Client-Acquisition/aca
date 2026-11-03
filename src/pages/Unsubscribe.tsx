import { useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";

const Unsubscribe = () => {
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status");
  const isSuccess = status === "success";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-5">
      <div className="bg-card rounded-xl p-12 max-w-md w-full text-center shadow-sm border">
        {isSuccess ? (
          <>
            <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-6" />
            <h1 className="text-2xl font-semibold text-foreground mb-3">
              You have been unsubscribed
            </h1>
            <p className="text-muted-foreground">
              You will no longer receive emails from this sender.
            </p>
          </>
        ) : (
          <>
            <XCircle className="h-14 w-14 text-destructive mx-auto mb-6" />
            <h1 className="text-2xl font-semibold text-foreground mb-3">
              Something went wrong
            </h1>
            <p className="text-muted-foreground">
              This unsubscribe link is invalid or has expired.
            </p>
          </>
        )}
        <p className="text-sm text-muted-foreground/60 mt-8">
          You can close this page.
        </p>
      </div>
    </div>
  );
};

export default Unsubscribe;
