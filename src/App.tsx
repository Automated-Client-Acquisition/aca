import { useEffect, useState, lazy, Suspense, type ElementType } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation, useSearchParams } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandingProvider } from "@/contexts/BrandingContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DynamicMetadata } from "@/components/DynamicMetadata";
import { RouteSEO } from "@/components/seo/RouteSEO";
import { RouteChangePointerUnlock } from "@/hooks/useRouteChangePointerUnlock";
import { recoveryLanding, recoveryLandingPath, RECOVERY_ROUTES } from "@/lib/auth-recovery";
import { useAutopilots } from "@/hooks/useAutopilots";
import { autopilotPath, autopilotsForBlueprint, newAutopilotPath } from "@/lib/blueprint-routes";
// Marketing design system. Its element-level rules are global, and some
// marketing pages lean on them without importing the file, so it stays in the
// entry CSS now that the pages that used to carry it in are lazy.
import "@/styles/aca-home.css";
import { SELF_HOSTED } from "@/config/site";

// Every page is lazy: the entry bundle is what a cold visitor to the homepage
// downloads before anything renders, so it must not carry the app.
const Index = lazy(() => import("./pages/Index"));
const Ideas = lazy(() => import("./pages/Ideas"));
const Research = lazy(() => import("./pages/Research"));
const Assets = lazy(() => import("./pages/Assets"));
const LibraryAudits = lazy(() => import("./pages/LibraryAudits"));
const Settings = lazy(() => import("./pages/Settings"));
const Blueprints = lazy(() => import("./pages/Blueprints"));
const BlueprintStudio = lazy(() => import("./pages/BlueprintStudio"));
const BlueprintRun = lazy(() => import("./pages/BlueprintRun"));
const Autopilots = lazy(() => import("./pages/Autopilots"));
const AutopilotEditor = lazy(() => import("./pages/AutopilotEditor"));
const Create = lazy(() => import("./pages/Create"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobDetail = lazy(() => import("./pages/JobDetail"));
const SavedContent = lazy(() => import("./pages/SavedContent"));
const PublishQueue = lazy(() => import("./pages/PublishQueue"));
const Auth = lazy(() => import("./pages/Auth"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ClientsManagement = lazy(() => import("./pages/ClientsManagement"));
const ClientDetail = lazy(() => import("./pages/ClientDetail"));
const M365Tenants = lazy(() => import("./pages/M365Tenants"));
const M365TenantSuccess = lazy(() => import("./pages/M365Tenants").then((m) => ({ default: m.M365TenantSuccess })));
const M365TenantCancelled = lazy(() => import("./pages/M365Tenants").then((m) => ({ default: m.M365TenantCancelled })));
const Analytics = lazy(() => import("./pages/Analytics"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminOrganizationDetail = lazy(() => import("./pages/AdminOrganizationDetail"));
const InvitationAccept = lazy(() => import("./pages/InvitationAccept"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const SetPassword = lazy(() => import("./pages/SetPassword"));
const IntegrationSuccess = lazy(() => import("./pages/IntegrationSuccess"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Support = lazy(() => import("./pages/Support"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const GithubAccess = lazy(() => import("./pages/GithubAccess"));
const ConnectComplete = lazy(() => import("./pages/ConnectComplete"));
const EmailMailboxDetail = lazy(() => import("./pages/EmailMailboxDetail"));
const EmailSequences = lazy(() => import("./pages/EmailSequences"));
const EmailSequenceBuilder = lazy(() => import("./pages/EmailSequenceBuilder"));
const EmailAnalytics = lazy(() => import("./pages/EmailAnalytics"));
const Leads = lazy(() => import("./pages/Leads"));
const LeadLists = lazy(() => import("./pages/LeadLists"));
const LeadListDetail = lazy(() => import("./pages/LeadListDetail"));
const LeadImport = lazy(() => import("./pages/LeadImport"));
const Inbox = lazy(() => import("./pages/Inbox"));
const Contacts = lazy(() => import("./pages/Contacts"));
const ContactDetail = lazy(() => import("./pages/ContactDetail"));
const CompaniesPage = lazy(() => import("./pages/crm/CompaniesPage"));
const CompanyDetailPage = lazy(() => import("./pages/crm/CompanyDetailPage"));
const DealsPage = lazy(() => import("./pages/crm/DealsPage"));
const DealsReportPage = lazy(() => import("./pages/crm/DealsReportPage"));
const Sequences = lazy(() => import("./pages/Sequences"));
const SequenceDetail = lazy(() => import("./pages/SequenceDetail"));
const Rules = lazy(() => import("./pages/Rules"));
const RuleDetail = lazy(() => import("./pages/RuleDetail"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const CampaignBuilder = lazy(() => import("./pages/CampaignBuilder"));
const CampaignDetail = lazy(() => import("./pages/CampaignDetail"));
const EnrichmentQueue = lazy(() => import("./pages/EnrichmentQueue"));
const Stylesheet = lazy(() => import("./pages/Stylesheet"));
// Lazy: pulls in @babel/standalone (~5.3 MB) for the code panel's in-browser
// JSX transpile, which has no business in the shared entry bundle every route
// downloads.
const VideoEditor = lazy(() => import("./pages/VideoEditor"));
const ListBuildingJobsPage = lazy(() => import("./pages/list-building/ListBuildingJobsPage"));
const ListBuildingJobDetailPage = lazy(() => import("./pages/list-building/ListBuildingJobDetailPage"));
const ListBuildingCachePage = lazy(() => import("./pages/list-building/ListBuildingCachePage"));
const ListBuildingProxiesPage = lazy(() => import("./pages/list-building/ListBuildingProxiesPage"));
const DiscoveryCatalogPage = lazy(() => import("./pages/discovery/DiscoveryCatalogPage"));
const DiscoverySubscriptionPage = lazy(() => import("./pages/discovery/DiscoverySubscriptionPage"));
const SignalsListPage = lazy(() => import("./pages/signals/SignalsListPage"));
const PublicRecordsPage = lazy(() => import("./pages/signals/PublicRecordsPage"));
const SignalDetailPage = lazy(() => import("./pages/signals/SignalDetailPage"));
const SignalNewPage = lazy(() => import("./pages/signals/SignalNewPage"));
const Pricing = lazy(() => import("./pages/marketing/Pricing"));
const Community = lazy(() => import("./pages/marketing/Community"));
const Blog = lazy(() => import("./pages/marketing/Blog"));
const BlogPost = lazy(() => import("./pages/marketing/BlogPost"));
const Playbooks = lazy(() => import("./pages/marketing/Playbooks"));
const Playbook = lazy(() => import("./pages/marketing/Playbook"));
const PlaybookOnboarding = lazy(() => import("./pages/marketing/PlaybookOnboarding"));
const HowWeWork = lazy(() => import("./pages/marketing/HowWeWork"));
const Quote = lazy(() => import("./pages/marketing/Quote"));
const BookCall = lazy(() => import("./pages/marketing/BookCall"));
const GetStarted = lazy(() => import("./pages/marketing/GetStarted"));
const Sandbox = lazy(() => import("./pages/marketing/Sandbox"));
const Tools = lazy(() => import("./pages/marketing/Tools"));
const PublicSignals = lazy(() => import("./pages/marketing/PublicSignals"));
const HermesAppointmentSetter = lazy(() => import("./pages/marketing/HermesAppointmentSetter"));
const AutopilotLanding = lazy(() => import("./pages/marketing/AutopilotLanding"));
const AutopilotWorld = lazy(() => import("./pages/marketing/AutopilotWorld"));
const AgentShowcase = lazy(() => import("./pages/marketing/AgentShowcase"));
const AcaMcp = lazy(() => import("./pages/marketing/AcaMcp"));
const AcaPluginCommands = lazy(() => import("./pages/marketing/AcaPluginCommands"));
const McpAuthorize = lazy(() => import("./pages/McpAuthorize"));
// Lazy: the API reference pulls in Scalar (~3.5 MB), which has no business
// sitting in the entry bundle that every marketing visitor downloads.
const Developers = lazy(() => import("./pages/marketing/Developers"));
const GoogleMapsScraper = lazy(() => import("./pages/marketing/GoogleMapsScraper"));
const SecForm4Agent = lazy(() => import("./pages/marketing/SecForm4Agent"));
const BuyingSignalsAgent = lazy(() => import("./pages/marketing/BuyingSignalsAgent"));
const RedditEngagementAgent = lazy(() => import("./pages/marketing/RedditEngagementAgent"));
const YoutubeAutomationAgent = lazy(() => import("./pages/marketing/YoutubeAutomationAgent"));
const SeoGrowthAgent = lazy(() => import("./pages/marketing/SeoGrowthAgent"));
const LeadPipelineAgent = lazy(() => import("./pages/marketing/LeadPipelineAgent"));
const CarouselFactoryAgent = lazy(() => import("./pages/marketing/CarouselFactoryAgent"));
const KitSalesPage = lazy(() => import("./pages/marketing/sprint/KitSalesPage"));
const KitOrder = lazy(() => import("./pages/marketing/sprint/KitOrder"));
const KitVault = lazy(() => import("./pages/marketing/sprint/KitVault"));
const KitLaunch = lazy(() => import("./pages/marketing/sprint/KitLaunch"));
const KitWelcome = lazy(() => import("./pages/marketing/sprint/KitWelcome"));
const StudioSalesPage = lazy(() => import("./pages/marketing/sprint/StudioSalesPage"));
const StudioOrder = lazy(() => import("./pages/marketing/sprint/StudioOrder"));
const StudioVault = lazy(() => import("./pages/marketing/sprint/StudioVault"));
const StudioLaunch = lazy(() => import("./pages/marketing/sprint/StudioLaunch"));
const StudioWelcome = lazy(() => import("./pages/marketing/sprint/StudioWelcome"));
const RadarSalesPage = lazy(() => import("./pages/marketing/sprint/RadarSalesPage"));
const RadarOrder = lazy(() => import("./pages/marketing/sprint/RadarOrder"));
const RadarVault = lazy(() => import("./pages/marketing/sprint/RadarVault"));
const RadarLaunch = lazy(() => import("./pages/marketing/sprint/RadarLaunch"));
const RadarWelcome = lazy(() => import("./pages/marketing/sprint/RadarWelcome"));
const PublicSignalCompany = lazy(() => import("./pages/marketing/PublicSignalCompany"));
const AboutCedricSeguela = lazy(() => import("./pages/marketing/AboutCedricSeguela"));
const SlidePresentation = lazy(() => import("./pages/slides/SlidePresentation"));

const queryClient = new QueryClient();

// Routes a password-recovery / invite link to the page that can actually
// handle it, from ANY landing route.
//
// A recovery link does not always land where `redirectTo` asked: if the URL
// isn't in Supabase's redirect allow-list, GoTrue falls back to the project's
// Site URL and the user arrives on "/" holding a live recovery session. The
// old check lived on "/" only and listened for the PASSWORD_RECOVERY event
// from an effect — a race against Supabase's async URL parsing that, when
// lost, left the user logged in on the homepage with no password form and no
// explanation. `recoveryLanding` is read synchronously at boot instead, so the
// decision no longer depends on timing.
function RecoveryLinkRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!recoveryLanding) return;
    if (RECOVERY_ROUTES.some((route) => location.pathname.startsWith(route))) return;
    navigate(recoveryLandingPath(recoveryLanding), { replace: true });
    // Landing is a boot-time snapshot; run this once, not per navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// Home = the cinematic scroll-world (previous marketing Index remains at /home-classic).
// A self-hosted install has no marketing site: / opens the app (sign-in when signed out).
function IndexWithRecoveryCheck() {
  if (SELF_HOSTED) return <Navigate to="/jobs" replace />;
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
      <AutopilotWorld />
    </Suspense>
  );
}

// Senders and Mailboxes moved into Settings > Sending. Keep the old URLs
// (bookmarks, onboarding emails, the /get-started ?connect=linkedin deep link)
// working, and carry their query string across — a bare <Navigate> drops it.
function SettingsTabRedirect({ tab }: { tab: string }) {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  return <Navigate to={`/settings?${params.toString()}${hash}`} replace />;
}

// Redirect component for /contacts/:id -> /people/:id
function ContactIdRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/people/${id}`} replace />;
}

// Old /blueprints/:id/automate links (health warnings, bookmarks) -> the autopilot itself
function BlueprintAutomateRedirect() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { data: autopilots, isPending } = useAutopilots();
  if (isPending) return null;
  const requested = searchParams.get("autopilot");
  const autopilot = requested ? autopilots?.find((a) => a.id === requested) : autopilotsForBlueprint(autopilots, id ?? "")[0];
  if (searchParams.get("new") !== "1" && autopilot) return <Navigate to={autopilotPath(autopilot)} replace />;
  return <Navigate to={newAutopilotPath({ blueprintId: id })} replace />;
}

// Wrapper for routes that need auth context
function AuthRoutes() {
  return (
    <AuthProvider>
      {/* Inside AuthProvider so a page chunk loading never unmounts the session. */}
      <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/connect/authorize" element={<McpAuthorize />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth/set-password" element={<SetPassword />} />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <Onboarding />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ideas"
          element={
            <ProtectedRoute>
              <Ideas />
            </ProtectedRoute>
          }
        />
        <Route
          path="/research"
          element={
            <ProtectedRoute>
              <Research />
            </ProtectedRoute>
          }
        />
        <Route
          path="/assets"
          element={
            <ProtectedRoute>
              <Assets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/library/audits"
          element={
            <ProtectedRoute>
              <LibraryAudits />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/tokens"
          element={<ProtectedRoute><Settings /></ProtectedRoute>}
        />
        {/* Legacy / shorthand subroute: keep any existing link to
            /settings/billing working by redirecting to /settings?tab=billing. */}
        <Route path="/settings/billing" element={<Navigate to="/settings?tab=billing" replace />} />
        <Route
          path="/blueprints"
          element={
            <ProtectedRoute>
              <Blueprints />
            </ProtectedRoute>
          }
        />
        <Route
          path="/blueprints/new"
          element={
            <ProtectedRoute>
              <BlueprintStudio />
            </ProtectedRoute>
          }
        />
        <Route
          path="/blueprints/:id"
          element={
            <ProtectedRoute>
              <BlueprintStudio />
            </ProtectedRoute>
          }
        />
        <Route
          path="/blueprints/:id/run"
          element={
            <ProtectedRoute>
              <BlueprintRun />
            </ProtectedRoute>
          }
        />
        <Route
          path="/blueprints/:id/automate"
          element={
            <ProtectedRoute>
              <BlueprintAutomateRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/create"
          element={
            <ProtectedRoute>
              <Create />
            </ProtectedRoute>
          }
        />
        <Route
          path="/jobs"
          element={
            <ProtectedRoute>
              <Jobs />
            </ProtectedRoute>
          }
        />
        <Route
          path="/jobs/:id"
          element={
            <ProtectedRoute>
              <JobDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/editor"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
                <VideoEditor />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/editor/:projectId"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
                <VideoEditor />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/saved"
          element={
            <ProtectedRoute>
              <SavedContent />
            </ProtectedRoute>
          }
        />
        {/* Autopilots: posting plans that rotate blueprints across accounts on a schedule */}
        <Route
          path="/autopilots"
          element={
            <ProtectedRoute>
              <Autopilots />
            </ProtectedRoute>
          }
        />
        <Route
          path="/autopilots/new"
          element={
            <ProtectedRoute>
              <AutopilotEditor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/autopilots/:id"
          element={
            <ProtectedRoute>
              <AutopilotEditor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/publish-queue"
          element={
            <ProtectedRoute>
              <PublishQueue />
            </ProtectedRoute>
          }
        />
        {/* Lead Magnets (Inbound lead capture) - Primary route */}
        <Route
          path="/lead-magnets"
          element={
            <ProtectedRoute>
              <Leads />
            </ProtectedRoute>
          }
        />
        {/* Redirect old /leads to new /lead-magnets */}
        <Route
          path="/leads"
          element={<Navigate to="/lead-magnets" replace />}
        />
        {/* People - Unified contacts, lead lists, network (Primary route) */}
        <Route
          path="/people"
          element={
            <ProtectedRoute>
              <Contacts />
            </ProtectedRoute>
          }
        />
        <Route
          path="/people/:id"
          element={
            <ProtectedRoute>
              <ContactDetail />
            </ProtectedRoute>
          }
        />
        {/* CRM Companies — canonical accounts entity */}
        <Route
          path="/crm/companies"
          element={
            <ProtectedRoute>
              <CompaniesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm/companies/:id"
          element={
            <ProtectedRoute>
              <CompanyDetailPage />
            </ProtectedRoute>
          }
        />
        {/* CRM Deals — pipeline board + report */}
        <Route
          path="/deals"
          element={
            <ProtectedRoute>
              <DealsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/deals/report"
          element={
            <ProtectedRoute>
              <DealsReportPage />
            </ProtectedRoute>
          }
        />
        {/* Redirect old /contacts to new /people */}
        <Route
          path="/contacts"
          element={<Navigate to="/people" replace />}
        />
        <Route
          path="/contacts/:id"
          element={<ContactIdRedirect />}
        />
        {/* Lead Lists - Now part of People page */}
        <Route
          path="/leads/lists"
          element={<Navigate to="/people?tab=lists" replace />}
        />
        <Route
          path="/leads/lists/:id"
          element={
            <ProtectedRoute>
              <LeadListDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/leads/import"
          element={
            <ProtectedRoute>
              <LeadImport />
            </ProtectedRoute>
          }
        />
        {/* Messaging Routes */}
        <Route
          path="/inbox"
          element={
            <ProtectedRoute>
              <Inbox />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sequences"
          element={
            <ProtectedRoute>
              <Sequences />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sequences/:id"
          element={
            <ProtectedRoute>
              <SequenceDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/rules"
          element={
            <ProtectedRoute>
              <Rules />
            </ProtectedRoute>
          }
        />
        {/* Redirect old handoff routes to Settings > Lead Delivery */}
        <Route
          path="/rules/handoff/*"
          element={<Navigate to="/settings?tab=lead-delivery" replace />}
        />
        <Route
          path="/rules/:id"
          element={
            <ProtectedRoute>
              <RuleDetail />
            </ProtectedRoute>
          }
        />
        {/* Senders (LinkedIn & social accounts) live in Settings > Sending */}
        <Route path="/senders" element={<SettingsTabRedirect tab="senders" />} />
        <Route path="/accounts" element={<SettingsTabRedirect tab="senders" />} />
        {/* My Network - Redirect to People with LinkedIn filter */}
        <Route
          path="/network"
          element={<Navigate to="/people?tab=network" replace />}
        />
        {/* The legacy outreach dashboard mixed incompatible LinkedIn and email
            analytics. Keep old bookmarks useful by landing on the operational
            automation list instead. */}
        <Route
          path="/outreach"
          element={<Navigate to="/campaigns" replace />}
        />
        {/* Enrichment Queue */}
        <Route
          path="/enrichment-queue"
          element={
            <ProtectedRoute>
              <EnrichmentQueue />
            </ProtectedRoute>
          }
        />
        {/* LinkedIn Campaigns */}
        <Route
          path="/campaigns"
          element={
            <ProtectedRoute>
              <Campaigns />
            </ProtectedRoute>
          }
        />
        {/* Legacy dashboard URL */}
        <Route
          path="/campaigns/dashboard"
          element={<Navigate to="/campaigns" replace />}
        />
        <Route
          path="/campaigns/new"
          element={
            <ProtectedRoute>
              <CampaignBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/campaigns/:id"
          element={
            <ProtectedRoute>
              <CampaignDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/campaigns/:id/edit"
          element={
            <ProtectedRoute>
              <CampaignBuilder />
            </ProtectedRoute>
          }
        />
        {/* List Building Engine */}
        <Route
          path="/list-building"
          element={
            <ProtectedRoute>
              <ListBuildingJobsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/list-building/cache"
          element={
            <ProtectedRoute>
              <ListBuildingCachePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/list-building/proxies"
          element={
            <ProtectedRoute>
              <ListBuildingProxiesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/list-building/:jobId"
          element={
            <ProtectedRoute>
              <ListBuildingJobDetailPage />
            </ProtectedRoute>
          }
        />
        {/* Signals — Discovery Layer rebranded around ICP-driven signal pipelines */}
        <Route
          path="/signals/dashboard"
          element={
            <ProtectedRoute>
              <SignalsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/signals/new"
          element={
            <ProtectedRoute>
              <SignalNewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/signals/public-records"
          element={
            <ProtectedRoute>
              <PublicRecordsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/signals/:subscriptionId/edit"
          element={
            <ProtectedRoute>
              <SignalNewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/signals/:subscriptionId"
          element={
            <ProtectedRoute>
              <SignalDetailPage />
            </ProtectedRoute>
          }
        />
        {/* Legacy /discovery routes kept so existing bookmarks / inbound links don't 404 */}
        <Route path="/discovery" element={<Navigate to="/signals/dashboard" replace />} />
        <Route path="/discovery/:subscriptionId" element={<Navigate to="/signals/:subscriptionId" replace />} />
        {/* Old pack-catalog and subscription pages still mounted for now while the new
            Signals UX bakes; they will be removed once feature parity is validated */}
        <Route
          path="/discovery-legacy"
          element={
            <ProtectedRoute>
              <DiscoveryCatalogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/discovery-legacy/:subscriptionId"
          element={
            <ProtectedRoute>
              <DiscoverySubscriptionPage />
            </ProtectedRoute>
          }
        />
        {/* Team and Profile redirect to Settings tabs */}
        <Route path="/team" element={<Navigate to="/settings?tab=team" replace />} />
        <Route path="/profile" element={<Navigate to="/settings?tab=account" replace />} />
        {/* Client Management (available to all - page handles "Become an Agency" flow) */}
        <Route
          path="/clients"
          element={
            <ProtectedRoute>
              <ClientsManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clients/:id"
          element={
            <ProtectedRoute requiredRole="agency">
              <ClientDetail />
            </ProtectedRoute>
          }
        />
        {/* Analytics */}
        <Route
          path="/analytics"
          element={
            <ProtectedRoute>
              <Analytics />
            </ProtectedRoute>
          }
        />
        {/* Email Engine */}
        {/* Mailbox list lives in Settings > Sending; detail pages stay here */}
        <Route path="/email/mailboxes" element={<SettingsTabRedirect tab="mailboxes" />} />
        <Route
          path="/email/mailboxes/:id"
          element={
            <ProtectedRoute>
              <EmailMailboxDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/email/sequences"
          element={
            <ProtectedRoute>
              <EmailSequences />
            </ProtectedRoute>
          }
        />
        <Route
          path="/email/sequences/:id"
          element={
            <ProtectedRoute>
              <EmailSequenceBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/email/analytics"
          element={
            <ProtectedRoute>
              <EmailAnalytics />
            </ProtectedRoute>
          }
        />
        {/* Microsoft 365 Tenants (self-serve ordering via Pax8 + Stripe) */}
        <Route
          path="/m365-tenants"
          element={
            <ProtectedRoute>
              <M365Tenants />
            </ProtectedRoute>
          }
        />
        <Route
          path="/m365-tenants/success"
          element={
            <ProtectedRoute>
              <M365TenantSuccess />
            </ProtectedRoute>
          }
        />
        <Route
          path="/m365-tenants/cancelled"
          element={
            <ProtectedRoute>
              <M365TenantCancelled />
            </ProtectedRoute>
          }
        />
        {/* Admin Dashboard (Super Admin Only) */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute requiredRole="super_admin">
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/organizations/:id"
          element={
            <ProtectedRoute requiredRole="super_admin">
              <AdminOrganizationDetail />
            </ProtectedRoute>
          }
        />
        {/* Invitation Accept (Public but needs auth context for post-accept) */}
        <Route path="/invite/:token" element={<InvitationAccept />} />
        {/* Integration Success (Public - user may not be logged in during OAuth flow) */}
        <Route path="/integration-success" element={<IntegrationSuccess />} />
        {/* Design System Stylesheet Reference */}
        <Route
          path="/stylesheet"
          element={
            <ProtectedRoute>
              <Stylesheet />
            </ProtectedRoute>
          }
        />
        {/* Catch-all for auth routes */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </AuthProvider>
  );
}

interface AppProps {
  /** Swapped for StaticRouter by the build-time prerender (src/entry-prerender.tsx). */
  Router?: ElementType;
  routerProps?: Record<string, unknown>;
  client?: QueryClient;
}

const App = ({ Router = BrowserRouter, routerProps, client = queryClient }: AppProps) => (
  <QueryClientProvider client={client}>
    <BrandingProvider>
      <TooltipProvider>
        <DynamicMetadata />
        {/* Both toasters are live: ~13 files (the whole auth surface included)
            call the shadcn `toast()` from @/hooks/use-toast, which renders
            nothing unless this <Toaster /> is mounted. */}
        <Toaster />
        <Sonner />
        <Router {...routerProps}>
          {/* Clears a leaked Radix `body{pointer-events:none}` lock on every
              route change, so an overlay that unmounted during navigation can't
              leave the next page unclickable. */}
          <RouteChangePointerUnlock />
          {/* Sends password-recovery / invite links to the right form no matter
              which route Supabase dropped them on. */}
          <RecoveryLinkRedirect />
          {/* Head tags for static routes that don't call useSEO (src/lib/pageMeta.ts) */}
          <RouteSEO />
          <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
          <Routes>
            {/* Fully public routes - NO auth context needed */}
            {/* IndexWithRecoveryCheck handles redirect if user arrived via recovery link */}
            <Route path="/" element={<IndexWithRecoveryCheck />} />
            <Route path="/join" element={<Navigate to="/auth?tab=signup" replace />} />
            {/* Legal pages */}
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/support" element={<Support />} />
            {/* Email unsubscribe confirmation (redirected from edge function) */}
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            {/* Community-only: invites a GitHub user to the org (link shared privately) */}
            <Route path="/access-cedric-github" element={<GithubAccess />} />
            {/* Unipile hosted-auth popup result (redirected from the auth callbacks) */}
            <Route path="/connect/complete" element={<ConnectComplete />} />

            {/* Marketing pages (slim) */}
            <Route path="/pricing" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><Pricing /></Suspense>} />
            <Route path="/community" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><Community /></Suspense>} />
            <Route path="/playbooks" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><Playbooks /></Suspense>} />
            <Route path="/playbooks/:slug" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><Playbook /></Suspense>} />
            <Route path="/onboard/playbook/:slug" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><PlaybookOnboarding /></Suspense>} />
            {/* The methodology page — the whole find → qualify → enrich → reach
                → amplify → convert → compound loop, explained for a buyer. */}
            <Route path="/how-we-work" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><HowWeWork /></Suspense>} />
            <Route path="/how-we-work/:profession" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><HowWeWork /></Suspense>} />
            {/* Quote journey: questionnaire, then pick a time. Separate from
                /get-started, which is self-serve product onboarding. */}
            <Route path="/quote" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><Quote /></Suspense>} />
            <Route path="/quote/:profession" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><Quote /></Suspense>} />
            <Route path="/book" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><BookCall /></Suspense>} />
            <Route path="/get-started" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><GetStarted /></Suspense>} />
            <Route path="/sandbox" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><Sandbox /></Suspense>} />
            <Route path="/tools" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><Tools /></Suspense>} />
            <Route path="/signals" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><PublicSignals /></Suspense>} />
            <Route path="/free-hermes-linkedin-setter" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><HermesAppointmentSetter /></Suspense>} />
            <Route path="/autopilot" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><AutopilotWorld /></Suspense>} />
            <Route path="/autopilot-classic" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><AutopilotLanding /></Suspense>} />
            <Route path="/home-classic" element={<Index />} />
            <Route path="/agents" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><AgentShowcase /></Suspense>} />
            <Route path="/mcp" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><AcaMcp /></Suspense>} />
            <Route path="/mcp/commands" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><AcaPluginCommands /></Suspense>} />
            <Route
              path="/developers"
              element={
                <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0f0f0f" }} />}>
                  <Developers />
                </Suspense>
              }
            />
            <Route path="/docs" element={<Navigate to="/developers" replace />} />
            <Route path="/free-google-maps-scraper" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><GoogleMapsScraper /></Suspense>} />
            <Route path="/free-sec-form4-agent" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><SecForm4Agent /></Suspense>} />
            <Route path="/free-buying-signals-agent" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><BuyingSignalsAgent /></Suspense>} />
            <Route path="/free-reddit-engagement-agent" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><RedditEngagementAgent /></Suspense>} />
            <Route path="/free-youtube-automation-agent" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><YoutubeAutomationAgent /></Suspense>} />
            <Route path="/free-seo-growth-agent" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><SeoGrowthAgent /></Suspense>} />
            <Route path="/free-lead-pipeline-agent" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><LeadPipelineAgent /></Suspense>} />
            <Route path="/free-carousel-factory-agent" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><CarouselFactoryAgent /></Suspense>} />
            {/* Cold-traffic funnels. /kit = local-lead agencies (Local Leads
                agent); /studio = a DIFFERENT avatar, faceless-YouTube creators
                (Channel agent), so the two don't split ad data or cannibalize.
                The Sprint pages are parked (unrouted) — repurposed as the
                members-only activation event, not a competing front-end offer. */}
            <Route path="/kit" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><KitSalesPage /></Suspense>} />
            <Route path="/kit/order" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><KitOrder /></Suspense>} />
            <Route path="/kit/vault" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><KitVault /></Suspense>} />
            <Route path="/kit/launch" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><KitLaunch /></Suspense>} />
            <Route path="/kit/welcome" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><KitWelcome /></Suspense>} />
            <Route path="/studio" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><StudioSalesPage /></Suspense>} />
            <Route path="/studio/order" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><StudioOrder /></Suspense>} />
            <Route path="/studio/vault" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><StudioVault /></Suspense>} />
            <Route path="/studio/launch" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><StudioLaunch /></Suspense>} />
            <Route path="/studio/welcome" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><StudioWelcome /></Suspense>} />
            {/* /radar = third front door: B2B founders/agencies buying warm
                pipeline for their own business (Buying Signals agent). */}
            <Route path="/radar" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><RadarSalesPage /></Suspense>} />
            <Route path="/radar/order" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><RadarOrder /></Suspense>} />
            <Route path="/radar/vault" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><RadarVault /></Suspense>} />
            <Route path="/radar/launch" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><RadarLaunch /></Suspense>} />
            <Route path="/radar/welcome" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><RadarWelcome /></Suspense>} />
            <Route path="/signals/c/:slug" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><PublicSignalCompany /></Suspense>} />
            <Route path="/blog" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><Blog /></Suspense>} />
            <Route path="/blog/:slug" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><BlogPost /></Suspense>} />
            <Route path="/about/cedric-seguela" element={<Suspense fallback={<div style={{ minHeight: "100vh" }} />}><AboutCedricSeguela /></Suspense>} />

            {/* Keyboard-navigated slide presentations (own the full viewport, noindex) */}
            <Route path="/slides/:slug" element={<SlidePresentation />} />

            {/* All other routes go through AuthProvider */}
            <Route path="/*" element={<AuthRoutes />} />
          </Routes>
          </Suspense>
        </Router>
      </TooltipProvider>
    </BrandingProvider>
  </QueryClientProvider>
);

export default App;
