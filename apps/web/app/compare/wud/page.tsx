import { Bell, Check, GitBranch, Network, Radio, RotateCcw, Shield } from "lucide-react";
import type { Metadata } from "next";
import { ComparisonPage, type ComparisonRow, type Highlight } from "@/components/comparison-page";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

export const metadata: Metadata = {
  title: "WUD vs Drydock — Container Update Monitoring Comparison",
  description:
    "Compare What's Up Docker (WUD) and Drydock for container update monitoring. Drydock is a WUD fork with security scanning, distributed agents, audit logging, rollback, and many more features.",
  keywords: [
    "wud vs drydock",
    "what's up docker vs drydock",
    "whats up docker alternative",
    "wud alternative",
    "wud docker",
    "container update monitoring",
    "docker container updater",
    "what's up docker replacement",
  ],
  openGraph: {
    title: "WUD vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare What's Up Docker (WUD) and Drydock. Drydock is a WUD fork with security scanning, agents, audit logging, and more.",
    url: `${baseUrl}/compare/wud`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "WUD vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare What's Up Docker (WUD) and Drydock. Drydock is a WUD fork with security scanning, agents, audit logging, and more.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare/wud`,
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
    competitor: "JavaScript",
    drydock: "TypeScript (full ESM)",
    verdict: "drydock",
  },
  {
    feature: "Web UI",
    competitor: "Yes",
    drydock: "Yes (redesigned)",
    verdict: "tie",
  },
  {
    feature: "Auto-update containers",
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
  },
  {
    feature: "Docker Compose updates",
    competitor: "Yes",
    drydock: "Yes, with multi-network support",
    verdict: "drydock",
  },
  {
    feature: "Registry providers",
    competitor: "8",
    drydock: "22",
    verdict: "drydock",
  },
  {
    feature: "Notifications",
    competitor: "14 triggers",
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
    competitor: "Yes",
    drydock: "Yes (expanded)",
    verdict: "drydock",
  },
  {
    feature: "Prometheus metrics",
    competitor: "Yes",
    drydock: "Yes + Grafana dashboard template",
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
    competitor: "None",
    drydock: "Pre-update backup with retention + auto rollback",
    verdict: "drydock",
  },
  {
    feature: "Container grouping",
    competitor: "Yes",
    drydock: "Yes (enhanced with batch actions)",
    verdict: "drydock",
  },
  {
    feature: "Lifecycle hooks",
    competitor: "None",
    drydock: "Pre/post-update shell commands",
    verdict: "drydock",
  },
  {
    feature: "Webhook API",
    competitor: "None",
    drydock: "Token-authenticated webhooks for CI/CD",
    verdict: "drydock",
  },
  {
    feature: "Container actions",
    competitor: "None",
    drydock: "Start/stop/restart from UI/API",
    verdict: "drydock",
  },
  {
    feature: "Distributed agents",
    competitor: "None",
    drydock: "SSE-based agent architecture",
    verdict: "drydock",
  },
  {
    feature: "Audit log",
    competitor: "None",
    drydock: "Yes, with REST API & Prometheus counter",
    verdict: "drydock",
  },
  {
    feature: "Semver-aware updates",
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
  },
  {
    feature: "Container log viewer",
    competitor: "None",
    drydock: "Yes, with level filtering & auto-fetch",
    verdict: "drydock",
  },
  {
    feature: "Test framework",
    competitor: "Jest",
    drydock: "Vitest 4",
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
    icon: GitBranch,
    title: "Fork & Evolve",
    description:
      "Drydock started as a WUD fork, then migrated to TypeScript, added security scanning, distributed agents, audit logging, and dozens of new features. It's WUD's foundation taken much further.",
  },
  {
    icon: Shield,
    title: "Security Scanning",
    description:
      "Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), cosign signature verification, and Update Guard to block vulnerable deploys. WUD has no security scanning.",
  },
  {
    icon: Network,
    title: "Distributed Agents",
    description:
      "Monitor remote Docker hosts via lightweight SSE-based agents with a centralized dashboard. WUD only monitors the local Docker socket.",
  },
  {
    icon: Radio,
    title: "22 Registry Providers",
    description:
      "14 more registries than WUD — including GAR, Harbor, Artifactory, Nexus, Alibaba Cloud, IBM Cloud, and Oracle Cloud.",
  },
  {
    icon: RotateCcw,
    title: "Rollback & Backup",
    description:
      "Pre-update image backups with configurable retention, dry-run preview, and automatic rollback on health check failure. None of these exist in WUD.",
  },
  {
    icon: Bell,
    title: "6 More Trigger Services",
    description:
      "Google Chat, Matrix, Mattermost, and Microsoft Teams (Adaptive Cards) plus enhanced configuration for existing triggers.",
  },
];

export default function WudComparison() {
  return (
    <ComparisonPage
      competitorName="WUD"
      heroTitle="WUD vs Drydock"
      heroDescription={
        <p>
          Drydock is a{" "}
          <strong className="text-neutral-900 dark:text-neutral-200">
            fork of What&apos;s Up Docker (WUD)
          </strong>{" "}
          that has evolved significantly — migrating to TypeScript, adding security scanning,
          distributed agents, audit logging, rollback, and 14 additional registry providers.
        </p>
      }
      competitorBadge={{
        icon: Check,
        label: "WUD — Active",
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
      migrationTitle="Coming from WUD?"
      migrationDescription="Drydock is a direct WUD fork, so migration is straightforward. Your existing Docker socket mount works as-is. You'll get the same monitoring capabilities plus security scanning, agents, audit log, and a modernized UI."
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "WUD vs Drydock — Container Update Monitoring Comparison",
        description: "Compare What's Up Docker (WUD) and Drydock for container update monitoring.",
        url: `${baseUrl}/compare/wud`,
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
