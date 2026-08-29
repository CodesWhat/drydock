"use client";

import { RootProvider as FumadocsRootProvider } from "fumadocs-ui/provider/next";
import type { ComponentProps } from "react";
import { DocsSearchDialog } from "@/components/docs-search-dialog";

type FumadocsRootProviderProps = ComponentProps<typeof FumadocsRootProvider>;

/**
 * Thin wrapper around fumadocs-ui's RootProvider that always scopes the
 * site's single search dialog (opened by the header's search button and by
 * the Cmd/Ctrl+K hotkey — both routed through fumadocs' search context) to
 * the current docs version. See docs-search-dialog.tsx for why.
 *
 * A dedicated wrapper, rather than passing `search` directly at the call
 * site in layout.tsx, keeps `<RootProvider theme={{ nonce }}>` there
 * unchanged — content-security-policy.test.mjs pins that exact JSX substring
 * to guard the nonce plumbing, so this is the only prop layout.tsx passes.
 */
export function RootProvider({ children, ...props }: FumadocsRootProviderProps) {
  return (
    <FumadocsRootProvider {...props} search={{ SearchDialog: DocsSearchDialog }}>
      {children}
    </FumadocsRootProvider>
  );
}
