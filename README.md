<div align="center">

<img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat logo" width="120">
<br>
<img src="docs/assets/whale-logo.png" alt="What's Up Docker logo" width="420">

# What's Up Docker Community Edition

Community-maintained fork of [`getwud/wud`](https://github.com/getwud/wud).  
Keep your containers up-to-date.

</div>

<p align="center">
  <a href="docs/quickstart/README.md"><img src="https://img.shields.io/badge/docs-quickstart-1f6feb" alt="Quickstart docs"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/whatsupdocker-ce"><img src="https://img.shields.io/badge/GHCR-image-2ea44f" alt="GHCR package"></a>
</p>
<p align="center">
  <a href="https://github.com/CodesWhat/whatsupdocker-ce/stargazers"><img src="https://img.shields.io/github/stars/CodesWhat/whatsupdocker-ce?label=stars" alt="Fork stars"></a>
  <a href="https://github.com/CodesWhat/whatsupdocker-ce/forks"><img src="https://img.shields.io/github/forks/CodesWhat/whatsupdocker-ce?label=forks" alt="Fork forks"></a>
  <a href="https://github.com/CodesWhat/whatsupdocker-ce/issues"><img src="https://img.shields.io/github/issues/CodesWhat/whatsupdocker-ce?label=issues" alt="Fork issues"></a>
  <a href="https://github.com/CodesWhat/whatsupdocker-ce/commits/main"><img src="https://img.shields.io/github/last-commit/CodesWhat/whatsupdocker-ce?label=updated" alt="Last commit"></a>
</p>

---

## Contents
- [Quick Start](#quick-start)
- [What's Updated From Original WUD](#whats-updated-from-original-wud)
- [Moving From Old WUD Image](#moving-from-old-wud-image)
- [Configuration and Usage Docs](#configuration-and-usage-docs)
- [Support](#support)
- [Build and Tooling](#build-and-tooling)
- [License](#license)

---

## Quick Start

### Installation

| Method | Command |
| --- | --- |
| Pull image | `docker pull ghcr.io/codeswhat/whatsupdocker-ce:live-test` |
| Run container | `docker run -d --name whatsupdocker-ce -p 3000:3000 -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/codeswhat/whatsupdocker-ce:live-test` |

### Verify
```bash
curl http://localhost:3000/health
```

### Open UI
`http://localhost:3000`

### If GHCR Requires Auth
If the package is private, login first:

```bash
echo '<GITHUB_PAT>' | docker login ghcr.io -u <github-username> --password-stdin
```

Then run the same `docker pull` and `docker run` commands above.

---

## What's Updated From Original WUD
This repo is not just a rename. It includes upstream improvements after old WUD `8.1.1` plus CE-specific work.

Compare snapshot:

- old WUD reference release: `8.1.1` (July 6, 2025)
- CE upstream sync baseline: `76e2099` (November 27, 2025)
- CE-specific commits after baseline: tooling + branding/docs + fork alignment

### Side-by-side highlights

| Area | Original WUD (`getwud/wud`) | This fork (`whatsupdocker-ce`) |
| --- | --- | --- |
| Dependencies/tooling | ESLint + Prettier toolchain | Biome-only lint/format stack (`app`, `ui`, `e2e`) |
| Runtime/container base | Older image base in 8.1.1 line | Alpine-based runtime path and refreshed dependency set in post-8.1.1 sync |
| Config editing ergonomics | Legacy docs/examples and links | Fork-aligned docs/examples, in-app config docs links point to this repo |
| Scheduling/update control | Basic threshold and tag handling | Expanded threshold controls (`major-only`, `minor-only`, `patch`) + stronger tag filtering and semver/prefix handling |
| Triggering updates | Core triggers | Added Rocket.Chat trigger + better invalid-trigger diagnostics |
| Registry coverage | Standard set | Added TrueForge OCI registry support |
| Compose-driven updates | Baseline behavior | `compose-file` label support for easier compose update workflows |

### Concrete improvements included from upstream sync line

- Vue 3 migration and related UI modernization
- dependency upgrades and `request` to `axios` migration
- image lookup failure fix that prevented blank container lists
- MQTT/Home Assistant topic/entity improvements
- TrueForge support
- compose-file label support
- `.sig` and `sha*` tag filtering hardening
- semver parsing/prefix/part-count behavior fixes
- digest pinning ignore narrowed to Docker Hub
- improved webhook trigger error messaging
- Rocket.Chat trigger support

---

## Moving From Old WUD Image
If you were using `getwud/wud`, switch only the image reference:

- old: `getwud/wud:<tag>`
- new: `ghcr.io/codeswhat/whatsupdocker-ce:live-test`

Your Docker socket mount and most runtime settings stay the same.

---

## Configuration and Usage Docs
- Upstream docs: [https://getwud.github.io/wud/](https://getwud.github.io/wud/)

## Support
- CE issues and requests: [Project issues](https://github.com/CodesWhat/whatsupdocker-ce/issues)
- Upstream project: [https://github.com/getwud/wud](https://github.com/getwud/wud)

## Build and Tooling
- `Node 24 Alpine` [![Node 24 Alpine](https://img.shields.io/badge/node-24--alpine-339933?logo=node.js&logoColor=white)](Dockerfile)
- `Vue 3` [![Vue 3](https://img.shields.io/badge/Vue-3.x-42b883?logo=vuedotjs&logoColor=white)](ui/package.json)
- `Biome 2.3.14` [![Biome 2.3.14](https://img.shields.io/badge/Biome-2.3.14-60a5fa?logo=biome&logoColor=white)](biome.json)
- `License MIT` [![License MIT](https://img.shields.io/badge/license-MIT-C9A227)](LICENSE)

## License
This project is licensed under the [MIT license](https://github.com/CodesWhat/whatsupdocker-ce/blob/main/LICENSE).
