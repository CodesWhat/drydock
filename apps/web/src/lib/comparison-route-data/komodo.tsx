import { Bell, Eye, Lock, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const komodoComparisonRouteData = {
  slug: "komodo",
  comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|Rust + TypeScript|TypeScript|tie
Web UI|Yes|Yes|tie
Image update detection|Yes|Yes|tie
Auto-update containers|Yes|Yes (monitor-first)|tie
Automatic rollback|No|Yes, on health check failure|self
Maintenance windows|No|Yes|self
Lifecycle hooks (pre/post)|No|Yes, with timeout & abort|self
Image backup|No|Pre-update backup with retention|self
Security scanning (Trivy)|No|Trivy + SBOM + cosign verification|self
Registry providers|Limited|23 dedicated integrations|self
Notification services|Slack, Discord, Ntfy, Pushover|20 native trigger integrations|self
MQTT / Home Assistant|No|Yes|self
OIDC / SSO|Yes|Yes (Authelia, Auth0, Authentik)|tie
Passkey / TOTP 2FA|Yes|Planned|competitor
CI/CD pipelines|Yes|No (webhook API for CI/CD)|competitor
TypeScript scripting|Yes (Actions)|Planned|competitor
TOML GitOps config|Yes|Planned (YAML)|competitor
CLI tool|Yes|Planned|competitor
Prometheus metrics|No|Full /metrics endpoint + Grafana template|self
Audit log|Yes|Yes, with REST API|tie
Dry-run preview|No|Yes|self
License|GPL-3.0|AGPL-3.0|tie
`,
  highlightsTable: `
rotate|Update Safety Controls|Drydock is the only tool with automatic rollback on health check failure, maintenance windows, and pre/post-update lifecycle hooks. Komodo updates containers but does not include automatic rollback on failure, maintenance windows, or pre/post-update hooks.
shield|Security Scanning|Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), and cosign image signature verification — built-in. Komodo has no integrated security scanning.
eye|Dry-Run Preview|Preview exactly what an update will do before applying it, with pre-update image backups and configurable retention. Komodo applies updates immediately with no preview step.
radio|23 Registry Providers|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more. Komodo supports fewer registries out of the box.
bell|20 Trigger Integrations|Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, Kafka, Gotify, NTFY, and more. Komodo includes built-in alerters for Slack, Discord, Ntfy, and Pushover; anything beyond those requires a self-hosted custom alerter integration.
lock|Fully Open Source|Every Drydock feature is free and open source. Both Drydock (AGPL-3.0) and Komodo (GPL-3.0) use copyleft licenses.
`,
  highlightIconMap: {
    rotate: RotateCcw,
    shield: Shield,
    eye: Eye,
    radio: Radio,
    bell: Bell,
    lock: Lock,
  },
  metadataTitle: "Komodo vs Drydock — Container Update Monitoring Comparison",
  metadataDescription:
    "Compare Komodo and Drydock for container management and update monitoring. See how Drydock's update-safety features — auto rollback, maintenance windows, lifecycle hooks — complement Komodo's broader DevOps platform.",
  metadataKeywords: [
    "komodo vs drydock",
    "komodo alternative",
    "komodo docker",
    "container update monitoring",
    "docker container updater",
    "komodo replacement",
    "komo.do alternative",
  ],
  openGraphDescription:
    "Compare Komodo and Drydock for container management and update monitoring. See how their feature sets differ.",
  twitterDescription: "Compare Komodo and Drydock for container management and update monitoring.",
  competitorName: "Komodo",
  heroTitle: "Komodo vs Drydock",
  heroDescription: (
    <p>
      Komodo is a broad DevOps platform with CI/CD, GitOps, and container management. Drydock
      focuses specifically on{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">
        safe container update monitoring
      </strong>{" "}
      with rollback, maintenance windows, security scanning, and 23 registry integrations plus 20
      notification services.
    </p>
  ),
  migrationTitle: "Considering Komodo?",
  migrationDescription:
    "Komodo and Drydock serve different needs. If you want safe, monitored container updates with rollback and security scanning, Drydock is purpose-built for that. One Docker command to get started.",
  jsonLdName: "Komodo vs Drydock — Container Update Monitoring Comparison",
  jsonLdDescription: "Compare Komodo and Drydock for container management and update monitoring.",
} satisfies ComparisonRouteRawConfig;
