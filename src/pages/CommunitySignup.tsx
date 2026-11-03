import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, CheckCircle, Sparkles, Crown, Star, Gem, Mail, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SkoolPlan = "standard" | "premium" | "vip";

const SKOOL_PLANS: Record<SkoolPlan, { label: string; price: string; icon: React.ElementType; color: string }> = {
  standard: { label: "Standard", price: "$1/month", icon: Star, color: "text-slate-600" },
  premium: { label: "Premium", price: "$67/month", icon: Crown, color: "text-amber-500" },
  vip: { label: "VIP", price: "$297/month", icon: Gem, color: "text-primary" },
};

export default function CommunitySignup() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [skoolProfileUrl, setSkoolProfileUrl] = useState("");
  const [skoolPlan, setSkoolPlan] = useState<SkoolPlan>("standard");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Basic validation
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsSubmitting(true);

    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      // Extract Skool username from URL if provided
      let skoolUsername = "";
      if (skoolProfileUrl.trim()) {
        // Handle various formats: full URL, @username, or just username
        const url = skoolProfileUrl.trim();
        if (url.includes("skool.com/@")) {
          skoolUsername = url.split("@").pop()?.split("/")[0] || "";
        } else if (url.startsWith("@")) {
          skoolUsername = url.substring(1);
        } else if (!url.includes("/")) {
          skoolUsername = url;
        }
      }

      // Check if there's already a pending request for this email
      const { data: existingRequest } = await supabase
        .from("signup_requests")
        .select("id, status")
        .eq("email", email.toLowerCase().trim())
        .eq("status", "pending")
        .single();

      if (existingRequest) {
        setIsSuccess(true);
        return;
      }

      // Insert signup request
      const { error: insertError } = await supabase
        .from("signup_requests")
        .insert({
          email: email.toLowerCase().trim(),
          full_name: fullName,
          skool_username: skoolUsername || null,
          source: "landing_page",
          source_data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            skool_profile_url: skoolProfileUrl.trim() || null,
            skool_plan: skoolPlan,
          },
        });

      if (insertError) {
        // Handle duplicate request
        if (insertError.code === "23505") {
          setIsSuccess(true);
          return;
        }
        throw insertError;
      }

      setIsSuccess(true);
    } catch (error) {
      console.error("Error submitting signup request:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-3xl font-bold mb-3">Thank You!</h2>
            <p className="text-lg text-muted-foreground mb-6">
              Your request has been submitted and is now under review.
            </p>

            <div className="bg-muted/50 rounded-lg p-6 mb-6 text-left space-y-4">
              <h3 className="font-semibold text-center mb-4">What happens next?</h3>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">1</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Our team will review your application to verify your Skool community membership.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">2</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <strong>Once approved, you'll receive an email at {email}</strong> with a magic link to access your account.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">3</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Click the link in your email to set up your password and start creating amazing content!
                </p>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 justify-center">
                <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                  Keep an eye on your inbox!
                </p>
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                Check your spam folder too - approval emails come from our system.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Review typically takes 24-48 hours.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Get Access to ACA</CardTitle>
          <CardDescription>
            Fill out this form to request access to the platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="skoolProfile">Skool Profile URL</Label>
              <Input
                id="skoolProfile"
                placeholder="https://www.skool.com/@username"
                value={skoolProfileUrl}
                onChange={(e) => setSkoolProfileUrl(e.target.value)}
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Helps us verify your community membership
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Your Skool Membership Plan *</Label>
                <a
                  href="https://www.skool.com/aca-xtreme/about"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  View plan details
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <RadioGroup
                value={skoolPlan}
                onValueChange={(value) => setSkoolPlan(value as SkoolPlan)}
                className="grid grid-cols-1 gap-2"
                disabled={isSubmitting}
              >
                {(Object.entries(SKOOL_PLANS) as [SkoolPlan, typeof SKOOL_PLANS[SkoolPlan]][]).map(
                  ([key, plan]) => {
                    const Icon = plan.icon;
                    return (
                      <Label
                        key={key}
                        htmlFor={`plan-${key}`}
                        className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors hover:bg-muted/50 ${
                          skoolPlan === key ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <RadioGroupItem value={key} id={`plan-${key}`} />
                        <Icon className={`w-5 h-5 ${plan.color}`} />
                        <span className="font-medium flex-1">{plan.label}</span>
                        <span className="text-sm text-muted-foreground">{plan.price}</span>
                      </Label>
                    );
                  }
                )}
              </RadioGroup>
            </div>

            <Button variant="cta" type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Request Access"
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              By requesting access, you agree to our terms of service.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
