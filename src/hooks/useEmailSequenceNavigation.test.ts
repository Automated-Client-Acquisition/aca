import test from "node:test";
import assert from "node:assert/strict";
import { shouldFlushBeforeSequenceNavigation } from "./useEmailSequenceAutosave.ts";

const currentUrl = "https://app.example.com/email/sequences/first?tab=steps";

test("sidebar and other sequence links flush before leaving the editor", () => {
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: "/email/sequences" }), true);
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: "/email/sequences/second", target: "_self" }), true);
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: "?tab=settings" }), true);
});

test("local anchors and same-page links do not interrupt editing", () => {
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: "#campaign-settings" }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: `${currentUrl}#campaign-settings` }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: currentUrl }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: "" }), false);
});

test("new tabs, modified clicks, and downloads keep normal browser behavior", () => {
  const link = { currentUrl, href: "/email/sequences" };
  assert.equal(shouldFlushBeforeSequenceNavigation({ ...link, target: "_blank" }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ ...link, download: true }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ ...link, metaKey: true }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ ...link, ctrlKey: true }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ ...link, shiftKey: true }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ ...link, altKey: true }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ ...link, button: 1 }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ ...link, defaultPrevented: true }), false);
});

test("external and non-web links rely on the browser exit warning", () => {
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: "https://other.example.com/email/sequences" }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: "mailto:hello@example.com" }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: "javascript:void(0)" }), false);
  assert.equal(shouldFlushBeforeSequenceNavigation({ currentUrl, href: "https://[invalid" }), false);
});
