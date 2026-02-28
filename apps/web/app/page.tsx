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
import { RoadmapTimeline } from "@/components/roadmap-timeline";
import { ScreenshotsSection } from "@/components/screenshots-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Container,
    title: "Auto-Discovery",
    emoji: "\u{1F50D}",
    color: "text-blue-500 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-900/50",
    description:
      "Automatically discovers running containers and tracks their image versions without manual configuration.",
  },
  {
    icon: Radio,
    title: "22 Registries",
    emoji: "\u{1F4E6}",
    color: "text-purple-500 dark:text-purple-400",
    bg: "bg-purple-100 dark:bg-purple-900/50",
    description:
      "Query Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, LSCR, ACR, Harbor, Artifactory, Nexus, and more.",
  },
  {
    icon: Bell,
    title: "20 Triggers",
    emoji: "\u{1F514}",
    color: "text-amber-500 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/50",
    description:
      "Notify via Slack, Discord, Telegram, Teams, SMTP, MQTT, HTTP, Gotify, NTFY, Kafka, and more.",
  },
  {
    icon: Eye,
    title: "Dry-Run Preview",
    emoji: "\u{1F441}\uFE0F",
    color: "text-cyan-500 dark:text-cyan-400",
    bg: "bg-cyan-100 dark:bg-cyan-900/50",
    description:
      "Preview updates before applying them. Pre-update image backup with one-click rollback.",
  },
  {
    icon: Network,
    title: "Distributed Agents",
    emoji: "\u{1F310}",
    color: "text-emerald-500 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-900/50",
    description:
      "Monitor remote Docker hosts via SSE-based agents. Centralized dashboard for all environments.",
  },
  {
    icon: BarChart3,
    title: "Prometheus Metrics",
    emoji: "\u{1F4CA}",
    color: "text-orange-500 dark:text-orange-400",
    bg: "bg-orange-100 dark:bg-orange-900/50",
    description:
      "Built-in /metrics endpoint with Grafana dashboard template. Full observability out of the box.",
  },
  {
    icon: History,
    title: "Audit Log",
    emoji: "\u{1F4DC}",
    color: "text-teal-500 dark:text-teal-400",
    bg: "bg-teal-100 dark:bg-teal-900/50",
    description:
      "Event-based audit trail with persistent storage. Full REST API and Prometheus counters.",
  },
  {
    icon: Lock,
    title: "OIDC Authentication",
    emoji: "\u{1F512}",
    color: "text-rose-500 dark:text-rose-400",
    bg: "bg-rose-100 dark:bg-rose-900/50",
    description:
      "Secure your instance with OpenID Connect. Works with Authelia, Auth0, and Authentik.",
  },
  {
    icon: RotateCcw,
    title: "Auto Rollback",
    emoji: "\u{1F504}",
    color: "text-indigo-500 dark:text-indigo-400",
    bg: "bg-indigo-100 dark:bg-indigo-900/50",
    description:
      "Automatic rollback on health check failure. Configurable image backup retention policies.",
  },
  {
    icon: Play,
    title: "Container Actions",
    emoji: "\u{25B6}\uFE0F",
    color: "text-green-500 dark:text-green-400",
    bg: "bg-green-100 dark:bg-green-900/50",
    description:
      "Start, stop, and restart containers directly from the UI or API. Feature-flagged for safety.",
  },
  {
    icon: Webhook,
    title: "Webhook API",
    emoji: "\u{1F517}",
    color: "text-sky-500 dark:text-sky-400",
    bg: "bg-sky-100 dark:bg-sky-900/50",
    description:
      "Token-authenticated HTTP endpoints for CI/CD integration. Trigger updates on demand.",
  },
  {
    icon: Layers,
    title: "Container Grouping",
    emoji: "\u{1F4DA}",
    color: "text-violet-500 dark:text-violet-400",
    bg: "bg-violet-100 dark:bg-violet-900/50",
    description:
      "Smart stack detection via compose project or labels. Collapsible groups with batch actions.",
  },
];

const screenshots = [
  {
    srcLight: "/screenshots/dashboard-light-desktop.png",
    srcDark: "/screenshots/dashboard-dark-desktop.png",
    alt: "Drydock Dashboard",
    label: "Dashboard",
  },
  {
    srcLight: "/screenshots/containers-light-desktop.png",
    srcDark: "/screenshots/containers-dark-desktop.png",
    alt: "Container List",
    label: "Containers",
  },
  {
    srcLight: "/screenshots/container-detail-light-desktop.png",
    srcDark: "/screenshots/container-detail-dark-desktop.png",
    alt: "Container Detail View",
    label: "Detail View",
  },
  {
    srcLight: "/screenshots/login-light-desktop.png",
    srcDark: "/screenshots/login-dark-desktop.png",
    alt: "Login Page",
    label: "Login",
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
      "Update Guard (block vulnerable deploys)",
      "SBOM generation (CycloneDX, SPDX)",
      "Image signing verification (cosign)",
    ],
  },
  {
    version: "v1.4.0",
    title: "UI Stack Modernization",
    emoji: "\u{1F3A8}",
    status: "next" as const,
    dotColor:
      "border-amber-500 bg-amber-50 text-amber-600 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-400",
    items: [
      "PrimeVue migration & Composition API",
      "Vite-native build cleanup",
      "Test & performance hardening",
      "UI personalization & font options",
    ],
  },
  {
    version: "v1.5.0",
    title: "Observability",
    emoji: "\u{26A1}",
    status: "planned" as const,
    dotColor:
      "border-sky-400 bg-sky-50 text-sky-500 dark:border-sky-500 dark:bg-sky-950 dark:text-sky-400",
    items: ["Real-time log viewer", "Container resource monitoring", "Registry webhook receiver"],
  },
  {
    version: "v1.6.0",
    title: "Notifications & Release Intel",
    emoji: "\u{1F4E8}",
    status: "planned" as const,
    dotColor:
      "border-orange-400 bg-orange-50 text-orange-500 dark:border-orange-500 dark:bg-orange-950 dark:text-orange-400",
    items: [
      "Notification templates",
      "Release notes in notifications",
      "MS Teams & Matrix triggers",
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
    items: ["Health check gate with auto-rollback", "Canary deployments (Kubernetes)"],
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
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com";

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
                v1.3.7 &middot; Open Source
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
                  updates across 22 registries, scan for vulnerabilities, and trigger notifications
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
                      src="https://img.shields.io/badge/GHCR-11.8K_pulls-2ea44f?logo=github&logoColor=white"
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
                      src="https://ghcr-badge.egpl.dev/codeswhat/drydock/size"
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
                </div>
                {/* Quality & Security Badges */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <a
                    href="https://github.com/CodesWhat/drydock/actions/workflows/ci.yml"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="https://github.com/CodesWhat/drydock/actions/workflows/ci.yml/badge.svg?branch=main"
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
                  <img
                    src="https://visitor-badge.laobi.icu/badge?page_id=drydock.codeswhat.com&left_text=site%20views"
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

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {features.map((feature) => (
                  <Card
                    key={feature.title}
                    className="border-neutral-200 bg-white/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50"
                  >
                    <CardContent className="pt-6">
                      <div className="mb-4 flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${feature.bg}`}
                        >
                          <feature.icon className={`h-5 w-5 ${feature.color}`} />
                        </div>
                        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
                          {feature.title}
                        </h3>
                      </div>
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        {feature.description}
                      </p>
                    </CardContent>
                  </Card>
                ))}
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

          {/* Screenshots Section */}
          <ScreenshotsSection screenshots={screenshots} />

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

          {/* Footer */}
          <footer className="px-4 py-8">
            <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Image
                  src="/codeswhat-logo.png"
                  alt="CodesWhat"
                  width={20}
                  height={20}
                  className="dark:invert"
                />
                <span>&copy; {new Date().getFullYear()} CodesWhat. AGPL-3.0 License.</span>
              </div>
              <div className="flex items-center gap-4">
                <a
                  href="https://github.com/CodesWhat/drydock"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full p-2 text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  aria-label="GitHub"
                >
                  <Github className="h-5 w-5" />
                </a>
                <Link
                  href="/docs"
                  className="rounded-full p-2 text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                  aria-label="Documentation"
                >
                  <BookOpen className="h-5 w-5" />
                </Link>
              </div>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}
