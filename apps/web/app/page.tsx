import {
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  ChevronDown,
  Container,
  Eye,
  Github,
  History,
  Layers,
  Lock,
  Network,
  Play,
  Radio,
  RotateCcw,
  Terminal,
  Webhook,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { DemoSection } from "@/components/demo-section";
import { RoadmapTimeline } from "@/components/roadmap-timeline";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type FeatureCategory = "core" | "security" | "integrations" | "operations";

const categoryLabels: Record<FeatureCategory, { label: string; color: string; border: string }> = {
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

const features: {
  icon: typeof Container;
  title: string;
  color: string;
  bg: string;
  description: string;
  category: FeatureCategory;
}[] = [
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

const roadmap = [
  {
    version: "v1.0.0",
    title: "Foundation",
    emoji: "\u{2705}",
    status: "released" as const,
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
    status: "released" as const,
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
    status: "released" as const,
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
    emoji: "\u{1F6E1}\uFE0F",
    status: "released" as const,
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
    status: "released" as const,
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
    status: "released" as const,
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
    status: "next" as const,
    dotColor:
      "border-amber-500 bg-amber-50 text-amber-600 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-400",
    items: [
      "Real-time WebSocket log viewer with ANSI colors + JSON syntax highlighting",
      "Container resource monitoring",
      "Diagnostic debug dump with automatic redaction",
      "Registry webhook receiver",
      "Auth endpoint telemetry & guardrails",
      "Image maturity / sort-by-age indicator",
      "URL-driven filter/sort state",
      "Release notes in UI",
      "Smart tag suggestion for latest containers",
      "Digest check deduplication",
      "Dashboard customization",
      "Resource usage dashboard widget",
      "Trigger environment variable aliases (DD_ACTION_*/DD_NOTIFICATION_*)",
      "Security scan digest (SECURITYMODE=digest) — one notification per scan cycle (#300)",
      "POST /containers/scan-all bulk scan endpoint with 1 req/60s rate limit",
      "Scan cycle correlation via UUID v7 cycleId (scheduled + on-demand + agent-forwarded)",
    ],
  },
  {
    version: "v1.6.0",
    title: "Scanner Decoupling, Notifications & Release Intel",
    emoji: "\u{1F4E8}",
    status: "planned" as const,
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
    status: "planned" as const,
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
    emoji: "\u{2699}\uFE0F",
    status: "planned" as const,
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
    status: "planned" as const,
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
    status: "planned" as const,
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
    status: "planned" as const,
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
    status: "planned" as const,
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
    status: "planned" as const,
    dotColor:
      "border-lime-400 bg-lime-50 text-lime-500 dark:border-lime-500 dark:bg-lime-950 dark:text-lime-400",
    items: ["Scheduled automated backups", "Compose templates library", "Secret management"],
  },
  {
    version: "v3.0.0",
    title: "Advanced Platform",
    emoji: "\u{1F52E}",
    status: "planned" as const,
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
    status: "planned" as const,
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

export default function Home() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://getdrydock.com";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Drydock",
    url: baseUrl,
    description: "Open source container update monitoring built in TypeScript with modern tooling.",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Docker",
    license: "https://opensource.org/licenses/AGPL-3.0",
    author: {
      "@type": "Organization",
      name: "CodesWhat",
      url: "https://codeswhat.com",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="relative min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-950 dark:to-neutral-900">
        {/* Background Pattern */}
        <div className="bg-grid-neutral-200/50 dark:bg-grid-neutral-800/50 fixed inset-0" />

        <div className="relative z-10">
          {/* Hero Section */}
          <section className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_70%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_70%)]" />

            <div className="relative z-10 flex flex-col items-center">
              {/* Bouncing Whale Logo */}
              <div className="animate-bounce-slow mb-8">
                <Image
                  src="/whale-logo.png"
                  alt="Drydock Logo"
                  width={180}
                  height={180}
                  className="drop-shadow-2xl dark:invert"
                  priority
                />
              </div>

              {/* Version Badge */}
              <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm font-medium">
                v1.5.0 &middot; Open Source
              </Badge>

              {/* Heading */}
              <div className="max-w-4xl text-center">
                <h1 className="mb-4 text-5xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 sm:text-6xl lg:text-7xl">
                  Container Update
                  <br />
                  <span className="text-neutral-600 dark:text-neutral-400">Monitoring</span>
                </h1>

                <p className="mx-auto mb-10 max-w-2xl text-lg text-neutral-600 sm:text-xl dark:text-neutral-400">
                  Keep your containers up-to-date. Auto-discover running containers, detect image
                  updates across 23 registries, scan for vulnerabilities, and trigger notifications
                  via 20+ services.
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                  <Button size="lg" asChild>
                    <a
                      href="https://github.com/CodesWhat/drydock"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Github className="h-4 w-4" />
                      View on GitHub
                    </a>
                  </Button>
                  <Button variant="outline" size="lg" asChild>
                    <Link href="/docs">
                      <BookOpen className="h-4 w-4" />
                      Documentation
                    </Link>
                  </Button>
                </div>

                {/* Distribution Badges */}
                <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
                  <a
                    href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/badge/GHCR-50K%2B_pulls-2ea44f?logo=github&logoColor=white"
                      alt="GHCR pulls"
                    />
                  </a>
                  <a
                    href="https://hub.docker.com/r/codeswhat/drydock"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/docker/pulls/codeswhat/drydock?logo=docker&logoColor=white&label=Docker%20Hub"
                      alt="Docker Hub pulls"
                    />
                  </a>
                  <a
                    href="https://quay.io/repository/codeswhat/drydock"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/badge/Quay.io-image-ee0000?logo=redhat&logoColor=white"
                      alt="Quay.io"
                    />
                  </a>
                  <a
                    href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-informational?logo=linux&logoColor=white"
                      alt="Multi-arch"
                    />
                  </a>
                  <a
                    href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/docker/image-size/codeswhat/drydock/latest?label=image%20size"
                      alt="Container size"
                    />
                  </a>
                </div>
                {/* Community Badges */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <a
                    href="https://github.com/CodesWhat/drydock/stargazers"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/github/stars/CodesWhat/drydock?style=flat"
                      alt="Stars"
                    />
                  </a>
                  <a
                    href="https://github.com/CodesWhat/drydock/forks"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/github/forks/CodesWhat/drydock?style=flat"
                      alt="Forks"
                    />
                  </a>
                  <a
                    href="https://github.com/CodesWhat/drydock/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/github/issues/CodesWhat/drydock?style=flat"
                      alt="Issues"
                    />
                  </a>
                  <a href="LICENSE" target="_blank" rel="noopener noreferrer">
                    <img
                      src="https://img.shields.io/badge/license-AGPL--3.0-C9A227"
                      alt="License AGPL-3.0"
                    />
                  </a>
                  <a
                    href="https://github.com/CodesWhat/drydock/commits/main"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/github/last-commit/CodesWhat/drydock?style=flat"
                      alt="Last commit"
                    />
                  </a>
                  <a
                    href="https://github.com/CodesWhat/drydock/commits/main"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/github/commit-activity/m/CodesWhat/drydock?style=flat"
                      alt="Commit activity"
                    />
                  </a>
                  <a
                    href="https://github.com/CodesWhat/drydock/discussions"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/github/discussions/CodesWhat/drydock?style=flat"
                      alt="Discussions"
                    />
                  </a>
                  <a
                    href="https://github.com/veggiemonk/awesome-docker#container-management"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://awesome.re/mentioned-badge.svg"
                      alt="Mentioned in Awesome Docker"
                    />
                  </a>
                </div>
                {/* Quality & Security Badges */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <a
                    href="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml/badge.svg?branch=main"
                      alt="CI"
                    />
                  </a>
                  <a
                    href="https://www.bestpractices.dev/projects/11915"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://www.bestpractices.dev/projects/11915/badge"
                      alt="OpenSSF Best Practices"
                    />
                  </a>
                  <a
                    href="https://securityscorecards.dev/viewer/?uri=github.com/CodesWhat/drydock"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/ossf-scorecard/github.com/CodesWhat/drydock?label=openssf+scorecard&style=flat"
                      alt="OpenSSF Scorecard"
                    />
                  </a>
                  <a
                    href="https://app.codecov.io/gh/CodesWhat/drydock"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://codecov.io/gh/CodesWhat/drydock/graph/badge.svg?token=b90d4863-46c5-40d2-bf00-f6e4a79c8656"
                      alt="Codecov"
                    />
                  </a>
                  <a
                    href="https://snyk.io/test/github/CodesWhat/drydock"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img src="https://snyk.io/test/github/CodesWhat/drydock/badge.svg" alt="Snyk" />
                  </a>
                  <a
                    href="https://dashboard.stryker-mutator.io/reports/github.com/CodesWhat/drydock/main"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2FCodesWhat%2Fdrydock%2Fmain"
                      alt="Mutation testing"
                    />
                  </a>
                  <img
                    src="https://visitor-badge.laobi.icu/badge?page_id=getdrydock.com&left_text=site%20views"
                    alt="Site views"
                  />
                  <a href="https://ko-fi.com/codeswhat" target="_blank" rel="noopener noreferrer">
                    <img
                      src="https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white"
                      alt="Ko-fi"
                    />
                  </a>
                  <a
                    href="https://buymeacoffee.com/codeswhat"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buymeacoffee&logoColor=black"
                      alt="Buy Me a Coffee"
                    />
                  </a>
                  <a
                    href="https://github.com/sponsors/CodesWhat"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white"
                      alt="GitHub Sponsors"
                    />
                  </a>
                </div>
              </div>

              {/* Scroll Indicator */}
              <div className="mt-20 animate-bounce">
                <ChevronDown className="h-10 w-10 text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
              </div>
            </div>
          </section>

          {/* Features Grid */}
          <section className="px-4 py-24">
            <div className="mx-auto max-w-6xl">
              <div className="relative mb-12 text-center">
                <div className="pointer-events-none absolute inset-y-[-1.5rem] left-1/2 w-[30rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
                <h2 className="relative mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
                  Everything you need
                </h2>
                <p className="relative mx-auto max-w-2xl text-neutral-600 dark:text-neutral-400">
                  A complete solution for monitoring and managing container updates across your
                  infrastructure.
                </p>
              </div>

              <div className="overflow-hidden rounded-xl border border-neutral-300 dark:border-neutral-700">
                <div className="flex items-center gap-2 border-b border-neutral-300 bg-neutral-100 px-5 py-3 dark:border-neutral-700 dark:bg-neutral-900">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                    drydock capabilities
                  </span>
                  <span className="ml-auto font-mono text-xs text-neutral-400 dark:text-neutral-600">
                    {features.length} modules
                  </span>
                </div>
                <div className="divide-y divide-neutral-200 bg-white dark:divide-neutral-800 dark:bg-neutral-950">
                  {features.map((feature, i) => {
                    const cat = categoryLabels[feature.category];
                    return (
                      <div
                        key={feature.title}
                        className="group flex items-center gap-5 px-5 py-4 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/50"
                      >
                        <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-neutral-300 dark:text-neutral-700">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${feature.bg}`}
                        >
                          <feature.icon className={`h-4 w-4 ${feature.color}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-3">
                            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                              {feature.title}
                            </h3>
                            <span
                              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cat.border} ${cat.color}`}
                            >
                              {cat.label}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                            {feature.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Quick Start Section */}
          <section className="px-4 py-24">
            <div className="mx-auto max-w-3xl text-center">
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-[-1.5rem] left-1/2 w-[30rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
                <h2 className="relative mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
                  Get started in seconds
                </h2>
                <p className="relative mb-8 text-neutral-600 dark:text-neutral-400">
                  One command to start monitoring all your containers.
                </p>
              </div>

              {/* Code Block */}
              <Card className="mx-auto max-w-2xl border-neutral-200 bg-neutral-950 text-left dark:border-neutral-800">
                <CardContent className="pt-6">
                  <div className="mb-3 flex items-center gap-2 text-neutral-500">
                    <Terminal className="h-4 w-4" />
                    <span className="text-xs font-medium uppercase tracking-wider">Terminal</span>
                  </div>
                  <pre className="overflow-x-auto text-sm">
                    <code className="text-neutral-300">
                      <span className="text-neutral-500">$</span>{" "}
                      <span className="text-[#C4FF00]">docker run</span> -d \{"\n"}
                      {"  "}--name drydock \{"\n"}
                      {"  "}-v /var/run/docker.sock:/var/run/docker.sock \{"\n"}
                      {"  "}-p 3000:3000 \{"\n"}
                      {"  "}codeswhat/drydock
                    </code>
                  </pre>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Interactive Demo */}
          <DemoSection />

          {/* Roadmap Timeline */}
          <RoadmapTimeline roadmap={roadmap} />

          {/* Star History */}
          <section className="px-4 py-24">
            <div className="mx-auto max-w-3xl">
              <div className="relative mb-12 text-center">
                <div className="pointer-events-none absolute inset-y-[-1rem] left-1/2 w-[22rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
                <h2 className="relative mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
                  Star History
                </h2>
              </div>
              <a
                href="https://www.star-history.com/#CodesWhat/drydock&type=timeline&legend=top-left"
                target="_blank"
                rel="noopener noreferrer"
                className="block isolate overflow-hidden rounded-xl border border-neutral-200 bg-white/50 backdrop-blur-sm transition-all duration-300 hover:shadow-lg hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-neutral-700"
              >
                <picture>
                  <source
                    media="(prefers-color-scheme: dark)"
                    srcSet="https://api.star-history.com/svg?repos=CodesWhat/drydock&type=timeline&theme=dark&legend=top-left"
                  />
                  <source
                    media="(prefers-color-scheme: light)"
                    srcSet="https://api.star-history.com/svg?repos=CodesWhat/drydock&type=timeline&legend=top-left"
                  />
                  <img
                    src="https://api.star-history.com/svg?repos=CodesWhat/drydock&type=timeline&legend=top-left"
                    alt="Star History Chart"
                    className="w-full"
                  />
                </picture>
              </a>
            </div>
          </section>

          {/* Compare Section */}
          <section className="px-4 py-24">
            <div className="mx-auto max-w-3xl text-center">
              <div className="relative mb-8">
                <div className="pointer-events-none absolute inset-y-[-1.5rem] left-1/2 w-[30rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
                <h2 className="relative mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
                  Compare with alternatives
                </h2>
                <p className="relative mx-auto max-w-2xl text-neutral-600 dark:text-neutral-400">
                  See how Drydock stacks up against Watchtower, Portainer, Diun, and more.
                </p>
              </div>
              <Link
                href="/compare"
                className="group inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white/50 px-6 py-3 font-medium text-neutral-900 backdrop-blur-sm transition-all hover:border-neutral-300 hover:bg-white/80 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-100 dark:hover:border-neutral-700 dark:hover:bg-neutral-900/80"
              >
                View all comparisons
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </section>

          <SiteFooter />
        </div>
      </main>
    </>
  );
}
