import { Bell, History, Lock, Network, Radio, RotateCcw } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const dockhandComparisonRouteData = {
  slug: "dockhand",
  comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|Go|TypeScript|tie
Web UI|Yes|Yes|tie
Image update detection|Yes|Yes|tie
Auto-update containers|Yes|Yes (monitor-first)|tie
Vulnerability scanning|Yes (🥊 Update Bouncer)|Yes (Trivy + SBOM + cosign)|tie
Automatic rollback|No|Yes, on health check failure|drydock
Maintenance windows|No|Yes|drydock
Lifecycle hooks (pre/post)|No|Yes, with timeout & abort|drydock
Image backup|No|Pre-update backup with retention|drydock
Dry-run preview|No|Yes|drydock
Registry providers|Major registries|23 dedicated integrations|drydock
Notifications|Email, Gotify, Ntfy, webhooks, Apprise|20 native trigger integrations|drydock
MQTT / Home Assistant|No|Yes|drydock
Distributed agents|Yes (headless agents)|Yes (SSE-based agents)|tie
OIDC / SSO|Yes|Yes (Authelia, Auth0, Authentik)|tie
Prometheus metrics|Planned|Full /metrics endpoint + Grafana template|drydock
Audit log|Enterprise only|Yes, free (REST API)|drydock
Git-based stack deployment|Yes|Planned|competitor
Web terminal / shell|Yes|Planned|competitor
File browser|Yes|Planned|competitor
Secret management|Enterprise only|Planned (free)|tie
License|Apache 2.0 / Proprietary (EE)|AGPL-3.0|drydock
`,
  highlightsTable: `
rotate|Update Safety Controls|Automatic rollback on health check failure, maintenance windows, lifecycle hooks, and dry-run preview. Dockhand can scan and update but lacks these safety primitives for production deployments.
radio|23 Registry Providers|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more — broader registry support than Dockhand.
bell|20 Notification Services|Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, Kafka, Gotify, NTFY, and more. Dockhand's notification options are more limited out of the box.
history|Free Audit Log|Full audit trail with REST API and Prometheus counter — included free. Dockhand's audit logging is gated behind the Enterprise edition.
network|SSE-Based Agents|Both tools support distributed monitoring. Drydock uses SSE-based agents for real-time communication with a centralized dashboard.
lock|Fully Open Source|Every Drydock feature is free and open source. Dockhand gates audit logs, secret management, and some features behind an Enterprise tier.
`,
  highlightIconMap: {
    rotate: RotateCcw,
    radio: Radio,
    bell: Bell,
    history: History,
    network: Network,
    lock: Lock,
  },
  metadataTitle: "Dockhand vs Drydock — Container Update Monitoring Comparison",
  metadataDescription:
    "Compare Dockhand and Drydock for container update monitoring. See how Drydock's 23 registries, 20 notification triggers, automatic rollback, and distributed agents compare to Dockhand's approach.",
  metadataKeywords: [
    "dockhand vs drydock",
    "dockhand alternative",
    "dockhand docker",
    "container update monitoring",
    "docker container updater",
    "dockhand replacement",
  ],
  openGraphDescription:
    "Compare Dockhand and Drydock for container update monitoring. Both offer update detection with web UIs — see how their feature sets differ.",
  twitterDescription: "Compare Dockhand and Drydock for container update monitoring.",
  competitorName: "Dockhand",
  heroTitle: "Dockhand vs Drydock",
  heroDescription: (
    <p>
      Dockhand and Drydock are both container update tools with web UIs and security scanning.
      Drydock adds{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">
        automatic rollback, maintenance windows, lifecycle hooks
      </strong>
      , and broader registry and notification coverage — all free and open source.
    </p>
  ),
  migrationTitle: "Considering Dockhand?",
  migrationDescription:
    "Both are solid choices. If you want update safety controls (rollback, maintenance windows, hooks) and the broadest registry and notification coverage — all free — Drydock is built for that. One Docker command to get started.",
  jsonLdName: "Dockhand vs Drydock — Container Update Monitoring Comparison",
  jsonLdDescription: "Compare Dockhand and Drydock for container update monitoring.",
} satisfies ComparisonRouteRawConfig;
