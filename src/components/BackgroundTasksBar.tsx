import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useBackgroundTasks, type BackgroundTask } from "@/hooks/useBackgroundTasks";
import { useActiveMailtesterJobs } from "@/hooks/useEmailSequences";
import { ChevronDown, Loader2, MailCheck, Mail, Search, ShieldAlert, Sparkles, Trash2, UserPlus, X } from "lucide-react";

const ICONS: Record<string, typeof ShieldAlert> = {
  firewall: ShieldAlert,
  analyze: Sparkles,
  generate: Mail,
  "find-emails": Search,
  delete: Trash2,
  "leads-import": UserPlus,
};

// Tailwind needs full class names at build time — no dynamic interpolation
const COLOR_CLASSES: Record<string, { icon: string; bar: string; text: string }> = {
  amber: { icon: "text-amber-500", bar: "bg-amber-500", text: "text-amber-500" },
  blue: { icon: "text-blue-500", bar: "bg-blue-500", text: "text-blue-500" },
  violet: { icon: "text-violet-500", bar: "bg-violet-500", text: "text-violet-500" },
  emerald: { icon: "text-emerald-500", bar: "bg-emerald-500", text: "text-emerald-500" },
  red: { icon: "text-red-500", bar: "bg-red-500", text: "text-red-500" },
};

function TaskRow({ task }: { task: BackgroundTask }) {
  const ratio = task.total > 0 ? task.checked / task.total : 0;
  // Keep sub-1% progress visible: don't round the fill width to whole percents
  // (a 48 / 41650 job is ~0.1% and would otherwise render as an empty bar), and
  // give any started job a 1% minimum sliver so the user sees it's underway.
  const fillPct = ratio > 0 ? Math.max(1, ratio * 100) : 0;
  const labelPct = ratio > 0 ? Math.max(0.1, +(ratio * 100).toFixed(1)) : 0;
  const Icon = ICONS[task.type] || Sparkles;
  const colors = COLOR_CLASSES[task.color] || COLOR_CLASSES.blue;
  const active = !task.cancelling && ratio < 1;
  const remaining = Math.max(0, task.total - task.checked);
  // Tasks can survive a hot reload in the external store. The durable ID is
  // authoritative so stale MailTester task metadata cannot restore a false
  // fixed-total percentage.
  const isGrowingQueue = task.mode === "growing-queue" || task.id.startsWith("mailtester-");

  if (isGrowingQueue) {
    return (
      <div className="flex items-center gap-3 px-4 py-2">
        <Icon className={`h-4 w-4 shrink-0 ${colors.icon} ${task.cancelling ? "" : "animate-pulse"}`} />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {task.cancelling ? (
            "Cancelling..."
          ) : (
            <>
              <span className="hidden sm:inline">Organization email verification queue</span>
              <span className="sm:hidden">Email verification</span>
              {" - "}{remaining.toLocaleString()} queued
              <span className="hidden md:inline">
                {" · "}{task.checked.toLocaleString()} checked
                {" · "}{task.total.toLocaleString()} received so far
              </span>
              {task.extra && <span className={`hidden lg:inline ${colors.text}`}>{" · "}{task.extra}</span>}
            </>
          )}
        </span>
        {task.onCancel && (
          <button
            onClick={task.onCancel}
            disabled={task.cancelling}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground disabled:opacity-50"
            title="Cancel this verification job"
          >
            {task.cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-2 flex items-center gap-3">
      <Icon className={`h-4 w-4 shrink-0 ${colors.icon} ${active ? "animate-pulse" : ""}`} />
      <div className="flex-1 min-w-0">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {task.cancelling ? "Cancelling..." : task.label} — {task.checked.toLocaleString()} / {task.total.toLocaleString()}
        {task.total > 0 && !task.cancelling && (
          <span className="ml-1 tabular-nums">({labelPct}%)</span>
        )}
        {task.extra && !task.cancelling && (
          <span className={`ml-1 ${colors.text}`}>({task.extra})</span>
        )}
      </span>
      {task.onCancel && (
        <button
          onClick={task.onCancel}
          disabled={task.cancelling}
          className="shrink-0 p-0.5 rounded hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Cancel this task"
        >
          {task.cancelling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

function MailtesterQueueGroup({ tasks }: { tasks: BackgroundTask[] }) {
  const [expanded, setExpanded] = useState(false);
  const checked = tasks.reduce((sum, task) => sum + task.checked, 0);
  const queued = tasks.reduce((sum, task) => sum + Math.max(0, task.total - task.checked), 0);
  const cancelling = tasks.some((task) => task.cancelling);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/50"
        aria-expanded={expanded}
      >
        <MailCheck className={`h-4 w-4 shrink-0 text-amber-500 ${cancelling ? "" : "animate-pulse"}`} />
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Email verification queue</span>
          {" · "}{tasks.length.toLocaleString()} active jobs
          {" · "}{queued.toLocaleString()} queued
          <span className="hidden sm:inline"> · {checked.toLocaleString()} checked</span>
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">Manage jobs</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="border-t border-dashed bg-muted/20">
          <p className="px-4 py-2 text-xs text-muted-foreground">
            Individual jobs are shown here. Canceling only stops the selected job.
          </p>
          {tasks.map((task) => <TaskRow key={task.id} task={task} />)}
        </div>
      )}
    </div>
  );
}

export function BackgroundTasksBar() {
  const tasks = useBackgroundTasks();
  const { pathname } = useLocation();
  const { data: activeMailtesterJobs = [] } = useActiveMailtesterJobs();

  // The list panel can replace the org-wide row only when the active job is
  // actually associated with this list. A bulk subset job may not carry that
  // association, and hiding it here made a real verification look idle.
  const currentListId = pathname.match(/^\/leads\/lists\/([^/]+)$/)?.[1];
  const mailtesterJobsShownOnThisList = new Set(
    activeMailtesterJobs
      .filter((job) => currentListId && (job.list_id === currentListId || job.list_ids?.includes(currentListId)))
      .map((job) => `mailtester-${job.id}`),
  );
  const visibleTasks = currentListId
    ? tasks.filter((task) => !mailtesterJobsShownOnThisList.has(task.id))
    : tasks;
  const mailtesterTasks = visibleTasks.filter((task) => task.mode === "growing-queue" || task.id.startsWith("mailtester-"));
  const otherTasks = visibleTasks.filter((task) => !mailtesterTasks.includes(task));

  if (visibleTasks.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-border bg-card divide-y divide-border">
      {mailtesterTasks.length > 1 ? (
        <MailtesterQueueGroup tasks={mailtesterTasks} />
      ) : mailtesterTasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
      {otherTasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </div>
  );
}
