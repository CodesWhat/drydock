import {
  ComparisonPage,
  type ComparisonRow,
  type Highlight,
} from "@/components/comparison-page";
import { Bell, Check, Eye, Lock, Radio, RotateCcw, Shield } from "lucide-react";
import type { Metadata } from "next";

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

export const metadata: Metadata = {
  title: "Komodo vs Drydock — Container Update Monitoring Comparison",
  description:
    "Compare Komodo and Drydock for container management and update monitoring. See how Drydock's update-safety features — auto rollback, maintenance windows, lifecycle hooks — complement Komodo's broader DevOps platform.",
  keywords: [
    "komodo vs drydock",
    "komodo alternative",
    "komodo docker",
    "container update monitoring",
    "docker container updater",
    "komodo replacement",
    "komo.do alternative",
  ],
  openGraph: {
    title: "Komodo vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Komodo and Drydock for container management and update monitoring. See how their feature sets differ.",
    url: `${baseUrl}/compare/komodo`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Komodo vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Komodo and Drydock for container management and update monitoring.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare/komodo`,
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
    competitor: "Rust + TypeScript",
    drydock: "TypeScript",
    verdict: "tie",
  },
  {
    feature: "Web UI",
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
  },
  {
    feature: "Image update detection",
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
  },
  {
    feature: "Auto-update containers",
    competitor: "Yes",
    drydock: "Yes (monitor-first)",
    verdict: "tie",
  },
  {
    feature: "Automatic rollback",
    competitor: "No",
    drydock: "Yes, on health check failure",
    verdict: "drydock",
  },
  {
    feature: "Maintenance windows",
    competitor: "No",
    drydock: "Yes",
    verdict: "drydock",
  },
  {
    feature: "Lifecycle hooks (pre/post)",
    competitor: "No",
    drydock: "Yes, with timeout & abort",
    verdict: "drydock",
  },
  {
    feature: "Image backup",
    competitor: "No",
    drydock: "Pre-update backup with retention",
    verdict: "drydock",
  },
  {
    feature: "Security scanning (Trivy)",
    competitor: "No",
    drydock: "Trivy + SBOM + cosign verification",
    verdict: "drydock",
  },
  {
    feature: "Registry providers",
    competitor: "Limited",
    drydock: "22 dedicated integrations",
    verdict: "drydock",
  },
  {
    feature: "Notification services",
    competitor: "Slack, Discord, webhooks",
    drydock: "20 native trigger integrations",
    verdict: "drydock",
  },
  {
    feature: "MQTT / Home Assistant",
    competitor: "No",
    drydock: "Yes",
    verdict: "drydock",
  },
  {
    feature: "OIDC / SSO",
    competitor: "Yes",
    drydock: "Yes (Authelia, Auth0, Authentik)",
    verdict: "tie",
  },
  {
    feature: "Passkey / TOTP 2FA",
    competitor: "Yes",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "CI/CD pipelines",
    competitor: "Yes",
    drydock: "No (webhook API for CI/CD)",
    verdict: "competitor",
  },
  {
    feature: "TypeScript scripting",
    competitor: "Yes (Actions)",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "TOML GitOps config",
    competitor: "Yes",
    drydock: "Planned (YAML)",
    verdict: "competitor",
  },
  {
    feature: "CLI tool",
    competitor: "Yes",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "Prometheus metrics",
    competitor: "No",
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
    feature: "Dry-run preview",
    competitor: "No",
    drydock: "Yes",
    verdict: "drydock",
  },
  {
    feature: "License",
    competitor: "GPL-3.0",
    drydock: "AGPL-3.0",
    verdict: "tie",
  },
];

const highlights: Highlight[] = [
  {
    icon: RotateCcw,
    title: "Update Safety Controls",
    description:
      "Drydock is the only tool with automatic rollback on health check failure, maintenance windows, and pre/post-update lifecycle hooks. Komodo can update containers but lacks these safety primitives.",
  },
  {
    icon: Shield,
    title: "Security Scanning",
    description:
      "Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), and cosign image signature verification — built-in. Komodo has no integrated security scanning.",
  },
  {
    icon: Eye,
    title: "Dry-Run Preview",
    description:
      "Preview exactly what an update will do before applying it, with pre-update image backups and configurable retention. Komodo applies updates immediately with no preview step.",
  },
  {
    icon: Radio,
    title: "22 Registry Providers",
    description:
      "Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more. Komodo supports fewer registries out of the box.",
  },
  {
    icon: Bell,
    title: "20 Notification Services",
    description:
      "Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, Kafka, Gotify, NTFY, and more. Komodo's notification options are more limited.",
  },
  {
    icon: Lock,
    title: "Fully Open Source",
    description:
      "Every Drydock feature is free and open source. Both Drydock (AGPL-3.0) and Komodo (GPL-3.0) use copyleft licenses.",
  },
];

export default function KomodoComparison() {
  return (
    <ComparisonPage
      competitorName="Komodo"
      heroTitle="Komodo vs Drydock"
      heroDescription={
        <p>
          Komodo is a broad DevOps platform with CI/CD, GitOps, and container
          management. Drydock focuses specifically on{" "}
          <strong className="text-neutral-900 dark:text-neutral-200">
            safe container update monitoring
          </strong>{" "}
          with rollback, maintenance windows, security scanning, and the widest
          registry and notification coverage.
        </p>
      }
      competitorBadge={{
        icon: Check,
        label: "Komodo — Active",
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
      migrationTitle="Considering Komodo?"
      migrationDescription="Komodo and Drydock serve different needs. If you want safe, monitored container updates with rollback and security scanning, Drydock is purpose-built for that. One Docker command to get started."
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Komodo vs Drydock — Container Update Monitoring Comparison",
        description:
          "Compare Komodo and Drydock for container management and update monitoring.",
        url: `${baseUrl}/compare/komodo`,
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
