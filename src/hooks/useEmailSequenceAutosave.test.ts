import test from "node:test";
import assert from "node:assert/strict";
import { createEmailSequenceSaveQueue } from "./useEmailSequenceAutosave.ts";

test("buffers content and distinct settings edits in one save", async () => {
  const writes: unknown[] = [];
  const queue = createEmailSequenceSaveQueue(async (payload) => {
    writes.push(payload);
  }, 60_000);
  queue.queueSave({
    id: "sequence",
    steps: [{ order: 0, type: "email", subject: "Hello", body: "Hi" }],
  });
  queue.queueSave({ id: "sequence", settings: { daily_limit: 50 } });
  queue.queueSave({ id: "sequence", settings: { skip_weekends: false } });
  queue.queueSave({ id: "sequence", name: "New name" });
  await queue.flush();
  assert.deepEqual(writes, [
    {
      id: "sequence",
      steps: [{ order: 0, type: "email", subject: "Hello", body: "Hi" }],
      settings: { daily_limit: 50, skip_weekends: false },
      name: "New name",
    },
  ]);
  assert.equal(queue.getSnapshot().saveStatus, "saved");
  assert.equal(queue.hasUnsavedChanges(), false);
});

test("flush waits for edits queued during a save and never overlaps writes", async () => {
  const writes: unknown[] = [];
  let release: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = createEmailSequenceSaveQueue(async (payload) => {
    writes.push(payload);
    if (writes.length === 1) await blocked;
  }, 60_000);
  queue.queueSave({ id: "sequence", name: "First" });
  const firstFlush = queue.flush();
  await Promise.resolve();
  queue.queueSave({
    id: "sequence",
    name: "Latest",
    settings: { daily_limit: 60 },
  });
  const secondFlush = queue.flush();
  assert.equal(writes.length, 1);
  assert.equal(queue.hasUnsavedChanges(), true);
  release();
  await Promise.all([firstFlush, secondFlush]);
  assert.deepEqual(writes, [
    { id: "sequence", name: "First" },
    { id: "sequence", name: "Latest", settings: { daily_limit: 60 } },
  ]);
  assert.equal(queue.hasUnsavedChanges(), false);
});

test("failed saves remain retryable and preserve newer settings", async () => {
  let fail = true;
  let release: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: unknown[] = [];
  const queue = createEmailSequenceSaveQueue(async (payload) => {
    writes.push(payload);
    if (fail) {
      await blocked;
      throw new Error("Offline");
    }
  }, 60_000);
  queue.queueSave({
    id: "sequence",
    name: "Draft",
    settings: { daily_limit: 40, skip_weekends: true },
  });
  const saving = queue.flush();
  await Promise.resolve();
  queue.queueSave({ id: "sequence", settings: { daily_limit: 80 } });
  release();
  await assert.rejects(saving, /Offline/);
  assert.equal(queue.getSnapshot().saveStatus, "error");
  assert.equal(queue.hasUnsavedChanges(), true);
  fail = false;
  await queue.flush();
  assert.deepEqual(writes[1], {
    id: "sequence",
    name: "Draft",
    settings: { daily_limit: 80, skip_weekends: true },
  });
  assert.equal(queue.getSnapshot().saveStatus, "saved");
});

test("a queued edit retains its save callback across a context callback change", async () => {
  const writes: string[] = [];
  const queue = createEmailSequenceSaveQueue(async () => {
    writes.push("original organization");
  }, 60_000);
  queue.queueSave({ id: "sequence", name: "Original draft" });
  queue.setSave(async () => {
    writes.push("new organization");
  });
  await queue.flush();
  assert.deepEqual(writes, ["original organization"]);
  queue.queueSave({ id: "sequence", name: "New draft" });
  await queue.flush();
  assert.deepEqual(writes, ["original organization", "new organization"]);
});

test("separate scope queues flush independently with their own context", async () => {
  const writes: { organization: string; name?: string }[] = [];
  const firstScope = createEmailSequenceSaveQueue(async (payload) => {
    writes.push({ organization: "first", name: payload.name });
  }, 60_000);
  const secondScope = createEmailSequenceSaveQueue(async (payload) => {
    writes.push({ organization: "second", name: payload.name });
  }, 60_000);
  firstScope.queueSave({ id: "sequence", name: "First scope draft" });
  secondScope.queueSave({ id: "sequence", name: "Second scope draft" });
  await secondScope.flush();
  assert.equal(firstScope.hasUnsavedChanges(), true);
  await firstScope.flush();
  assert.deepEqual(writes, [
    { organization: "second", name: "Second scope draft" },
    { organization: "first", name: "First scope draft" },
  ]);
});

test("an explicit organization scope survives a mutation observer context switch", async () => {
  let currentOrganization = "original";
  const writes: string[] = [];
  // A stable mutateAsync function may use the latest observer context at call time.
  const mutate = async (payload: { organization_id?: string }) => {
    writes.push(payload.organization_id ?? currentOrganization);
  };
  const originalOrganization = currentOrganization;
  const queue = createEmailSequenceSaveQueue(async (payload) => {
    await mutate({ ...payload, organization_id: originalOrganization });
  }, 60_000);
  queue.queueSave({ id: "sequence", name: "Unsaved draft" });
  currentOrganization = "new";
  queue.setSave(async (payload) => {
    await mutate({ ...payload, organization_id: currentOrganization });
  });
  await queue.flush();
  assert.deepEqual(writes, ["original"]);
});
