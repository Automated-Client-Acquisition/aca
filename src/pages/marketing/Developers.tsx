import { ApiReferenceReact } from "@scalar/api-reference-react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowRight, Braces } from "lucide-react";
import { MarketingNav } from "@/components/marketing";
import "@scalar/api-reference-react/style.css";
import "@/styles/aca-docs.css";

/**
 * Public API reference at /developers.
 *
 * Rendered from public/openapi.yaml rather than hand-written markup: the spec is
 * the artifact customers actually reuse (Postman import, SDK generation, agent
 * tooling), and it keeps request/response examples from drifting away from what
 * the endpoints really do.
 *
 * The spec documents the proxied /v1/* paths (see vercel.json), never the raw
 * Supabase functions URL, so renaming an edge function can't break integrations.
 */
export default function Developers() {
  return (
    <>
      <MarketingNav />
      <main className="aca-apiref">
        {/* Keep the introduction in real HTML: the generated reference mounts
            client-side, while this context remains readable before it loads. */}
        <header className="aca-apiref__intro">
          <div className="aca-apiref__intro-inner">
            <div className="aca-apiref__copy">
              <span className="aca-apiref__eyebrow">
                <Braces size={17} /> Build on ACA
              </span>
              <h1>
                API reference<span>.</span>
              </h1>
              <p>
                Create contacts, build lists, enroll leads and send messages
                from your own tools. JSON over HTTPS, with keyset pagination and
                tokens scoped to your organization.
              </p>
            </div>
            <div className="aca-apiref__links">
              <a href="/openapi.yaml" download>
                <ArrowDownToLine size={17} /> Download OpenAPI
              </a>
              <Link to="/mcp">
                Connect your AI agent <ArrowRight size={17} />
              </Link>
              <span>
                The reference below comes directly from the API specification.
              </span>
            </div>
          </div>
        </header>
        <ApiReferenceReact
          configuration={{
            url: "/openapi.yaml",
            theme: "default",
            darkMode: true,
            layout: "modern",

            // Scalar's editor chrome defaults to showing on localhost. Pin it off so
            // a stray production build can never render Configure/Share/Deploy to a
            // customer.
            showToolbar: "never",
            showDeveloperTools: "never",

            // This is a public page and the try-it panel takes a real API token —
            // don't leave it sitting in localStorage afterwards.
            persistAuth: false,

            // No usage pings to a third party from a customer-facing page.
            telemetry: false,

            // Scalar can generate an MCP server from this spec. ACA already has a
            // real one with far more tools, linked from the introduction — shipping
            // a generated near-duplicate would just be confusing.
            mcp: { disabled: true },

            metaData: {
              title: "ACA API Reference",
              description:
                "Create contacts, build lists, enroll leads and send messages with the ACA API.",
            },
          }}
        />
      </main>
    </>
  );
}
