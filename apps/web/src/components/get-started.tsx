"use client";

import { ShieldCheck, Terminal, TriangleAlert, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SectionHeading } from "@/components/section-heading";
import { SITE_CONFIG } from "@/lib/site-config";

type Preset = "quick" | "secure";

const PRESETS: { id: Preset; label: string; icon: typeof Zap }[] = [
  { id: "quick", label: "Quick", icon: Zap },
  { id: "secure", label: "Secure", icon: ShieldCheck },
];

/** Shared dark code-card chrome, matching DockerRunSnippet. */
function CodeCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
      <div className="px-6 pt-5">
        <div className="mb-3 flex items-center gap-2 text-neutral-500">
          <Terminal className="h-4 w-4" />
          <span className="font-mono text-xs font-medium uppercase tracking-wider">{label}</span>
        </div>
        <pre className="overflow-x-auto pb-6 text-sm leading-relaxed">{children}</pre>
      </div>
    </div>
  );
}

function QuickSnippet() {
  return (
    <CodeCard label="Quick start · docker run">
      <code className="text-neutral-300">
        <span className="text-neutral-500">$</span>{" "}
        <span className="text-[#C4FF00]">docker run</span> -d \{"\n"}
        {"  "}--name drydock \{"\n"}
        {"  "}-v /var/run/docker.sock:/var/run/docker.sock \{"\n"}
        {"  "}-p 3000:3000 \{"\n"}
        {"  "}
        {SITE_CONFIG.dockerImage}
      </code>
    </CodeCard>
  );
}

function SecureSnippet() {
  // Light YAML coloring: keys in sky, image/string values in lime, comments muted.
  const key = "text-sky-300";
  const val = "text-[#C4FF00]";
  const com = "text-neutral-600";
  return (
    <CodeCard label="Hardened · compose.yml">
      <code className="text-neutral-300">
        <span className={com}>
          # sockguard owns the real socket — Drydock only sees a scoped one
        </span>
        {"\n"}
        <span className={key}>services</span>:{"\n"}
        {"  "}
        <span className={key}>sockguard</span>:{"\n"}
        {"    "}
        <span className={key}>image</span>: <span className={val}>codeswhat/sockguard</span>
        {"\n"}
        {"    "}
        <span className={key}>restart</span>: unless-stopped{"\n"}
        {"    "}
        <span className={key}>volumes</span>:{"\n"}
        {"      "}- /var/run/docker.sock:/var/run/docker.sock:
        <span className={val}>ro</span>
        {"  "}
        <span className={com}># read-only</span>
        {"\n"}
        {"      "}- sockguard-socket:/var/run/sockguard{"\n"}
        {"    "}
        <span className={key}>environment</span>:{"\n"}
        {"      "}- SOCKGUARD_LISTEN_SOCKET=/var/run/sockguard/sockguard.sock{"\n"}
        {"\n"}
        {"  "}
        <span className={key}>drydock</span>:{"\n"}
        {"    "}
        <span className={key}>image</span>: <span className={val}>{SITE_CONFIG.dockerImage}</span>
        {"\n"}
        {"    "}
        <span className={key}>restart</span>: unless-stopped{"\n"}
        {"    "}
        <span className={key}>depends_on</span>: [sockguard]{"\n"}
        {"    "}
        <span className={key}>ports</span>: [<span className={val}>&quot;3000:3000&quot;</span>]
        {"\n"}
        {"    "}
        <span className={key}>volumes</span>:{"\n"}
        {"      "}- sockguard-socket:/var/run/sockguard:<span className={val}>ro</span>
        {"\n"}
        {"    "}
        <span className={key}>environment</span>:{"\n"}
        {"      "}
        <span className={com}># no raw docker.sock — just sockguard&apos;s scoped socket</span>
        {"\n"}
        {"      "}- DD_WATCHER_LOCAL_SOCKET=/var/run/sockguard/sockguard.sock{"\n"}
        {"\n"}
        <span className={key}>volumes</span>:{"\n"}
        {"  "}
        <span className={key}>sockguard-socket</span>:
      </code>
    </CodeCard>
  );
}

export function GetStarted() {
  const [preset, setPreset] = useState<Preset>("quick");

  return (
    <section className="border-t border-border/60 px-4 py-20">
      <div className="mx-auto max-w-3xl">
        <SectionHeading
          eyebrow="Get running"
          title="Get started in seconds"
          subtitle="One command to try it. One compose file to run it right."
          align="right"
        />

        {/* Segmented Quick / Secure toggle */}
        <div className="mb-5 flex justify-center">
          <div
            role="tablist"
            aria-label="Install preset"
            className="inline-flex gap-1 rounded-xl border border-neutral-200 bg-white/60 p-1 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/60"
            onKeyDown={(e) => {
              const currentIndex = PRESETS.findIndex((p) => p.id === preset);
              if (e.key === "ArrowRight") {
                e.preventDefault();
                setPreset(PRESETS[(currentIndex + 1) % PRESETS.length].id);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                setPreset(PRESETS[(currentIndex - 1 + PRESETS.length) % PRESETS.length].id);
              } else if (e.key === "Home") {
                e.preventDefault();
                setPreset(PRESETS[0].id);
              } else if (e.key === "End") {
                e.preventDefault();
                setPreset(PRESETS[PRESETS.length - 1].id);
              }
            }}
          >
            {PRESETS.map(({ id, label, icon: Icon }) => {
              const active = preset === id;
              return (
                <button
                  key={id}
                  id={`tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="preset-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => setPreset(id)}
                  className={[
                    "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div role="tabpanel" id="preset-panel" aria-labelledby={`tab-${preset}`}>
          {preset === "quick" ? <QuickSnippet /> : <SecureSnippet />}

          {/* Contextual note under the snippet */}
          <div className="mt-4 flex items-start justify-center gap-2 px-2 text-center text-sm">
            {preset === "quick" ? (
              <p className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
                <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
                Mounts the Docker socket directly — fine for a local try, not for production.
              </p>
            ) : (
              <p className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                Drydock never touches the raw socket.{" "}
                <Link
                  href="/docs/guides/security"
                  className="font-medium text-neutral-900 underline-offset-4 hover:underline dark:text-neutral-100"
                >
                  Hardening guide
                </Link>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
