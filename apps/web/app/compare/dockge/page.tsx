import {
  ComparisonPage,
  type ComparisonRow,
  type Highlight,
} from "@/components/comparison-page";
import {
  Bell,
  Check,
  Eye,
  Network,
  Radio,
  RotateCcw,
  Shield,
} from "lucide-react";
import type { Metadata } from "next";

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

export const metadata: Metadata = {
  title: "Dockge vs Drydock — Docker Compose & Container Update Comparison",
  description:
    "Compare Dockge and Drydock for Docker container management. Dockge manages compose stacks, Drydock monitors and updates container images — see how they complement each other or which fits your needs.",
  keywords: [
    "dockge vs drydock",
    "dockge alternative",
    "dockge docker",
    "docker compose manager",
    "container update monitoring",
    "dockge replacement",
    "dockge container updates",
  ],
  openGraph: {
    title: "Dockge vs Drydock — Docker Compose & Container Update Comparison",
    description:
      "Compare Dockge and Drydock for Docker container management. See how compose management and update monitoring compare.",
    url: `${baseUrl}/compare/dockge`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dockge vs Drydock — Docker Compose & Container Update Comparison",
    description:
      "Compare Dockge and Drydock for Docker container management. See how compose management and update monitoring compare.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare/dockge`,
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
    competitor: "TypeScript",
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
    competitor: "Compose stack management",
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
    feature: "Notifications on updates",
    competitor: "No",
    drydock: "20 native trigger integrations",
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
    feature: "Prometheus metrics",
    competitor: "No",
    drydock: "Full /metrics endpoint + Grafana template",
    verdict: "drydock",
  },
  {
    feature: "OIDC authentication",
    competitor: "No",
    drydock: "Authelia, Auth0, Authentik",
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
    feature: "Compose file editing",
    competitor: "Yes (visual editor)",
    drydock: "No (compose updates only)",
    verdict: "competitor",
  },
  {
    feature: "Docker run → compose",
    competitor: "Yes",
    drydock: "No",
    verdict: "competitor",
  },
  {
    feature: "Multi-language (i18n)",
    competitor: "Yes (15+ languages)",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "Container start/stop/restart",
    competitor: "Yes",
    drydock: "Yes",
    verdict: "tie",
  },
  {
    feature: "Container grouping / stacks",
    competitor: "Yes",
    drydock: "Yes (auto-detected)",
    verdict: "tie",
  },
  {
    feature: "Dark/light theme",
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
    icon: Eye,
    title: "Image Update Detection",
    description:
      "Dockge manages compose stacks but doesn't check for image updates. Drydock continuously monitors 22 registries and notifies you when new versions are available.",
  },
  {
    icon: Shield,
    title: "Security Scanning",
    description:
      "Trivy vulnerability scanning, SBOM generation, and cosign signature verification before any update is applied. Dockge has no security scanning.",
  },
  {
    icon: RotateCcw,
    title: "Safe Update Pipeline",
    description:
      "Dry-run preview, pre-update backup, automatic rollback on health check failure, and maintenance windows. Dockge lets you manually update stacks but has no safety controls.",
  },
  {
    icon: Bell,
    title: "20 Notification Services",
    description:
      "Get notified about available updates via Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, and more. Dockge has no notification system.",
  },
  {
    icon: Network,
    title: "Distributed Monitoring",
    description:
      "Monitor remote Docker hosts via SSE-based agents with a centralized dashboard. Dockge manages only the local Docker instance.",
  },
  {
    icon: Radio,
    title: "22 Registry Integrations",
    description:
      "Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more. Dockge doesn't query registries at all.",
  },
];

export default function DockgeComparison() {
  return (
    <ComparisonPage
      competitorName="Dockge"
      heroTitle="Dockge vs Drydock"
      heroDescription={
        <p>
          Dockge is a popular compose stack manager. Drydock focuses on{" "}
          <strong className="text-neutral-900 dark:text-neutral-200">
            container update monitoring and safe auto-updates
          </strong>
          . They solve different problems and can work well side-by-side —
          Dockge for managing compose files, Drydock for tracking and applying
          image updates.
        </p>
      }
      competitorBadge={{
        icon: Check,
        label: "Dockge — Active",
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
      migrationTitle="Using Dockge?"
      migrationDescription="Drydock and Dockge complement each other well. Use Dockge to manage your compose files and Drydock to monitor for image updates and apply them safely. One Docker command to add Drydock to your stack."
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Dockge vs Drydock — Docker Compose & Container Update Comparison",
        description:
          "Compare Dockge and Drydock for Docker container management.",
        url: `${baseUrl}/compare/dockge`,
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
