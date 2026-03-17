import { Bell, Layers, Monitor, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const diunComparisonRouteData = {
  slug: "diun",
  comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|Go|TypeScript|tie
Web UI|None (CLI / daemon)|Full dashboard|drydock
Auto-update containers|No (notify only)|Yes (optional)|drydock
Docker Compose updates|No|Yes, pull & recreate|drydock
Registry support|Docker Hub + private via Docker config|23 dedicated registry integrations|drydock
Notifications|17 services|20 native trigger integrations|drydock
Security scanning|None|Trivy + SBOM + cosign verification|drydock
OIDC authentication|None|Authelia, Auth0, Authentik|drydock
REST API|Limited|Full REST API|drydock
Prometheus metrics|No|Full /metrics endpoint + Grafana template|drydock
MQTT / Home Assistant|Yes|Yes|tie
Image backup & rollback|No|Pre-update backup with retention + auto rollback|drydock
Container grouping|No|Smart stack detection with batch actions|drydock
Lifecycle hooks|No|Pre/post-update shell commands|drydock
Webhook API|No|Token-authenticated webhooks for CI/CD|drydock
Container actions|No|Start/stop/restart from UI/API|drydock
Distributed agents|Yes (Docker, Swarm, K8s)|SSE-based agent architecture|tie
Kubernetes support|Yes|Planned (v2.0.0)|competitor
Semver-aware updates|Yes|Yes|tie
Audit log|No|Yes, with REST API|drydock
License|MIT|AGPL-3.0|tie
`,
  highlightsTable: `
monitor|Full Web Dashboard|Diun is a CLI daemon with no built-in UI. Drydock provides a full web dashboard for browsing containers, viewing update status, triggering actions, and inspecting logs — all from the browser.
layers|Auto-Update Containers|Diun is notification-only — it tells you about updates but can't apply them. Drydock can monitor and notify, but also optionally pull images and recreate containers via Docker Compose.
shield|Security Scanning|Drydock integrates Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), and cosign signature verification. Diun has no security scanning capabilities.
radio|23 Registry Integrations|Drydock has dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more. Diun relies on Docker credential configuration.
rotate|Rollback & Backup|Pre-update image backups with configurable retention and automatic rollback on health check failure. Diun can't update containers, so rollback isn't applicable.
bell|Audit Trail & Observability|Full audit log with REST API, Prometheus /metrics endpoint with Grafana dashboard template. Diun has no built-in metrics or audit trail.
`,
  highlightIconMap: {
    monitor: Monitor,
    layers: Layers,
    shield: Shield,
    radio: Radio,
    rotate: RotateCcw,
    bell: Bell,
  },
  metadataTitle: "Diun vs Drydock — Container Update Monitoring Comparison",
  metadataDescription:
    "Compare Diun (Docker Image Update Notifier) and Drydock for container update monitoring. See how Drydock adds a full web UI, auto-updates, security scanning, and 23 registry integrations beyond Diun's notification-only approach.",
  metadataKeywords: [
    "diun vs drydock",
    "diun alternative",
    "docker image update notifier",
    "diun docker",
    "container update monitoring",
    "docker container updater",
    "diun replacement",
  ],
  openGraphDescription:
    "Compare Diun and Drydock for container update monitoring. See how Drydock adds a full web UI, auto-updates, security scanning, and more.",
  twitterDescription:
    "Compare Diun and Drydock for container update monitoring. See how Drydock adds a full web UI, auto-updates, security scanning, and more.",
  competitorName: "Diun",
  heroTitle: "Diun vs Drydock",
  heroDescription: (
    <p>
      Diun (Docker Image Update Notifier) is a lightweight notification tool. Drydock builds on the
      same monitoring concept but adds a{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">
        full web UI, auto-updates, security scanning
      </strong>
      , and comprehensive container management capabilities.
    </p>
  ),
  migrationTitle: "Coming from Diun?",
  migrationDescription:
    "If you're using Diun for notifications, Drydock can do the same — plus give you a full dashboard, auto-updates, security scanning, and container management. One Docker command to get started.",
  jsonLdName: "Diun vs Drydock — Container Update Monitoring Comparison",
  jsonLdDescription: "Compare Diun and Drydock for container update monitoring.",
} satisfies ComparisonRouteRawConfig;
