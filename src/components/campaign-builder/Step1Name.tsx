import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { CampaignBuilderReturn } from "@/hooks/useCampaignBuilder";

export function Step1Name({ builder }: { builder: CampaignBuilderReturn }) {
  const { state, updateField, validation } = builder;
  const [nameTouched, setNameTouched] = useState(false);
  const errors = nameTouched ? validation.steps.name.errors : [];

  return (
    <section
      className="mx-auto w-full max-w-3xl space-y-6"
      aria-labelledby="campaign-overview-heading"
    >
      <div>
        <h2
          id="campaign-overview-heading"
          className="text-xl font-semibold tracking-tight"
        >
          Campaign overview
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Give your campaign a clear name and keep your team’s notes in one
          place.
        </p>
      </div>
      <div className="space-y-6 rounded-xl border bg-card p-5 sm:p-6">
        <div className="space-y-2">
          <Label htmlFor="campaign-name">
            Campaign name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="campaign-name"
            value={state.name}
            onChange={(e) => { setNameTouched(true); updateField("name", e.target.value); }}
            onBlur={() => setNameTouched(true)}
            placeholder="e.g., Q4 outreach · Agency founders"
            maxLength={255}
            required
            aria-invalid={errors.length > 0}
            aria-describedby={
              errors.length ? "campaign-name-error" : "campaign-name-help"
            }
            className={errors.length ? "border-destructive" : ""}
          />
          {errors.length > 0 && (
            <p id="campaign-name-error" className="text-sm text-destructive">
              {errors.join(". ")}
            </p>
          )}
          <p id="campaign-name-help" className="text-xs text-muted-foreground">
            Use an audience, goal or date so your team can find it later.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="campaign-description">
            Internal notes{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Textarea
            id="campaign-description"
            value={state.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Audience, offer, goals or context for your team…"
            rows={5}
            aria-describedby="campaign-description-help"
          />
          <p
            id="campaign-description-help"
            className="text-xs text-muted-foreground"
          >
            Visible to your team. These notes are never included in outreach
            messages.
          </p>
        </div>
      </div>
    </section>
  );
}
