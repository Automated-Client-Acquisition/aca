import { useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SequenceDelayPicker } from "@/components/email/SequenceDelayPicker";
import { VariablePickerDropdown } from "@/components/email/VariablePickerDropdown";
import { SpintaxPickerDropdown } from "@/components/email/SpintaxPickerDropdown";
import {
  EmailRichTextEditor,
  type EmailRichTextEditorHandle,
} from "@/components/email/EmailRichTextEditor";
import { SpamCheckPanel } from "@/components/email/SpamCheckPanel";
import {
  Mail,
  Clock,
  GitBranch,
  Split,
  Trash2,
  ChevronUp,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SEQUENCE_STEP_STYLES } from "@/components/email/sequence-step-styles";
import {
  formatDelayHours,
  CONDITION_TIMEOUT_PRESETS,
  type ValidationError,
} from "@/lib/email-sequence-utils";
import type { EmailSequenceStep, StepType, ConditionType } from "@/types/email";

interface SequenceStepEditorProps {
  step: EmailSequenceStep;
  stepIndex: number;
  totalSteps: number;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (step: EmailSequenceStep) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  previousSubject?: string;
  errors?: ValidationError[];
}

const STEP_ICONS: Record<StepType, React.ElementType> = {
  email: Mail,
  delay: Clock,
  condition: GitBranch,
  ab_test: Split,
};

const STEP_LABELS: Record<StepType, string> = {
  email: "Email",
  delay: "Delay",
  condition: "Condition",
  ab_test: "A/B Test",
};

export function SequenceStepEditor({
  step,
  stepIndex,
  totalSteps,
  isSelected,
  onSelect,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  previousSubject,
  errors = [],
}: SequenceStepEditorProps) {
  const Icon = STEP_ICONS[step.type];
  const hasErrors = errors.length > 0;
  const hasFieldError = (field: string) =>
    errors.some((e) => e.field === field);
  const bodyEditorRef = useRef<EmailRichTextEditorHandle>(null);

  const insertVariable = (variable: string, field: "subject" | "body") => {
    const current = step[field] || "";
    onChange({ ...step, [field]: current + variable });
  };

  // Compact preview (when not selected)
  if (!isSelected) {
    return (
      <div
        className={cn(
          "group flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all hover:border-primary/50 hover:shadow-sm",
          step.type === "delay" && "border-dashed",
          hasErrors && "border-red-500/40 bg-red-500/5",
        )}
        role="button"
        tabIndex={0}
        aria-expanded={false}
        aria-label={`Edit step ${stepIndex + 1}: ${STEP_LABELS[step.type]}`}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        onClick={onSelect}
      >
        <div
          className={cn(
            "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border",
            SEQUENCE_STEP_STYLES[step.type].icon,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-[100px]">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-medium",
                SEQUENCE_STEP_STYLES[step.type].icon,
              )}
            >
              Step {stepIndex + 1}
            </Badge>
            <span className="text-xs font-medium">
              {STEP_LABELS[step.type]}
            </span>
          </div>
          {step.type === "email" && (step.subject || previousSubject) && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {step.subject ||
                (previousSubject
                  ? `Re: ${previousSubject.replace(/^Re:\s*/i, "")}`
                  : "")}
            </p>
          )}
          {step.type === "delay" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Wait {formatDelayHours(step.delay_hours || 24)}
            </p>
          )}
          {step.type === "condition" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              If {step.condition_type || "replied"} (timeout:{" "}
              {formatDelayHours(step.condition_timeout_hours || 48)})
            </p>
          )}
          {step.type === "ab_test" && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {step.variants?.length || 0} variants
            </p>
          )}
          {hasErrors && (
            <p className="text-xs text-red-500 flex items-center gap-1 mt-0.5">
              <AlertCircle className="h-3 w-3" />
              {errors.length} {errors.length === 1 ? "issue" : "issues"} — click
              to fix
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp();
            }}
            aria-label={`Move step ${stepIndex + 1} up`}
            disabled={stepIndex === 0}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown();
            }}
            aria-label={`Move step ${stepIndex + 1} down`}
            disabled={stepIndex === totalSteps - 1}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 hover:bg-destructive/10"
            title="Delete step"
            aria-label={`Delete step ${stepIndex + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>
    );
  }

  // Expanded editor (when selected)
  return (
    <Card
      className={cn(
        "overflow-hidden rounded-xl border-border border-t-2 bg-card shadow-sm",
        SEQUENCE_STEP_STYLES[step.type].accent,
        hasErrors && "border-red-500/50",
      )}
    >
      <CardContent className="p-5 space-y-5 sm:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border",
                SEQUENCE_STEP_STYLES[step.type].icon,
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-medium",
                  SEQUENCE_STEP_STYLES[step.type].icon,
                )}
              >
                Step {stepIndex + 1}
              </Badge>
              <span className="text-base font-semibold ml-2">
                {step.type === "email"
                  ? previousSubject
                    ? "Follow-up email"
                    : "First email"
                  : STEP_LABELS[step.type]}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={onMoveUp}
              aria-label={`Move step ${stepIndex + 1} up`}
              disabled={stepIndex === 0}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={onMoveDown}
              aria-label={`Move step ${stepIndex + 1} down`}
              disabled={stepIndex === totalSteps - 1}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 hover:bg-destructive/10"
              title="Delete step"
              aria-label={`Delete step ${stepIndex + 1}`}
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>

        {/* Email Step Editor */}
        {step.type === "email" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={`subject-${stepIndex}`} className="text-sm">
                  Subject Line
                </Label>
                <div className="flex items-center gap-0.5">
                  <VariablePickerDropdown
                    onInsert={(v) => insertVariable(v, "subject")}
                  />
                  <SpintaxPickerDropdown
                    onInsert={(v) => insertVariable(v, "subject")}
                  />
                </div>
              </div>
              <Input
                id={`subject-${stepIndex}`}
                value={step.subject || ""}
                onChange={(e) => onChange({ ...step, subject: e.target.value })}
                placeholder={
                  previousSubject
                    ? `Re: ${previousSubject.replace(/^Re:\s*/i, "")}`
                    : "e.g. Quick question about {{company}}"
                }
                className={cn(
                  hasFieldError("subject") &&
                    "border-red-500 focus-visible:ring-red-500",
                )}
              />
              {hasFieldError("subject") && (
                <p className="text-[11px] text-red-500">
                  Subject line is required
                </p>
              )}
              {previousSubject &&
                !step.subject &&
                !hasFieldError("subject") && (
                  <p className="text-[11px] text-muted-foreground">
                    Leave empty to send as a threaded reply with "Re:{" "}
                    {previousSubject.replace(/^Re:\s*/i, "")}"
                  </p>
                )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={`body-${stepIndex}`} className="text-sm">
                  Email Body
                </Label>
                <div className="flex items-center gap-0.5">
                  <VariablePickerDropdown
                    onInsert={(v) =>
                      bodyEditorRef.current?.insertVariableChip(v)
                    }
                  />
                  <SpintaxPickerDropdown
                    onInsert={(v) =>
                      bodyEditorRef.current?.insertSpintaxChip(v)
                    }
                  />
                </div>
              </div>
              <EmailRichTextEditor
                ref={bodyEditorRef}
                value={step.body || ""}
                bodyFormat={step.body_format}
                onChange={(html, format) =>
                  onChange({ ...step, body: html, body_format: format })
                }
                placeholder={
                  "Hi {{first_name}},\n\nWrite a short, personal message that starts a conversation…"
                }
                minHeight={300}
                error={hasFieldError("body")}
              />
              {hasFieldError("body") && (
                <p className="text-[11px] text-red-500">
                  Email body is required
                </p>
              )}
            </div>
            <SpamCheckPanel
              subject={
                step.subject ||
                (previousSubject
                  ? `Re: ${previousSubject.replace(/^Re:\s*/i, "")}`
                  : "")
              }
              body={step.body || ""}
              bodyFormat={step.body_format}
              // No earlier email has a subject to thread onto, so this is the opener.
              isFirstStep={!previousSubject}
            />
          </div>
        )}

        {/* Delay Step Editor */}
        {step.type === "delay" && (
          <SequenceDelayPicker
            value={step.delay_hours || 24}
            onChange={(hours) => onChange({ ...step, delay_hours: hours })}
          />
        )}

        {/* Condition Step Editor */}
        {step.type === "condition" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">Condition Type</Label>
              <Select
                value={step.condition_type || "replied"}
                onValueChange={(value) =>
                  onChange({
                    ...step,
                    condition_type: value as ConditionType,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opened">Lead opened email</SelectItem>
                  <SelectItem value="clicked">Lead clicked a link</SelectItem>
                  <SelectItem value="replied">Lead replied</SelectItem>
                  <SelectItem value="bounced">Email bounced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Timeout</Label>
              <div className="flex flex-wrap gap-2">
                {CONDITION_TIMEOUT_PRESETS.map((preset) => (
                  <button
                    key={preset.hours}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...step,
                        condition_timeout_hours: preset.hours,
                      })
                    }
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-full border transition-all",
                      (step.condition_timeout_hours || 48) === preset.hours
                        ? "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/40 shadow-sm"
                        : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                The sequence pauses here until the condition is met. If not met
                within the timeout, the lead exits the sequence.
              </p>
            </div>
          </div>
        )}

        {/* A/B Test Step -- handled by ABVariantEditor in the builder page */}
        {step.type === "ab_test" && (
          <p className="text-xs text-muted-foreground">
            Each lead receives one variant. Compare subjects or email copy and
            adjust how many leads receive each version below.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
