import { Bell, History, Lock, Network, Radio, RotateCcw } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const dockhandComparisonRouteData = {
  slug: "dockhand",
  comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|Svelte + TypeScript (Bun)|TypeScript|tie
Web UI|Yes|Yes|tie
Image update detection|Yes|Yes|tie
Auto-update containers|Yes|Yes (monitor-first)|tie
Vulnerability scanning|Yes (Safe-Pull Protection)|Yes (Trivy + SBOM + cosign)|tie
Automatic rollback|No|Yes, on health check failure|self
Maintenance windows|No|Yes|self
Lifecycle hooks (pre/post)|No|Yes, with timeout & abort|self
Image backup|No|Pre-update backup with retention|self
Dry-run preview|No|Yes|self
Registry providers|Major registries|23 dedicated integrations|self
Notifications|SMTP, Gotify, ntfy, Pushover, Telegram, Mattermost, Teams, Bark, Signal, Apprise passthrough (80+ services)|20 native trigger integrations|self
MQTT / Home Assistant|No|Yes|self
Distributed agents|Yes (headless agents)|Yes (SSE-based agents)|tie
OIDC / SSO|Yes|Yes (Authelia, Auth0, Authentik)|tie
Prometheus metrics|Planned|Full /metrics endpoint + Grafana template|self
Audit log|Activity log (free); compliance audit log (Enterprise only)|Yes, free (REST API)|self
Git-based stack deployment|Yes|Planned|competitor
Web terminal / shell|Yes|Planned|competitor
File browser|Yes|Planned|competitor
Secret management|Planned|Planned (free)|tie
License|BSL 1.1 (source-available; converts to Apache 2.0 in 2029)|AGPL-3.0|self
`,
  highlightsTable: `
rotate|Update Safety Controls|Automatic rollback on health check failure, maintenance windows, lifecycle hooks, and dry-run preview. Dockhand's safe-pull protection rolls back if a new container fails to start, but doesn't support proactive health-check rollback, maintenance windows, or lifecycle hooks.
radio|23 Registry Providers|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more — broader registry support than Dockhand.
bell|20 Trigger Integrations|Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, Kafka, Gotify, NTFY, and more. Dockhand offers SMTP, Gotify, ntfy, Telegram, and several others, plus Apprise passthrough. Drydock's 20 native integrations include Kafka, MQTT/Home Assistant, and Matrix out of the box without needing an Apprise server.
history|Free Audit Log|Full audit trail with REST API and Prometheus counter — included free. Dockhand includes a basic activity log in the free tier, but compliance-grade audit logging requires the Enterprise edition.
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
