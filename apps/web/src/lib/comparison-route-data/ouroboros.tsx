import { Archive, Bell, Check, Eye, Monitor, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const ouroborosComparisonRouteData = {
  slug: "ouroboros",
  comparisonTable: `
Project status|Unmaintained (since ~2020)|Actively maintained|self
Language|Python|TypeScript|tie
Web UI|None (CLI only)|Full dashboard|self
Auto-update containers|Yes|Yes (optional, monitor-first)|self
Docker Compose updates|No|Yes, pull & recreate|self
Registry support|Docker Hub + private via Docker config|23 dedicated registry integrations|self
Notifications|Apprise passthrough (150+ platforms via Apprise URLs)|20 native trigger integrations|self
Security scanning|None|Trivy + SBOM + cosign verification|self
OIDC authentication|None|Authelia, Auth0, Authentik|self
REST API|None|Full REST API|self
Prometheus metrics|Basic (container update counts; official Grafana template available)|Full /metrics endpoint + Grafana template|self
Image backup & rollback|No|Pre-update backup with retention + auto rollback|self
Container grouping|No|Smart stack detection with batch actions|self
Lifecycle hooks|No|Pre/post-update shell commands|self
Webhook API|No|Token-authenticated webhooks for CI/CD|self
Container actions|No|Start/stop/restart from UI/API|self
Distributed agents|No|SSE-based agent architecture|self
Audit log|No|Yes, with REST API|self
Semver-aware updates|No|Yes|self
Digest watching|Yes|Yes|tie
Multi-arch (amd64/arm64)|Yes|Yes|tie
License|MIT|AGPL-3.0|tie
`,
  highlightsTable: `
monitor|Full Web Dashboard|Ouroboros is CLI-only with no built-in UI. Drydock ships with a full web dashboard for browsing containers, viewing update status, triggering actions, and inspecting logs.
eye|Monitor-First Design|Drydock is monitor-first by design — it detects updates and notifies you, with dry-run preview before any changes are applied. Ouroboros auto-pulls and restarts containers with no preview option.
shield|Security Scanning|Drydock integrates Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), and cosign image signature verification. Ouroboros has no security scanning.
radio|23 Registry Integrations|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more — far beyond Ouroboros's Docker-config-based approach.
rotate|Rollback & Backup|Pre-update image backups with configurable retention and automatic rollback on health check failure. Ouroboros has no rollback or backup mechanism.
bell|20 Notification Services|Drydock notifies on image update availability across 20 native services — Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, and more. Ouroboros delegates notifications to Apprise (any Apprise-compatible URL works), but has no native trigger system — no scheduling, templating, threshold filtering, or batch mode.
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
      The original pyouroboros project has been{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">
        unmaintained since around 2020
      </strong>{" "}
      (last release: v1.4.3, December 2019). Drydock offers a modern, actively maintained
      alternative with a full web UI, security scanning, and comprehensive container management.
    </p>
  ),
  competitorBadge: {
    icon: Archive,
    label: "Ouroboros — Unmaintained",
    className:
      "bg-neutral-200 px-3 py-1 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  },
  selfBadge: {
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
