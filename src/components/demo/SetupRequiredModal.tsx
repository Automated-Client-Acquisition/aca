import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSetupStatus } from "@/hooks/useSetupStatus";
import { AlertCircle, ArrowRight, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface SetupRequiredModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action?: string; // e.g., "generate content", "analyze ideas"
  requiredServices?: ("openrouter" | "replicate" | "storage")[];
}

const SERVICE_INFO = {
  openrouter: {
    name: "OpenRouter",
    description: "Required for AI text generation and idea analysis",
    getKeyUrl: "https://openrouter.ai/keys",
    settingsTab: "integrations",
  },
  replicate: {
    name: "Replicate",
    description: "Required for image and video generation",
    getKeyUrl: "https://replicate.com/account/api-tokens",
    settingsTab: "integrations",
  },
  storage: {
    name: "Cloud Storage",
    description: "Required to save your generated content",
    getKeyUrl: null,
    settingsTab: "storage",
  },
};

export function SetupRequiredModal({
  open,
  onOpenChange,
  action = "perform this action",
  requiredServices,
}: SetupRequiredModalProps) {
  const navigate = useNavigate();
  const { hasOpenRouter, hasReplicate, hasStorage, missingItems } = useSetupStatus();

  // Filter to only show relevant missing services
  const servicesToCheck = requiredServices || ["openrouter", "replicate", "storage"];
  const serviceStatus = {
    openrouter: hasOpenRouter,
    replicate: hasReplicate,
    storage: hasStorage,
  };

  const relevantMissing = servicesToCheck.filter(
    (service) => !serviceStatus[service]
  );

  const handleGoToSettings = (tab: string) => {
    onOpenChange(false);
    navigate(`/settings?tab=${tab}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Setup Required
          </DialogTitle>
          <DialogDescription>
            To {action}, you need to connect the following services:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {servicesToCheck.map((serviceId) => {
            const service = SERVICE_INFO[serviceId];
            const isConnected = serviceStatus[serviceId];

            return (
              <div
                key={serviceId}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border",
                  isConnected
                    ? "bg-green-500/10 border-green-500/20"
                    : "bg-muted/50 border-border"
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center",
                      isConnected ? "bg-green-500/20" : "bg-muted"
                    )}
                  >
                    {isConnected ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        {servicesToCheck.indexOf(serviceId) + 1}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{service.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {service.description}
                    </p>
                  </div>
                </div>

                {!isConnected && (
                  <div className="flex items-center gap-2">
                    {service.getKeyUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        asChild
                      >
                        <a
                          href={service.getKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => handleGoToSettings(service.settingsTab)}
                    >
                      Connect
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-between items-center pt-2 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
          <Button variant="cta" onClick={() => handleGoToSettings("integrations")}>
            Go to Settings
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
