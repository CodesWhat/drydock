import { Bell, GitBranch, Network, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const wudComparisonRouteData = {
  slug: "wud",
  comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|JavaScript|TypeScript (full ESM)|drydock
Web UI|Yes|Yes (redesigned)|tie
Auto-update containers|Yes|Yes|tie
Docker Compose updates|Yes|Yes, with multi-network support|drydock
Registry providers|13|23|drydock
Notifications|16 triggers|20 native trigger integrations|drydock
Security scanning|None|Trivy + SBOM + cosign verification|drydock
OIDC authentication|OIDC supported|Authelia, Auth0, Authentik|drydock
REST API|Yes|Yes (expanded)|drydock
Prometheus metrics|Yes|Yes + Grafana dashboard template|drydock
MQTT / Home Assistant|Yes|Yes|tie
Image backup & rollback|None|Pre-update backup with retention + auto rollback|drydock
Container grouping|Yes|Yes (enhanced with batch actions)|drydock
Lifecycle hooks|None|Pre/post-update shell commands|drydock
Webhook API|None|Token-authenticated webhooks for CI/CD|drydock
Container actions|None|Start/stop/restart from UI/API|drydock
Distributed agents|None|SSE-based agent architecture|drydock
Audit log|None|Yes, with REST API & Prometheus counter|drydock
Semver-aware updates|Yes|Yes|tie
Container log viewer|None|Yes, with level filtering & auto-fetch|drydock
Test framework|Jest|Vitest 4|drydock
License|MIT|AGPL-3.0|tie
`,
  highlightsTable: `
git-branch|Fork & Evolve|Drydock started as a WUD fork, then migrated to TypeScript, added security scanning, distributed agents, audit logging, and dozens of new features. It's WUD's foundation taken much further.
shield|Security Scanning|Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), cosign signature verification, and 🥊 Update Bouncer to block vulnerable deploys. WUD has no security scanning.
network|Distributed Agents|Monitor remote Docker hosts via lightweight SSE-based agents with a centralized dashboard. WUD only monitors the local Docker socket.
radio|23 Registry Providers|10 more registries than WUD — including GAR, Harbor, Artifactory, Nexus, Alibaba Cloud, IBM Cloud, and Oracle Cloud.
rotate|Rollback & Backup|Pre-update image backups with configurable retention, dry-run preview, and automatic rollback on health check failure. None of these exist in WUD.
bell|4 More Trigger Services|Google Chat, Matrix, Mattermost, and Microsoft Teams (Adaptive Cards) plus enhanced configuration for existing triggers.
`,
  highlightIconMap: {
    "git-branch": GitBranch,
    shield: Shield,
    network: Network,
    radio: Radio,
    rotate: RotateCcw,
    bell: Bell,
  },
  metadataTitle: "WUD vs Drydock — Container Update Monitoring Comparison",
  metadataDescription:
    "Compare What's Up Docker (WUD) and Drydock for container update monitoring. Drydock is a WUD fork with security scanning, distributed agents, audit logging, rollback, and many more features.",
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
    "Compare What's Up Docker (WUD) and Drydock. Drydock is a WUD fork with security scanning, agents, audit logging, and more.",
  twitterDescription:
    "Compare What's Up Docker (WUD) and Drydock. Drydock is a WUD fork with security scanning, agents, audit logging, and more.",
  competitorName: "WUD",
  heroTitle: "WUD vs Drydock",
  heroDescription: (
    <p>
      Drydock is a{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">
        fork of What&apos;s Up Docker (WUD)
      </strong>{" "}
      that has evolved significantly — migrating to TypeScript, adding security scanning,
      distributed agents, audit logging, rollback, and 10 additional registry providers.
    </p>
  ),
  migrationTitle: "Coming from WUD?",
  migrationDescription:
    "Drydock is a direct WUD fork, so migration is straightforward. Your existing Docker socket mount works as-is. You'll get the same monitoring capabilities plus security scanning, agents, audit log, and a modernized UI.",
  jsonLdName: "WUD vs Drydock — Container Update Monitoring Comparison",
  jsonLdDescription: "Compare What's Up Docker (WUD) and Drydock for container update monitoring.",
} satisfies ComparisonRouteRawConfig;
