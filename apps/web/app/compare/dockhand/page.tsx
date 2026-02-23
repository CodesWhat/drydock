import {
  ComparisonPage,
  type ComparisonRow,
  type Highlight,
} from "@/components/comparison-page";
import {
  Bell,
  Check,
  History,
  Lock,
  Network,
  Radio,
  RotateCcw,
} from "lucide-react";
import type { Metadata } from "next";

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

export const metadata: Metadata = {
  title: "Dockhand vs Drydock — Container Update Monitoring Comparison",
  description:
    "Compare Dockhand and Drydock for container update monitoring. See how Drydock's 22 registries, 20 notification triggers, automatic rollback, and distributed agents compare to Dockhand's approach.",
  keywords: [
    "dockhand vs drydock",
    "dockhand alternative",
    "dockhand docker",
    "container update monitoring",
    "docker container updater",
    "dockhand replacement",
  ],
  openGraph: {
    title: "Dockhand vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Dockhand and Drydock for container update monitoring. Both offer update detection with web UIs — see how their feature sets differ.",
    url: `${baseUrl}/compare/dockhand`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dockhand vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Dockhand and Drydock for container update monitoring.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare/dockhand`,
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
    feature: "Vulnerability scanning",
    competitor: "Yes (Update Guard)",
    drydock: "Yes (Trivy + SBOM + cosign)",
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
    feature: "Dry-run preview",
    competitor: "No",
    drydock: "Yes",
    verdict: "drydock",
  },
  {
    feature: "Registry providers",
    competitor: "Major registries",
    drydock: "22 dedicated integrations",
    verdict: "drydock",
  },
  {
    feature: "Notifications",
    competitor: "Email, Gotify, Ntfy, webhooks, Apprise",
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
    feature: "Distributed agents",
    competitor: "Yes (headless agents)",
    drydock: "Yes (SSE-based agents)",
    verdict: "tie",
  },
  {
    feature: "OIDC / SSO",
    competitor: "Yes",
    drydock: "Yes (Authelia, Auth0, Authentik)",
    verdict: "tie",
  },
  {
    feature: "Prometheus metrics",
    competitor: "Planned",
    drydock: "Full /metrics endpoint + Grafana template",
    verdict: "drydock",
  },
  {
    feature: "Audit log",
    competitor: "Enterprise only",
    drydock: "Yes, free (REST API)",
    verdict: "drydock",
  },
  {
    feature: "Git-based stack deployment",
    competitor: "Yes",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "Web terminal / shell",
    competitor: "Yes",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "File browser",
    competitor: "Yes",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "Secret management",
    competitor: "Enterprise only",
    drydock: "Planned (free)",
    verdict: "tie",
  },
  {
    feature: "License",
    competitor: "Apache 2.0 / Proprietary (EE)",
    drydock: "AGPL-3.0",
    verdict: "drydock",
  },
];

const highlights: Highlight[] = [
  {
    icon: RotateCcw,
    title: "Update Safety Controls",
    description:
      "Automatic rollback on health check failure, maintenance windows, lifecycle hooks, and dry-run preview. Dockhand can scan and update but lacks these safety primitives for production deployments.",
  },
  {
    icon: Radio,
    title: "22 Registry Providers",
    description:
      "Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more — broader registry support than Dockhand.",
  },
  {
    icon: Bell,
    title: "20 Notification Services",
    description:
      "Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, Kafka, Gotify, NTFY, and more. Dockhand's notification options are more limited out of the box.",
  },
  {
    icon: History,
    title: "Free Audit Log",
    description:
      "Full audit trail with REST API and Prometheus counter — included free. Dockhand's audit logging is gated behind the Enterprise edition.",
  },
  {
    icon: Network,
    title: "SSE-Based Agents",
    description:
      "Both tools support distributed monitoring. Drydock uses SSE-based agents for real-time communication with a centralized dashboard.",
  },
  {
    icon: Lock,
    title: "Fully Open Source",
    description:
      "Every Drydock feature is free and open source. Dockhand gates audit logs, secret management, and some features behind an Enterprise tier.",
  },
];

export default function DockhandComparison() {
  return (
    <ComparisonPage
      competitorName="Dockhand"
      heroTitle="Dockhand vs Drydock"
      heroDescription={
        <p>
          Dockhand and Drydock are both container update tools with web UIs and
          security scanning. Drydock adds{" "}
          <strong className="text-neutral-900 dark:text-neutral-200">
            automatic rollback, maintenance windows, lifecycle hooks
          </strong>
          , and broader registry and notification coverage — all free and open
          source.
        </p>
      }
      competitorBadge={{
        icon: Check,
        label: "Dockhand — Active",
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
      migrationTitle="Considering Dockhand?"
      migrationDescription="Both are solid choices. If you want update safety controls (rollback, maintenance windows, hooks) and the broadest registry and notification coverage — all free — Drydock is built for that. One Docker command to get started."
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Dockhand vs Drydock — Container Update Monitoring Comparison",
        description:
          "Compare Dockhand and Drydock for container update monitoring.",
        url: `${baseUrl}/compare/dockhand`,
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
