"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { REPO_SLUG } from "@/lib/site-config";

const DARK_SRC = `https://api.star-history.com/svg?repos=${REPO_SLUG}&type=timeline&theme=dark&legend=top-left`;
const LIGHT_SRC = `https://api.star-history.com/svg?repos=${REPO_SLUG}&type=timeline&legend=top-left`;
const CHART_HREF = `https://www.star-history.com/#${REPO_SLUG}&type=timeline&legend=top-left`;

export function StarHistoryChart({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <a
      href={CHART_HREF}
      target="_blank"
      rel="noopener"
      aria-label="Open the Star History chart"
      className={className}
    >
      <span className="block aspect-[3/2] w-full">
        {mounted ? (
          <img
            src={resolvedTheme === "dark" ? DARK_SRC : LIGHT_SRC}
            alt="Star History Chart"
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            className="h-full w-full object-contain"
          />
        ) : (
          <span aria-hidden="true" className="block h-full w-full" />
        )}
      </span>
    </a>
  );
}
