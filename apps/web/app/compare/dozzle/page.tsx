import {
  ComparisonPage,
  type ComparisonRow,
  type Highlight,
} from "@/components/comparison-page";
import { Bell, Check, Eye, Radio, RotateCcw, Shield } from "lucide-react";
import type { Metadata } from "next";

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

export const metadata: Metadata = {
  title:
    "Dozzle vs Drydock — Container Log Viewer & Update Monitoring Comparison",
  description:
    "Compare Dozzle and Drydock for Docker container management. Dozzle is a real-time log viewer, Drydock monitors container updates — see how they complement each other or which fits your needs.",
  keywords: [
    "dozzle vs drydock",
    "dozzle alternative",
    "dozzle docker",
    "docker log viewer",
    "container update monitoring",
    "dozzle replacement",
    "dozzle container updates",
  ],
  openGraph: {
    title:
      "Dozzle vs Drydock — Container Log Viewer & Update Monitoring Comparison",
    description:
      "Compare Dozzle and Drydock for Docker container management. See how log viewing and update monitoring compare.",
    url: `${baseUrl}/compare/dozzle`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title:
      "Dozzle vs Drydock — Container Log Viewer & Update Monitoring Comparison",
    description: "Compare Dozzle and Drydock for Docker container management.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare/dozzle`,
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
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
  },
  {
    feature: "Primary focus",
    competitor: "Real-time log viewing",
    drydock: "Container update monitoring",
    verdict: "tie",
  },
  {
    feature: "Image update detection",
    competitor: "No",
    drydock: "Yes, across 22 registries",
    verdict: "drydock",
  },
  {
    feature: "Auto-update containers",
    competitor: "No",
    drydock: "Yes (optional, monitor-first)",
    verdict: "drydock",
  },
  {
    feature: "Security scanning",
    competitor: "No",
    drydock: "Trivy + SBOM + cosign verification",
    verdict: "drydock",
  },
  {
    feature: "Automatic rollback",
    competitor: "No",
    drydock: "Yes, on health check failure",
    verdict: "drydock",
  },
  {
    feature: "Image backup",
    competitor: "No",
    drydock: "Pre-update backup with retention",
    verdict: "drydock",
  },
  {
    feature: "Notifications",
    competitor: "Slack, Discord, Ntfy, webhooks",
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
    feature: "Log viewer",
    competitor: "Advanced (SQL, split-screen, regex)",
    drydock: "Basic (level filtering, auto-fetch)",
    verdict: "competitor",
  },
  {
    feature: "Log analytics / SQL",
    competitor: "Yes",
    drydock: "No",
    verdict: "competitor",
  },
  {
    feature: "Resource monitoring",
    competitor: "Yes (CPU, memory)",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "Multi-host agents",
    competitor: "Yes",
    drydock: "Yes (SSE-based)",
    verdict: "tie",
  },
  {
    feature: "Container start/stop/restart",
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
  },
  {
    feature: "OIDC authentication",
    competitor: "No",
    drydock: "Yes (Authelia, Auth0, Authentik)",
    verdict: "drydock",
  },
  {
    feature: "RBAC",
    competitor: "Yes",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "Docker Swarm",
    competitor: "Yes",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "Kubernetes",
    competitor: "Yes",
    drydock: "Planned (v2.0.0)",
    verdict: "competitor",
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
    icon: Eye,
    title: "Image Update Detection",
    description:
      "Dozzle is a log viewer — it doesn't monitor for image updates. Drydock continuously checks 22 registries and notifies you when new versions are available.",
  },
  {
    icon: Shield,
    title: "Security Scanning",
    description:
      "Trivy vulnerability scanning, SBOM generation, and cosign signature verification before updates are applied. Dozzle has no security capabilities.",
  },
  {
    icon: RotateCcw,
    title: "Safe Update Pipeline",
    description:
      "Dry-run preview, pre-update backup, automatic rollback on health check failure, and maintenance windows. Dozzle doesn't manage container updates at all.",
  },
  {
    icon: Bell,
    title: "20 Notification Services",
    description:
      "Get notified about available updates via Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, and more. Dozzle's notifications are limited to log-based alerts.",
  },
  {
    icon: Radio,
    title: "22 Registry Integrations",
    description:
      "Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more.",
  },
  {
    icon: RotateCcw,
    title: "Works Great Together",
    description:
      "Dozzle for deep log analysis and Drydock for update monitoring — they solve different problems and can run side-by-side in your Docker stack.",
  },
];

export default function DozzleComparison() {
  return (
    <ComparisonPage
      competitorName="Dozzle"
      heroTitle="Dozzle vs Drydock"
      heroDescription={
        <p>
          Dozzle is a best-in-class real-time log viewer. Drydock focuses on{" "}
          <strong className="text-neutral-900 dark:text-neutral-200">
            container update monitoring and safe auto-updates
          </strong>
          . They solve different problems and work well together — Dozzle for
          log analysis, Drydock for keeping containers up-to-date.
        </p>
      }
      competitorBadge={{
        icon: Check,
        label: "Dozzle — Active",
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
      migrationTitle="Using Dozzle?"
      migrationDescription="Drydock and Dozzle are complementary tools. Use Dozzle for real-time log viewing and Drydock for monitoring container updates, applying them safely, and getting notified across 20 services. One Docker command to add Drydock."
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Dozzle vs Drydock — Container Log Viewer & Update Monitoring Comparison",
        description:
          "Compare Dozzle and Drydock for Docker container management.",
        url: `${baseUrl}/compare/dozzle`,
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
