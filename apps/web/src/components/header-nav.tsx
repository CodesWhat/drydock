"use client";

import { BookOpen, GitCompare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GithubIcon } from "@/components/github-icon";
import { TrackedLink } from "@/components/tracked-link";
import { DOCS_ROOT, GITHUB_URL } from "@/lib/site-config";

// DOCS_ROOT minus its version segment, so every docs version keeps the link current.
export const DOCS_SECTION = DOCS_ROOT.slice(0, DOCS_ROOT.indexOf("/", 1));

/** Whether `pathname` is `section` or a page beneath it. */
export function isSectionPath(pathname: string | null, section: string) {
  return pathname === section || Boolean(pathname?.startsWith(`${section}/`));
}

export function HeaderNavLinks() {
  const pathname = usePathname();
  const onDocs = isSectionPath(pathname, DOCS_SECTION);
  const onCompare = isSectionPath(pathname, "/compare");

  return (
    <>
      <TrackedLink
        href={DOCS_ROOT}
        ctaId="docs_root"
        placement="header"
        className="website-nav-link"
        aria-current={onDocs ? "page" : undefined}
      >
        <BookOpen size={14} aria-hidden="true" />
        Docs
      </TrackedLink>
      <Link
        href="/compare"
        className="website-nav-link"
        aria-current={onCompare ? "page" : undefined}
      >
        <GitCompare size={14} aria-hidden="true" />
        Compare
      </Link>
      <TrackedLink
        href={GITHUB_URL}
        ctaId="github_repository"
        placement="header"
        target="_blank"
        rel="noopener noreferrer"
        className="website-nav-link"
      >
        <GithubIcon className="h-3.5 w-3.5" />
        GitHub
      </TrackedLink>
    </>
  );
}
