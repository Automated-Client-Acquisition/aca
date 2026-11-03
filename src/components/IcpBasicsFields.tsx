import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Target } from "lucide-react";

export interface IcpBasicsValue {
  name: string;
  summary: string;
  description: string;
}

interface IcpBasicsFieldsProps {
  value: IcpBasicsValue;
  onChange: <K extends keyof IcpBasicsValue>(field: K, value: IcpBasicsValue[K]) => void;
}

/**
 * Name / Summary / Description — shared between AddICPDialog and
 * ICPDetailsDialog so both render these with identical labels/icons. Each
 * parent supplies its own outer wrapper (Card vs. plain block); only the
 * fields and their styling are shared here.
 */
export function IcpBasicsFields({ value, onChange }: IcpBasicsFieldsProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="icp-name" className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-600" />
          Audience Name *
        </Label>
        <Input
          id="icp-name"
          value={value.name}
          onChange={(e) => onChange("name", e.target.value)}
          placeholder="e.g., Tech-Savvy Entrepreneurs"
          className="h-11 text-base focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="icp-summary" className="text-base font-semibold flex items-center gap-2">
          <Target className="w-4 h-4 text-cyan-600" />
          One-Sentence ICP
        </Label>
        <Input
          id="icp-summary"
          value={value.summary}
          onChange={(e) => onChange("summary", e.target.value)}
          placeholder='e.g., "Homeowners struggling with multiple debts who have tried balance transfers but keep getting declined."'
          className="h-11 text-base focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Template: [Who] struggling with [problem] who have tried [thing] but [why it failed].
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="icp-description" className="text-base font-semibold">Description</Label>
        <Textarea
          id="icp-description"
          value={value.description}
          onChange={(e) => onChange("description", e.target.value)}
          placeholder="Describe this target audience..."
          className="min-h-[80px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </div>
  );
}
