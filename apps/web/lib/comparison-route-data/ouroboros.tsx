import { Archive, Bell, Check, Eye, Monitor, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const ouroborosComparisonRouteData = {
  slug: "ouroboros",
  comparisonTable: `
Project status|Unmaintained (since ~2020)|Actively maintained|drydock
Language|Python|TypeScript|tie
Web UI|None (CLI only)|Full dashboard|drydock
Auto-update containers|Yes|Yes (optional, monitor-first)|drydock
Docker Compose updates|No|Yes, pull & recreate|drydock
Registry support|Docker Hub + private via Docker config|23 dedicated registry integrations|drydock
Notifications|~6 services|20 native trigger integrations|drydock
Security scanning|None|Trivy + SBOM + cosign verification|drydock
OIDC authentication|None|Authelia, Auth0, Authentik|drydock
REST API|None|Full REST API|drydock
Prometheus metrics|Basic|Full /metrics endpoint + Grafana template|drydock
Image backup & rollback|No|Pre-update backup with retention + auto rollback|drydock
Container grouping|No|Smart stack detection with batch actions|drydock
Lifecycle hooks|No|Pre/post-update shell commands|drydock
Webhook API|No|Token-authenticated webhooks for CI/CD|drydock
Container actions|No|Start/stop/restart from UI/API|drydock
Distributed agents|No|SSE-based agent architecture|drydock
Audit log|No|Yes, with REST API|drydock
Semver-aware updates|No|Yes|drydock
Digest watching|Yes|Yes|tie
Multi-arch (amd64/arm64)|Yes|Yes|tie
License|MIT|AGPL-3.0|tie
`,
  highlightsTable: `
monitor|Full Web Dashboard|Ouroboros is CLI-only with no built-in UI. Drydock ships with a full web dashboard for browsing containers, viewing update status, triggering actions, and inspecting logs.
eye|Monitor-First Design|Ouroboros auto-pulls and restarts containers with no preview option. Drydock is monitor-first by design — it detects updates and notifies you, with dry-run preview before any changes.
shield|Security Scanning|Drydock integrates Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), and cosign image signature verification. Ouroboros has no security scanning.
radio|23 Registry Integrations|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more — far beyond Ouroboros's Docker-config-based approach.
rotate|Rollback & Backup|Pre-update image backups with configurable retention and automatic rollback on health check failure. Ouroboros has no rollback or backup mechanism.
bell|20 Notification Services|Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, HTTP webhooks, Gotify, NTFY, and more — compared to Ouroboros's ~6 notification options.
`,
  highlightIconMap: {
    monitor: Monitor,
    eye: Eye,
    shield: Shield,
    radio: Radio,
    rotate: RotateCcw,
    bell: Bell,
  },
  metadataTitle: "Ouroboros vs Drydock — Container Update Monitoring Comparison",
  metadataDescription:
    "Compare Ouroboros and Drydock for container update monitoring. Ouroboros is no longer maintained — see how Drydock provides a modern, actively maintained alternative with a full UI, security scanning, and more.",
  metadataKeywords: [
    "ouroboros vs drydock",
    "ouroboros alternative",
    "ouroboros replacement",
    "ouroboros docker",
    "container update monitoring",
    "docker container updater",
    "ouroboros archived",
    "pyouroboros",
  ],
  openGraphDescription:
    "Compare Ouroboros and Drydock for container update monitoring. Ouroboros is no longer maintained — see how Drydock provides a modern alternative.",
  twitterDescription:
    "Compare Ouroboros and Drydock for container update monitoring. Ouroboros is no longer maintained — see how Drydock provides a modern alternative.",
  competitorName: "Ouroboros",
  heroTitle: "Ouroboros vs Drydock",
  heroDescription: (
    <p>
      Ouroboros was a popular Python-based container updater, but it has been{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">
        unmaintained since around 2020
      </strong>
      . Drydock offers a modern, actively maintained alternative with a full web UI, security
      scanning, and comprehensive container management.
    </p>
  ),
  competitorBadge: {
    icon: Archive,
    label: "Ouroboros — Unmaintained",
    className:
      "bg-neutral-200 px-3 py-1 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  },
  drydockBadge: {
    icon: Check,
    label: "Drydock — Actively Maintained",
    className:
      "bg-emerald-100 px-3 py-1 text-sm text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400",
  },
  migrationTitle: "Coming from Ouroboros?",
  migrationDescription:
    "Ouroboros hasn't been updated in years. Drydock gives you the same auto-update capability plus a full dashboard, security scanning, rollback, and much more. One Docker command to get started.",
  jsonLdName: "Ouroboros vs Drydock — Container Update Monitoring Comparison",
  jsonLdDescription:
    "Compare Ouroboros and Drydock for container update monitoring. Ouroboros is no longer maintained.",
} satisfies ComparisonRouteRawConfig;
