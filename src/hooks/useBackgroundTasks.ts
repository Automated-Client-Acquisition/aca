import { useSyncExternalStore } from "react";

export type BackgroundTaskType = "firewall" | "analyze" | "generate" | "find-emails" | "verify" | "delete" | "leads-import";

export interface BackgroundTask {
  id: string;
  type: BackgroundTaskType;
  label: string;
  checked: number;
  total: number;
  extra?: string;
  color: string; // tailwind color token: "amber", "blue", "violet", "emerald"
  /** Queue totals can grow while upstream work is still producing items. */
  mode?: "progress" | "growing-queue";
  /** Called when the user clicks the cancel button. If not set, task is not cancellable. */
  onCancel?: () => void;
  /** True while the cancel request is in-flight */
  cancelling?: boolean;
}

let tasks: BackgroundTask[] = [];
const listeners = new Set<() => void>();

function emit() {
  // Create new array reference so useSyncExternalStore detects the change
  tasks = [...tasks];
  listeners.forEach((l) => l());
}

export const backgroundTasks = {
  start(task: BackgroundTask) {
    // Replace existing task with same id, or add new
    tasks = tasks.filter((t) => t.id !== task.id);
    tasks.push(task);
    emit();
  },

  update(id: string, partial: Partial<Pick<BackgroundTask, "checked" | "total" | "extra" | "label" | "mode" | "onCancel" | "cancelling">>) {
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    tasks[idx] = { ...tasks[idx], ...partial };
    emit();
  },

  finish(id: string) {
    tasks = tasks.filter((t) => t.id !== id);
    emit();
  },

  /** Check if a task with this id is already active */
  has(id: string) {
    return tasks.some((t) => t.id === id);
  },

  /** Get IDs of all tasks matching a prefix (e.g. "analyze-") */
  idsByPrefix(prefix: string) {
    return tasks.filter((t) => t.id.startsWith(prefix)).map((t) => t.id);
  },

  /** Check if a task has been marked as cancelling */
  isCancelling(id: string) {
    return tasks.some((t) => t.id === id && t.cancelling);
  },
};

export function useBackgroundTasks(): BackgroundTask[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => tasks,
  );
}
