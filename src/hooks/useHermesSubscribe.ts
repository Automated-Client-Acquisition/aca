import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SubscribeStatus = "idle" | "submitting" | "done" | "error";

// Opt-in logic for the free Hermes LinkedIn Appointment Setter lead magnet.
// Posts to submit-playbook-lead with source="hermes-agent" → own subscriber
// tag + immediate delivery email (prompt + setup guide).
export function useHermesSubscribe() {
  const navigate = useNavigate();
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
        body: { email: email.trim(), source: "hermes-agent" },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setStatus("done");
      // Send the opt-in to the /agents thank-you page (confirms delivery +
      // pitches the community). Inline "done" state stays as a safe fallback.
      navigate("/agents?resource=hermes-agent");
    } catch (err) {
      console.error("[hermes-subscribe] submit failed:", err);
      setError("Something went wrong. Try again in a moment.");
      setStatus("error");
    }
  }

  return { email, setEmail, status, error, valid, submit };
}
