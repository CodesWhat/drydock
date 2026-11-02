"use client";

import {
  BookOpen,
  GitCompare,
  Heart,
  Layers,
  type LucideIcon,
  Map as MapIcon,
  Menu,
  Play,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { GithubIcon } from "@/components/github-icon";
import { DOCS_SECTION, isSectionPath } from "@/components/header-nav";
import { DOCS_ROOT, GITHUB_URL } from "@/lib/site-config";

const SPONSOR_URL = "https://github.com/sponsors/CodesWhat";

const LINKS: { href: string; label: string; icon: LucideIcon; section?: string }[] = [
  { href: DOCS_ROOT, label: "Documentation", icon: BookOpen, section: DOCS_SECTION },
  { href: "/compare", label: "Compare", icon: GitCompare, section: "/compare" },
  { href: "/#features", label: "Features", icon: Layers },
  { href: "/#get-started", label: "Get started", icon: Terminal },
  { href: "/#demo", label: "Live demo", icon: Play },
  { href: "/#roadmap", label: "Roadmap", icon: MapIcon },
];

export function MobileNavigation() {
  const pathname = usePathname();
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
      <summary aria-label="Open navigation menu">
        <Menu size={16} aria-hidden="true" />
        <span>Menu</span>
      </summary>
      <div className="website-mobile-panel">
        {LINKS.map(({ href, label, icon: Icon, section }) => (
          <Link
            key={href}
            href={href}
            aria-current={section && isSectionPath(pathname, section) ? "page" : undefined}
            onClick={() => menu.current?.removeAttribute("open")}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </Link>
        ))}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => menu.current?.removeAttribute("open")}
        >
          <GithubIcon className="h-4 w-4" />
          GitHub
        </a>
        <a
          href={SPONSOR_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => menu.current?.removeAttribute("open")}
        >
          <Heart size={16} aria-hidden="true" />
          Sponsor
        </a>
      </div>
    </details>
  );
}
