import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SubscribeStatus = "idle" | "submitting" | "done" | "error";

// Shared daily-signals opt-in logic. Posts to submit-playbook-lead with
// source="signals-daily" (own subscriber list + welcome email). Used by the
// hero/band capture and the sticky capture bar so they stay in sync.
export function useSignalsSubscribe() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SubscribeStatus>("idle");
  const [error, setError] = useState("");

  const valid = EMAIL_RE.test(email.trim());

  async function submit() {
    if (!valid || status === "submitting") return;
    setStatus("submitting");
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("submit-playbook-lead", {
        body: { email: email.trim(), source: "signals-daily" },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setStatus("done");
    } catch (err) {
      console.error("[signals-subscribe] submit failed:", err);
      setError("Something went wrong. Try again in a moment.");
      setStatus("error");
    }
  }

  return { email, setEmail, status, error, valid, submit };
}
