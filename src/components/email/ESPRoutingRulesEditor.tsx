import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ArrowRight } from "lucide-react";
import type { ESPRoutingRule } from "@/types/email";

interface ESPRoutingRulesEditorProps {
  rules: ESPRoutingRule[];
  onChange: (rules: ESPRoutingRule[]) => void;
}
export function ESPRoutingRulesEditor({
  rules,
  onChange,
}: ESPRoutingRulesEditorProps) {
  const updateRule = (index: number, update: Partial<ESPRoutingRule>) =>
    onChange(
      rules.map((rule, position) =>
        position === index ? { ...rule, ...update } : rule,
      ),
    );
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Custom provider routing</h4>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
            Use a specific sender provider for a recipient's domain.
          </p>
        </div>
        <Button
          variant="cta"
          size="sm"
          onClick={() =>
            onChange([...rules, { recipient_domain: "", provider: "gmail" }])
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          Add routing rule
        </Button>
      </div>
      {rules.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm leading-relaxed text-muted-foreground">
          No domain overrides. Provider matching is used when enabled.
        </p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <div key={index} className="rounded-xl border bg-background/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  RULE {index + 1}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10"
                  aria-label={`Delete routing rule ${index + 1}`}
                  onClick={() =>
                    onChange(rules.filter((_, position) => position !== index))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(140px,200px)]">
                <div className="min-w-0 space-y-2">
                  <label
                    htmlFor={`routing-domain-${index}`}
                    className="text-sm font-medium"
                  >
                    Recipient domain
                  </label>
                  <Input
                    id={`routing-domain-${index}`}
                    value={rule.recipient_domain}
                    placeholder="company.com"
                    onChange={(event) =>
                      updateRule(index, {
                        recipient_domain: event.target.value,
                      })
                    }
                  />
                </div>
                <ArrowRight className="mb-3 hidden h-4 w-4 text-muted-foreground sm:block" />
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium">Send through</p>
                  <Select
                    value={rule.provider}
                    onValueChange={(value) =>
                      updateRule(index, { provider: value })
                    }
                  >
                    <SelectTrigger
                      aria-label={`Sender provider for routing rule ${index + 1}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gmail">Gmail</SelectItem>
                      <SelectItem value="outlook">Outlook</SelectItem>
                      <SelectItem value="smtp">SMTP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
