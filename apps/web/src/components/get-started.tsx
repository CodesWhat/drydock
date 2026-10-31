"use client";

import { ShieldCheck, Terminal, TriangleAlert, Zap } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SectionHeading } from "@/components/section-heading";
import { TrackedLink } from "@/components/tracked-link";
import { captureCta } from "@/lib/analytics";
import { SITE_CONFIG } from "@/lib/site-config";

type Preset = "quick" | "secure";

const PRESETS: { id: Preset; label: string; icon: typeof Zap }[] = [
  { id: "quick", label: "Quick", icon: Zap },
  { id: "secure", label: "Secure", icon: ShieldCheck },
];

/** Shared dark code-card chrome, matching DockerRunSnippet. */
function CodeCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[4px] border border-[var(--dd-border-strong)] website-install-code">
      <div className="px-6 pt-5">
        <div className="mb-3 flex items-center gap-2 text-[var(--tx-sec)]">
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
      <code className="text-[#abb2bf]">
        <span className="text-[#8f97a8]">$</span> <span className="text-[#98c379]">docker run</span>{" "}
        -d \{"\n"}
        {"  "}--name drydock \{"\n"}
        {"  "}-v /var/run/docker.sock:/var/run/docker.sock \{"\n"}
        {"  "}-v drydock-store:/store \{"\n"}
        {"  "}-e DD_ANONYMOUS_AUTH_CONFIRM=true \{"\n"}
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
  const val = "text-[#98c379]";
  const com = "text-[#8f97a8]";
  return (
    <CodeCard label="Hardened · compose.yml">
      <code className="text-[#abb2bf]">
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
        {"      "}- drydock-store:/store{"\n"}
        {"    "}
        <span className={key}>environment</span>:{"\n"}
        {"      "}
        <span className={com}># no raw docker.sock — just sockguard&apos;s scoped socket</span>
        {"\n"}
        {"      "}- DD_WATCHER_LOCAL_SOCKET=/var/run/sockguard/sockguard.sock{"\n"}
        {"      "}- DD_AUTH_BASIC_ADMIN_USER=admin{"\n"}
        {"      "}
        <span className={com}>
          # double each $ in the hash as $$ so Compose does not interpolate it
        </span>
        {"\n"}
        {"      "}- DD_AUTH_BASIC_ADMIN_HASH=&lt;paste-argon2id-hash&gt;{"\n"}
        {"\n"}
        <span className={key}>volumes</span>:{"\n"}
        {"  "}
        <span className={key}>sockguard-socket</span>:{"\n"}
        {"  "}
        <span className={key}>drydock-store</span>:
      </code>
    </CodeCard>
  );
}

export function GetStarted() {
  const [preset, setPreset] = useState<Preset>("quick");
  const pathname = usePathname();

  const activatePreset = (id: Preset) => {
    setPreset(id);
    document.getElementById(`tab-${id}`)?.focus();
    captureCta(pathname, `install_${id}`, "get_started");
  };

  return (
    <section id="get-started" className="website-section website-section--compact">
      <div className="website-wrap">
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
            className="inline-flex gap-1 rounded-[4px] border border-[var(--dd-border-strong)] bg-[var(--dd-bg-card)] p-1"
            onKeyDown={(e) => {
              const currentIndex = PRESETS.findIndex((p) => p.id === preset);
              if (e.key === "ArrowRight") {
                e.preventDefault();
                activatePreset(PRESETS[(currentIndex + 1) % PRESETS.length].id);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                activatePreset(PRESETS[(currentIndex - 1 + PRESETS.length) % PRESETS.length].id);
              } else if (e.key === "Home") {
                e.preventDefault();
                activatePreset(PRESETS[0].id);
              } else if (e.key === "End") {
                e.preventDefault();
                activatePreset(PRESETS[PRESETS.length - 1].id);
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
                  onClick={() => activatePreset(id)}
                  className={[
                    "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-[var(--dd-primary)] text-[var(--dd-primary-fg)]"
                      : "text-[var(--tx-sec)] hover:text-[var(--dd-text)] dark:text-[var(--tx-sec)] dark:hover:text-[var(--tx-sec)]",
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
              <p className="flex items-center gap-2 text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
                Mounts the Docker socket directly — fine for a local try, not for production.
              </p>
            ) : (
              <p className="flex items-center gap-2 text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                Drydock never touches the raw socket.{" "}
                <TrackedLink
                  href="/docs/guides/security"
                  ctaId="docs_security"
                  placement="get_started"
                  className="font-medium text-[var(--dd-text)] underline-offset-4 hover:underline dark:text-[var(--dd-text)]"
                >
                  Hardening guide
                </TrackedLink>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
