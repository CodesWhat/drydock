import { Archive, Check, Eye, Monitor, Network, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const watchtowerComparisonRouteData = {
  slug: "watchtower",
  comparisonTable: `
Project status|Archived (Dec 2025)|Actively maintained|drydock
Language|Go|TypeScript|tie
Web UI|None (CLI only)|Full dashboard|drydock
Update approach|Auto-pulls & restarts|Monitor + notify (optional update)|drydock
Monitor-only mode|Flag exists but unreliable|Core design — monitor-first|drydock
Dry-run preview|No|Yes|drydock
Registry support|Docker Hub + private via Docker config|23 dedicated registry integrations|drydock
Notifications|Via Shoutrrr (~18 services)|20 native trigger integrations|tie
Security scanning|None|Trivy + SBOM + cosign verification|drydock
Per-container scheduling|No|Yes (per-watcher CRON)|drydock
Include/exclude patterns|Labels only|Labels, regex, image sets|drydock
Distributed/remote hosts|Limited|SSE-based agent architecture|drydock
Prometheus metrics|Basic|Full /metrics endpoint + Grafana template|drydock
Audit log|No|Yes, with REST API|drydock
Auto rollback|No|Yes, on health check failure|drydock
Authentication|None|OIDC (Authelia, Auth0, Authentik)|drydock
Container actions|Restart only (via update)|Start/stop/restart from UI/API|drydock
Docker Compose updates|Limited|Full compose pull & recreate|drydock
Lifecycle hooks|Yes (advisory — no abort on failure)|Yes (pre/post with abort & audit)|drydock
Image backup|No|Pre-update backup with retention|drydock
Webhook API|HTTP API mode|Token-authenticated webhooks|drydock
License|Apache 2.0|AGPL-3.0|tie
`,
  highlightsTable: `
monitor|Full Web Dashboard|Watchtower is CLI-only with no built-in UI. Drydock ships with a full web dashboard for browsing containers, viewing update status, triggering actions, and inspecting logs — no terminal required.
eye|Monitor-First Design|Watchtower's default behavior auto-pulls and restarts containers, which can be risky in production. Drydock is monitor-first by design — it detects updates and notifies you, with optional dry-run preview before any changes are applied.
shield|Security Scanning|Drydock integrates Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), and cosign image signature verification. Watchtower has no security scanning capabilities.
network|Distributed Architecture|Monitor remote Docker hosts via lightweight SSE-based agents with a centralized dashboard. Watchtower is limited to the local Docker socket or basic remote connections.
radio|23 Registry Integrations|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, LSCR, ACR, Harbor, Artifactory, Nexus, and more — rather than relying on Docker's credential config.
rotate|Rollback & Backup|Pre-update image backups with configurable retention and automatic rollback on health check failure. Watchtower has no rollback or backup mechanism.
`,
  highlightIconMap: {
    monitor: Monitor,
    eye: Eye,
    shield: Shield,
    network: Network,
    radio: Radio,
    rotate: RotateCcw,
  },
  metadataTitle: "Watchtower vs Drydock — Container Update Monitoring Comparison",
  metadataDescription:
    "Compare Watchtower and Drydock for container update monitoring. Watchtower was archived Dec 2025 — see how Drydock provides a modern, actively maintained alternative with a full UI, 23 registries, security scanning, and more.",
  metadataKeywords: [
    "watchtower vs drydock",
    "watchtower alternative",
    "watchtower replacement",
    "watchtower archived",
    "container update monitoring",
    "docker container updater",
    "watchtower docker alternative",
    "containrrr watchtower",
  ],
  openGraphDescription:
    "Compare Watchtower and Drydock for container update monitoring. Watchtower was archived Dec 2025 — see how Drydock provides a modern, actively maintained alternative.",
  twitterDescription:
    "Compare Watchtower and Drydock for container update monitoring. Watchtower was archived Dec 2025 — see how Drydock provides a modern, actively maintained alternative.",
  competitorName: "Watchtower",
  heroTitle: "Watchtower vs Drydock",
  heroDescription: (
    <p>
      Watchtower served the Docker community well for years. With its{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">archival in December 2025</strong>,
      Drydock offers an actively maintained alternative with a modern UI, security scanning, and
      monitor-first design.
    </p>
  ),
  competitorBadge: {
    icon: Archive,
    label: "Watchtower — Archived",
    className:
      "bg-neutral-200 px-3 py-1 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  },
  drydockBadge: {
    icon: Check,
    label: "Drydock — Actively Maintained",
    className:
      "bg-emerald-100 px-3 py-1 text-sm text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400",
  },
  migrationTitle: "Coming from Watchtower?",
  migrationDescription:
    "Drydock takes a different approach than Watchtower — it's monitor-first rather than update-first. This means you get visibility into what's available before anything changes. Getting started takes one Docker command, and you can have the dashboard running in under a minute.",
  jsonLdName: "Watchtower vs Drydock — Container Update Monitoring Comparison",
  jsonLdDescription:
    "Compare Watchtower and Drydock for container update monitoring. Watchtower was archived Dec 2025.",
} satisfies ComparisonRouteRawConfig;
