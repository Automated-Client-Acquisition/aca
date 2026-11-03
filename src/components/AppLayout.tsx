import { ReactNode, useLayoutEffect, useRef } from "react";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Separator } from "@/components/ui/separator";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { FloatingChecklist } from "@/components/activation/FloatingChecklist";
import { DemoModeBanner } from "@/components/demo/DemoModeBanner";
import { TrialBanner } from "@/components/billing/TrialBanner";
import { PastDueBanner } from "@/components/billing/PastDueBanner";
import { BackgroundTasksBar } from "@/components/BackgroundTasksBar";
import {
  useAnalysisJobProgressSync,
  useSequenceJobProgressSync,
  useApifyLeadsImportSync,
  useMailtesterJobProgressSync,
} from "@/hooks/useBackgroundTaskSync";
import { SELF_HOSTED } from "@/config/site";

interface AppLayoutProps {
  children: ReactNode;
  header?: ReactNode;
  disableScroll?: boolean;
  hideActivationChecklist?: boolean;
}

export function AppLayout({
  children,
  header,
  disableScroll = false,
  hideActivationChecklist = false,
}: AppLayoutProps) {
  const contentRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const updateHeight = () => {
      content.style.setProperty(
        "--app-content-height",
        `${content.clientHeight}px`,
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Sync DB-polled jobs into the global background tasks store
  useAnalysisJobProgressSync();
  useSequenceJobProgressSync();
  useApifyLeadsImportSync();
  useMailtesterJobProgressSync();

  return (
    <SidebarProvider defaultOpen={true}>
      {/* data-app-shell keeps the marketing heading defaults (aca-home.css) out of the app */}
      <div
        data-app-shell
        className="flex h-dvh min-h-0 w-full flex-col overflow-hidden"
      >
        {/* Impersonation Banner - shown when super admin is impersonating */}
        <ImpersonationBanner />

        <div className="flex min-h-0 flex-1">
          <AppSidebar />
          <SidebarInset className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* Header with trigger */}
            <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4 bg-card">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <div className="flex items-center gap-2 flex-1">
                <div className="ml-auto flex items-center gap-2">{header}</div>
              </div>
            </header>

            {/* Past-due red banner — non-dismissible, sits above the trial banner */}
            {!SELF_HOSTED && <PastDueBanner />}

            {/* Trial banner — shown to orgs on the free 3-day trial */}
            {!SELF_HOSTED && <TrialBanner />}

            {/* Demo mode banner */}
            <DemoModeBanner />

            {/* Global background task progress */}
            <BackgroundTasksBar />

            {/* Main content */}
            <main
              ref={contentRef}
              data-app-content
              className={`min-h-0 min-w-0 flex-1 ${disableScroll ? "overflow-hidden flex flex-col" : "overflow-auto"}`}
            >
              {children}
            </main>
          </SidebarInset>
        </div>

        {/* Floating activation checklist */}
        {!hideActivationChecklist && <FloatingChecklist />}
      </div>
    </SidebarProvider>
  );
}
