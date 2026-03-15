import {
  Archive,
  Bell,
  Check,
  Eye,
  GitBranch,
  History,
  Layers,
  Lock,
  type LucideIcon,
  Monitor,
  Network,
  Radio,
  RotateCcw,
  Shield,
} from "lucide-react";
import type { ComparisonRouteConfig } from "@/lib/comparison-route";
import { highlightsFromPipeTable, rowsFromPipeTable } from "@/lib/comparison-route";

type ComparisonRouteRawConfig = Omit<ComparisonRouteConfig, "comparisonData" | "highlights"> & {
  comparisonTable: string;
  highlightsTable: string;
  highlightIconMap: Record<string, LucideIcon>;
};

const comparisonRouteDataBySlug = {
  komodo: {
    slug: "komodo",
    comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|Rust + TypeScript|TypeScript|tie
Web UI|Yes|Yes|tie
Image update detection|Yes|Yes|tie
Auto-update containers|Yes|Yes (monitor-first)|tie
Automatic rollback|No|Yes, on health check failure|drydock
Maintenance windows|No|Yes|drydock
Lifecycle hooks (pre/post)|No|Yes, with timeout & abort|drydock
Image backup|No|Pre-update backup with retention|drydock
Security scanning (Trivy)|No|Trivy + SBOM + cosign verification|drydock
Registry providers|Limited|23 dedicated integrations|drydock
Notification services|Slack, Discord, webhooks|20 native trigger integrations|drydock
MQTT / Home Assistant|No|Yes|drydock
OIDC / SSO|Yes|Yes (Authelia, Auth0, Authentik)|tie
Passkey / TOTP 2FA|Yes|Planned|competitor
CI/CD pipelines|Yes|No (webhook API for CI/CD)|competitor
TypeScript scripting|Yes (Actions)|Planned|competitor
TOML GitOps config|Yes|Planned (YAML)|competitor
CLI tool|Yes|Planned|competitor
Prometheus metrics|No|Full /metrics endpoint + Grafana template|drydock
Audit log|No|Yes, with REST API|drydock
Dry-run preview|No|Yes|drydock
License|GPL-3.0|AGPL-3.0|tie
`,
    highlightsTable: `
rotate|Update Safety Controls|Drydock is the only tool with automatic rollback on health check failure, maintenance windows, and pre/post-update lifecycle hooks. Komodo can update containers but lacks these safety primitives.
shield|Security Scanning|Trivy vulnerability scanning, SBOM generation (CycloneDX & SPDX), and cosign image signature verification — built-in. Komodo has no integrated security scanning.
eye|Dry-Run Preview|Preview exactly what an update will do before applying it, with pre-update image backups and configurable retention. Komodo applies updates immediately with no preview step.
radio|23 Registry Providers|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more. Komodo supports fewer registries out of the box.
bell|20 Notification Services|Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, Kafka, Gotify, NTFY, and more. Komodo's notification options are more limited.
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
    twitterDescription:
      "Compare Komodo and Drydock for container management and update monitoring.",
    competitorName: "Komodo",
    heroTitle: "Komodo vs Drydock",
    heroDescription: (
      <p>
        Komodo is a broad DevOps platform with CI/CD, GitOps, and container management. Drydock
        focuses specifically on{" "}
        <strong className="text-neutral-900 dark:text-neutral-200">
          safe container update monitoring
        </strong>{" "}
        with rollback, maintenance windows, security scanning, and the widest registry and
        notification coverage.
      </p>
    ),
    migrationTitle: "Considering Komodo?",
    migrationDescription:
      "Komodo and Drydock serve different needs. If you want safe, monitored container updates with rollback and security scanning, Drydock is purpose-built for that. One Docker command to get started.",
    jsonLdName: "Komodo vs Drydock — Container Update Monitoring Comparison",
    jsonLdDescription: "Compare Komodo and Drydock for container management and update monitoring.",
  },
  portainer: {
    slug: "portainer",
    comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Pricing|Free CE / Paid BE ($$$)|Free, AGPL-3.0 licensed|drydock
Web UI|Yes|Yes|tie
Image update detection|Yes|Yes|tie
Auto-update containers|Yes|Yes (monitor-first)|tie
Automatic rollback|No|Yes, on health check failure|drydock
Maintenance windows|No|Yes|drydock
Lifecycle hooks (pre/post)|No|Yes, with timeout & abort|drydock
Image backup & dry-run|No|Pre-update backup + dry-run preview|drydock
Security scanning|Yes (BE only — paid)|Trivy + SBOM + cosign (free)|drydock
Registry providers|Major registries|23 dedicated integrations|drydock
Notifications|Slack, Teams (BE only)|20 native trigger integrations|drydock
MQTT / Home Assistant|No|Yes|drydock
Grafana dashboard|No|Yes, importable template|drydock
OIDC / SSO|Yes|Yes (Authelia, Auth0, Authentik)|tie
RBAC|Yes (BE only)|Planned|competitor
Kubernetes support|Yes|Planned (v2.0.0)|competitor
Docker Swarm|Yes|Planned (v2.0.0)|competitor
Web terminal / shell|Yes|Planned|competitor
Compose templates|Yes|Planned|competitor
Audit log|Yes (BE only)|Yes (free)|drydock
Resource footprint|Heavy (~200MB+ RAM)|Lightweight (~80MB RAM)|drydock
License|Zlib (CE) / Proprietary (BE)|AGPL-3.0|drydock
`,
    highlightsTable: `
rotate|Update Safety Controls|Automatic rollback on health check failure, maintenance windows, lifecycle hooks, and dry-run preview. Portainer can update containers but has none of these safety primitives.
shield|Free Security Scanning|Trivy vulnerability scanning, SBOM generation, and cosign verification — all free and open source. Portainer's security features require the paid Business Edition.
lock|No Paywall|Every Drydock feature is free and open source. Portainer gates security scanning, audit logs, RBAC, and most notification integrations behind the paid Business Edition.
bell|20 Notification Services|Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, Kafka, Gotify, NTFY, and more — all free. Portainer CE has very limited notification options.
radio|23 Registry Integrations|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more with per-registry configuration.
eye|Lightweight & Focused|Drydock uses ~80MB RAM and focuses on doing update monitoring well. Portainer is a full management platform that uses significantly more resources.
`,
    highlightIconMap: {
      rotate: RotateCcw,
      shield: Shield,
      lock: Lock,
      bell: Bell,
      radio: Radio,
      eye: Eye,
    },
    metadataTitle: "Portainer vs Drydock — Container Update Monitoring Comparison",
    metadataDescription:
      "Compare Portainer and Drydock for container update monitoring. Portainer is a full container management platform — see how Drydock's focused update monitoring with rollback, security scanning, and 23 registries offers a lightweight alternative.",
    metadataKeywords: [
      "portainer vs drydock",
      "portainer alternative",
      "portainer replacement",
      "portainer free alternative",
      "container update monitoring",
      "portainer open source alternative",
      "portainer docker alternative",
    ],
    openGraphDescription:
      "Compare Portainer and Drydock for container update monitoring. See how focused update monitoring compares to a full management platform.",
    twitterDescription: "Compare Portainer and Drydock for container update monitoring.",
    competitorName: "Portainer",
    heroTitle: "Portainer vs Drydock",
    heroDescription: (
      <p>
        Portainer is a full container management platform with a broad feature set. Drydock is a{" "}
        <strong className="text-neutral-900 dark:text-neutral-200">
          focused, lightweight update monitor
        </strong>{" "}
        with safety controls that Portainer lacks — automatic rollback, maintenance windows,
        lifecycle hooks, and free security scanning.
      </p>
    ),
    migrationTitle: "Using Portainer?",
    migrationDescription:
      "Drydock can run alongside Portainer. Use Portainer for general container management and Drydock for update monitoring with safety controls, security scanning, and broad notification support — all without a paid tier.",
    jsonLdName: "Portainer vs Drydock — Container Update Monitoring Comparison",
    jsonLdDescription: "Compare Portainer and Drydock for container update monitoring.",
  },
  watchtower: {
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
Lifecycle hooks|Yes|Yes (pre/post-update)|tie
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
        <strong className="text-neutral-900 dark:text-neutral-200">
          archival in December 2025
        </strong>
        , Drydock offers an actively maintained alternative with a modern UI, security scanning, and
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
  },
  ouroboros: {
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
  },
  dozzle: {
    slug: "dozzle",
    comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|Go|TypeScript|tie
Web UI|Yes|Yes|tie
Primary focus|Real-time log viewing|Container update monitoring|tie
Image update detection|No|Yes, across 23 registries|drydock
Auto-update containers|No|Yes (optional, monitor-first)|drydock
Security scanning|No|Trivy + SBOM + cosign verification|drydock
Automatic rollback|No|Yes, on health check failure|drydock
Image backup|No|Pre-update backup with retention|drydock
Notifications|Slack, Discord, Ntfy, webhooks|20 native trigger integrations|drydock
MQTT / Home Assistant|No|Yes|drydock
Prometheus metrics|No|Full /metrics endpoint + Grafana template|drydock
Audit log|No|Yes, with REST API|drydock
Log viewer|Advanced (SQL, split-screen, regex)|Basic (level filtering, auto-fetch)|competitor
Log analytics / SQL|Yes|No|competitor
Resource monitoring|Yes (CPU, memory)|Planned|competitor
Multi-host agents|Yes|Yes (SSE-based)|tie
Container start/stop/restart|Yes|Yes|tie
OIDC authentication|No|Yes (Authelia, Auth0, Authentik)|drydock
RBAC|Yes|Planned|competitor
Docker Swarm|Yes|Planned|competitor
Kubernetes|Yes|Planned (v2.0.0)|competitor
License|Apache 2.0|AGPL-3.0|tie
`,
    highlightsTable: `
eye|Image Update Detection|Dozzle is a log viewer — it doesn't monitor for image updates. Drydock continuously checks 23 registries and notifies you when new versions are available.
shield|Security Scanning|Trivy vulnerability scanning, SBOM generation, and cosign signature verification before updates are applied. Dozzle has no security capabilities.
rotate|Safe Update Pipeline|Dry-run preview, pre-update backup, automatic rollback on health check failure, and maintenance windows. Dozzle doesn't manage container updates at all.
bell|20 Notification Services|Get notified about available updates via Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, and more. Dozzle's notifications are limited to log-based alerts.
radio|23 Registry Integrations|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more.
rotate|Works Great Together|Dozzle for deep log analysis and Drydock for update monitoring — they solve different problems and can run side-by-side in your Docker stack.
`,
    highlightIconMap: {
      eye: Eye,
      shield: Shield,
      rotate: RotateCcw,
      bell: Bell,
      radio: Radio,
    },
    metadataTitle: "Dozzle vs Drydock — Container Log Viewer & Update Monitoring Comparison",
    metadataDescription:
      "Compare Dozzle and Drydock for Docker container management. Dozzle is a real-time log viewer, Drydock monitors container updates — see how they complement each other or which fits your needs.",
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
        Dozzle is a best-in-class real-time log viewer. Drydock focuses on{" "}
        <strong className="text-neutral-900 dark:text-neutral-200">
          container update monitoring and safe auto-updates
        </strong>
        . They solve different problems and work well together — Dozzle for log analysis, Drydock
        for keeping containers up-to-date.
      </p>
    ),
    migrationTitle: "Using Dozzle?",
    migrationDescription:
      "Drydock and Dozzle are complementary tools. Use Dozzle for real-time log viewing and Drydock for monitoring container updates, applying them safely, and getting notified across 20 services. One Docker command to add Drydock.",
    jsonLdName: "Dozzle vs Drydock — Container Log Viewer & Update Monitoring Comparison",
    jsonLdDescription: "Compare Dozzle and Drydock for Docker container management.",
  },
  wud: {
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
    jsonLdDescription:
      "Compare What's Up Docker (WUD) and Drydock for container update monitoring.",
  },
  dockhand: {
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
  },
  diun: {
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
        Diun (Docker Image Update Notifier) is a lightweight notification tool. Drydock builds on
        the same monitoring concept but adds a{" "}
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
  },
  dockge: {
    slug: "dockge",
    comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Language|TypeScript|TypeScript|tie
Web UI|Yes|Yes|tie
Primary focus|Compose stack management|Container update monitoring|tie
Image update detection|No|Yes, across 23 registries|drydock
Auto-update containers|No|Yes (optional, monitor-first)|drydock
Notifications on updates|No|20 native trigger integrations|drydock
Security scanning|No|Trivy + SBOM + cosign verification|drydock
Automatic rollback|No|Yes, on health check failure|drydock
Image backup|No|Pre-update backup with retention|drydock
Prometheus metrics|No|Full /metrics endpoint + Grafana template|drydock
OIDC authentication|No|Authelia, Auth0, Authentik|drydock
Distributed agents|No|SSE-based agent architecture|drydock
Audit log|No|Yes, with REST API|drydock
Compose file editing|Yes (visual editor)|No (compose updates only)|competitor
Docker run → compose|Yes|No|competitor
Multi-language (i18n)|Yes (15+ languages)|Planned|competitor
Container start/stop/restart|Yes|Yes|tie
Container grouping / stacks|Yes|Yes (auto-detected)|tie
Dark/light theme|Yes|Yes|tie
License|MIT|AGPL-3.0|tie
`,
    highlightsTable: `
eye|Image Update Detection|Dockge manages compose stacks but doesn't check for image updates. Drydock continuously monitors 23 registries and notifies you when new versions are available.
shield|Security Scanning|Trivy vulnerability scanning, SBOM generation, and cosign signature verification before any update is applied. Dockge has no security scanning.
rotate|Safe Update Pipeline|Dry-run preview, pre-update backup, automatic rollback on health check failure, and maintenance windows. Dockge lets you manually update stacks but has no safety controls.
bell|20 Notification Services|Get notified about available updates via Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, and more. Dockge has no notification system.
network|Distributed Monitoring|Monitor remote Docker hosts via SSE-based agents with a centralized dashboard. Dockge manages only the local Docker instance.
radio|23 Registry Integrations|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more. Dockge doesn't query registries at all.
`,
    highlightIconMap: {
      eye: Eye,
      shield: Shield,
      rotate: RotateCcw,
      bell: Bell,
      network: Network,
      radio: Radio,
    },
    metadataTitle: "Dockge vs Drydock — Docker Compose & Container Update Comparison",
    metadataDescription:
      "Compare Dockge and Drydock for Docker container management. Dockge manages compose stacks, Drydock monitors and updates container images — see how they complement each other or which fits your needs.",
    metadataKeywords: [
      "dockge vs drydock",
      "dockge alternative",
      "dockge docker",
      "docker compose manager",
      "container update monitoring",
      "dockge replacement",
      "dockge container updates",
    ],
    openGraphDescription:
      "Compare Dockge and Drydock for Docker container management. See how compose management and update monitoring compare.",
    twitterDescription:
      "Compare Dockge and Drydock for Docker container management. See how compose management and update monitoring compare.",
    competitorName: "Dockge",
    heroTitle: "Dockge vs Drydock",
    heroDescription: (
      <p>
        Dockge is a popular compose stack manager. Drydock focuses on{" "}
        <strong className="text-neutral-900 dark:text-neutral-200">
          container update monitoring and safe auto-updates
        </strong>
        . They solve different problems and can work well side-by-side — Dockge for managing compose
        files, Drydock for tracking and applying image updates.
      </p>
    ),
    migrationTitle: "Using Dockge?",
    migrationDescription:
      "Drydock and Dockge complement each other well. Use Dockge to manage your compose files and Drydock to monitor for image updates and apply them safely. One Docker command to add Drydock to your stack.",
    jsonLdName: "Dockge vs Drydock — Docker Compose & Container Update Comparison",
    jsonLdDescription: "Compare Dockge and Drydock for Docker container management.",
  },
} satisfies Record<string, ComparisonRouteRawConfig>;

export type ComparisonRouteSlug = keyof typeof comparisonRouteDataBySlug;

function resolveComparisonRouteConfig(routeData: ComparisonRouteRawConfig): ComparisonRouteConfig {
  const { comparisonTable, highlightsTable, highlightIconMap, ...config } = routeData;

  return {
    ...config,
    comparisonData: rowsFromPipeTable(comparisonTable),
    highlights: highlightsFromPipeTable(highlightsTable, highlightIconMap),
  };
}

export function getComparisonRouteConfig(slug: ComparisonRouteSlug): ComparisonRouteConfig;
export function getComparisonRouteConfig(slug: string): ComparisonRouteConfig | undefined;
export function getComparisonRouteConfig(slug: string): ComparisonRouteConfig | undefined {
  const routeData = comparisonRouteDataBySlug[slug as ComparisonRouteSlug];
  if (!routeData) {
    return undefined;
  }

  return resolveComparisonRouteConfig(routeData);
}

export function getComparisonRouteSlugs(): ComparisonRouteSlug[] {
  return Object.keys(comparisonRouteDataBySlug) as ComparisonRouteSlug[];
}
