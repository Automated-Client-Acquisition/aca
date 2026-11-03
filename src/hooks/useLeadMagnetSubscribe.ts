import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SubscribeStatus = "idle" | "submitting" | "done" | "error";

// Shared opt-in logic for the "free agent build" lead magnet pages (one per
// agent in the /agents curriculum). Posts to submit-playbook-lead with the
// given `source` → own subscriber tag + immediate delivery email. Mirrors
// useHermesSubscribe / useMapsSubscribe, generalized so each new agent page
// doesn't need its own near-identical hook.
export function useLeadMagnetSubscribe(source: string) {
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
        body: { email: email.trim(), source },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setStatus("done");
      // Send the opt-in to the /agents thank-you page: it confirms the resource
      // is on its way (?resource=<source>) and pitches the community while the
      // delivery email lands. The inline "done" state stays as a safe fallback.
      navigate(`/agents?resource=${encodeURIComponent(source)}`);
    } catch (err) {
      console.error(`[lead-magnet-subscribe:${source}] submit failed:`, err);
      setError("Something went wrong. Try again in a moment.");
      setStatus("error");
    }
  }

  return { email, setEmail, status, error, valid, submit };
}
