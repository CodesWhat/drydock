import { Bell, Eye, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const dozzleComparisonRouteData = {
  slug: "dozzle",
  comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|Go|TypeScript|tie
Web UI|Yes|Yes|tie
Primary focus|Real-time log viewing|Container update monitoring|tie
Image update detection|No|Yes, across 23 registries|drydock
Auto-update containers|No|Yes (optional, monitor-first)|drydock
Security scanning|No|Trivy + SBOM + cosign verification|drydock
Automatic rollback|No|Yes, on health check failure|drydock
Image backup|No|Pre-update backup with retention|drydock
Notifications|Slack, Discord, Ntfy, webhooks|20 native trigger integrations|drydock
MQTT / Home Assistant|No|Yes|drydock
Prometheus metrics|No|Full /metrics endpoint + Grafana template|drydock
Audit log|No|Yes, with REST API|drydock
Log viewer|Advanced (SQL, split-screen, regex)|Basic (level filtering, auto-fetch)|competitor
Log analytics / SQL|Yes|No|competitor
Resource monitoring|Yes (CPU, memory)|Planned|competitor
Multi-host agents|Yes|Yes (SSE-based)|tie
Container start/stop/restart|Yes|Yes|tie
OIDC authentication|No|Yes (Authelia, Auth0, Authentik)|drydock
RBAC|Yes|Planned|competitor
Docker Swarm|Yes|Planned|competitor
Kubernetes|Yes|Planned (v2.0.0)|competitor
License|Apache 2.0|AGPL-3.0|tie
`,
  highlightsTable: `
eye|Image Update Detection|Dozzle is a log viewer — it doesn't monitor for image updates. Drydock continuously checks 23 registries and notifies you when new versions are available.
shield|Security Scanning|Trivy vulnerability scanning, SBOM generation, and cosign signature verification before updates are applied. Dozzle has no security capabilities.
rotate|Safe Update Pipeline|Dry-run preview, pre-update backup, automatic rollback on health check failure, and maintenance windows. Dozzle doesn't manage container updates at all.
bell|20 Notification Services|Get notified about available updates via Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, and more. Dozzle's notifications are limited to log-based alerts.
radio|23 Registry Integrations|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more.
rotate|Works Great Together|Dozzle for deep log analysis and Drydock for update monitoring — they solve different problems and can run side-by-side in your Docker stack.
`,
  highlightIconMap: {
    eye: Eye,
    shield: Shield,
    rotate: RotateCcw,
    bell: Bell,
    radio: Radio,
  },
  metadataTitle: "Dozzle vs Drydock — Container Log Viewer & Update Monitoring Comparison",
  metadataDescription:
    "Compare Dozzle and Drydock for Docker container management. Dozzle is a real-time log viewer, Drydock monitors container updates — see how they complement each other or which fits your needs.",
  metadataKeywords: [
    "dozzle vs drydock",
    "dozzle alternative",
    "dozzle docker",
    "docker log viewer",
    "container update monitoring",
    "dozzle replacement",
    "dozzle container updates",
  ],
  openGraphDescription:
    "Compare Dozzle and Drydock for Docker container management. See how log viewing and update monitoring compare.",
  twitterDescription: "Compare Dozzle and Drydock for Docker container management.",
  competitorName: "Dozzle",
  heroTitle: "Dozzle vs Drydock",
  heroDescription: (
    <p>
      Dozzle is a best-in-class real-time log viewer. Drydock focuses on{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">
        container update monitoring and safe auto-updates
      </strong>
      . They solve different problems and work well together — Dozzle for log analysis, Drydock for
      keeping containers up-to-date.
    </p>
  ),
  migrationTitle: "Using Dozzle?",
  migrationDescription:
    "Drydock and Dozzle are complementary tools. Use Dozzle for real-time log viewing and Drydock for monitoring container updates, applying them safely, and getting notified across 20 services. One Docker command to add Drydock.",
  jsonLdName: "Dozzle vs Drydock — Container Log Viewer & Update Monitoring Comparison",
  jsonLdDescription: "Compare Dozzle and Drydock for Docker container management.",
} satisfies ComparisonRouteRawConfig;
