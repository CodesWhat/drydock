import { Bell, CalendarClock, ListChecks, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const arcaneComparisonRouteData = {
  slug: "arcane",
  comparisonTable: `
Project status|Actively maintained (~35 releases/6mo)|Actively maintained|tie
Language / stack|Go backend, SvelteKit frontend|TypeScript (full ESM)|tie
License|BSD-3-Clause|AGPL-3.0|tie
Web UI|Yes|Yes|tie
General container management (create, exec, commit)|Yes, full container CRUD plus shell exec and commit-to-image|No, update-focused (start/stop/restart/redeploy only)|competitor
Compose project management|Yes, create/deploy/redeploy/destroy with an in-app editor|No, updates existing stacks only|competitor
Git-based stack deployment|Yes, Git-synced projects with auto sync and webhook redeploy|No, planned|competitor
Podman support|Yes, via the Docker-compatible socket|Yes, via the Docker-compatible socket|tie
Image management (browse, pull, tag, prune)|Yes, dedicated Images page with registry search, pull, tag, and dangling/all-unused prune|No general image manager; image prune not yet shipped|competitor
Docker Swarm cluster management|Yes, nodes, services, stacks, configs, and secrets|No|competitor
Native mobile apps|Yes, iOS and Android with push notifications|No|competitor
Multi-host architecture|Yes, Direct or Edge Agent (gRPC/WebSocket tunnel or poll)|Yes, SSE-based agents|tie
Vulnerability scanning|Yes, scheduled Trivy scans|Yes, Trivy + Grype scans|tie
SBOM for scanned images|No, SBOM covers only Arcane's own release artifacts|Yes, SPDX and CycloneDX for every scanned image|self
Image signature verification|No|Yes, cosign verification plus an Update Bouncer that can block a vulnerable deploy|self
Auto-patch vulnerable OS packages|Yes, in-place patching via Copacetic|No|competitor
Auto-rollback on failed health check|No|Yes, on health check failure|self
Maintenance windows|No|Yes|self
Pre/post update lifecycle hooks|No, only a pre-deploy hook for Git-synced projects|Yes, dd.hook.pre and dd.hook.post|self
Update review workflow|Updates page: apply now or ignore, per item|Dedicated Approval Queue: approve, reject, or defer with a full audit trail|self
Notification threshold filtering|No, digest-only update detection|Yes, all/major/minor/patch/digest across 21 triggers|self
Registry providers|Generic credential matching plus first-class ECR|23 named providers with per-provider auth|self
RBAC / roles|Yes, six built-in roles plus custom roles and OIDC group mapping|No, single-tier authenticated access|competitor
Scoped API keys|Yes, per-resource:action permission catalog|Yes, coarse scopes (read, containers:watch, containers:update, admin, api-keys:manage)|tie
`,
  highlightsTable: `
rotate|Auto-Rollback on Failed Health Checks|Drydock watches the container's HEALTHCHECK after an update and can automatically stop, remove, and recreate it from an immutable digest-pinned backup. Arcane has no automatic rollback — a failed update stays failed until someone steps in.
calendar-clock|Maintenance Windows and Update Hooks|Schedule when auto-updates are allowed to run, and fire a shell command before or after every update with dd.hook.pre and dd.hook.post. Neither exists in Arcane outside its Git-sync-only GitOps pre-deploy hook.
shield|SBOM, Cosign, and a Bouncer|Trivy and Grype scanning, SBOM generation (SPDX and CycloneDX) for every scanned image, cosign signature verification, and an Update Bouncer that can block a vulnerable deploy outright. Arcane's Trivy scans (with a genuinely useful Copacetic auto-patch for OS packages) publish an SBOM only for Arcane's own release, not for the images it scans.
list-checks|A Real Approval Queue|Drydock's dedicated Approvals view lets you approve, reject, or defer a pending update with a full audit trail and keyboard shortcuts. Arcane's Updates page only offers apply-now or ignore per item — there's no queue, no defer, no decision log.
bell|Severity-Aware Notifications|Drydock applies all/major/minor/patch/digest thresholds globally across 21 native trigger integrations. Arcane's update checks are digest-only with no severity classification, and its own notification setup documents around a dozen named providers behind Shoutrrr plus a generic webhook.
radio|23 Registry Providers|Dedicated auth per registry — Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more. Arcane's registry setup is generic credential matching plus first-class ECR token exchange, not a comparable named list.
`,
  highlightIconMap: {
    rotate: RotateCcw,
    "calendar-clock": CalendarClock,
    shield: Shield,
    "list-checks": ListChecks,
    bell: Bell,
    radio: Radio,
  },
  metadataTitle: "Arcane vs Drydock — Container Update Monitoring Comparison",
  metadataDescription:
    "Compare Arcane and Drydock for Docker container management and update monitoring. Arcane is a broad Docker/Compose/Swarm management platform with RBAC and Git-based deployment; Drydock is a focused update watcher with rollback, maintenance windows, and a deep security-scanning stack.",
  metadataKeywords: [
    "arcane vs drydock",
    "arcane alternative",
    "getarcane alternative",
    "arcane docker",
    "docker management platform comparison",
    "container update monitoring",
    "docker container updater",
    "arcane replacement",
  ],
  openGraphDescription:
    "Compare Arcane and Drydock. Arcane is a broad Docker management platform with RBAC and Git-based deployment; Drydock is a focused update watcher with rollback and security scanning.",
  twitterDescription:
    "Compare Arcane and Drydock for Docker container management and update monitoring.",
  competitorName: "Arcane",
  heroTitle: "Arcane vs Drydock",
  heroDescription: (
    <p>
      Arcane is a fast-moving, broad Docker management platform — container and Compose CRUD, Docker
      Swarm cluster management, Git-based stack deployment, six built-in RBAC roles with OIDC group
      mapping, and native iOS/Android apps.{" "}
      <strong className="text-neutral-900 dark:text-neutral-200">
        Drydock stays focused on safe, monitored container updates
      </strong>
      : automatic rollback on failed health checks, maintenance windows, pre/post update hooks, a
      dedicated approval queue, and a security-scanning stack (Trivy, Grype, SBOM, cosign) built
      around the images it updates rather than its own release artifacts.
    </p>
  ),
  migrationTitle: "Considering Arcane?",
  migrationDescription:
    "Arcane and Drydock solve different problems. If you want a full Docker/Compose/Swarm management UI with RBAC, Git-based deployment, and mobile apps, Arcane is built for that — and it does not yet have drydock's rollback, maintenance windows, or lifecycle hooks. If you want an update-focused watcher with those safety features plus a deeper security-scanning stack, Drydock is purpose-built for that, though it has no RBAC, Compose editor, or Swarm support today. One Docker command to get started.",
  jsonLdName: "Arcane vs Drydock — Container Update Monitoring Comparison",
  jsonLdDescription:
    "Compare Arcane and Drydock for Docker container management and update monitoring.",
} satisfies ComparisonRouteRawConfig;
