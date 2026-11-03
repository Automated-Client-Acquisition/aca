// MUST stay the first import: it snapshots a password-recovery link's tokens
// off window.location before the Supabase client (imported via App) consumes
// the hash and rewrites the URL. See src/lib/auth-recovery.ts.
import "./lib/auth-recovery";
import { createRoot, hydrateRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { captureAttribution } from "./lib/attribution";
import { initTracking } from "./lib/tracking";

// Stamp first-touch attribution before React renders. Click ids live on the
// landing URL only; by the time someone finishes the wizard the query string
// is long gone, and every paid signup would look organic.
captureAttribution();

// Load whichever ad pixels are configured. No-ops when none are, so local dev
// and preview builds stay silent instead of writing into a real ad account.
initTracking();

const container = document.getElementById("root")!;
const app = (
  <HelmetProvider>
    <App />
  </HelmetProvider>
);

// Pages built by scripts/prerender.mjs ship their real HTML inside #root. Hydrate
// it instead of re-rendering from scratch: a fresh createRoot would replace that
// HTML with the lazy-route Suspense fallback (a blank screen) until the page
// chunk arrives. Every other route (the authenticated app) is client-rendered.
// The attribute holds the path the HTML was built for, so a shell served for a
// different URL (e.g. `vite preview` fallback) is never hydrated against it.
const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
if (container.getAttribute("data-prerendered") === currentPath) {
  hydrateRoot(container, app);
} else {
  createRoot(container).render(app);
}
