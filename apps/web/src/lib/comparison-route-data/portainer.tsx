import { Bell, Eye, Lock, Radio, RotateCcw, Shield } from "lucide-react";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";

export const portainerComparisonRouteData = {
  slug: "portainer",
  comparisonTable: `
Project status|Actively maintained|Actively maintained|tie
Pricing|Free CE / Paid BE ($$$)|Free, AGPL-3.0 licensed|self
Web UI|Yes|Yes|tie
Image update detection|Yes|Yes|tie
Auto-update containers|Yes|Yes (monitor-first)|tie
Automatic rollback|No|Yes, on health check failure|self
Maintenance windows|No|Yes|self
Lifecycle hooks (pre/post)|No|Yes, with timeout & abort|self
Image backup & dry-run|No|Pre-update backup + dry-run preview|self
Security scanning|No|Trivy + SBOM + cosign (free)|self
Registry providers|Major registries|23 dedicated integrations|self
Notifications|Slack, Teams (BE only)|20 native trigger integrations|self
MQTT / Home Assistant|No|Yes|self
Grafana dashboard|No|Yes, importable template|self
OIDC / SSO|Yes|Yes (Authelia, Auth0, Authentik)|tie
RBAC|Yes (BE only)|Planned|competitor
Kubernetes support|Yes|Planned (v2.0.0)|competitor
Docker Swarm|Yes|Planned (v2.0.0)|competitor
Web terminal / shell|Yes|Planned|competitor
Compose templates|Yes|Planned|competitor
Audit log|Yes (BE only)|Yes (free)|self
Resource footprint|Heavier (~100–200MB RAM)|Lightweight (~80MB RAM)|self
License|Zlib (CE) / Proprietary (BE)|AGPL-3.0|self
`,
  highlightsTable: `
rotate|Update Safety Controls|Automatic rollback on health check failure, maintenance windows, lifecycle hooks, and dry-run preview. We built these into Drydock because Portainer doesn't offer automatic rollback or these safety primitives.
shield|Free Security Scanning|Drydock bundles Trivy scanning, SBOM generation, and cosign verification at no cost. Portainer has no built-in image or vulnerability scanning in any edition.
lock|No Paywall|Every Drydock feature is free and open source. Portainer gates audit logs, RBAC, and notification integrations behind the paid Business Edition. Portainer has no built-in vulnerability scanning in any edition.
bell|20 Notification Services|Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, Kafka, Gotify, NTFY, and more — all free. Portainer CE has no alerting integrations — Slack, Teams, email, and webhook notifications all require the paid Business Edition.
radio|23 Registry Integrations|Dedicated integrations for Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more with per-registry configuration.
eye|Lightweight & Focused|We keep Drydock under 80MB RAM with a single focused purpose. Portainer is a full management platform that typically uses 100–200MB RAM or more.
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
      with safety controls that Portainer lacks — automatic rollback, maintenance windows, lifecycle
      hooks, and free security scanning.
    </p>
  ),
  migrationTitle: "Using Portainer?",
  migrationDescription:
    "Drydock can run alongside Portainer. Use Portainer for general container management and Drydock for update monitoring with safety controls, security scanning, and broad notification support — all without a paid tier.",
  jsonLdName: "Portainer vs Drydock — Container Update Monitoring Comparison",
  jsonLdDescription: "Compare Portainer and Drydock for container update monitoring.",
} satisfies ComparisonRouteRawConfig;
