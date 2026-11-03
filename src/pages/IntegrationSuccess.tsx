import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PROVIDER_NAMES: Record<string, string> = {
  leadconnector: "LeadConnector",
};

export default function IntegrationSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(3);

  const provider = searchParams.get("provider") || "integration";
  const status = searchParams.get("status") || "success";
  const errorMessage = searchParams.get("message");

  const isSuccess = status === "success";
  const providerName = PROVIDER_NAMES[provider] || provider;

  useEffect(() => {
    if (isSuccess) {
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            navigate("/settings?tab=integrations");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [isSuccess, navigate]);

  const handleGoToSettings = () => {
    navigate("/settings?tab=integrations");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4">
            {isSuccess ? (
              <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center animate-in zoom-in duration-300">
                <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
            ) : (
              <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center animate-in zoom-in duration-300">
                <XCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
              </div>
            )}
          </div>
          <CardTitle className="text-2xl">
            {isSuccess ? "Connected Successfully!" : "Connection Failed"}
          </CardTitle>
          <CardDescription className="text-base">
            {isSuccess
              ? `Your ${providerName} account has been connected.`
              : `Failed to connect your ${providerName} account.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isSuccess && errorMessage && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
            </div>
          )}

          {isSuccess && (
            <p className="text-center text-sm text-muted-foreground">
              Redirecting to settings in {countdown} second{countdown !== 1 ? "s" : ""}...
            </p>
          )}

          <Button onClick={handleGoToSettings} className="w-full" size="lg">
            Go to Integrations
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>

          {!isSuccess && (
            <p className="text-center text-sm text-muted-foreground">
              Please try connecting again or contact support if the issue persists.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
