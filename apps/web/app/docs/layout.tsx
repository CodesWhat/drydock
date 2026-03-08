import { DocsLayout } from "fumadocs-ui/layouts/docs";
import Image from "next/image";
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
      {children}
    </DocsLayout>
  );
}
