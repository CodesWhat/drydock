"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { capturePageview } from "@/lib/analytics";

export function AnalyticsPageview() {
  const pathname = usePathname();
  const lastPathname = useRef<string | null>(null);

  useEffect(() => {
    if (lastPathname.current === pathname) {
      return;
    }
    lastPathname.current = pathname;
    capturePageview(pathname);
  }, [pathname]);

  return null;
}
