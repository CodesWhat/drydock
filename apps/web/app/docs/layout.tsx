import { Banner } from "fumadocs-ui/components/banner";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Banner
        changeLayout={false}
        className="border-b border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
      >
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-red-200 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900 dark:text-red-200">
            RC
          </span>
          <span>
            You&apos;re viewing <strong>v1.4.0 release candidate</strong> docs &mdash; this version
            is not yet released.
          </span>
          <Link
            href="https://github.com/CodesWhat/drydock/releases/tag/v1.3.9"
            className="font-medium text-red-700 underline underline-offset-2 hover:text-red-900 dark:text-red-300 dark:hover:text-red-100"
          >
            v1.3.9 release notes &rarr;
          </Link>
        </span>
      </Banner>
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
        {children}
      </DocsLayout>
    </>
  );
}
