import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, ShieldAlert } from "lucide-react";
import { useRecheckByoBlocklist } from "@/hooks/useByoServers";
import type { ByoServer, ByoServerIp } from "@/types/email";

interface PtrSetupHintProps {
  server: ByoServer;
  ip: ByoServerIp;
}

/**
 * Provider-specific PTR setup links + recheck button. Renders inline below
 * an unverified IP row so the user can fix rDNS at the hosting provider
 * without leaving the page.
 *
 * The recheck button reuses the existing blocklist endpoint, which also
 * re-resolves PTR via dohResolveA on each call (the server-deployer's PTR
 * verifier is the authoritative path; this is a manual nudge).
 */
export function PtrSetupHint({ server, ip }: PtrSetupHintProps) {
  const recheck = useRecheckByoBlocklist();
  const provider = (server.provider_hint || "").toLowerCase();

  // Per-provider deep-link helpers. Servers can have any provider_hint and we
  // gracefully fall back to a generic message when we don't have a tailored
  // link.
  const guidance = (() => {
    switch (provider) {
      case "hetzner":
        return {
          label: "Hetzner Robot",
          url: "https://robot.hetzner.com/server/ip",
          steps: [
            "Open Hetzner Robot → Server → IPs tab.",
            `Click the pencil icon next to ${ip.ip_address}.`,
            "Set the reverse DNS to your sending domain (e.g. mail.example.com).",
            "Save. PTR usually propagates within 5-10 minutes.",
          ],
        };
      case "ovh":
        return {
          label: "OVH Manager",
          url: "https://www.ovh.com/manager/dedicated/",
          steps: [
            "OVH Manager → Bare Metal Cloud → Dedicated Servers.",
            `Pick the server, open the IP tab, edit ${ip.ip_address}.`,
            "Set the reverse DNS field to your sending domain.",
            "Save. OVH reverses can take up to 1 hour to propagate.",
          ],
        };
      case "ionos":
        return {
          label: "IONOS Cloud",
          url: "https://my.ionos.com/cloud-panel/",
          steps: [
            "IONOS Cloud Panel → Network → Public IPs.",
            `Open ${ip.ip_address}, then 'Reverse DNS'.`,
            "Set the reverse DNS to your sending domain.",
            "Save. IONOS PTR records propagate within ~30 min.",
          ],
        };
      case "vultr":
        return {
          label: "Vultr Customer Portal",
          url: "https://my.vultr.com/",
          steps: [
            "Vultr → Products → server → IPv4 tab.",
            `Edit reverse DNS for ${ip.ip_address}.`,
            "Set it to your sending domain. Save.",
          ],
        };
      case "linode":
        return {
          label: "Linode Cloud Manager",
          url: "https://cloud.linode.com/",
          steps: [
            "Linode Cloud Manager → Linodes → server → Network tab.",
            `Click 'Edit RDNS' next to ${ip.ip_address}.`,
            "rDNS only resolves once you've added a forward A record pointing back at this IP.",
          ],
        };
      case "digitalocean":
        return {
          label: "DigitalOcean rDNS",
          url: "https://docs.digitalocean.com/products/networking/dns/how-to/manage-records/",
          steps: [
            "DigitalOcean assigns rDNS by Droplet name. Rename the Droplet to your sending hostname (e.g. mail.example.com).",
            "Once renamed, the rDNS reflects the new name automatically.",
            `Test with 'dig -x ${ip.ip_address}' — expect your sending domain.`,
          ],
        };
      case "aws":
        return {
          label: "AWS rDNS request",
          url: "https://docs.aws.amazon.com/ses/latest/dg/send-email-throttle-removal.html",
          steps: [
            "AWS doesn't expose rDNS in the console — file a Route 53 / EC2 case for reverse DNS configuration.",
            `Provide the IP (${ip.ip_address}) and the desired hostname.`,
            "AWS requires a forward A record matching the rDNS first.",
          ],
        };
      case "gcp":
        return {
          label: "GCP rDNS",
          url: "https://cloud.google.com/compute/docs/instances/create-ptr-record",
          steps: [
            "gcloud compute instances add-metadata <instance> --metadata=reverse-dns=mail.example.com.",
            "Then update the corresponding A record. Propagation: ~10 min.",
          ],
        };
      default:
        return {
          label: "Provider control panel",
          url: null,
          steps: [
            "Open your hosting provider's control panel and find the reverse DNS / PTR field for this IP.",
            "Set it to your sending domain (e.g. mail.example.com).",
            "Make sure a forward A record at that hostname points back to this IP.",
            "PTR propagation usually takes 5 minutes to an hour.",
          ],
        };
    }
  })();

  return (
    <Alert className="border-amber-500/40 bg-amber-500/5 mt-2">
      <ShieldAlert className="h-4 w-4 text-amber-500" />
      <AlertTitle className="flex items-center gap-2">
        Set reverse DNS for {ip.ip_address}
      </AlertTitle>
      <AlertDescription>
        <ol className="list-decimal pl-5 text-xs space-y-1 mt-1">
          {guidance.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        <div className="flex items-center gap-2 mt-2">
          {guidance.url && (
            <Button asChild variant="outline" size="sm" className="h-7 text-xs">
              <a href={guidance.url} target="_blank" rel="noreferrer">
                <ExternalLink className="w-3 h-3 mr-1" />
                Open {guidance.label}
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={recheck.isPending}
            onClick={() => recheck.mutate({ ip_id: ip.id })}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${recheck.isPending ? "animate-spin" : ""}`} />
            I've set it — verify now
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
