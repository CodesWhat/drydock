import type { ReactNode } from "react";
import { DocsShell } from "@/components/docs-shell";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return <DocsShell tree={source.getPageTree()}>{children}</DocsShell>;
}
