import {
  ComparisonPage,
  type ComparisonRow,
  type Highlight,
} from "@/components/comparison-page";
import {
  Archive,
  Bell,
  Check,
  Eye,
  Monitor,
  Radio,
  RotateCcw,
  Shield,
} from "lucide-react";
import type { Metadata } from "next";

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

export const metadata: Metadata = {
  title: "Ouroboros vs Drydock — Container Update Monitoring Comparison",
  description:
    "Compare Ouroboros and Drydock for container update monitoring. Ouroboros is no longer maintained — see how Drydock provides a modern, actively maintained alternative with a full UI, security scanning, and more.",
  keywords: [
    "ouroboros vs drydock",
    "ouroboros alternative",
    "ouroboros replacement",
    "ouroboros docker",
    "container update monitoring",
    "docker container updater",
    "ouroboros archived",
    "pyouroboros",
  ],
  openGraph: {
    title: "Ouroboros vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Ouroboros and Drydock for container update monitoring. Ouroboros is no longer maintained — see how Drydock provides a modern alternative.",
    url: `${baseUrl}/compare/ouroboros`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ouroboros vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Ouroboros and Drydock for container update monitoring. Ouroboros is no longer maintained — see how Drydock provides a modern alternative.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare/ouroboros`,
  },
};

const comparisonData: ComparisonRow[] = [
  {
    feature: "Project status",
    competitor: "Unmaintained (since ~2020)",
    drydock: "Actively maintained",
    verdict: "drydock",
  },
  {
    feature: "Language",
    competitor: "Python",
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
    feature: "Auto-update containers",
    competitor: "Yes",
    drydock: "Yes (optional, monitor-first)",
    verdict: "drydock",
  },
  {
    feature: "Docker Compose updates",
    competitor: "No",
    drydock: "Yes, pull & recreate",
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
    competitor: "~6 services",
    drydock: "20 native trigger integrations",
    verdict: "drydock",
  },
  {
    feature: "Security scanning",
    competitor: "None",
    drydock: "Trivy + SBOM + cosign verification",
    verdict: "drydock",
  },
  {
    feature: "OIDC authentication",
    competitor: "None",
    drydock: "Authelia, Auth0, Authentik",
    verdict: "drydock",
  },
  {
    feature: "REST API",
    competitor: "None",
    drydock: "Full REST API",
    verdict: "drydock",
  },
  {
    feature: "Prometheus metrics",
    competitor: "Basic",
    drydock: "Full /metrics endpoint + Grafana template",
    verdict: "drydock",
  },
  {
    feature: "Image backup & rollback",
    competitor: "No",
    drydock: "Pre-update backup with retention + auto rollback",
    verdict: "drydock",
  },
  {
    feature: "Container grouping",
    competitor: "No",
    drydock: "Smart stack detection with batch actions",
    verdict: "drydock",
  },
  {
    feature: "Lifecycle hooks",
    competitor: "No",
    drydock: "Pre/post-update shell commands",
    verdict: "drydock",
  },
  {
    feature: "Webhook API",
    competitor: "No",
    drydock: "Token-authenticated webhooks for CI/CD",
    verdict: "drydock",
  },
  {
    feature: "Container actions",
    competitor: "No",
    drydock: "Start/stop/restart from UI/API",
    verdict: "drydock",
  },
  {
    feature: "Distributed agents",
    competitor: "No",
    drydock: "SSE-based agent architecture",
    verdict: "drydock",
  },
  {
    feature: "Audit log",
    competitor: "No",
    drydock: "Yes, with REST API",
    verdict: "drydock",
  },
  {
    feature: "Semver-aware updates",
    competitor: "No",
    drydock: "Yes",
    verdict: "drydock",
  },
  {
    feature: "Digest watching",
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
  },
  {
    feature: "Multi-arch (amd64/arm64)",
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
  },
  {
    feature: "License",
    competitor: "MIT",
    drydock: "AGPL-3.0",
    verdict: "tie",
  },
];

const highlights: Highlight[] = [
  {
    icon: Monitor,
    title: "Full Web Dashboard",
    description:
      "Ouroboros is CLI-only with no built-in UI. Drydock ships with a full web dashboard for browsing containers, viewing update status, triggering actions, and inspecting logs.",
  },
  {
    icon: Eye,
    title: "Monitor-First Design",
    description:
      "Ouroboros auto-pulls and restarts containers with no preview option. Drydock is monitor-first by design — it detects updates and notifies you, with dry-run preview before any changes.",
  },
  {
    icon: Shield,
    title: "Security Scanning",
    description:
      "Drydock integrates Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), and cosign image signature verification. Ouroboros has no security scanning.",
  },
  {
    icon: Radio,
    title: "22 Registry Integrations",
    description:
      "Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more — far beyond Ouroboros's Docker-config-based approach.",
  },
  {
    icon: RotateCcw,
    title: "Rollback & Backup",
    description:
      "Pre-update image backups with configurable retention and automatic rollback on health check failure. Ouroboros has no rollback or backup mechanism.",
  },
  {
    icon: Bell,
    title: "20 Notification Services",
    description:
      "Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, HTTP webhooks, Gotify, NTFY, and more — compared to Ouroboros's ~6 notification options.",
  },
];

export default function OuroborosComparison() {
  return (
    <ComparisonPage
      competitorName="Ouroboros"
      heroTitle="Ouroboros vs Drydock"
      heroDescription={
        <p>
          Ouroboros was a popular Python-based container updater, but it has
          been{" "}
          <strong className="text-neutral-900 dark:text-neutral-200">
            unmaintained since around 2020
          </strong>
          . Drydock offers a modern, actively maintained alternative with a full
          web UI, security scanning, and comprehensive container management.
        </p>
      }
      competitorBadge={{
        icon: Archive,
        label: "Ouroboros — Unmaintained",
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
      migrationTitle="Coming from Ouroboros?"
      migrationDescription="Ouroboros hasn't been updated in years. Drydock gives you the same auto-update capability plus a full dashboard, security scanning, rollback, and much more. One Docker command to get started."
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Ouroboros vs Drydock — Container Update Monitoring Comparison",
        description:
          "Compare Ouroboros and Drydock for container update monitoring. Ouroboros is no longer maintained.",
        url: `${baseUrl}/compare/ouroboros`,
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
