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
      "TypeScript app foundation",
      "ReDoS and XSS hardening",
      "Vitest migration and broader coverage",
    ],
  },
  {
    version: "v1.1.0",
    title: "Observability",
    emoji: "\u{2705}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: ["Application log viewer", "Agent log source selector", "Container log access"],
  },
  {
    version: "v1.2.0",
    title: "Core Platform",
    emoji: "\u{2705}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "Audit log and REST API",
      "Image backup and rollback",
      "Container actions and webhooks",
      "Lifecycle hooks, maintenance windows, and metrics",
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
      "Update Bouncer deployment gate",
      "SBOM generation",
      "Cosign signature verification",
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
      "Modern UI shell and command palette",
      "Compose-native YAML-preserving updates",
      "Compose-safe updates and stronger rollback flows",
      "Self-update controller and dashboard customization",
    ],
  },
  {
    version: "v1.4.1",
    title: "Patch & Polish",
    emoji: "\u{2705}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: ["Headless mode", "Maturity-based update policy", "Agent and login polish"],
  },
  {
    version: "v1.5.0",
    title: "Observability & Localization",
    emoji: "\u{26A1}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "Live observability and notification workflows",
      "Dashboard customization and design-system refresh",
      "Localized UI and edge-agent foundation",
      "Bulk scan and update eligibility workflows",
    ],
  },
  {
    version: "v1.5.1",
    title: "Security & Maintenance",
    emoji: "\u{1F527}",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "Security, registry, and secret-handling fixes",
      "Maturity gate and maintenance-window reliability",
      "Container detail polish and final i18n coverage",
    ],
  },
  {
    version: "v1.5.2",
    title: "Maturity & Pinned-Tag Reliability",
    emoji: "\u{1F6E1}️",
    status: "released",
    dotColor:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-neutral-900",
    items: [
      "Recreation-safe maturity policy retention",
      "Pinned-tag digest detection and informational insights",
      "Tag-policy inheritance and visibility refinements",
    ],
  },
  {
    version: "v1.6.0-rc.1",
    title: "Notifications, Policy & Release Intel",
    emoji: "\u{1F4E8}",
    status: "next",
    dotColor:
      "border-orange-400 bg-orange-50 text-orange-500 dark:border-orange-500 dark:bg-orange-950 dark:text-orange-400",
    items: [
      "Notification templates and preferences",
      "Declarative and maturity policy workflows",
      "Dashboard, responsive table/card views, and consistent resource-action toolbars",
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
      "Dependency-aware update flows",
      "Image cleanup and static-image monitoring",
      "Operator quality-of-life workflows",
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
      "Live configuration surfaces",
      "Config file and API foundation",
      "Fleet-scale operations and storage path",
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
      "Additional orchestrator support",
      "Stack deployment workflows",
      "Native Podman provider direction",
    ],
  },
  {
    version: "v2.1.0",
    title: "Progressive Delivery",
    emoji: "\u{1F3AF}",
    status: "planned",
    dotColor:
      "border-indigo-400 bg-indigo-50 text-indigo-500 dark:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-400",
    items: ["Health-gated rollouts", "Canary-style deployments", "Durable self-update flows"],
  },
  {
    version: "v2.2.0",
    title: "Container Operations",
    emoji: "\u{1F4BB}",
    status: "planned",
    dotColor:
      "border-teal-400 bg-teal-50 text-teal-500 dark:border-teal-500 dark:bg-teal-950 dark:text-teal-400",
    items: [
      "Container shell and file workflows",
      "Image build and publish workflows",
      "Day-two container maintenance tools",
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
      "Stronger operator authentication",
      "API key and scripting workflows",
      "CLI and developer tooling",
    ],
  },
  {
    version: "v2.4.0",
    title: "Data Safety & Templates",
    emoji: "\u{1F4E6}",
    status: "planned",
    dotColor:
      "border-lime-400 bg-lime-50 text-lime-500 dark:border-lime-500 dark:bg-lime-950 dark:text-lime-400",
    items: ["Scheduled backup workflows", "Reusable stack templates", "Secret management"],
  },
  {
    version: "v3.0.0",
    title: "Advanced Platform",
    emoji: "\u{1F52E}",
    status: "planned",
    dotColor:
      "border-fuchsia-400 bg-fuchsia-50 text-fuchsia-500 dark:border-fuchsia-500 dark:bg-fuchsia-950 dark:text-fuchsia-400",
    items: ["Infrastructure visualization", "Specialized hardware monitoring"],
  },
  {
    version: "v3.1.0",
    title: "Enterprise Access & Compliance",
    emoji: "\u{1F510}",
    status: "planned",
    dotColor:
      "border-violet-400 bg-violet-50 text-violet-500 dark:border-violet-500 dark:bg-violet-950 dark:text-violet-400",
    items: [
      "Role and environment-scoped permissions",
      "Directory and identity-provider integration",
      "Compliance posture and hardened image options",
    ],
  },
];
