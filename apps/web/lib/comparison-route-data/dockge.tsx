import { Bell, Eye, Network, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const dockgeComparisonRouteData = {
  slug: "dockge",
  comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|TypeScript|TypeScript|tie
Web UI|Yes|Yes|tie
Primary focus|Compose stack management|Container update monitoring|tie
Image update detection|No|Yes, across 23 registries|drydock
Auto-update containers|No|Yes (optional, monitor-first)|drydock
Notifications on updates|No|20 native trigger integrations|drydock
Security scanning|No|Trivy + SBOM + cosign verification|drydock
Automatic rollback|No|Yes, on health check failure|drydock
Image backup|No|Pre-update backup with retention|drydock
Prometheus metrics|No|Full /metrics endpoint + Grafana template|drydock
OIDC authentication|No|Authelia, Auth0, Authentik|drydock
Distributed agents|No|SSE-based agent architecture|drydock
Audit log|No|Yes, with REST API|drydock
Compose file editing|Yes (visual editor)|No (compose updates only)|competitor
Docker run → compose|Yes|No|competitor
Multi-language (i18n)|Yes (15+ languages)|Planned|competitor
Container start/stop/restart|Yes|Yes|tie
Container grouping / stacks|Yes|Yes (auto-detected)|tie
Dark/light theme|Yes|Yes|tie
License|MIT|AGPL-3.0|tie
`,
  highlightsTable: `
eye|Image Update Detection|Dockge manages compose stacks but doesn't check for image updates. Drydock continuously monitors 23 registries and notifies you when new versions are available.
shield|Security Scanning|Trivy vulnerability scanning, SBOM generation, and cosign signature verification before any update is applied. Dockge has no security scanning.
rotate|Safe Update Pipeline|Dry-run preview, pre-update backup, automatic rollback on health check failure, and maintenance windows. Dockge lets you manually update stacks but has no safety controls.
bell|20 Notification Services|Get notified about available updates via Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, and more. Dockge has no notification system.
network|Distributed Monitoring|Monitor remote Docker hosts via SSE-based agents with a centralized dashboard. Dockge manages only the local Docker instance.
radio|23 Registry Integrations|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more. Dockge doesn't query registries at all.
`,
  highlightIconMap: {
    eye: Eye,
    shield: Shield,
    rotate: RotateCcw,
    bell: Bell,
    network: Network,
    radio: Radio,
  },
  metadataTitle: "Dockge vs Drydock — Docker Compose & Container Update Comparison",
  metadataDescription:
    "Compare Dockge and Drydock for Docker container management. Dockge manages compose stacks, Drydock monitors and updates container images — see how they complement each other or which fits your needs.",
  metadataKeywords: [
    "dockge vs drydock",
    "dockge alternative",
    "dockge docker",
    "docker compose manager",
    "container update monitoring",
    "dockge replacement",
    "dockge container updates",
  ],
  openGraphDescription:
    "Compare Dockge and Drydock for Docker container management. See how compose management and update monitoring compare.",
  twitterDescription:
    "Compare Dockge and Drydock for Docker container management. See how compose management and update monitoring compare.",
  competitorName: "Dockge",
  heroTitle: "Dockge vs Drydock",
  heroDescription: (
    <p>
      Dockge is a popular compose stack manager. Drydock focuses on{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">
        container update monitoring and safe auto-updates
      </strong>
      . They solve different problems and can work well side-by-side — Dockge for managing compose
      files, Drydock for tracking and applying image updates.
    </p>
  ),
  migrationTitle: "Using Dockge?",
  migrationDescription:
    "Drydock and Dockge complement each other well. Use Dockge to manage your compose files and Drydock to monitor for image updates and apply them safely. One Docker command to add Drydock to your stack.",
  jsonLdName: "Dockge vs Drydock — Docker Compose & Container Update Comparison",
  jsonLdDescription: "Compare Dockge and Drydock for Docker container management.",
} satisfies ComparisonRouteRawConfig;
