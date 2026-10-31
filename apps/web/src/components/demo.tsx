"use client";

import { ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEMO_URL, SITE_CONFIG } from "@/lib/site-config";
import { isDemoReadyMessage } from "@/lib/website-behavior.mjs";

const views = [
  { label: "Dashboard", path: "/" },
  { label: "Containers", path: "/containers" },
  { label: "Security", path: "/security" },
];

type Status = "loading" | "ready" | "failed";

function LiveDemoFrame({
  url,
  onStatus,
  ready,
}: {
  url: string;
  onStatus: (status: Status) => void;
  ready: boolean;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    function ready(event: MessageEvent) {
      if (isDemoReadyMessage(event, iframe.current?.contentWindow, url)) {
        window.clearTimeout(timeout);
        onStatus("ready");
      }
    }
    const timeout = window.setTimeout(() => onStatus("failed"), 20000);
    window.addEventListener("message", ready);
    return () => {
      window.removeEventListener("message", ready);
      window.clearTimeout(timeout);
    };
  }, [url, onStatus]);
  return (
    <iframe
      ref={iframe}
      src={url}
      inert={!ready}
      aria-hidden={!ready}
      tabIndex={ready ? 0 : -1}
      title={`${SITE_CONFIG.name} interactive demo`}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      allow="clipboard-write; fullscreen"
      onError={() => onStatus("failed")}
    />
  );
}

export function Demo() {
  const [view, setView] = useState(views[0]);
  const [status, setStatus] = useState<Status>("loading");
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const section = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFullscreenAvailable(Boolean(document.fullscreenEnabled));
    function changed() {
      setFullscreen(document.fullscreenElement === frame.current);
    }
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  useEffect(() => {
    if (!section.current || !("IntersectionObserver" in window)) {
      setEnabled(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setEnabled(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(section.current);
    return () => observer.disconnect();
  }, []);

  function navigate(next: (typeof views)[number]) {
    setView(next);
    setStatus("loading");
    setAttempt((previous) => previous + 1);
    setEnabled(true);
  }

  async function toggleFullscreen() {
    setFullscreenError("");
    try {
      if (document.fullscreenElement === frame.current) await document.exitFullscreen();
      else await frame.current?.requestFullscreen();
    } catch {
      setFullscreenError(
        "Fullscreen is unavailable in this browser. You can open the full demo below.",
      );
    }
  }

  const url = `${DEMO_URL.replace(/\/$/, "")}${view.path}`;

  return (
    <section id="demo" ref={section} className="website-demo" aria-labelledby="demo-heading">
      <div className="website-wrap">
        <div className="website-demo-heading">
          <h2 id="demo-heading">See it in action</h2>
          <p>The real Drydock interface, running live with sample data. No install required.</p>
        </div>
        <div ref={frame} className={`website-demo-frame${fullscreen ? " is-fullscreen" : ""}`}>
          <div className="website-demo-bar">
            <span>{new URL(DEMO_URL).hostname}</span>
            <span role="status" aria-live="polite">
              {status === "ready"
                ? "Live demo"
                : status === "failed"
                  ? "Couldn’t connect"
                  : "Loading demo…"}
            </span>
            {fullscreenAvailable ? (
              <button type="button" onClick={() => void toggleFullscreen()}>
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                {fullscreen ? "Exit fullscreen" : "Fullscreen"}
              </button>
            ) : null}
          </div>
          <fieldset className="website-demo-views" aria-label="Demo view">
            {views.map((item) => (
              <button
                key={item.path}
                type="button"
                aria-pressed={view.path === item.path}
                onClick={() => navigate(item)}
              >
                {item.label}
              </button>
            ))}
          </fieldset>
          <div className="website-demo-slot">
            {enabled ? (
              <LiveDemoFrame
                key={attempt}
                url={url}
                onStatus={setStatus}
                ready={status === "ready"}
              />
            ) : null}
            {status !== "ready" ? (
              <div className="website-demo-state">
                <p>
                  {status === "failed"
                    ? "The live demo couldn’t load in this browser."
                    : "Connecting to the live demo…"}
                </p>
                {status === "failed" ? (
                  <button type="button" onClick={() => navigate(view)}>
                    Try again
                  </button>
                ) : null}
                <a href={url} target="_blank" rel="noopener noreferrer">
                  Open demo directly
                </a>
              </div>
            ) : null}
          </div>
        </div>
        <p role="status" className="website-demo-footnote">
          {fullscreenError}
        </p>
        <p className="website-demo-footnote">
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open the full demo <ExternalLink size={12} className="inline" />
          </a>
          . Sample data resets in your browser; this is the same UI shipped with Drydock.
        </p>
      </div>
    </section>
  );
}
