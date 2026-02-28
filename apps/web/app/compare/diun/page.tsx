import { Bell, Check, Layers, Monitor, Radio, RotateCcw, Shield } from "lucide-react";
import type { Metadata } from "next";
import { ComparisonPage, type ComparisonRow, type Highlight } from "@/components/comparison-page";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

export const metadata: Metadata = {
  title: "Diun vs Drydock — Container Update Monitoring Comparison",
  description:
    "Compare Diun (Docker Image Update Notifier) and Drydock for container update monitoring. See how Drydock adds a full web UI, auto-updates, security scanning, and 22 registry integrations beyond Diun's notification-only approach.",
  keywords: [
    "diun vs drydock",
    "diun alternative",
    "docker image update notifier",
    "diun docker",
    "container update monitoring",
    "docker container updater",
    "diun replacement",
  ],
  openGraph: {
    title: "Diun vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Diun and Drydock for container update monitoring. See how Drydock adds a full web UI, auto-updates, security scanning, and more.",
    url: `${baseUrl}/compare/diun`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Diun vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Diun and Drydock for container update monitoring. See how Drydock adds a full web UI, auto-updates, security scanning, and more.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare/diun`,
  },
};

const comparisonData: ComparisonRow[] = [
  {
    feature: "Project status",
    competitor: "Actively maintained",
    drydock: "Actively maintained",
    verdict: "tie",
  },
  {
    feature: "Language",
    competitor: "Go",
    drydock: "TypeScript",
    verdict: "tie",
  },
  {
    feature: "Web UI",
    competitor: "None (CLI / daemon)",
    drydock: "Full dashboard",
    verdict: "drydock",
  },
  {
    feature: "Auto-update containers",
    competitor: "No (notify only)",
    drydock: "Yes (optional)",
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
    competitor: "17 services",
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
    competitor: "Limited",
    drydock: "Full REST API",
    verdict: "drydock",
  },
  {
    feature: "Prometheus metrics",
    competitor: "No",
    drydock: "Full /metrics endpoint + Grafana template",
    verdict: "drydock",
  },
  {
    feature: "MQTT / Home Assistant",
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
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
    competitor: "Yes (Docker, Swarm, K8s)",
    drydock: "SSE-based agent architecture",
    verdict: "tie",
  },
  {
    feature: "Kubernetes support",
    competitor: "Yes",
    drydock: "Planned (v2.0.0)",
    verdict: "competitor",
  },
  {
    feature: "Semver-aware updates",
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
  },
  {
    feature: "Audit log",
    competitor: "No",
    drydock: "Yes, with REST API",
    verdict: "drydock",
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
      "Diun is a CLI daemon with no built-in UI. Drydock provides a full web dashboard for browsing containers, viewing update status, triggering actions, and inspecting logs — all from the browser.",
  },
  {
    icon: Layers,
    title: "Auto-Update Containers",
    description:
      "Diun is notification-only — it tells you about updates but can't apply them. Drydock can monitor and notify, but also optionally pull images and recreate containers via Docker Compose.",
  },
  {
    icon: Shield,
    title: "Security Scanning",
    description:
      "Drydock integrates Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), and cosign signature verification. Diun has no security scanning capabilities.",
  },
  {
    icon: Radio,
    title: "22 Registry Integrations",
    description:
      "Drydock has dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more. Diun relies on Docker credential configuration.",
  },
  {
    icon: RotateCcw,
    title: "Rollback & Backup",
    description:
      "Pre-update image backups with configurable retention and automatic rollback on health check failure. Diun can't update containers, so rollback isn't applicable.",
  },
  {
    icon: Bell,
    title: "Audit Trail & Observability",
    description:
      "Full audit log with REST API, Prometheus /metrics endpoint with Grafana dashboard template. Diun has no built-in metrics or audit trail.",
  },
];

export default function DiunComparison() {
  return (
    <ComparisonPage
      competitorName="Diun"
      heroTitle="Diun vs Drydock"
      heroDescription={
        <p>
          Diun (Docker Image Update Notifier) is a lightweight notification tool. Drydock builds on
          the same monitoring concept but adds a{" "}
          <strong className="text-neutral-900 dark:text-neutral-200">
            full web UI, auto-updates, security scanning
          </strong>
          , and comprehensive container management capabilities.
        </p>
      }
      competitorBadge={{
        icon: Check,
        label: "Diun — Active",
        className:
          "bg-blue-100 px-3 py-1 text-sm text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
      }}
      drydockBadge={{
        icon: Check,
        label: "Drydock — Active",
        className:
          "bg-emerald-100 px-3 py-1 text-sm text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400",
      }}
      comparisonData={comparisonData}
      highlights={highlights}
      migrationTitle="Coming from Diun?"
      migrationDescription="If you're using Diun for notifications, Drydock can do the same — plus give you a full dashboard, auto-updates, security scanning, and container management. One Docker command to get started."
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Diun vs Drydock — Container Update Monitoring Comparison",
        description: "Compare Diun and Drydock for container update monitoring.",
        url: `${baseUrl}/compare/diun`,
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
