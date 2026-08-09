"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { REPO_SLUG } from "@/lib/site-config";

// Self-hosted chart (#671) — rendered by /api/star-history from our own
// origin after the upstream chart service's outage broke the embed.
const DARK_SRC = "/api/star-history?theme=dark";
const LIGHT_SRC = "/api/star-history?theme=light";
const CHART_HREF = `https://github.com/${REPO_SLUG}/stargazers`;

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
