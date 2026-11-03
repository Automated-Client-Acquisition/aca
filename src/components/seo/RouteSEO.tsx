import { useLocation } from "react-router-dom";
import { useSEO } from "@/hooks/useSEO";
import { getPageMeta } from "@/lib/pageMeta";

function Meta({ options }: { options: Parameters<typeof useSEO>[0] }) {
  return useSEO(options);
}

/**
 * Emits head tags for static routes listed in src/lib/pageMeta.ts. Mount once
 * inside the router; renders nothing for routes that manage their own head.
 */
export function RouteSEO() {
  const { pathname } = useLocation();
  const options = getPageMeta(pathname);
  return options ? <Meta options={options} /> : null;
}
