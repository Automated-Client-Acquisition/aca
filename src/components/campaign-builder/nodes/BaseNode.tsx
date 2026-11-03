import { memo, type ReactNode } from "react";
import { Handle, Position, useNodeConnections, useNodeId, useNodesData } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { AlertCircle, Instagram, Linkedin, Mail, MessageCircle, MessageSquare, Plus, Send, type LucideIcon } from "lucide-react";
import { NODE_TYPE_CONFIGS, type ChannelType, type SequenceNodeType } from "@/lib/sequence-utils";
import { campaignBranchLabel, campaignBranchTone, campaignNodeDisplayLabel } from "@/lib/campaign-node-preview";
import { BranchOutcomeBadge } from "@/components/campaign-builder/nodes/BranchOutcomeBadge";
import { useSequenceCanvasActions } from "@/components/campaign-builder/SequenceCanvasContext";

export interface NodeValidation {
  errors: string[];
  warnings: string[];
}

export interface BaseNodeProps {
  icon: ReactNode;
  label: string;
  customLabel?: string;
  sublabel?: string;
  category: "action" | "control" | "condition" | "terminal";
  selected?: boolean;
  appearance?: "card" | "compact";
  handles: {
    source: string[];
    target: boolean;
  };
  children?: ReactNode;
  channel?: ChannelType;
  variant?:
    | "smartlead"
    | "instantly"
    | "leadconnector"
    | "zapmail"
    | "enrichment"
    | "notion";
  validation?: NodeValidation;
}

// Each tone pairs a chip (icon + channel name) with the card's top stripe,
// the same look as the automation mockup on the homepage.
interface NodeTone {
  chip: string;
  stripe: string;
}

const TONES = {
  linkedin: { chip: "bg-[#e9f1fb] text-[#0a66c2] dark:bg-sky-950 dark:text-sky-300", stripe: "border-t-[#0a66c2] dark:border-t-sky-500" },
  email: { chip: "bg-[#fbe6de] text-[#a8492c] dark:bg-orange-950 dark:text-orange-300", stripe: "border-t-[#cf5f3c] dark:border-t-orange-400" },
  whatsapp: { chip: "bg-[#e8f3eb] text-[#2c7a4b] dark:bg-green-950 dark:text-green-300", stripe: "border-t-[#2c9a5a] dark:border-t-green-500" },
  instagram: { chip: "bg-pink-50 text-pink-700 dark:bg-pink-950 dark:text-pink-300", stripe: "border-t-pink-500" },
  telegram: { chip: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300", stripe: "border-t-sky-500" },
  neutral: { chip: "bg-[#f1eee5] text-[#64655d] dark:bg-stone-800 dark:text-stone-300", stripe: "border-t-[#a8a395] dark:border-t-stone-500" },
  gold: { chip: "bg-[#fbf0d0] text-[#7a5a12] dark:bg-amber-950 dark:text-amber-300", stripe: "border-t-[#d4a339] dark:border-t-amber-500" },
  violet: { chip: "bg-[#f0ecfb] text-[#6247c4] dark:bg-violet-950 dark:text-violet-300", stripe: "border-t-[#6247c4] dark:border-t-violet-400" },
  green: { chip: "bg-[#e8f3eb] text-[#2c7a4b] dark:bg-emerald-950 dark:text-emerald-300", stripe: "border-t-[#2c7a4b] dark:border-t-emerald-500" },
} satisfies Record<string, NodeTone>;

// Channel chips carry the channel's own logo; the card title names the action.
const CHANNEL_CHIPS: Record<string, { name: string; tone: NodeTone; logo: LucideIcon }> = {
  linkedin: { name: "LinkedIn", tone: TONES.linkedin, logo: Linkedin },
  email: { name: "Email", tone: TONES.email, logo: Mail },
  whatsapp: { name: "WhatsApp", tone: TONES.whatsapp, logo: MessageCircle },
  instagram: { name: "Instagram", tone: TONES.instagram, logo: Instagram },
  telegram: { name: "Telegram", tone: TONES.telegram, logo: Send },
  sms: { name: "SMS", tone: TONES.neutral, logo: MessageSquare },
};

const VARIANT_CHIPS: Record<string, { name: string; tone: NodeTone }> = {
  smartlead: { name: "Smartlead", tone: TONES.linkedin },
  instantly: { name: "Instantly", tone: TONES.gold },
  leadconnector: { name: "LeadConnector", tone: TONES.green },
  zapmail: { name: "ZapMail", tone: TONES.email },
  enrichment: { name: "Enrichment", tone: TONES.gold },
  notion: { name: "Notion", tone: TONES.neutral },
};

const CATEGORY_CHIPS: Record<BaseNodeProps["category"], { name: string; tone: NodeTone }> = {
  action: { name: "Action", tone: TONES.neutral },
  control: { name: "Flow", tone: TONES.gold },
  condition: { name: "Condition", tone: TONES.violet },
  terminal: { name: "Start", tone: TONES.green },
};

function nodeChip(category: BaseNodeProps["category"], channel?: ChannelType, variant?: BaseNodeProps["variant"]): { name: string; tone: NodeTone; logo?: LucideIcon } {
  if (variant && VARIANT_CHIPS[variant]) return VARIANT_CHIPS[variant];
  const byChannel = channel ? CHANNEL_CHIPS[channel] : undefined;
  // Conditions read as conditions first; the channel only names what they check.
  if (category === "condition") return { name: byChannel ? `${byChannel.name} condition` : "Condition", tone: TONES.violet };
  return byChannel || CATEGORY_CHIPS[category];
}

const HANDLE_CLASS =
  "!w-2 !h-2 !border-0 !bg-stone-400 dark:!bg-stone-500 ring-2 ring-card transition-[width,height,opacity] before:absolute before:-inset-3 before:rounded-full group-hover/sequence-node:!w-3 group-hover/sequence-node:!h-3 hover:!bg-amber-600 hover:ring-amber-500/20";

const ADD_BUTTON_CLASS =
  "nodrag nopan pointer-events-auto flex items-center justify-center rounded-full border border-dashed border-[#ccc6b5] bg-card text-muted-foreground shadow-sm transition-colors hover:border-solid hover:border-amber-500 hover:text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-600";

const CARD_BORDER = "border-[#ddd8ca] dark:border-stone-700/80";

export function BaseNode({
  icon,
  label,
  customLabel,
  sublabel,
  category,
  selected,
  appearance,
  handles,
  children,
  channel,
  variant,
  validation,
}: BaseNodeProps) {
  const chip = nodeChip(category, channel, variant);
  const hasErrors = !!validation?.errors.length;
  const issues = hasErrors ? validation!.errors : validation?.warnings || [];
  const manyOutcomes = handles.source.length > 3;
  const connections = useNodeConnections({ handleType: "source" });
  const incoming = useNodeConnections({ handleType: "target" });
  const nodeId = useNodeId();
  const actions = useSequenceCanvasActions();
  const node = useNodesData(nodeId || "");
  const displayLabel = campaignNodeDisplayLabel({
    customLabel: typeof node?.data?.customLabel === "string" ? node.data.customLabel : undefined,
    // Generated graphs save Start as "Start"; that is a default, not a name.
    label: typeof node?.data?.label === "string" && !(node.type === "start" && /^(campaign )?start$/i.test(node.data.label))
      ? node.data.label
      : undefined,
  }, node?.type ? NODE_TYPE_CONFIGS[node.type as SequenceNodeType]?.label : undefined, label, customLabel);
  const compact = (category === "terminal" || appearance === "compact") && issues.length === 0;
  // Start shows its audience on a second line, like the homepage lead list pill.
  const stacked = compact && category === "terminal" && !!sublabel;
  const isWired = (handle: string) => connections.some(connection => (connection.sourceHandle || "default") === handle);
  // Go To links to an existing step, so it never offers "add a step after".
  const canAdd = !!actions && !!nodeId && node?.type !== "goTo";
  const openAdd = (handle: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    actions!.openAddAfter({ nodeId: nodeId!, handleId: handle }, { x: rect.left, y: rect.bottom + 6 });
  };

  return (
    <div
      className={cn(
        "group/sequence-node relative w-[320px] text-card-foreground",
        !compact && "rounded-xl border border-t-[3px] bg-card shadow-[0_1px_2px_rgba(35,35,31,0.06)] transition-[border-color,box-shadow] hover:shadow-[0_4px_14px_rgba(35,35,31,0.08)]",
        !compact && (hasErrors ? "border-destructive/60" : CARD_BORDER),
        selected && !compact &&
          "border-amber-500/80 dark:border-amber-500/80 ring-1 ring-amber-500/30 shadow-[0_3px_12px_rgba(245,158,11,0.1)]",
        !compact && chip.tone.stripe,
      )}
    >
      {handles.target && (
        <Handle
          type="target"
          position={Position.Top}
          className={cn(HANDLE_CLASS, incoming.length > 0 && "opacity-0 group-hover/sequence-node:opacity-100")}
          aria-label="Connect previous step"
          title="Connect previous step"
        />
      )}

      {compact ? (
        <div className={cn(
          "mx-auto flex w-fit max-w-[288px] items-center rounded-full border bg-card shadow-[0_1px_2px_rgba(35,35,31,0.06)]",
          stacked ? "gap-2.5 py-2 pl-3.5 pr-5" : "gap-2 py-2 pl-2 pr-4",
          CARD_BORDER,
          selected && "border-amber-500/80 ring-1 ring-amber-500/30 dark:border-amber-500/80",
        )}>
          <div className={cn(
            "flex shrink-0 items-center justify-center",
            stacked ? "text-muted-foreground [&_svg]:h-4 [&_svg]:w-4" : cn("h-6 w-6 rounded-full [&_svg]:h-3.5 [&_svg]:w-3.5", chip.tone.chip),
          )}>
            {icon}
          </div>
          {stacked ? (
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold leading-5 tracking-[-0.015em]" title={displayLabel}>{displayLabel}</p>
              <p className="truncate text-xs leading-4 text-muted-foreground" title={sublabel}>{sublabel}</p>
            </div>
          ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <p className="truncate text-[13px] font-semibold leading-5 tracking-[-0.015em]" title={displayLabel}>
              {displayLabel}
            </p>
            {sublabel && category === "control" && !displayLabel.endsWith(` ${sublabel}`) && (
              <p className="shrink-0 text-[13px] leading-5 text-muted-foreground" title={sublabel}>
                {sublabel}
              </p>
            )}
          </div>
          )}
        </div>
      ) : (
        <div className="px-4 pb-3 pt-3.5">
          <span className={cn(
            "mb-2 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4 [&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0",
            chip.tone.chip,
          )}>
            {chip.logo ? <chip.logo aria-hidden="true" /> : icon}
            <span className="truncate">{chip.name}</span>
          </span>
          <p className="line-clamp-2 text-[14px] font-semibold leading-5 tracking-[-0.015em]" title={displayLabel}>
            {displayLabel}
          </p>
          {sublabel && (
            <p className="mt-0.5 text-xs leading-[18px] text-muted-foreground" title={sublabel}>
              {sublabel}
            </p>
          )}
        </div>
      )}

      {children && (
        <div className="-mt-1.5 px-4 pb-3.5 [&_p]:text-[13px] [&_p]:leading-[21px] [&_p]:break-words">
          {children}
        </div>
      )}

      {issues.length > 0 && (
        <div
          className={cn(
            "mx-4 mb-4 flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs leading-[18px]",
            hasErrors
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-100/70 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
          )}
          title={issues.join("\n")}
        >
          <AlertCircle
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <span className="line-clamp-2">
            {issues[0]}
            {issues.length > 1 ? ` (+${issues.length - 1})` : ""}
          </span>
        </div>
      )}

      {handles.source.length === 1 ? (
        <>
        {canAdd && !isWired(handles.source[0]) && (
          <div className="absolute left-1/2 top-full z-10 flex -translate-x-1/2 flex-col items-center">
            <span className="h-5 w-px bg-[#c9c3b2] dark:bg-stone-600" aria-hidden="true" />
            <button type="button" className={cn(ADD_BUTTON_CLASS, "h-7 w-7")} onClick={openAdd(handles.source[0])}
              aria-label="Add the next step" title="Add the next step">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <Handle
          type="source"
          position={Position.Bottom}
          id={handles.source[0]}
          className={cn(HANDLE_CLASS, isWired(handles.source[0]) && "opacity-0 group-hover/sequence-node:opacity-100")}
          aria-label={`Connect ${campaignBranchLabel(handles.source[0])} branch`}
          title={campaignBranchLabel(handles.source[0])}
        />
        </>
      ) : handles.source.length > 1 ? (
        <>
          {manyOutcomes && (
            <div className="mx-4 mb-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border/60 pt-3">
              {handles.source.map((handle, index) => (
                <div
                  key={handle}
                  className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-foreground">
                    {index + 1}
                  </span>
                  <span>{campaignBranchLabel(handle)}</span>
                </div>
              ))}
            </div>
          )}
          {manyOutcomes && <div
            className={cn(
              "grid overflow-hidden rounded-b-xl",
              "px-1 pb-3",
            )}
            style={{
              gridTemplateColumns: `repeat(${handles.source.length}, minmax(0, 1fr))`,
            }}
          >
            {handles.source.map((handle, index) => (
              <span
                key={handle}
                className="px-2 text-center text-[11px] font-medium leading-4 text-foreground/75"
                title={campaignBranchLabel(handle)}
              >
                {index + 1}
              </span>
            ))}
          </div>}
          {!manyOutcomes && handles.source.map((handle, index) => !isWired(handle) && (
            <div key={`unwired-${handle}`} className="pointer-events-none absolute top-full z-10 mt-3 flex w-max -translate-x-1/2 flex-col items-center gap-1.5" style={{ left: `${((index + 0.5) / handles.source.length) * 100}%`, maxWidth: 320 / handles.source.length - 12 }}>
              <BranchOutcomeBadge label={campaignBranchLabel(handle)} tone={campaignBranchTone(handle)} />
              {canAdd && (
                <button type="button" className={cn(ADD_BUTTON_CLASS, "h-6 w-6")} onClick={openAdd(handle)}
                  aria-label={`Add a step for ${campaignBranchLabel(handle)}`} title={`Add a step for ${campaignBranchLabel(handle)}`}>
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {manyOutcomes && canAdd && handles.source.map((handle, index) => !isWired(handle) && (
            <button key={`add-${handle}`} type="button" className={cn(ADD_BUTTON_CLASS, "absolute top-full z-10 mt-3 h-6 w-6 -translate-x-1/2")}
              style={{ left: `${((index + 0.5) / handles.source.length) * 100}%` }} onClick={openAdd(handle)}
              aria-label={`Add a step for ${campaignBranchLabel(handle)}`} title={`Add a step for ${campaignBranchLabel(handle)}`}>
              <Plus className="h-3 w-3" />
            </button>
          ))}
          {handles.source.map((handle, index) => (
            <Handle
              key={handle}
              type="source"
              position={Position.Bottom}
              id={handle}
              className={cn(HANDLE_CLASS, isWired(handle) && "opacity-0 group-hover/sequence-node:opacity-100")}
              style={{
                left: `${((index + 0.5) / handles.source.length) * 100}%`,
              }}
              aria-label={`Connect ${campaignBranchLabel(handle)} branch`}
              title={campaignBranchLabel(handle)}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

export const MemoizedBaseNode = memo(BaseNode);
