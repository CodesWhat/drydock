"use client";

import { ExternalLink, Maximize2, Monitor, Palette, Share, X } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { DEMO_URL, SITE_CONFIG } from "@/lib/site-config";

const DEMO_TRANSITION = "all 350ms cubic-bezier(0.4, 0, 0.2, 1)";
const DEMO_SHARE_DATA = {
  title: `${SITE_CONFIG.name} Interactive Demo`,
  text: `Try ${SITE_CONFIG.name} — open source container update monitoring. Interactive demo, no install required.`,
  // Share the canonical production demo, not a per-env preview URL.
  url: SITE_CONFIG.demoUrl,
};

type DemoMode = "inline" | "expanding" | "fullscreen" | "collapsing";
type IframeStatus = "loading" | "ready" | "failed";

function applyContainerFrame(
  el: HTMLDivElement,
  frame: {
    transition: string;
    top: string;
    left: string;
    width: string;
    height: string;
    borderRadius: string;
  },
) {
  el.style.transition = frame.transition;
  el.style.top = frame.top;
  el.style.left = frame.left;
  el.style.width = frame.width;
  el.style.height = frame.height;
  el.style.borderRadius = frame.borderRadius;
}

function clearContainerFrame(el: HTMLDivElement) {
  el.style.transition = "";
  el.style.top = "";
  el.style.left = "";
  el.style.width = "";
  el.style.height = "";
  el.style.borderRadius = "";
}

function finishAfterTransition(el: HTMLDivElement, onDone: () => void) {
  let finished = false;

  const finish = () => {
    if (finished) {
      return;
    }

    finished = true;
    el.removeEventListener("transitionend", finish);
    onDone();
  };

  el.addEventListener("transitionend", finish, { once: true });
  const timeout = window.setTimeout(finish, 400);

  return () => {
    window.clearTimeout(timeout);
    el.removeEventListener("transitionend", finish);
  };
}

function useDemoReadyStatus(setIframeStatus: Dispatch<SetStateAction<IframeStatus>>) {
  useEffect(() => {
    const demoOrigin = new URL(DEMO_URL).origin;

    function onMessage(e: MessageEvent) {
      if (e.origin !== demoOrigin) {
        return;
      }

      if (e.data?.type === "drydock-demo-ready") {
        setIframeStatus("ready");
      }
    }

    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(() => {
      setIframeStatus((prev) => (prev === "loading" ? "failed" : prev));
    }, 5000);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
    };
  }, [setIframeStatus]);
}

function useExpandAnimation(
  mode: DemoMode,
  containerRef: RefObject<HTMLDivElement | null>,
  inlineRectRef: RefObject<DOMRect | null>,
  setMode: Dispatch<SetStateAction<DemoMode>>,
) {
  useEffect(() => {
    if (mode !== "expanding") {
      return;
    }

    const el = containerRef.current;
    const rect = inlineRectRef.current;

    if (!el || !rect) {
      return;
    }

    applyContainerFrame(el, {
      transition: "none",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      borderRadius: "12px",
    });

    el.getBoundingClientRect();

    applyContainerFrame(el, {
      transition: DEMO_TRANSITION,
      top: "0px",
      left: "0px",
      width: "100vw",
      height: "100vh",
      borderRadius: "0px",
    });

    return finishAfterTransition(el, () => {
      clearContainerFrame(el);
      setMode("fullscreen");
    });
  }, [mode, containerRef, inlineRectRef, setMode]);
}

function useCollapseAnimation(
  mode: DemoMode,
  containerRef: RefObject<HTMLDivElement | null>,
  inlineRectRef: RefObject<DOMRect | null>,
  setMode: Dispatch<SetStateAction<DemoMode>>,
) {
  useEffect(() => {
    if (mode !== "collapsing") {
      return;
    }

    const el = containerRef.current;
    if (!el) {
      return;
    }

    const placeholder = document.getElementById("demo-placeholder");
    const targetRect = placeholder ? placeholder.getBoundingClientRect() : inlineRectRef.current;

    if (!targetRect) {
      setMode("inline");
      return;
    }

    applyContainerFrame(el, {
      transition: "none",
      top: "0px",
      left: "0px",
      width: "100vw",
      height: "100vh",
      borderRadius: "0px",
    });

    el.getBoundingClientRect();

    applyContainerFrame(el, {
      transition: DEMO_TRANSITION,
      top: `${targetRect.top}px`,
      left: `${targetRect.left}px`,
      width: `${targetRect.width}px`,
      height: `${targetRect.height}px`,
      borderRadius: "12px",
    });

    return finishAfterTransition(el, () => {
      clearContainerFrame(el);
      setMode("inline");
    });
  }, [mode, containerRef, inlineRectRef, setMode]);
}

function useFullscreenDocumentEffects(mode: DemoMode, closeFullscreen: () => void) {
  useEffect(() => {
    if (mode === "inline") {
      return;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeFullscreen();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [mode, closeFullscreen]);
}

async function shareDemo() {
  if (navigator.share) {
    try {
      await navigator.share(DEMO_SHARE_DATA);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
    }
  }

  if (!navigator.clipboard?.writeText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(DEMO_SHARE_DATA.url);
  } catch (error) {
    console.warn("Failed to copy demo URL to clipboard", error);
  }
}

function navigateDemoIframe(iframeRef: RefObject<HTMLIFrameElement | null>, path: string) {
  if (iframeRef.current?.contentWindow) {
    iframeRef.current.contentWindow.postMessage({ type: "navigate", path }, DEMO_URL);
  }

  if (iframeRef.current) {
    iframeRef.current.src = `${DEMO_URL}${path}`;
  }
}

function DemoInlineActions({
  onOpenThemeEditor,
  onOpenFullscreen,
}: {
  onOpenThemeEditor: () => void;
  onOpenFullscreen: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-center gap-3">
      <Button variant="outline" size="sm" onClick={onOpenThemeEditor}>
        <Palette className="h-4 w-4" />
        Theme Editor
      </Button>
      <Button variant="outline" size="sm" onClick={onOpenFullscreen}>
        <Maximize2 className="h-4 w-4" />
        Open fullscreen
      </Button>
    </div>
  );
}

function DemoFullscreenHeader({
  onClose,
  onShare,
  onThemeEditor,
}: {
  onClose: () => void;
  onShare: () => void;
  onThemeEditor: () => void;
}) {
  return (
    <div className="grid h-11 shrink-0 grid-cols-3 items-center border-b border-neutral-200 bg-white/80 px-4 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/80">
      <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Interactive Demo
      </span>

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" aria-label="Share" onClick={onShare}>
          <Share className="h-4 w-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" aria-label="Theme Editor" onClick={onThemeEditor}>
          <Palette className="h-4 w-4" />
          <span className="hidden sm:inline">Theme Editor</span>
        </Button>
        <Button variant="ghost" size="sm" aria-label="Back to site" onClick={onClose}>
          <X className="h-4 w-4" />
          <span className="hidden sm:inline">Back to site</span>
        </Button>
      </div>
    </div>
  );
}

function DemoLoadFailure() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-50 dark:bg-neutral-900">
      <span className="text-6xl" role="img" aria-label="Dead fish">
        🐟
      </span>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        The interactive demo couldn&apos;t load in this browser.
      </p>
      <Button variant="outline" size="sm" asChild>
        <a href={DEMO_URL} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4" />
          Open demo directly
        </a>
      </Button>
    </div>
  );
}

function DemoFrame({
  mode,
  iframeStatus,
  containerRef,
  iframeRef,
  onClose,
  onShare,
  onThemeEditor,
}: {
  mode: DemoMode;
  iframeStatus: IframeStatus;
  containerRef: RefObject<HTMLDivElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onClose: () => void;
  onShare: () => void;
  onThemeEditor: () => void;
}) {
  const isFixed = mode !== "inline";

  return (
    <>
      {isFixed ? (
        <div
          id="demo-placeholder"
          className="aspect-[16/10] rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900"
        />
      ) : null}

      {isFixed ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close fullscreen demo"
          className={`fixed inset-0 z-40 cursor-default border-0 bg-black/50 p-0 transition-opacity duration-300 ${
            mode === "collapsing" ? "opacity-0" : "opacity-100"
          }`}
          onClick={onClose}
        />
      ) : null}

      <div
        ref={containerRef}
        className={
          isFixed
            ? "fixed z-50 flex flex-col overflow-hidden bg-white shadow-2xl dark:bg-neutral-950"
            : "isolate flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white/50 shadow-2xl backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50"
        }
        style={isFixed ? { inset: mode === "fullscreen" ? "0" : undefined } : undefined}
      >
        {isFixed ? (
          <DemoFullscreenHeader onClose={onClose} onShare={onShare} onThemeEditor={onThemeEditor} />
        ) : (
          <div className="flex h-10 shrink-0 items-center gap-3 border-b border-neutral-200 bg-neutral-100/80 px-4 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/80">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-red-400" />
              <div className="h-3 w-3 rounded-full bg-yellow-400" />
              <div className="h-3 w-3 rounded-full bg-green-400" />
            </div>
            <div className="flex flex-1 items-center justify-center">
              <div className="flex h-6 items-center gap-1.5 rounded-md bg-white/70 px-3 text-xs text-neutral-500 dark:bg-neutral-800/70 dark:text-neutral-400">
                <Monitor className="h-3 w-3 shrink-0" />
                <span>{DEMO_URL.replace(/^https?:\/\//, "")}</span>
              </div>
            </div>
            <div className="w-[54px]" />
          </div>
        )}

        <div className={`relative ${isFixed ? "flex-1" : "aspect-[16/10] overflow-hidden"}`}>
          <iframe
            ref={iframeRef}
            src={DEMO_URL}
            title={`${SITE_CONFIG.name} Interactive Demo`}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="clipboard-write"
            loading="lazy"
          />

          {iframeStatus === "failed" ? <DemoLoadFailure /> : null}
        </div>
      </div>
    </>
  );
}

export function DemoVariants() {
  const [mode, setMode] = useState<DemoMode>("inline");
  const [iframeStatus, setIframeStatus] = useState<IframeStatus>("loading");
  const containerRef = useRef<HTMLDivElement>(null);
  const inlineRectRef = useRef<DOMRect | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const openFullscreen = useCallback(() => {
    if (!containerRef.current) {
      return;
    }

    inlineRectRef.current = containerRef.current.getBoundingClientRect();
    setMode("expanding");
  }, []);

  const closeFullscreen = useCallback(() => {
    if (!containerRef.current) {
      return;
    }

    setMode("collapsing");
  }, []);

  const openThemeEditor = useCallback(() => {
    navigateDemoIframe(iframeRef, "/config?tab=appearance");
  }, []);

  const handleShare = useCallback(() => {
    void shareDemo();
  }, []);

  useDemoReadyStatus(setIframeStatus);
  useExpandAnimation(mode, containerRef, inlineRectRef, setMode);
  useCollapseAnimation(mode, containerRef, inlineRectRef, setMode);
  useFullscreenDocumentEffects(mode, closeFullscreen);

  return (
    <section className="border-t border-border/60 py-16">
      <div className="mx-auto max-w-6xl px-4">
        <SectionHeading
          strike="Screenshots"
          title="See it in action!"
          subtitle="Try the fully interactive demo below — real UI, real data*, no install required."
          align="left"
        />

        <div className="mx-auto max-w-4xl">
          {mode === "inline" ? (
            <DemoInlineActions
              onOpenThemeEditor={openThemeEditor}
              onOpenFullscreen={openFullscreen}
            />
          ) : null}

          <DemoFrame
            mode={mode}
            iframeStatus={iframeStatus}
            containerRef={containerRef}
            iframeRef={iframeRef}
            onClose={closeFullscreen}
            onShare={handleShare}
            onThemeEditor={openThemeEditor}
          />

          {mode === "inline" ? (
            <p className="mt-3 text-center text-xs text-neutral-400 dark:text-neutral-600">
              *Not real data
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
