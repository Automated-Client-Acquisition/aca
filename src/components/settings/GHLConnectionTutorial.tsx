import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  HelpCircle,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Copy,
  CheckCircle2,
  AlertCircle,
  Settings,
  Link as LinkIcon,
  User,
  Share2,
  Key,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FUNCTIONS_URL } from "@/config/site";

const CALLBACK_URL = `${FUNCTIONS_URL}/oauth-callback`;

const REQUIRED_SCOPES = [
  "socialplanner/oauth.readonly",
  "socialplanner/oauth.write",
  "socialplanner/post.readonly",
  "socialplanner/post.write",
  "socialplanner/account.readonly",
  "socialplanner/account.write",
  "socialplanner/csv.readonly",
  "socialplanner/csv.write",
  "socialplanner/category.readonly",
  "socialplanner/tag.readonly",
  "socialplanner/statistics.readonly",
  "socialplanner/category.write",
  "socialplanner/tag.write",
  "medias.readonly",
  "medias.write",
  "oauth.readonly",
  "oauth.write",
  "blogs/post.write",
];

interface TutorialStepProps {
  stepNumber: number;
  title: string;
  description: string;
  children: React.ReactNode;
  isActive?: boolean;
}

function TutorialStep({ stepNumber, title, description, children, isActive = true }: TutorialStepProps) {
  return (
    <div className={cn("space-y-4", !isActive && "opacity-50")}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
          {stepNumber}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="ml-11">{children}</div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(label ? `${label} copied to clipboard` : "Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className="h-8 gap-2"
    >
      {copied ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </>
      )}
    </Button>
  );
}

export function GHLConnectionTutorial() {
  const [currentStep, setCurrentStep] = useState(0);
  const [open, setOpen] = useState(false);

  const steps = [
    {
      title: "Overview",
      icon: <HelpCircle className="h-4 w-4" />,
    },
    {
      title: "Create App",
      icon: <Settings className="h-4 w-4" />,
    },
    {
      title: "Credentials",
      icon: <Key className="h-4 w-4" />,
    },
    {
      title: "Scopes",
      icon: <Share2 className="h-4 w-4" />,
    },
    {
      title: "Connect",
      icon: <LinkIcon className="h-4 w-4" />,
    },
    {
      title: "User ID",
      icon: <User className="h-4 w-4" />,
    },
  ];

  const nextStep = () => setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 0));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-2 text-muted-foreground hover:text-foreground">
          <HelpCircle className="h-4 w-4" />
          Setup Guide
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <LinkIcon className="h-4 w-4 text-primary" />
            </div>
            LeadConnector Connection Setup
          </DialogTitle>
          <DialogDescription>
            Follow these steps to connect your LeadConnector account and start publishing content.
          </DialogDescription>
        </DialogHeader>

        {/* Progress Steps */}
        <div className="flex items-center justify-between px-2 py-4">
          {steps.map((step, index) => (
            <button
              key={index}
              onClick={() => setCurrentStep(index)}
              className={cn(
                "flex flex-col items-center gap-1 transition-all",
                index === currentStep
                  ? "text-primary"
                  : index < currentStep
                  ? "text-green-600"
                  : "text-muted-foreground"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all",
                  index === currentStep
                    ? "border-primary bg-primary/10"
                    : index < currentStep
                    ? "border-green-600 bg-green-600 text-white"
                    : "border-muted"
                )}
              >
                {index < currentStep ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  step.icon
                )}
              </div>
              <span className="text-xs font-medium hidden sm:block">{step.title}</span>
            </button>
          ))}
        </div>

        <Separator />

        {/* Step Content */}
        <div className="py-4 space-y-6">
          {currentStep === 0 && (
            <div className="space-y-4">
              <TutorialStep
                stepNumber={1}
                title="What You'll Need"
                description="Before starting, make sure you have access to the following:"
              >
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">LeadConnector Agency Account</p>
                      <p className="text-sm text-muted-foreground">
                        You need an active GHL account with agency-level access to create marketplace apps.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Social Media Accounts Connected in GHL</p>
                      <p className="text-sm text-muted-foreground">
                        Connect your Facebook, Instagram, LinkedIn, Twitter, or TikTok accounts in your GHL Social Planner first.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Pro Plan (for publishing)</p>
                      <p className="text-sm text-muted-foreground">
                        Publishing to GHL requires a Pro subscription. You can still connect without it.
                      </p>
                    </div>
                  </div>
                </div>
              </TutorialStep>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  This setup takes about <strong>5-10 minutes</strong>. You'll need to create a private marketplace app in GHL to authorize the connection.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-4">
              <TutorialStep
                stepNumber={2}
                title="Create a Marketplace App"
                description="You'll create a private OAuth app in the GHL Marketplace to authorize the connection."
              >
                <div className="space-y-4">
                  <ol className="space-y-4 text-sm">
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">1.</span>
                      <div>
                        <p>Go to the GHL Marketplace and log in:</p>
                        <p className="mt-1">
                          <Badge variant="secondary" className="font-mono text-xs">
                            https://marketplace.leadconnectorhq.com
                          </Badge>
                        </p>
                        <p className="mt-2 text-muted-foreground">
                          Use the <strong>same email address</strong> as your GHL account to log in.
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">2.</span>
                      <div>
                        <p>Click <strong>"Create App"</strong> and configure:</p>
                        <ul className="mt-2 space-y-1 text-muted-foreground">
                          <li>• <strong>App Name:</strong> "Content Publisher" (or any name you prefer)</li>
                          <li>• <strong>Description:</strong> "Allows publishing content to social media"</li>
                          <li>• <strong>App Type:</strong> Select <strong>"Private"</strong></li>
                          <li>• <strong>Distribution:</strong> Select <strong>"White-label"</strong></li>
                          <li>• <strong>Who can install:</strong> Select <strong>"Everyone can install"</strong></li>
                          <li>• <strong>Target:</strong> Select <strong>"Sub-Account"</strong></li>
                        </ul>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">3.</span>
                      <div>
                        <p>In the <strong>Redirect URL</strong> field, paste this callback URL:</p>
                        <div className="mt-2 flex items-center gap-2">
                          <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md break-all">
                            {CALLBACK_URL}
                          </code>
                          <CopyButton text={CALLBACK_URL} label="Callback URL" />
                        </div>
                      </div>
                    </li>
                  </ol>

                  <Alert className="bg-[hsl(var(--status-warning))]/10 border-[hsl(var(--status-warning))]/30">
                    <AlertCircle className="h-4 w-4 text-[hsl(var(--status-warning))]" />
                    <AlertDescription className="text-[hsl(var(--status-warning))]">
                      <strong>Important:</strong> The callback URL must be exactly as shown above. Any typo will cause the connection to fail.
                    </AlertDescription>
                  </Alert>

                  <Button variant="outline" className="w-full gap-2" asChild>
                    <a
                      href="https://marketplace.leadconnectorhq.com"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open GHL Marketplace
                    </a>
                  </Button>
                </div>
              </TutorialStep>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <TutorialStep
                stepNumber={3}
                title="Create Client Secret"
                description="Generate credentials to authenticate your app."
              >
                <div className="space-y-4">
                  <ol className="space-y-4 text-sm">
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">1.</span>
                      <div>
                        <p>After creating your app, navigate to:</p>
                        <p className="mt-1">
                          <Badge variant="secondary" className="font-mono text-xs">
                            Manage → Secrets → Client Keys
                          </Badge>
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">2.</span>
                      <div>
                        <p>Click <strong>"Add"</strong> or <strong>"Create New Key"</strong> to generate a new Client Secret.</p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">3.</span>
                      <div>
                        <p>Copy both the <strong>Client ID</strong> and <strong>Client Secret</strong>:</p>
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                            <Key className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-muted-foreground text-xs">Client ID:</span>
                            <code className="text-xs font-mono">xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>
                          </div>
                          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                            <Key className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-muted-foreground text-xs">Client Secret:</span>
                            <code className="text-xs font-mono">xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</code>
                          </div>
                        </div>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">4.</span>
                      <p>Store these credentials safely - you'll need them if setting up your own instance.</p>
                    </li>
                  </ol>

                  <Alert className="bg-[hsl(var(--status-warning))]/10 border-[hsl(var(--status-warning))]/30">
                    <AlertCircle className="h-4 w-4 text-[hsl(var(--status-warning))]" />
                    <AlertDescription className="text-[hsl(var(--status-warning))]">
                      <strong>Important:</strong> The Client Secret is only shown once when created. Make sure to copy it immediately and store it securely.
                    </AlertDescription>
                  </Alert>
                </div>
              </TutorialStep>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <TutorialStep
                stepNumber={4}
                title="Configure OAuth Scopes"
                description="Select the permissions your app needs to publish content."
              >
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    In your app settings, navigate to the <strong>Scopes</strong> section and enable the following permissions:
                  </p>

                  <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                    {REQUIRED_SCOPES.map((scope) => (
                      <div key={scope} className="flex items-center justify-between px-3 py-2 text-sm">
                        <code className="text-xs bg-muted px-2 py-1 rounded">{scope}</code>
                        <Badge variant="outline" className="text-xs">Required</Badge>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 gap-2"
                      onClick={() => {
                        navigator.clipboard.writeText(REQUIRED_SCOPES.join("\n"));
                        toast.success("All scopes copied to clipboard");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                      Copy All Scopes
                    </Button>
                  </div>

                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      After adding scopes, make sure to <strong>save your app</strong> before proceeding to the next step.
                    </AlertDescription>
                  </Alert>
                </div>
              </TutorialStep>
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-4">
              <TutorialStep
                stepNumber={5}
                title="Connect in the App"
                description="Now you can authorize the connection from this app."
              >
                <div className="space-y-4">
                  <ol className="space-y-4 text-sm">
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">1.</span>
                      <p>Close this tutorial and click the <strong>"Connect LeadConnector"</strong> button below.</p>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">2.</span>
                      <p>A popup window will open asking you to authorize the connection.</p>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">3.</span>
                      <div>
                        <p>Select the <strong>Location</strong> (sub-account) you want to connect:</p>
                        <p className="text-muted-foreground mt-1">
                          Choose the location that has your social media accounts connected.
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">4.</span>
                      <p>Click <strong>"Authorize"</strong> to complete the connection.</p>
                    </li>
                  </ol>

                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      <strong>White-label users:</strong> The popup opens on <code className="text-xs bg-muted px-1 rounded">app.leadconnectorhq.com</code>.
                      If you use a custom domain (e.g. app.youragency.com), you'll need to sign in again in the popup with the same credentials.
                    </AlertDescription>
                  </Alert>

                  <Alert className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-900 dark:text-green-100">
                      Once connected, your social media accounts will appear in the integration card. You can publish content directly from the Jobs page.
                    </AlertDescription>
                  </Alert>
                </div>
              </TutorialStep>
            </div>
          )}

          {currentStep === 5 && (
            <div className="space-y-4">
              <TutorialStep
                stepNumber={6}
                title="Configure Your GHL User ID"
                description="The final step is to add your GHL User ID for publishing to work."
              >
                <div className="space-y-4">
                  <Alert variant="destructive" className="border-destructive/50">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>This step is required!</strong> Publishing will fail without your User ID configured.
                    </AlertDescription>
                  </Alert>

                  <ol className="space-y-4 text-sm">
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">1.</span>
                      <div>
                        <p>In GHL, go to your location and navigate to:</p>
                        <p className="mt-1">
                          <Badge variant="secondary" className="font-mono text-xs">
                            Settings → My Staff → Click your profile
                          </Badge>
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">2.</span>
                      <div>
                        <p>Look at the URL in your browser. It will look like:</p>
                        <code className="block mt-2 text-xs bg-muted px-3 py-2 rounded-md break-all">
                          app.leadconnectorhq.com/v2/location/.../settings/users/<strong className="text-primary">abc123xyz</strong>
                        </code>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">3.</span>
                      <div>
                        <p>Copy the <strong>last part</strong> of the URL (your User ID) - in this example: <code className="text-xs bg-muted px-2 py-1 rounded">abc123xyz</code></p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="font-semibold text-primary">4.</span>
                      <p>Paste it in the <strong>"GHL User ID"</strong> field in the integration card below and click <strong>Save</strong>.</p>
                    </li>
                  </ol>

                  <Alert className="bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800">
                    <HelpCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-900 dark:text-blue-100">
                      <strong>Why is this needed?</strong> GHL requires a user ID to attribute posts. This ensures your published content is associated with your account.
                    </AlertDescription>
                  </Alert>
                </div>
              </TutorialStep>

              <Separator />

              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto" />
                <p className="font-semibold text-green-900 dark:text-green-100">You're all set!</p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Once connected and configured, you can publish content from the Jobs page using the "Publish" button.
                </p>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={currentStep === 0}
            className="gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>

          <span className="text-sm text-muted-foreground">
            Step {currentStep + 1} of {steps.length}
          </span>

          {currentStep === steps.length - 1 ? (
            <Button variant="cta" onClick={() => setOpen(false)} className="gap-2">
              Done
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="cta" onClick={nextStep} className="gap-2">
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
