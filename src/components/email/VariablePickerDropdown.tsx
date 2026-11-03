import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Variable } from "lucide-react";
import { EMAIL_VARIABLES, EMAIL_AI_VARIABLES, EMAIL_SIGNAL_VARIABLES, EMAIL_GENERATED_VARIABLES, EMAIL_DELIVERABLE_VARIABLES, EMAIL_MAILBOX_VARIABLES, EMAIL_COMPLIANCE_VARIABLES } from "@/lib/email-sequence-utils";
import { useCustomFieldDefs } from "@/hooks/useCustomFieldDefs";

interface VariablePickerDropdownProps {
  onInsert: (variable: string) => void;
  /** Use "xs" for compact contexts like ABVariantEditor */
  size?: "sm" | "xs";
}

export function VariablePickerDropdown({
  onInsert,
  size = "sm",
}: VariablePickerDropdownProps) {
  const { data: customFields } = useCustomFieldDefs();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={size === "xs" ? "h-5 text-[10px]" : "h-6 text-xs"}
        >
          <Variable className="h-3 w-3 mr-1" />
          {size === "xs" ? "Variable" : "Insert Variable"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Contact</DropdownMenuLabel>
        {EMAIL_VARIABLES.map((v) => (
          <DropdownMenuItem
            key={v.variable}
            onClick={() => onInsert(v.variable)}
          >
            <code className="text-xs mr-2">{v.variable}</code>
            <span className="text-xs text-muted-foreground">{v.label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">AI Enrichment</DropdownMenuLabel>
        {EMAIL_AI_VARIABLES.map((v) => (
          <DropdownMenuItem
            key={v.variable}
            onClick={() => onInsert(v.variable)}
          >
            <code className="text-xs mr-2">{v.variable}</code>
            <span className="text-xs text-muted-foreground">{v.label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Buying Signals</DropdownMenuLabel>
        {EMAIL_SIGNAL_VARIABLES.map((v) => (
          <DropdownMenuItem
            key={v.variable}
            onClick={() => onInsert(v.variable)}
          >
            <code className="text-xs mr-2">{v.variable}</code>
            <span className="text-xs text-muted-foreground">{v.label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Generated Emails</DropdownMenuLabel>
        {EMAIL_GENERATED_VARIABLES.map((v) => (
          <DropdownMenuItem
            key={v.variable}
            onClick={() => onInsert(v.variable)}
          >
            <code className="text-xs mr-2">{v.variable}</code>
            <span className="text-xs text-muted-foreground">{v.label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Mailbox</DropdownMenuLabel>
        {EMAIL_MAILBOX_VARIABLES.map((v) => (
          <DropdownMenuItem
            key={v.variable}
            onClick={() => onInsert(v.variable)}
          >
            <code className="text-xs mr-2">{v.variable}</code>
            <span className="text-xs text-muted-foreground">{v.label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Deliverables</DropdownMenuLabel>
        {EMAIL_DELIVERABLE_VARIABLES.map((v) => (
          <DropdownMenuItem
            key={v.variable}
            onClick={() => onInsert(v.variable)}
          >
            <code className="text-xs mr-2">{v.variable}</code>
            <span className="text-xs text-muted-foreground">{v.label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Compliance</DropdownMenuLabel>
        {EMAIL_COMPLIANCE_VARIABLES.map((v) => (
          <DropdownMenuItem
            key={v.variable}
            onClick={() => onInsert(v.variable)}
          >
            <code className="text-xs mr-2">{v.variable}</code>
            <span className="text-xs text-muted-foreground">{v.label}</span>
          </DropdownMenuItem>
        ))}
        {customFields && customFields.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Custom Variables</DropdownMenuLabel>
            {customFields.map((f) => (
              <DropdownMenuItem
                key={f.field_key}
                onClick={() => onInsert(`{{custom_${f.field_key}}}`)}
              >
                <code className="text-xs mr-2">{`{{custom_${f.field_key}}}`}</code>
                <span className="text-xs text-muted-foreground">
                  {f.display_name}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
