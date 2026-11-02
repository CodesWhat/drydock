"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { DOCS_ROOT, GITHUB_URL } from "@/lib/site-config";

export function MobileNavigation() {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menu.current?.contains(event.target))
        menu.current?.removeAttribute("open");
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.removeAttribute("open");
        menu.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  return (
    <details className="website-mobile-nav" ref={menu}>
      <summary aria-label="Open navigation menu">Menu</summary>
      <div className="website-mobile-panel">
        {[
          [DOCS_ROOT, "Documentation"],
          ["/compare", "Compare"],
          ["/#features", "Features"],
          ["/#get-started", "Get started"],
          ["/#demo", "Live demo"],
          ["/#roadmap", "Roadmap"],
        ].map(([href, label]) => (
          <Link key={href} href={href} onClick={() => menu.current?.removeAttribute("open")}>
            {label}
          </Link>
        ))}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => menu.current?.removeAttribute("open")}
        >
          GitHub
        </a>
      </div>
    </details>
  );
}
