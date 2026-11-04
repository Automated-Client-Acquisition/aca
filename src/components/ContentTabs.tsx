import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * One "Content" place for everything that's been made: runs (jobs) and saved
 * pieces. Rendered at the top of each of those pages. Scheduled posts live in
 * the Scheduler (/scheduler), which has its own sidebar item.
 */
export function ContentTabs() {
  const tabs = [
    { href: "/jobs", label: "Runs" },
    { href: "/saved", label: "Saved" },
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
