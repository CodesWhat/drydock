export const faqItems: Array<{ question: string; answer: string }> = [
  {
    question: "How does Drydock detect when a container image has a newer version?",
    answer:
      "On every poll cycle Drydock reads the image reference and current digest from each watched container, then queries the upstream registry for available tags. It applies your per-container tag filters (dd.tag.include / dd.tag.exclude regex patterns compiled with re2js for linear-time evaluation) and semantic-version ordering to determine the latest eligible tag. If the latest digest differs from the running one, the container is flagged as having an available update. SSE keeps connected browser sessions in sync in real time without polling on the client side.",
  },
  {
    question: "Which container registries does Drydock support?",
    answer:
      "Drydock ships with 23 registry providers: Docker Hub, GitHub Container Registry (GHCR), Amazon ECR, Google Container Registry (GCR), Google Artifact Registry (GAR), GitLab Registry, Red Hat Quay, LinuxServer Container Registry (LSCR), Azure Container Registry (ACR), Harbor, JFrog Artifactory, Sonatype Nexus, Gitea, Forgejo, Portus, and more — plus a generic private-registry provider for anything that speaks HTTP Basic or bearer token auth. TLS customization (CA file, insecure skip-verify) is available on every provider.",
  },
  {
    question: "What is the difference between a notification and an action trigger?",
    answer:
      "Notifications (DD_NOTIFICATION_* env vars) send a message when an update is detected — Slack, Discord, Telegram, Microsoft Teams, SMTP, Gotify, NTFY, MQTT, Kafka, HTTP webhooks, and more. Actions (DD_ACTION_* env vars) execute the update: the docker action re-pulls and restarts the container, dockercompose runs docker compose pull/up on your stack, and command invokes an arbitrary shell script. You can combine both in the same pipeline — notify a channel and apply the update. Note: DD_TRIGGER_* is a deprecated alias scheduled for removal; use the canonical DD_NOTIFICATION_* or DD_ACTION_* prefix in any new config.",
  },
  {
    question: "How do I control which containers Drydock watches and which tags it considers?",
    answer:
      "Add Docker labels to your containers. dd.watch=true opts a container in (or set DD_WATCHER_LOCAL_ALLCONTAINERS=true to watch everything by default). Use dd.tag.include with a regex to restrict which tags are eligible — for example dd.tag.include=^\\d+\\.\\d+\\.\\d+$ to match only semver tags. dd.tag.exclude filters out tags that match. dd.tag.transform applies a rewrite to the tag string before matching. dd.display.name overrides the container name shown in the dashboard, and dd.group groups containers into collapsible stacks.",
  },
  {
    question: "What is the controller-agent architecture and when do I need it?",
    answer:
      "A Drydock instance can run as a controller (hosts the REST API and dashboard), an agent (runs watchers and triggers on a remote Docker host), or both. Agents stream container events back to the controller over SSE, so you can monitor containers spread across multiple hosts or cloud environments from a single dashboard — no raw Docker socket needs to be exposed across the network. A single-host setup runs everything in one container; add agents with DD_AGENT_* variables when you need to reach remote hosts.",
  },
  {
    question: "How does Drydock compare to Watchtower?",
    answer:
      "Watchtower auto-updates containers on a schedule with minimal config and no UI. Drydock is an update management platform: it detects what is available, shows you a dashboard, lets you preview and approve changes, backs up images before applying them, and rolls back automatically if the new container fails its health check. It also adds security scanning (Trivy CVEs, SBOM generation, Cosign signature verification) and per-container update policies. If you want silent automatic updates, Watchtower is simpler. If you want visibility, control, security gates, and notification integrations, Drydock fits better.",
  },
  {
    question: "Does Drydock support vulnerability scanning and image signature verification?",
    answer:
      "Yes. Drydock integrates Trivy for CVE scanning and SBOM generation for any image in your update queue. The Update Bouncer deployment gate supports Cosign signature verification — you can block an update from being applied if the new image is unsigned or signed by an unexpected identity. Scanning and verification are opt-in per container or globally, and results surface in the dashboard alongside the available-update list so you can make an informed decision before pulling.",
  },
  {
    question: "Is Drydock open source, and how do I get started?",
    answer:
      "Drydock is AGPL-3.0 licensed and free to self-host. The fastest path is a single docker run mounting /var/run/docker.sock and setting DD_WATCHER_LOCAL_SOCKET=/var/run/docker.sock — the dashboard is available on port 3000. For production, use Docker Compose with a persistent volume at /store for the database and add a notification trigger such as DD_NOTIFICATION_SLACK_* for update alerts. Authentication is supported via OIDC (Authelia, Auth0, Authentik) or the built-in username/password. Full configuration docs are at getdrydock.com/docs.",
  },
];
