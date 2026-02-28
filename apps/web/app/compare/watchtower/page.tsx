import { Archive, Check, Eye, Monitor, Network, Radio, RotateCcw, Shield } from "lucide-react";
import type { Metadata } from "next";
import { ComparisonPage, type ComparisonRow, type Highlight } from "@/components/comparison-page";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

export const metadata: Metadata = {
  title: "Watchtower vs Drydock — Container Update Monitoring Comparison",
  description:
    "Compare Watchtower and Drydock for container update monitoring. Watchtower was archived Dec 2025 — see how Drydock provides a modern, actively maintained alternative with a full UI, 22 registries, security scanning, and more.",
  keywords: [
    "watchtower vs drydock",
    "watchtower alternative",
    "watchtower replacement",
    "watchtower archived",
    "container update monitoring",
    "docker container updater",
    "watchtower docker alternative",
    "containrrr watchtower",
  ],
  openGraph: {
    title: "Watchtower vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Watchtower and Drydock for container update monitoring. Watchtower was archived Dec 2025 — see how Drydock provides a modern, actively maintained alternative.",
    url: `${baseUrl}/compare/watchtower`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Watchtower vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Watchtower and Drydock for container update monitoring. Watchtower was archived Dec 2025 — see how Drydock provides a modern, actively maintained alternative.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare/watchtower`,
  },
};

const comparisonData: ComparisonRow[] = [
  {
    feature: "Project status",
    competitor: "Archived (Dec 2025)",
    drydock: "Actively maintained",
    verdict: "drydock",
  },
  {
    feature: "Language",
    competitor: "Go",
    drydock: "TypeScript",
    verdict: "tie",
  },
  {
    feature: "Web UI",
    competitor: "None (CLI only)",
    drydock: "Full dashboard",
    verdict: "drydock",
  },
  {
    feature: "Update approach",
    competitor: "Auto-pulls & restarts",
    drydock: "Monitor + notify (optional update)",
    verdict: "drydock",
  },
  {
    feature: "Monitor-only mode",
    competitor: "Flag exists but unreliable",
    drydock: "Core design — monitor-first",
    verdict: "drydock",
  },
  {
    feature: "Dry-run preview",
    competitor: "No",
    drydock: "Yes",
    verdict: "drydock",
  },
  {
    feature: "Registry support",
    competitor: "Docker Hub + private via Docker config",
    drydock: "22 dedicated registry integrations",
    verdict: "drydock",
  },
  {
    feature: "Notifications",
    competitor: "Via Shoutrrr (~18 services)",
    drydock: "20 native trigger integrations",
    verdict: "tie",
  },
  {
    feature: "Security scanning",
    competitor: "None",
    drydock: "Trivy + SBOM + cosign verification",
    verdict: "drydock",
  },
  {
    feature: "Per-container scheduling",
    competitor: "No",
    drydock: "Yes (per-watcher CRON)",
    verdict: "drydock",
  },
  {
    feature: "Include/exclude patterns",
    competitor: "Labels only",
    drydock: "Labels, regex, image sets",
    verdict: "drydock",
  },
  {
    feature: "Distributed/remote hosts",
    competitor: "Limited",
    drydock: "SSE-based agent architecture",
    verdict: "drydock",
  },
  {
    feature: "Prometheus metrics",
    competitor: "Basic",
    drydock: "Full /metrics endpoint + Grafana template",
    verdict: "drydock",
  },
  {
    feature: "Audit log",
    competitor: "No",
    drydock: "Yes, with REST API",
    verdict: "drydock",
  },
  {
    feature: "Auto rollback",
    competitor: "No",
    drydock: "Yes, on health check failure",
    verdict: "drydock",
  },
  {
    feature: "Authentication",
    competitor: "None",
    drydock: "OIDC (Authelia, Auth0, Authentik)",
    verdict: "drydock",
  },
  {
    feature: "Container actions",
    competitor: "Restart only (via update)",
    drydock: "Start/stop/restart from UI/API",
    verdict: "drydock",
  },
  {
    feature: "Docker Compose updates",
    competitor: "Limited",
    drydock: "Full compose pull & recreate",
    verdict: "drydock",
  },
  {
    feature: "Lifecycle hooks",
    competitor: "Yes",
    drydock: "Yes (pre/post-update)",
    verdict: "tie",
  },
  {
    feature: "Image backup",
    competitor: "No",
    drydock: "Pre-update backup with retention",
    verdict: "drydock",
  },
  {
    feature: "Webhook API",
    competitor: "HTTP API mode",
    drydock: "Token-authenticated webhooks",
    verdict: "drydock",
  },
  {
    feature: "License",
    competitor: "Apache 2.0",
    drydock: "AGPL-3.0",
    verdict: "tie",
  },
];

const highlights: Highlight[] = [
  {
    icon: Monitor,
    title: "Full Web Dashboard",
    description:
      "Watchtower is CLI-only with no built-in UI. Drydock ships with a full web dashboard for browsing containers, viewing update status, triggering actions, and inspecting logs — no terminal required.",
  },
  {
    icon: Eye,
    title: "Monitor-First Design",
    description:
      "Watchtower's default behavior auto-pulls and restarts containers, which can be risky in production. Drydock is monitor-first by design — it detects updates and notifies you, with optional dry-run preview before any changes are applied.",
  },
  {
    icon: Shield,
    title: "Security Scanning",
    description:
      "Drydock integrates Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), and cosign image signature verification. Watchtower has no security scanning capabilities.",
  },
  {
    icon: Network,
    title: "Distributed Architecture",
    description:
      "Monitor remote Docker hosts via lightweight SSE-based agents with a centralized dashboard. Watchtower is limited to the local Docker socket or basic remote connections.",
  },
  {
    icon: Radio,
    title: "22 Registry Integrations",
    description:
      "Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, LSCR, ACR, Harbor, Artifactory, Nexus, and more — rather than relying on Docker's credential config.",
  },
  {
    icon: RotateCcw,
    title: "Rollback & Backup",
    description:
      "Pre-update image backups with configurable retention and automatic rollback on health check failure. Watchtower has no rollback or backup mechanism.",
  },
];

export default function WatchtowerComparison() {
  return (
    <ComparisonPage
      competitorName="Watchtower"
      heroTitle="Watchtower vs Drydock"
      heroDescription={
        <p>
          Watchtower served the Docker community well for years. With its{" "}
          <strong className="text-neutral-900 dark:text-neutral-200">
            archival in December 2025
          </strong>
          , Drydock offers an actively maintained alternative with a modern UI, security scanning,
          and monitor-first design.
        </p>
      }
      competitorBadge={{
        icon: Archive,
        label: "Watchtower — Archived",
        className:
          "bg-neutral-200 px-3 py-1 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
      }}
      drydockBadge={{
        icon: Check,
        label: "Drydock — Actively Maintained",
        className:
          "bg-emerald-100 px-3 py-1 text-sm text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400",
      }}
      comparisonData={comparisonData}
      highlights={highlights}
      migrationTitle="Coming from Watchtower?"
      migrationDescription="Drydock takes a different approach than Watchtower — it's monitor-first rather than update-first. This means you get visibility into what's available before anything changes. Getting started takes one Docker command, and you can have the dashboard running in under a minute."
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Watchtower vs Drydock — Container Update Monitoring Comparison",
        description:
          "Compare Watchtower and Drydock for container update monitoring. Watchtower was archived Dec 2025.",
        url: `${baseUrl}/compare/watchtower`,
        mainEntity: {
          "@type": "SoftwareApplication",
          name: "Drydock",
          url: baseUrl,
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Docker",
          license: "https://opensource.org/licenses/AGPL-3.0",
        },
      }}
    />
  );
}
