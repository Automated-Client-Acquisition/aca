import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { splitThreadTweets, threadContent } from "./thread-tweets.ts";

Deno.test("numbered posts split on their markers, numbering kept", () => {
  const text = "1/ Cold email isn't dead.\nIt's just lazy.\n\n2/ Here's what changed.\n\n3) Try it this week.";
  assertEquals(splitThreadTweets(text), ["1/ Cold email isn't dead.\nIt's just lazy.", "2/ Here's what changed.", "3) Try it this week."]);
});

Deno.test("no numbering: blank lines separate posts", () => {
  assertEquals(splitThreadTweets("First post.\n\nSecond post.\n\n\nThird."), ["First post.", "Second post.", "Third."]);
});

Deno.test("a number inside a sentence is not a marker", () => {
  assertEquals(splitThreadTweets("We sent 1/ 3 of the list.\n\nThen the rest."), ["We sent 1/ 3 of the list.", "Then the rest."]);
});

Deno.test("threadContent is the JSON shape publishing reads", () => {
  assertEquals(JSON.parse(threadContent("1/ A\n2/ B")), { tweets: [{ text: "1/ A" }, { text: "2/ B" }] });
  assertEquals(JSON.parse(threadContent("")), { tweets: [] });
});
