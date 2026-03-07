import { DocsLayout } from "fumadocs-ui/layouts/docs";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: (
          <div className="flex items-center gap-2">
            <Image
              src="/whale-logo.png"
              alt="Drydock"
              width={24}
              height={24}
              className="dark:invert"
            />
            <span>Drydock</span>
          </div>
        ),
        url: "/",
      }}
      links={[
        {
          text: "GitHub",
          url: "https://github.com/CodesWhat/drydock",
          external: true,
        },
      ]}
    >
      <div className="border-b border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/80">
        <div className="mx-auto flex items-center justify-center gap-2 px-4 py-2 text-sm">
          <span className="inline-flex items-center rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            RC
          </span>
          <span className="text-amber-800 dark:text-amber-200">
            These docs cover the <strong>v1.4.0 release candidate</strong>.
          </span>
          <Link
            href="https://github.com/CodesWhat/drydock/releases/tag/v1.3.9"
            className="font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
          >
            v1.3.9 stable
          </Link>
        </div>
      </div>
      {children}
    </DocsLayout>
  );
}
