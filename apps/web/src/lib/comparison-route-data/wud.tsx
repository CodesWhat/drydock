import { Bell, GitBranch, Network, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const wudComparisonRouteData = {
  slug: "wud",
  comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|TypeScript|TypeScript (full ESM)|tie
Web UI|Yes|Yes (redesigned)|tie
Auto-update containers|Yes|Yes|tie
Docker Compose updates|Yes|Yes, with multi-network support|self
Registry providers|25|23|competitor
Trigger integrations|33 triggers|21 native trigger integrations|competitor
Security scanning|None|Trivy + SBOM + cosign verification|self
OIDC authentication|OIDC supported (Authelia, Auth0, Authentik)|Authelia, Auth0, Authentik|tie
REST API|Yes|Yes (expanded)|self
Prometheus metrics|Yes|Yes + Grafana dashboard template|self
MQTT / Home Assistant|Yes|Yes|tie
Image backup & rollback|Partial: rolls back a failed update on HEALTHCHECK, keeps no image backup|Pre-update image backup with retention + auto rollback|self
Container grouping|Yes|Yes (enhanced with batch actions)|self
Lifecycle hooks|Yes (pre/post, with exec)|Pre/post-update shell commands|tie
Webhook API|Partial: registry push checks, not a general CI API|Token-authenticated webhooks for CI/CD|self
Container actions|Partial: manual update button covers updates only|Start/stop/restart/update from UI/API|self
Distributed agents|Multi-host via Docker TCP API|SSE-based agents (no exposed Docker API required)|self
Audit log|No|Yes, with REST API & Prometheus counter|self
Semver-aware updates|Yes|Yes|tie
Container log viewer|None|Yes, with level filtering & auto-fetch|self
Test framework|Jest|Vitest 4|self
License|MIT|MIT|tie
RBAC / multi-user roles|Yes (admin, read-write, read-only)|No, single-tier authenticated access|competitor
One-shot CI mode|Yes (--fail-on-update exit code)|No|competitor
Swarm / Kubernetes / Nomad watchers|Partial (watch-only except Nomad)|No|competitor
Scoped API tokens|Yes|Yes|tie
`,
  highlightsTable: `
git-branch|Migration Command|A built-in config migrate command previews, then rewrites your WUD_* variables and wud.* labels to DD_* and dd.*.
shield|Security Scanning|Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), cosign signature verification, and Update Bouncer to block vulnerable deploys — none of which WUD includes.
network|Distributed Agents|Monitor remote Docker hosts via lightweight SSE-based agents with a centralized dashboard — no need to expose the Docker API over TCP. WUD supports multiple Docker hosts too, but requires the remote Docker API to be exposed over TCP or TLS.
radio|23 Registry Providers|Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more, each with its own auth. WUD lists 25 providers, so this isn't a count win.
rotate|Rollback & Backup|Pre-update image backups with configurable retention, plus automatic rollback on health check failure. WUD also rolls back a failed update on HEALTHCHECK but keeps no image backup.
bell|Trigger Services|21 trigger integrations including Google Chat, Matrix, Mattermost, and Microsoft Teams (Adaptive Cards). WUD lists 33.
`,
  highlightIconMap: {
    "git-branch": GitBranch,
    shield: Shield,
    network: Network,
    radio: Radio,
    rotate: RotateCcw,
    bell: Bell,
  },
  metadataTitle: "WUD Alternative: Drydock vs WUD",
  metadataDescription:
    "Drydock and WUD compared. Drydock adds vulnerability scanning, image backup and rollback. WUD has RBAC and a one-shot CI mode.",
  metadataKeywords: [
    "wud vs drydock",
    "what's up docker vs drydock",
    "whats up docker alternative",
    "wud alternative",
    "wud docker",
    "container update monitoring",
    "docker container updater",
    "what's up docker replacement",
  ],
  openGraphDescription:
    "Compare What's Up Docker (WUD) and Drydock: security scanning, agents, audit logging and rollback, plus where WUD is ahead.",
  twitterDescription:
    "Compare What's Up Docker (WUD) and Drydock: security scanning, agents, audit logging and rollback, plus where WUD is ahead.",
  competitorName: "WUD",
  heroTitle: "WUD vs Drydock",
  heroDescription: (
    <p>
      <strong className="text-neutral-900 dark:text-neutral-200">
        What&apos;s Up Docker (WUD)
      </strong>{" "}
      is the closest alternative to Drydock. Both watch your containers and update them on your
      terms. Drydock adds security scanning, distributed agents, audit logging, and rollback. WUD
      has RBAC and a one-shot CI mode.
    </p>
  ),
  migrationTitle: "Coming from WUD?",
  migrationDescription:
    "Run config migrate --dry-run inside the Drydock container to preview how your WUD_* variables and wud.* labels map to DD_* and dd.*, then rewrite them. Since v1.6, Drydock no longer reads WUD_* or wud.* at runtime.",
  jsonLdName: "WUD vs Drydock — Container Update Monitoring Comparison",
} satisfies ComparisonRouteRawConfig;
