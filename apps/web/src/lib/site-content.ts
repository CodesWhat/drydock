import {
  BarChart3,
  Bell,
  Container,
  Eye,
  History,
  Layers,
  Lock,
  Network,
  Play,
  Radio,
  RotateCcw,
  Webhook,
} from "lucide-react";

export type FeatureCategory = "core" | "security" | "integrations" | "operations";

export type Feature = {
  icon: typeof Container;
  title: string;
  color: string;
  bg: string;
  description: string;
  category: FeatureCategory;
};

export type Milestone = {
  version: string;
  title: string;
  emoji: string;
  status: "released" | "next" | "planned";
  dotColor: string;
  items: string[];
};

export const categoryLabels: Record<
  FeatureCategory,
  { label: string; color: string; border: string }
> = {
  core: { label: "Core", color: "text-blue-600 dark:text-blue-400", border: "border-blue-500/30" },
  security: {
    label: "Security",
    color: "text-rose-600 dark:text-rose-400",
    border: "border-rose-500/30",
  },
  integrations: {
    label: "Integrations",
    color: "text-purple-600 dark:text-purple-400",
    border: "border-purple-500/30",
  },
  operations: {
    label: "Operations",
    color: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500/30",
  },
};

export const features: Feature[] = [
  {
    icon: Container,
    title: "Auto-Discovery",
    color: "text-blue-500 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-900/50",
    description:
      "Automatically discovers running containers and tracks their image versions without manual configuration.",
    category: "core",
  },
  {
    icon: Radio,
    title: "23 Registries",
    color: "text-purple-500 dark:text-purple-400",
    bg: "bg-purple-100 dark:bg-purple-900/50",
    description:
      "Query Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, LSCR, ACR, Harbor, Artifactory, Nexus, and more.",
    category: "integrations",
  },
  {
    icon: Bell,
    title: "20 Triggers",
    color: "text-amber-500 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/50",
    description:
      "Notify via Slack, Discord, Telegram, Teams, SMTP, MQTT, HTTP, Gotify, NTFY, Kafka, and more.",
    category: "integrations",
  },
  {
    icon: Eye,
    title: "Dry-Run Preview",
    color: "text-cyan-500 dark:text-cyan-400",
    bg: "bg-cyan-100 dark:bg-cyan-900/50",
    description:
      "Preview updates before applying them. Pre-update image backup with one-click rollback.",
    category: "operations",
  },
  {
    icon: Network,
    title: "Distributed Agents",
    color: "text-emerald-500 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-900/50",
    description:
      "Monitor remote Docker hosts via SSE-based agents. Centralized dashboard for all environments.",
    category: "core",
  },
  {
    icon: BarChart3,
    title: "Prometheus Metrics",
    color: "text-orange-500 dark:text-orange-400",
    bg: "bg-orange-100 dark:bg-orange-900/50",
    description:
      "Built-in /metrics endpoint with Grafana dashboard template. Full observability out of the box.",
    category: "core",
  },
  {
    icon: History,
    title: "Audit Log",
    color: "text-teal-500 dark:text-teal-400",
    bg: "bg-teal-100 dark:bg-teal-900/50",
    description:
      "Event-based audit trail with persistent storage. Full REST API and Prometheus counters.",
    category: "security",
  },
  {
    icon: Lock,
    title: "OIDC Authentication",
    color: "text-rose-500 dark:text-rose-400",
    bg: "bg-rose-100 dark:bg-rose-900/50",
    description:
      "Secure your instance with OpenID Connect. Works with Authelia, Auth0, and Authentik.",
    category: "security",
  },
  {
    icon: RotateCcw,
    title: "Auto Rollback",
    color: "text-indigo-500 dark:text-indigo-400",
    bg: "bg-indigo-100 dark:bg-indigo-900/50",
    description:
      "Automatic rollback on health check failure. Configurable image backup retention policies.",
    category: "operations",
  },
  {
    icon: Play,
    title: "Container Actions",
    color: "text-green-500 dark:text-green-400",
    bg: "bg-green-100 dark:bg-green-900/50",
    description:
      "Start, stop, and restart containers directly from the UI or API. Feature-flagged for safety.",
    category: "operations",
  },
  {
    icon: Webhook,
    title: "Webhook API",
    color: "text-sky-500 dark:text-sky-400",
    bg: "bg-sky-100 dark:bg-sky-900/50",
    description:
      "Token-authenticated HTTP endpoints for CI/CD integration. Trigger updates on demand.",
    category: "integrations",
  },
  {
    icon: Layers,
    title: "Container Grouping",
    color: "text-violet-500 dark:text-violet-400",
    bg: "bg-violet-100 dark:bg-violet-900/50",
    description:
      "Smart stack detection via compose project or labels. Collapsible groups with batch actions.",
    category: "core",
  },
];

export const roadmap: Milestone[] = [
  {
    version: "v1.0.0",
    title: "Foundation",
    emoji: "\u{2705}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "TypeScript migration (app + UI)",
      "ReDoS & XSS security hardening",
      "Jest → Vitest test migration",
      "872 total tests across app and UI",
    ],
  },
  {
    version: "v1.1.0",
    title: "Observability",
    emoji: "\u{2705}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "Application log viewer with level filtering",
      "Agent log source selector",
      "Container log viewer",
    ],
  },
  {
    version: "v1.2.0",
    title: "Core Platform",
    emoji: "\u{2705}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "Audit log & REST API",
      "Image backup & rollback",
      "Container actions",
      "Webhook API for CI/CD",
      "Lifecycle hooks & maintenance windows",
      "Grafana dashboard template",
    ],
  },
  {
    version: "v1.3.0",
    title: "Security Integration",
    emoji: "\u{1F6E1}️",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "Trivy vulnerability scanning",
      "🥊 Update Bouncer (block vulnerable deploys)",
      "SBOM generation (CycloneDX, SPDX)",
      "Image signing verification (cosign)",
    ],
  },
  {
    version: "v1.4.0",
    title: "UI Stack Modernization",
    emoji: "\u{1F3A8}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "Tailwind CSS 4 + custom component library, 4 themes, 7 icon libraries",
      "Cmd/K command palette with scope filtering",
      "Compose-native YAML-preserving updates",
      "Rename-first rollback with health gates",
      "Self-update controller with SSE ack flow",
      "Fail-closed auth enforcement across watchers, registries, and triggers",
      "Tag-family semver, notification rules, container grouping by stack",
      "Dual-slot security scanning, scheduled scans, audit history view",
      "WUD migration CLI, bundled offline icons, dashboard drag-reorder",
    ],
  },
  {
    version: "v1.4.1",
    title: "Patch & Polish",
    emoji: "\u{2705}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "Headless mode (API-only, no UI serving)",
      "Maturity-based update policy (NEW/MATURE badges)",
      "URL param groupByStack, agent handshake fix, login error surfacing",
    ],
  },
  {
    version: "v1.5.0",
    title: "Observability & User-Requested Features",
    emoji: "\u{26A1}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "Real-time WebSocket log viewer with ANSI colors + JSON syntax highlighting",
      "Diagnostic debug dump with automatic redaction",
      "Dashboard customization with drag-to-reorder and per-widget toggles",
      "Resource usage dashboard widget",
      "Trigger environment variable aliases (DD_ACTION_*/DD_NOTIFICATION_*)",
      "Security scan digest (SECURITYMODE=digest) — one notification per scan cycle (#300)",
      "POST /containers/scan-all bulk scan endpoint with 1 req/60s rate limit",
      "Backend-driven update queue with Queued → Updating → Updated state progression",
      "Update eligibility blockers surfaced on container rows",
      "Floating tag detection with auto-enable digest watch for mutable aliases",
      "Notification bell rework — actionable alerts only, per-entry dismiss, zebra stripes",
      "Notification history store — once=true dedup survives restarts",
      "Metrics bearer token auth (DD_SERVER_METRICS_TOKEN)",
      "Design system overhaul — shared components, semantic typography, WCAG touch targets",
      "Container source project shortcut link from OCI labels (#295)",
      "Watcher next-run column with absolute-timestamp tooltip (#288)",
      "Actionable deprecation banners with inline migration guidance (#214)",
    ],
  },
  {
    version: "v1.6.0",
    title: "Scanner Decoupling, Notifications & Release Intel",
    emoji: "\u{1F4E8}",
    status: "planned",
    dotColor:
      "border-orange-400 bg-orange-50 text-orange-500 dark:border-orange-500 dark:bg-orange-950 dark:text-orange-400",
    items: [
      "Backend-based scanner execution (docker/remote)",
      "Grype scanner provider",
      "Scanner asset lifecycle management",
      "Custom zero-dependency dashboard grid (replaces grid-layout-plus, #281)",
      "Fixed-height Containers table redesign with explicit column widths, overflow handling, and safe virtualization re-enable",
      "Notification templates",
      "Notification preferences UI",
      "Deprecation removals",
    ],
  },
  {
    version: "v1.7.0",
    title: "Smart Updates & UX",
    emoji: "\u{1F680}",
    status: "planned",
    dotColor:
      "border-pink-400 bg-pink-50 text-pink-500 dark:border-pink-500 dark:bg-pink-950 dark:text-pink-400",
    items: [
      "Dependency-aware update ordering",
      "Clickable port links",
      "Image prune from UI",
      "Static image monitoring",
    ],
  },
  {
    version: "v1.8.0",
    title: "Fleet Management & Live Config",
    emoji: "\u{2699}️",
    status: "planned",
    dotColor:
      "border-amber-400 bg-amber-50 text-amber-500 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-400",
    items: [
      "YAML config file & Config API",
      "Live UI configuration panels",
      "Volume browser & parallel updates",
      "SQLite store migration",
      "i18n framework setup",
    ],
  },
  {
    version: "v2.0.0",
    title: "Platform Expansion",
    emoji: "\u{1F30D}",
    status: "planned",
    dotColor:
      "border-rose-400 bg-rose-50 text-rose-500 dark:border-rose-500 dark:bg-rose-950 dark:text-rose-400",
    items: [
      "Docker Swarm native support",
      "Kubernetes watcher & triggers",
      "Basic Git-based stack deployment",
    ],
  },
  {
    version: "v2.1.0",
    title: "Advanced Deployment Patterns",
    emoji: "\u{1F3AF}",
    status: "planned",
    dotColor:
      "border-indigo-400 bg-indigo-50 text-indigo-500 dark:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-400",
    items: [
      "Health check gate with auto-rollback",
      "Canary deployments (Kubernetes)",
      "Durable self-update controller",
    ],
  },
  {
    version: "v2.2.0",
    title: "Container Operations",
    emoji: "\u{1F4BB}",
    status: "planned",
    dotColor:
      "border-teal-400 bg-teal-50 text-teal-500 dark:border-teal-500 dark:bg-teal-950 dark:text-teal-400",
    items: [
      "Web terminal / container shell",
      "Container file browser",
      "Image building & registry push",
      "Basic Podman support",
    ],
  },
  {
    version: "v2.3.0",
    title: "Automation & Developer Experience",
    emoji: "\u{1F527}",
    status: "planned",
    dotColor:
      "border-cyan-400 bg-cyan-50 text-cyan-500 dark:border-cyan-500 dark:bg-cyan-950 dark:text-cyan-400",
    items: [
      "API keys & passkey auth (WebAuthn)",
      "TOTP two-factor authentication",
      "OpenAPI / Swagger docs",
      "TypeScript scripting & Drydock CLI",
    ],
  },
  {
    version: "v2.4.0",
    title: "Data Safety & Templates",
    emoji: "\u{1F4E6}",
    status: "planned",
    dotColor:
      "border-lime-400 bg-lime-50 text-lime-500 dark:border-lime-500 dark:bg-lime-950 dark:text-lime-400",
    items: ["Scheduled automated backups", "Compose templates library", "Secret management"],
  },
  {
    version: "v3.0.0",
    title: "Advanced Platform",
    emoji: "\u{1F52E}",
    status: "planned",
    dotColor:
      "border-fuchsia-400 bg-fuchsia-50 text-fuchsia-500 dark:border-fuchsia-500 dark:bg-fuchsia-950 dark:text-fuchsia-400",
    items: [
      "Network topology visualization",
      "GPU monitoring (NVIDIA/AMD)",
      "Multi-language / i18n (full translations)",
    ],
  },
  {
    version: "v3.1.0",
    title: "Enterprise Access & Compliance",
    emoji: "\u{1F510}",
    status: "planned",
    dotColor:
      "border-violet-400 bg-violet-50 text-violet-500 dark:border-violet-500 dark:bg-violet-950 dark:text-violet-400",
    items: [
      "RBAC (role-based access control)",
      "LDAP / Active Directory integration",
      "Environment-scoped permissions",
      "Audit logging & compliance",
      "Hardened container image (Wolfi)",
    ],
  },
];
