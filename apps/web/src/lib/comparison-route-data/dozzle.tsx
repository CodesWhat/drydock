import { Bell, Eye, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const dozzleComparisonRouteData = {
  slug: "dozzle",
  comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|Go|TypeScript|tie
Web UI|Yes|Yes|tie
Primary focus|Real-time log viewing|Container update monitoring|tie
Image update detection|Yes, digest checks (v11)|Yes, across 23 registries|tie
Auto-update containers|Yes, bulk and scheduled with safe swap and cleanup (v11)|Yes (optional, monitor-first)|tie
Security scanning|No|Trivy + SBOM + cosign verification|self
Automatic rollback|No|Yes, on health check failure|self
Image backup|No|Pre-update backup with retention|self
Trigger integrations|Slack, Discord, Ntfy, webhooks|21 native trigger integrations|self
MQTT / Home Assistant|No|Yes|self
Prometheus metrics|No|Full /metrics endpoint + Grafana template|self
Audit log|No|Yes, with REST API|self
Log viewer|Advanced (SQL, split-screen, regex)|Basic (level filtering, auto-fetch)|competitor
Log analytics / SQL|Yes|No|competitor
Resource monitoring|Yes (CPU, memory, network — live)|Yes (CPU, memory, network)|tie
Multi-host agents|Yes|Yes (SSE-based)|tie
Container start/stop/restart|Yes|Yes|tie
OIDC authentication|Via forward proxy (Authelia, Authentik, Cloudflare)|Yes (Authelia, Auth0, Authentik)|self
RBAC|Yes|Planned|competitor
Docker Swarm|Yes|Planned|competitor
Kubernetes|Yes (since v8.11)|Planned (v2.0.0)|competitor
License|MIT|MIT|tie
`,
  highlightsTable: `
eye|Image Update Detection|Dozzle v11 added digest update checks. Drydock checks 23 registries and tells you whether a new version is a major, minor, patch or digest change before anything updates.
shield|Security Scanning|Trivy vulnerability scanning, SBOM generation, and cosign signature verification before updates are applied. Dozzle has no image security capabilities — no vulnerability scanning, SBOM generation, or signature verification.
rotate|Safe Update Pipeline|Dozzle v11 has bulk and scheduled auto-update with safe swap and cleanup. Drydock adds dry-run preview, pre-update image backup, automatic rollback on health check failure, and maintenance windows.
bell|21 Trigger Integrations|Drydock notifies across 17 native channels, Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, and more, plus Docker, Docker Compose, Portainer, and Command actions. Dozzle sends runtime alerts (log patterns, CPU/memory spikes, container crashes) via webhooks to Slack, Discord, or ntfy.
radio|23 Registry Integrations|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more.
rotate|Works Great Together|Dozzle for deep log analysis and Drydock for update monitoring — Dozzle is a log viewer first and Drydock is built around updates, so they can run side-by-side in your Docker stack.
`,
  highlightIconMap: {
    eye: Eye,
    shield: Shield,
    rotate: RotateCcw,
    bell: Bell,
    radio: Radio,
  },
  metadataTitle: "Dozzle vs Drydock: Container Update Comparison",
  metadataDescription:
    "Dozzle is a real-time log viewer. Drydock monitors container updates. See how they complement each other.",
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
      Dozzle is a best-in-class real-time log viewer that added update checks and auto-update in
      v11. Drydock is built around{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">
        container update monitoring and safe auto-updates
      </strong>
      . They overlap a little and work well together — Dozzle for log analysis, Drydock for keeping
      containers up-to-date.
    </p>
  ),
  migrationTitle: "Using Dozzle?",
  migrationDescription:
    "Drydock and Dozzle are complementary tools. Use Dozzle for real-time log viewing and Drydock for monitoring container updates, applying them safely, and getting notified across 17 services with 4 more that can apply the update directly. One Docker command to add Drydock.",
  jsonLdName: "Dozzle vs Drydock — Container Log Viewer & Update Monitoring Comparison",
} satisfies ComparisonRouteRawConfig;
