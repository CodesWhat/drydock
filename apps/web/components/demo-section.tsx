"use client";

import { ExternalLink, Maximize2, Palette, Share, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || "https://demo.drydock.codeswhat.com";

export function DemoSection() {
  const [mode, setMode] = useState<"inline" | "expanding" | "fullscreen" | "collapsing">("inline");
  const [iframeStatus, setIframeStatus] = useState<"loading" | "ready" | "failed">("loading");
  const containerRef = useRef<HTMLDivElement>(null);
  const inlineRectRef = useRef<DOMRect | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for demo app ready signal, fallback after timeout
  useEffect(() => {
    const demoOrigin = new URL(DEMO_URL).origin;

    function onMessage(e: MessageEvent) {
      if (e.origin !== demoOrigin) return;
      if (e.data?.type === "drydock-demo-ready") {
        setIframeStatus("ready");
      }
    }

    window.addEventListener("message", onMessage);
    const timeout = setTimeout(() => {
      setIframeStatus((prev) => (prev === "loading" ? "failed" : prev));
    }, 5000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timeout);
    };
  }, []);

  function openFullscreen() {
    if (!containerRef.current) return;
    // Capture current position before going fixed
    inlineRectRef.current = containerRef.current.getBoundingClientRect();
    setMode("expanding");
  }

  const closeFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    // Re-capture where the inline slot is so we can animate back
    // We need the placeholder position — store it before we started
    setMode("collapsing");
  }, []);

  // Handle expand animation
  useEffect(() => {
    if (mode !== "expanding" || !containerRef.current || !inlineRectRef.current) return;

    const el = containerRef.current;
    const rect = inlineRectRef.current;

    // Start at the inline position
    el.style.transition = "none";
    el.style.top = `${rect.top}px`;
    el.style.left = `${rect.left}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    el.style.borderRadius = "12px";

    // Force reflow
    el.getBoundingClientRect();

    // Animate to fullscreen
    el.style.transition = "all 350ms cubic-bezier(0.4, 0, 0.2, 1)";
    el.style.top = "0px";
    el.style.left = "0px";
    el.style.width = "100vw";
    el.style.height = "100vh";
    el.style.borderRadius = "0px";

    function onEnd() {
      el.removeEventListener("transitionend", onEnd);
      // Clear inline styles, let CSS class take over
      el.style.transition = "";
      el.style.top = "";
      el.style.left = "";
      el.style.width = "";
      el.style.height = "";
      el.style.borderRadius = "";
      setMode("fullscreen");
    }

    el.addEventListener("transitionend", onEnd, { once: true });
    // Safety timeout in case transitionend doesn't fire
    const timeout = setTimeout(onEnd, 400);
    return () => clearTimeout(timeout);
  }, [mode]);

  // Handle collapse animation
  useEffect(() => {
    if (mode !== "collapsing" || !containerRef.current) return;

    const el = containerRef.current;

    // Find where the placeholder is now
    const placeholder = document.getElementById("demo-placeholder");
    const target = placeholder ? placeholder.getBoundingClientRect() : inlineRectRef.current;

    if (!target) {
      setMode("inline");
      return;
    }

    // Start at fullscreen
    el.style.transition = "none";
    el.style.top = "0px";
    el.style.left = "0px";
    el.style.width = "100vw";
    el.style.height = "100vh";
    el.style.borderRadius = "0px";

    // Force reflow
    el.getBoundingClientRect();

    // Animate back to inline position
    el.style.transition = "all 350ms cubic-bezier(0.4, 0, 0.2, 1)";
    el.style.top = `${target.top}px`;
    el.style.left = `${target.left}px`;
    el.style.width = `${target.width}px`;
    el.style.height = `${target.height}px`;
    el.style.borderRadius = "12px";

    function onEnd() {
      el.removeEventListener("transitionend", onEnd);
      el.style.transition = "";
      el.style.top = "";
      el.style.left = "";
      el.style.width = "";
      el.style.height = "";
      el.style.borderRadius = "";
      setMode("inline");
    }

    el.addEventListener("transitionend", onEnd, { once: true });
    const timeout = setTimeout(onEnd, 400);
    return () => clearTimeout(timeout);
  }, [mode]);

  // Escape key closes fullscreen
  useEffect(() => {
    if (mode === "inline") return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeFullscreen();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [mode, closeFullscreen]);

  async function shareDemo() {
    const shareData = {
      title: "Drydock Interactive Demo",
      text: "Try Drydock — open source container update monitoring. Interactive demo, no install required.",
      url: "https://demo.drydock.codeswhat.com",
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        // Ignore user-cancelled share prompts.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareData.url);
      } catch (error) {
        console.warn("Failed to copy demo URL to clipboard", error);
      }
    }
  }

  function navigateIframe(path: string) {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: "navigate", path }, DEMO_URL);
    }
    if (iframeRef.current) {
      iframeRef.current.src = `${DEMO_URL}${path}`;
    }
  }

  const isFixed = mode !== "inline";

  return (
    <section className="px-4 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="relative mb-12 text-center">
          <div className="pointer-events-none absolute inset-y-[-1.5rem] left-1/2 w-[30rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
          <p className="relative mb-2 text-3xl font-bold tracking-tight text-neutral-400 line-through decoration-2 sm:text-4xl dark:text-neutral-600">
            Screenshots
          </p>
          <h2 className="relative mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
            See it in action!
          </h2>
          <p className="relative mx-auto max-w-2xl text-neutral-600 dark:text-neutral-400">
            Try the fully interactive demo below — real UI, real data*, no install required.
          </p>
        </div>

        {/* Action Buttons (inline only) */}
        {mode === "inline" && (
          <div className="mb-4 flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigateIframe("/config?tab=appearance")}>
              <Palette className="h-4 w-4" />
              Theme Editor
            </Button>
            <Button variant="outline" size="sm" onClick={openFullscreen}>
              <Maximize2 className="h-4 w-4" />
              Open fullscreen
            </Button>
          </div>
        )}

        {/* Placeholder keeps the page layout stable when iframe goes fixed */}
        {isFixed && (
          <div
            id="demo-placeholder"
            className="aspect-[16/10] rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900"
          />
        )}

        {/* Backdrop */}
        {isFixed && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close fullscreen demo"
            className={`fixed inset-0 z-40 cursor-default border-0 bg-black/50 p-0 transition-opacity duration-300 ${
              mode === "collapsing" ? "opacity-0" : "opacity-100"
            }`}
            onClick={closeFullscreen}
          />
        )}

        {/* Iframe container — animates between inline rect and fullscreen */}
        <div
          ref={containerRef}
          className={
            isFixed
              ? "fixed z-50 flex flex-col overflow-hidden bg-white shadow-2xl dark:bg-neutral-950"
              : "isolate overflow-hidden rounded-xl border border-neutral-200 bg-white/50 shadow-sm backdrop-blur-sm hover:shadow-lg hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-neutral-700"
          }
          style={isFixed ? { inset: mode === "fullscreen" ? "0" : undefined } : undefined}
        >
          {/* Fullscreen header */}
          {isFixed && (
            <div className="grid h-11 shrink-0 grid-cols-3 items-center border-b border-neutral-200 bg-white/80 px-4 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/80">
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Interactive Demo
              </span>

              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={shareDemo}>
                  <Share className="h-4 w-4" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => navigateIframe("/config?tab=appearance")}>
                  <Palette className="h-4 w-4" />
                  <span className="hidden sm:inline">Theme Editor</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={closeFullscreen}>
                  <X className="h-4 w-4" />
                  <span className="hidden sm:inline">Back to site</span>
                </Button>
              </div>
            </div>
          )}

          <div className={`relative ${isFixed ? "flex-1" : "aspect-[16/10] overflow-hidden"}`}>
            <iframe
              ref={iframeRef}
              src={DEMO_URL}
              title="Drydock Interactive Demo"
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              allow="clipboard-write"
              loading="lazy"
            />

            {/* Fallback when iframe is blocked */}
            {iframeStatus === "failed" && (
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
            )}
          </div>
        </div>

        {mode === "inline" && (
          <p className="mt-3 text-center text-xs text-neutral-400 dark:text-neutral-600">
            *Not real data
          </p>
        )}
      </div>
    </section>
  );
}
