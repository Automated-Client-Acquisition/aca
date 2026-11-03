import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Safety net for the Radix "stuck body pointer-events" bug.
 *
 * Radix overlays (DropdownMenu, Dialog, AlertDialog) set
 * `document.body.style.pointer-events = 'none'` while open and rely on their own
 * unmount cleanup to restore it. When an overlay unmounts abnormally — most
 * commonly when a menu item navigates to another route in the same tick as the
 * menu is closing — that cleanup can be skipped, and the lock leaks onto the
 * next page. The symptom is "all clicks are dead" everywhere: Continue does
 * nothing, step indicators do nothing, buttons don't fire, no errors, no toasts.
 *
 * On every route change we clear a leaked inline `pointer-events: none` from the
 * body. This only fires on pathname changes, so it never interferes with an
 * overlay that is legitimately open on the current page (no navigation).
 */
export function useRouteChangePointerUnlock() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
  }, [pathname]);
}

/** Renders nothing; runs the unlock effect. Mount once inside the Router. */
export function RouteChangePointerUnlock() {
  useRouteChangePointerUnlock();
  return null;
}
