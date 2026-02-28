import { Bell, Check, Eye, Lock, Radio, RotateCcw, Shield } from "lucide-react";
import type { Metadata } from "next";
import { ComparisonPage, type ComparisonRow, type Highlight } from "@/components/comparison-page";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

export const metadata: Metadata = {
  title: "Portainer vs Drydock — Container Update Monitoring Comparison",
  description:
    "Compare Portainer and Drydock for container update monitoring. Portainer is a full container management platform — see how Drydock's focused update monitoring with rollback, security scanning, and 22 registries offers a lightweight alternative.",
  keywords: [
    "portainer vs drydock",
    "portainer alternative",
    "portainer replacement",
    "portainer free alternative",
    "container update monitoring",
    "portainer open source alternative",
    "portainer docker alternative",
  ],
  openGraph: {
    title: "Portainer vs Drydock — Container Update Monitoring Comparison",
    description:
      "Compare Portainer and Drydock for container update monitoring. See how focused update monitoring compares to a full management platform.",
    url: `${baseUrl}/compare/portainer`,
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Portainer vs Drydock — Container Update Monitoring Comparison",
    description: "Compare Portainer and Drydock for container update monitoring.",
    creator: "@codeswhat",
  },
  alternates: {
    canonical: `${baseUrl}/compare/portainer`,
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
    feature: "Pricing",
    competitor: "Free CE / Paid BE ($$$)",
    drydock: "Free, AGPL-3.0 licensed",
    verdict: "drydock",
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
    feature: "Image backup & dry-run",
    competitor: "No",
    drydock: "Pre-update backup + dry-run preview",
    verdict: "drydock",
  },
  {
    feature: "Security scanning",
    competitor: "Yes (BE only — paid)",
    drydock: "Trivy + SBOM + cosign (free)",
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
    competitor: "Slack, Teams (BE only)",
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
    feature: "Grafana dashboard",
    competitor: "No",
    drydock: "Yes, importable template",
    verdict: "drydock",
  },
  {
    feature: "OIDC / SSO",
    competitor: "Yes",
    drydock: "Yes (Authelia, Auth0, Authentik)",
    verdict: "tie",
  },
  {
    feature: "RBAC",
    competitor: "Yes (BE only)",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "Kubernetes support",
    competitor: "Yes",
    drydock: "Planned (v2.0.0)",
    verdict: "competitor",
  },
  {
    feature: "Docker Swarm",
    competitor: "Yes",
    drydock: "Planned (v2.0.0)",
    verdict: "competitor",
  },
  {
    feature: "Web terminal / shell",
    competitor: "Yes",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "Compose templates",
    competitor: "Yes",
    drydock: "Planned",
    verdict: "competitor",
  },
  {
    feature: "Audit log",
    competitor: "Yes (BE only)",
    drydock: "Yes (free)",
    verdict: "drydock",
  },
  {
    feature: "Resource footprint",
    competitor: "Heavy (~200MB+ RAM)",
    drydock: "Lightweight (~80MB RAM)",
    verdict: "drydock",
  },
  {
    feature: "License",
    competitor: "Zlib (CE) / Proprietary (BE)",
    drydock: "AGPL-3.0",
    verdict: "drydock",
  },
];

const highlights: Highlight[] = [
  {
    icon: RotateCcw,
    title: "Update Safety Controls",
    description:
      "Automatic rollback on health check failure, maintenance windows, lifecycle hooks, and dry-run preview. Portainer can update containers but has none of these safety primitives.",
  },
  {
    icon: Shield,
    title: "Free Security Scanning",
    description:
      "Trivy vulnerability scanning, SBOM generation, and cosign verification — all free and open source. Portainer's security features require the paid Business Edition.",
  },
  {
    icon: Lock,
    title: "No Paywall",
    description:
      "Every Drydock feature is free and open source. Portainer gates security scanning, audit logs, RBAC, and most notification integrations behind the paid Business Edition.",
  },
  {
    icon: Bell,
    title: "20 Notification Services",
    description:
      "Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, Kafka, Gotify, NTFY, and more — all free. Portainer CE has very limited notification options.",
  },
  {
    icon: Radio,
    title: "22 Registry Integrations",
    description:
      "Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more with per-registry configuration.",
  },
  {
    icon: Eye,
    title: "Lightweight & Focused",
    description:
      "Drydock uses ~80MB RAM and focuses on doing update monitoring well. Portainer is a full management platform that uses significantly more resources.",
  },
];

export default function PortainerComparison() {
  return (
    <ComparisonPage
      competitorName="Portainer"
      heroTitle="Portainer vs Drydock"
      heroDescription={
        <p>
          Portainer is a full container management platform with a broad feature set. Drydock is a{" "}
          <strong className="text-neutral-900 dark:text-neutral-200">
            focused, lightweight update monitor
          </strong>{" "}
          with safety controls that Portainer lacks — automatic rollback, maintenance windows,
          lifecycle hooks, and free security scanning.
        </p>
      }
      competitorBadge={{
        icon: Check,
        label: "Portainer — Active",
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
      migrationTitle="Using Portainer?"
      migrationDescription="Drydock can run alongside Portainer. Use Portainer for general container management and Drydock for update monitoring with safety controls, security scanning, and broad notification support — all without a paid tier."
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Portainer vs Drydock — Container Update Monitoring Comparison",
        description: "Compare Portainer and Drydock for container update monitoring.",
        url: `${baseUrl}/compare/portainer`,
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
