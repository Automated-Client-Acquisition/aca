import { NavLink } from "react-router-dom";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { cn } from "@/lib/utils";

/**
 * One "Content" place for everything that's been made: runs (jobs), saved
 * pieces and the publish queue. Rendered at the top of each of those pages.
 */
export function ContentTabs() {
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const tabs = [
    { href: "/jobs", label: "Runs" },
    { href: "/saved", label: "Saved" },
    ...(hasFeature("publishing") || showUpgradePrompts ? [{ href: "/publish-queue", label: "Scheduled" }] : []),
  ];
  return (
    <nav aria-label="Content" className="mb-6 flex gap-1 border-b">
      {tabs.map((t) => (
        <NavLink
          key={t.href}
          to={t.href}
          className={({ isActive }) =>
            cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              isActive ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
