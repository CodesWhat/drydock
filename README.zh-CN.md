<div align="center">

<p><a href="README.md">English</a> · <a href="README.es.md">Español</a> · <a href="README.pl.md">Polski</a> · <strong>简体中文</strong> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.pt-BR.md">Português (Brasil)</a></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/whale-logo-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/whale-logo.png" />
  <img src="docs/assets/whale-logo.png" alt="drydock" width="220">
</picture>

<h1>drydock</h1>

**容器镜像更新观察程序 — 23 个注册表、20 个通知和操作提供程序。**

</div>

<p align="center"><a href="https://github.com/CodesWhat/drydock/releases"><img src="https://img.shields.io/github/v/release/CodesWhat/drydock?include_prereleases&label=release" alt="Release"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-informational?logo=linux&logoColor=white" alt="Multi-arch"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/CodesWhat/drydock" alt="License"></a>
  <br>
  <a href="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml"><img src="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/CodesWhat/drydock"><img src="https://img.shields.io/ossf-scorecard/github.com/CodesWhat/drydock?label=openssf+scorecard&style=flat" alt="OpenSSF Scorecard"></a>
  <a href="https://www.bestpractices.dev/projects/11915"><img src="https://www.bestpractices.dev/projects/11915/badge" alt="OpenSSF Best Practices"></a>
  <a href="https://qlty.sh/gh/CodesWhat/projects/drydock"><img src="https://qlty.sh/gh/CodesWhat/projects/drydock/maintainability.svg" alt="Maintainability"></a>
  <a href="https://dashboard.stryker-mutator.io/reports/github.com/CodesWhat/drydock/main"><img src="https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2FCodesWhat%2Fdrydock%2Fmain" alt="Mutation testing"></a>
  <a href="https://codecov.io/gh/CodesWhat/drydock"><img src="https://codecov.io/gh/CodesWhat/drydock/graph/badge.svg" alt="Coverage"></a>
  <br>
  <a href="https://hub.docker.com/r/codeswhat/drydock"><img src="https://img.shields.io/docker/pulls/codeswhat/drydock?logo=docker&logoColor=white&label=Docker+Hub" alt="Docker Hub pulls"></a>
  <a href="https://github.com/CodesWhat/drydock/stargazers"><img src="https://img.shields.io/github/stars/CodesWhat/drydock?style=flat" alt="Stars"></a>
  <a href="https://github.com/veggiemonk/awesome-docker#container-management"><img src="https://awesome.re/mentioned-badge.svg" alt="Mentioned in Awesome Docker"></a>
  <a href="https://crowdin.com/project/drydock"><img src="https://badges.crowdin.net/drydock/localized.svg" alt="Crowdin localization"></a>
  <a href="https://github.com/sponsors/CodesWhat"><img src="https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white" alt="Sponsor"></a>
</p>

<hr>

> [!WARNING]
> **从旧版本更新？首先阅读升级说明。** 三个安全强化修复程序首先在 **1.4.6** 中发布，并贯穿整个 **1.5** 系列，因此从早于 1.4.6 的版本进行更新的任何人都会受到影响，无论他们登陆的是哪个版本（1.4.6、任何 1.5.x 或更高版本）。它们不是弃用，也没有宽限期：OIDC 现在要求您的提供商的发现元数据中包含 `authorization_endpoint`，TCP 对等地址上未经身份验证的速率限制密钥（反向代理后面的共享存储桶），并且 HTTP 触发代理 URL 必须使用 `http(s)://`。更新前请参阅 **[UPGRADE-NOTES.md](UPGRADE-NOTES.md)**。

<!-- separate alerts: a blank-line-only gap between blockquotes trips markdownlint MD028 -->

> [!WARNING]
> **正在升级到 1.6.0-rc.3 或更高版本？** 更多安全强化措施会立即生效，没有宽限期。未配置身份验证，或已启用但尚未确认匿名身份验证的实例，在升级后会像新安装一样以故障关闭方式运行：容器保持运行，受保护的 API 请求返回 `401`，公共身份验证发现和状态路由仍可访问，`/health` 返回 `503`。SPA 外壳仍可能加载，但无法读取受保护的数据。升级前请设置 `DD_ANONYMOUS_AUTH_CONFIRM=true`，或配置 `DD_AUTH_BASIC_*`/OIDC。会话 cookie 从 `connect.sid` 更名为 `drydock.sid`，因此所有现有用户会被注销一次。HTTP 通知触发器、Hass webhook 和注册表图标获取现在通过受保护的 DNS 查询解析主机名，阻止云元数据和 link-local 目标，并且绝不跟随重定向。仅在确实需要时为特定 `DD_NOTIFICATION_HTTP_*` 触发器设置 `allowmetadata=true`。完整迁移说明请参阅 **[DEPRECATIONS.md](DEPRECATIONS.md#enforced-security-changes-no-deprecation-window)**。

<h2 align="center">内容</h2>

- [文档](#documentation)
- [快速入门](#quick-start)
- [最近更新](#recent-updates)
- [屏幕截图和现场演示](#screenshots)
- [为什么是 Drydock](#why-drydock)
- [特点](#features)
- [支持的集成](#supported-integrations)
- [功能比较](#feature-comparison)
- [迁移](#migration)
- [路线图](#roadmap)
- [星史](#star-history)
- [技术栈](#built-with)
- [社区与支持](#community-support)
- [CodesWhat 生态系统](#codeswhat-ecosystem)

<h2 align="center" id="documentation">文档</h2>

| 资源           | 链接                                                                                 |
| ------------ | ---------------------------------------------------------------------------------- |
| 网站           | [getdrydock.com](https://getdrydock.com/)                           |
| 现场演示         | [demo.getdrydock.com](https://demo.getdrydock.com) |
| 文档           | [getdrydock.com/docs](https://getdrydock.com/docs)                 |
| 配置           | [配置](https://getdrydock.com/docs/configuration)                                    |
| 快速入门         | [快速入门](https://getdrydock.com/docs/quickstart)                                     |
| 更新日志         | [`CHANGELOG.md`](CHANGELOG.md)                                                     |
| 弃用           | [`DEPRECATIONS.md`](DEPRECATIONS.md)                                               |
| 路线图          | 请参阅上面的[路线图](#roadmap) 部分                                                           |
| 贡献           | [`CONTRIBUTING.md`](CONTRIBUTING.md)                                               |
| 行为准则         | [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)                                         |
| 治理           | [`GOVERNANCE.md`](GOVERNANCE.md)                                                   |
| 安全保证         | [`SECURITY-ASSURANCE.md`](SECURITY-ASSURANCE.md)                                   |
| 安全政策         | [`SECURITY.md`](SECURITY.md)                                                       |
| 问题           | [GitHub 问题](https://github.com/CodesWhat/drydock/issues)                           |
| 讨论           | [GitHub 讨论](https://github.com/CodesWhat/drydock/discussions) — 欢迎功能请求和想法          |

<hr>

<h2 align="center" id="quick-start">快速入门</h2>

**推荐：使用套接字代理**来限制哪些 Docker API 端点 Drydock 可以访问。这可以避免容器完全访问 Docker 套接字。

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      socket-proxy:
        condition: service_healthy
    environment:
      - DD_WATCHER_LOCAL_HOST=socket-proxy
      - DD_WATCHER_LOCAL_PORT=2375
      - DD_AUTH_BASIC_ADMIN_USER=admin
      - "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>"
    ports:
      - 3000:3000

  socket-proxy:
    image: tecnativa/docker-socket-proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - CONTAINERS=1
      - IMAGES=1
      - EVENTS=1
      - SERVICES=1
      - INFO=1          # Required for daemon identity detection (notification prefixes)
      # Add POST=1 and NETWORKS=1 for container actions and auto-updates
    healthcheck:
      test: wget --spider http://localhost:2375/version || exit 1
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped
```

<details>
<summary>替代方案：<a href="https://github.com/CodesWhat/sockguard">sockguard</a>套接字代理</summary>

[sockguard](https://github.com/CodesWhat/sockguard) 是来自同一 CodesWhat 生态系统的默认拒绝 Docker 套接字过滤器，具有为 drydock 构建的预设：

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      sockguard:
        condition: service_healthy
    environment:
      - DD_WATCHER_LOCAL_HOST=sockguard
      - DD_WATCHER_LOCAL_PORT=2375
      - DD_AUTH_BASIC_ADMIN_USER=admin
      - "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>"
    ports:
      - 3000:3000

  sockguard:
    image: codeswhat/sockguard
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./sockguard.yaml:/etc/sockguard/config.yaml:ro
    environment:
      - SOCKGUARD_CONFIG_FILE=/etc/sockguard/config.yaml
    healthcheck:
      test: wget --spider http://localhost:2375/version || exit 1
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped
```

请参阅 sockguard 的 [`app/configs/portwing.yaml`](https://github.com/CodesWhat/sockguard/blob/dev/v1.5/app/configs/portwing.yaml) 预设，了解起始 `sockguard.yaml`（相同的预设 portwing 在其自己的示例中提供）。

</details>

<details>
<summary>替代方案：通过直接挂载套接字快速启动</summary>

```bash
docker run -d \
  --name drydock \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e DD_AUTH_BASIC_ADMIN_USER=admin \
  -e "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>" \
  codeswhat/drydock:latest
```

> **警告：** 直接套接字访问授予容器对 Docker 守护进程的完全控制权。使用上面的套接字代理设置进行生产部署。请参阅 [Docker Socket 安全指南](https://getdrydock.com/docs/configuration/watchers#docker-socket-security) 了解所有选项，包括远程 TLS 和 rootless Docker。

</details>

> 生成密码哈希（`argon2` CLI — 通过包管理器安装）：
>
> ```bash
> echo -n "yourpassword" | argon2 $(openssl rand -base64 32) -id -m 16 -t 3 -p 4 -l 64 -e
> ```
>
> 或者使用 Node.js 24.7+（不需要额外的包）：
>
> ```bash
> node -e 'const c=require("node:crypto");const s=c.randomBytes(32);const h=c.argon2Sync("argon2id",{message:process.argv[1],nonce:s,memory:65536,passes:3,parallelism:4,tagLength:64});console.log("argon2id$65536$3$4$"+s.toString("base64")+"$"+h.toString("base64"));' "yourpassword"
> ```
>
> Drydock v1.6 仅接受 argon2id 基本身份验证哈希值。旧版 `{SHA}`、`$apr1$`/`$1$`、`crypt` 和纯文本哈希被拒绝；在升级之前重新生成它们。
> **默认情况下需要身份验证**。有关 OIDC、匿名访问和其他选项，请参阅 [auth docs](https://getdrydock.com/docs/configuration/authentications)。
> 新安装和升级后的实例都必须通过 `DD_ANONYMOUS_AUTH_CONFIRM=true` 明确确认匿名访问。若未确认，无论是未配置身份验证还是匿名身份验证尚未确认，实例都会以故障关闭模式启动：受保护的 API 请求返回 `401`，公共身份验证发现和状态路由仍可用，`/health` 返回 `503`。

该镜像包含`trivy`和`cosign`二进制文件，用于本地漏洞扫描和镜像验证。

有关 Docker Compose、套接字安全、反向代理和替代注册表，请参阅[快速入门指南](https://getdrydock.com/docs/quickstart)。

<hr>

<h2 align="center" id="recent-updates">最近更新</h2>

<details open>
<summary><strong>v1.7.0-rc.5 亮点</strong></summary>

- **一次安全加固修复了 Portwing 与调试/诊断层面的五个问题** — 格式错误的 Portwing hello 负载现在会在解析前先完成校验，而不是在回调错误边界之外抛出异常；代理容器的所有权现在会在更新/删除边界处强制校验；脱敏现在还能捕获 `*_PAT` 值以及嵌入 URL 中的凭据（包括相对协议的 URL）；被拒来源的诊断路径现在也有速率限制。([#904](https://github.com/CodesWhat/drydock/pull/904))
- **暗色主题现在满足 WCAG 2.2 最低对比度要求** — 次要/弱化文本、色调颜色、toast 提示背景以及主按钮文字标签均已提升，在全部六种暗色主题下相对其实际绘制的背景都能达到 4.5:1。([#850](https://github.com/CodesWhat/drydock/issues/850)、[#865](https://github.com/CodesWhat/drydock/discussions/865))
- **大规模集群与慢客户端不再拖垮控制器连接** — 缓存的 watcher 重放超过 256 KiB 的代理此前永远无法重新连接，现在通过保持流处于打开状态、让已认证的握手来补充状态解决了这个问题；落后的 SSE 客户端现在会获得有边界、感知背压、按顺序投递的数据，而不是被丢弃的写入或无限增长的内存占用；系统日志限流器不再回退到空标识；不受支持的代理传输现在会在准入阶段就被拒绝，而不是之后才失败。([#904](https://github.com/CodesWhat/drydock/pull/904))
- **更新与 watcher 的生命周期状态在重启和拆卸过程中都保持准确** — 启动恢复不再把未被改动的容器标记为已更新，重启不再抑制仍在进行中的更新的批次完成事件，从未真正开始的更新不再被报告为失败，配置过程中被拆卸的 watcher 不再会被延迟到达的回调重新唤醒，并发解析的 Docker 事件分片也不再争抢同一个共享缓冲区。([#904](https://github.com/CodesWhat/drydock/pull/904))
- **备份、回滚与容器列表的正确性修复** — 备份现在携带稳定的作用域身份，而不是在共享容器名称时发生冲突；回滚现在会恢复备份中记录的摘要，而不是可变标签当前指向的内容；并发的摘要扫描不再互相取消；成功的容器操作在后续刷新失败时不再返回 500；分页的容器列表现在按全局排序，而不仅仅是在单页内排序。([#904](https://github.com/CodesWhat/drydock/pull/904))
- **Crowdin 同步工作流在非默认 dev 分支上不再失败** — 推送到并非最新的 `dev/vX.Y` 分支此前会因基准解析器始终选择最高的 dev 分支（而不管是哪个 ref 触发了运行）而以检出冲突告终；现在推送会直接定位到自己所在的分支。([run 33047712284](https://github.com/CodesWhat/drydock/actions/runs/33047712284))

完整发行说明请参阅 [CHANGELOG.md](./CHANGELOG.md#170-rc5--2026-08-27)。

</details>

<details>
<summary><strong>v1.7.0-rc.4 亮点</strong></summary>

- **WebSocket 日志流现在可在 TLS 终止代理后正常工作** — 当启用 trust proxy 且升级请求中缺少 `X-Forwarded-Proto` 时，来源检查不再回退到本地 socket 的 TLS 状态（TLS 终止后端为纯 HTTP，导致每个浏览器连接都被 403 拒绝）；协议现在被视为未知，主机校验保持不变。Traefik 会将升级请求面向客户端的协议转发为 `wss` 而非 `https`（traefik/traefik#6388），而来源检查会直接拒绝该值，因此仅靠第一个修复在默认 Traefik 配置下仍会返回 403；`ws`/`wss` 现在会映射为 `http:`/`https:` 参与来源比较。([#867](https://github.com/CodesWhat/drydock/issues/867)、[#868](https://github.com/CodesWhat/drydock/pull/868)、[#887](https://github.com/CodesWhat/drydock/pull/887))
- **当存储卷拒绝 `chmod` 时启动不再崩溃** — 1.6.0 版本引入的权限加固在遇到 `EPERM` 时会抛出异常，导致拒绝 `chmod` 的挂载（NFS/CIFS 卷、非 root 容器）在启动时使整个进程崩溃，并彻底阻塞从 1.6.0 的升级；现在遇到 `EPERM`/`EACCES`/`ENOTSUP` 时只会发出警告并继续运行；真正只读的卷（`EROFS`）在启动时仍会快速失败，因为那里本来就无法持久化任何数据。([#874](https://github.com/CodesWhat/drydock/discussions/874)、[#886](https://github.com/CodesWhat/drydock/pull/886))
- **调试转储此前隐藏的是环境变量的名称而非值** — 环境变量条目是 `{key, value}` 键值对，脱敏遍历逻辑此前将属性字面名称 `key` 与敏感标记规则进行匹配，导致像 `HF_TOKEN` 这样的变量会隐藏名称、而实际密钥以明文呈现；现在名称始终可见，仅当名称匹配敏感规则时才会对值进行脱敏。([#875](https://github.com/CodesWhat/drydock/issues/875)、[#885](https://github.com/CodesWhat/drydock/pull/885))
- **纯数字标签不再超过带点号的版本号** — 像 `168` 这样的构建计数器标签不再被强制转换为虚假的 `168.0.0` 从而超过真实版本 `1.43.3`；建议标签徽章和可操作的 `includeTags` 恢复路径现在共享同一条分区规则，因此二者不会再出现分歧。([#859](https://github.com/CodesWhat/drydock/issues/859)、[#871](https://github.com/CodesWhat/drydock/pull/871))
- **基础镜像清除了六个高危 OpenSSL CVE** — `node:24-alpine` 与 `alpine:3.24` 的摘要固定版本以及 `openssl` 的 apk 固定版本均升级至 OpenSSL 3.5.8-r0。([#881](https://github.com/CodesWhat/drydock/pull/881))
- **演示站点现在发送完整的安全响应头集合** — DAST 标记为缺失的响应头现在已在演示环境中发送。([#878](https://github.com/CodesWhat/drydock/pull/878))
- **脱离监视范围的容器会从存储和界面中清除** — 因 `watchbydefault` 被关闭或 `dd.watch` 标签被移除而被排除的容器，此前只要仍能在 Docker 中被成功 inspect，就会一直保留过期记录；已停止但仍在监视范围内的容器保持原有的启动按钮行为。([#869](https://github.com/CodesWhat/drydock/issues/869)、[#888](https://github.com/CodesWhat/drydock/pull/888))

完整发行说明请参阅 [CHANGELOG.md](./CHANGELOG.md#170-rc4--2026-08-26)。

</details>

<details>
<summary><strong>v1.7.0-rc.3 亮点</strong></summary>

- **Portwing 边缘隧道现在可传输非 JSON 响应体** — 控制器的欢迎帧现在会宣告 `edge-response-body-b64` 能力，并为支持该能力的代理解码经 base64 协商的 Docker 响应体（例如 `_ping` 的纯文本响应 "OK"）；此变更是增量式的，并受能力协商门控。([#852](https://github.com/CodesWhat/drydock/pull/852))
- **README 徽章现在实时读取** — 版本、许可证、下载量和星标徽章现在从实时的 shields.io 端点渲染，而不再是静态图片，星标历史图表现在以匹配主题的浅色/深色一对形式呈现，并在发布切割时而非通过定时任务重新生成。([#851](https://github.com/CodesWhat/drydock/pull/851)、[#844](https://github.com/CodesWhat/drydock/pull/844)、[#847](https://github.com/CodesWhat/drydock/pull/847))
- **DAST 与工作流 lint 关卡现在默认拒绝失败** — ZAP 扫描不再忽略所有警告，pre-push 的 zizmor 步骤在缺少二进制文件时会报错并给出安装提示，而不是静默跳过。([#842](https://github.com/CodesWhat/drydock/pull/842))
- **每日监控确认 `main` 携带发布标签** — 一个按计划运行的只读工作流会在 `main` 的 HEAD 未打标签时报红。([#846](https://github.com/CodesWhat/drydock/pull/846))
- **发布流水线修复** — 修复了 rc.2 切割时的 CI 故障：回滚了破坏 Artillery 负载测试的错误 js-yaml 覆盖，并将两处 Playwright 等待时间放宽到超过应用自身的操作预算。([#829](https://github.com/CodesWhat/drydock/pull/829)、[#836](https://github.com/CodesWhat/drydock/pull/836))

完整发行说明请参阅 [CHANGELOG.md](./CHANGELOG.md#170-rc3--2026-08-23)。

</details>

<details>
<summary><strong>v1.7.0-rc.2 亮点</strong></summary>

- **按容器解析操作策略** — API 和界面现在会显示每个容器已解析的状态（blocked/manual/auto）以及胜出的触发器，并新增 `dd.action.auto` 标签和 `AUTO=onauto` 模式，可实现仅手动访问而不自动派发。
- **本周期的不兼容变更** — `DD_TRIGGER_*`/`dd.trigger.*` 已被彻底移除，`trigger-excluded`/`trigger-not-included` 现在会硬性阻止更新，Home Assistant 的 MQTT 主题布局默认新增 `agent/<name>` 段，`GET /api/auth/methods` 现在返回 410，且镜像中已移除 `curl`。
- **更新检查正确性修复** — 检查过程中的注册表错误不再误报为"Up to date"，格式错误的容器不再清空整个代理清单同步，嵌套的 OCI 镜像索引现在能正确解析到实际清单。([#814](https://github.com/CodesWhat/drydock/issues/814))
- **依赖关系与自我更新修复** — 被拒绝的依赖成员现在会保留其重启上下文，Compose 刷新不再带入镜像继承的过期环境变量默认值，更新策略覆盖设置现在能在 drydock 自我更新后保留。([#718](https://github.com/CodesWhat/drydock/pull/718)、[#736](https://github.com/CodesWhat/drydock/pull/736)、[#743](https://github.com/CodesWhat/drydock/pull/743))
- **安全** — 修复了容器列表 URL 查询同步中的远程属性注入路径，并将 Grype 镜像门限收窄到一个尚待上游修复的 Alpine CVE。([#750](https://github.com/CodesWhat/drydock/pull/750))

完整发行说明请参阅 [CHANGELOG.md](./CHANGELOG.md#170-rc2--2026-08-20)。

</details>

<details>
<summary><strong>v1.7.0-rc.1 亮点</strong></summary>

- **依赖感知更新** — 通过标签或 Compose 元数据构建经过验证的依赖关系图，预览准确的更新波次，并按确定的顺序执行更新或重启依赖项，同时安全处理循环依赖、失败和过期预览。([讨论 #219](https://github.com/CodesWhat/drydock/discussions/219))
- **运维体验** — 可安装的 PWA、可点击的命名端口链接、实时容器运行时间、键盘快捷键，以及对新发现容器的防抖检测。
- **不兼容的触发器迁移** — `DD_TRIGGER_*` 现在会阻止启动，旧的 `dd.trigger.include` / `dd.trigger.exclude` 标签也不再分派任务；请改用 `DD_ACTION_*`、`DD_NOTIFICATION_*` 及其作用域标签。
- **安全与生命周期强化** — 身份验证、代理请求、日志、WebSocket 和镜像仓库请求均有明确的资源限制；敏感的命令和钩子值会被遮盖；Home Assistant 发现会在启动后重新同步，并在停用提供程序任务时避免发布过期数据。([#708](https://github.com/CodesWhat/drydock/issues/708))

完整发行说明请参阅 [CHANGELOG.md](./CHANGELOG.md#170-rc1--2026-08-14)。

</details>

<details>
<summary><strong>v1.6.0 亮点</strong></summary>

- **Portwing Edge/代理传输趋于成熟**：Portwing 0.9.0+ 支持由控制器执行原生 Docker 检查和更新、连续 Edge 日志、Ed25519 v2 请求签名，以及与签名密钥绑定的代理显示名称。([#632](https://github.com/CodesWhat/drydock/issues/632)、[#637](https://github.com/CodesWhat/drydock/issues/637))
- **带成熟度稳定门的声明式更新策略**：三级 `dd.updatePolicy.*` 优先级、候选解锁倒计时和专用 `maturity-cleared` 通知。([讨论 #307](https://github.com/CodesWhat/drydock/discussions/307)、[讨论 #406](https://github.com/CodesWhat/drydock/discussions/406))
- **每条规则的通知模板、铃铛偏好和新 `container-unhealthy` 事件**，以及双向 Home Assistant MQTT，其“安装”按钮会触发实际更新。([讨论 #205](https://github.com/CodesWhat/drydock/discussions/205)、[讨论 #198](https://github.com/CodesWhat/drydock/discussions/198))
- **所有主要列表视图均支持响应式布局**，使用共享 `DataTable` 和持久化的表格/卡片切换。([#498](https://github.com/CodesWhat/drydock/issues/498))
- **完成 `/api/v1` 对等功能**：移除 `/api/*` 和 `WS /api/log/stream`（`410 Gone`），可选 `DD_COMPAT_WUDCARD` 兼容 wud-card/Homepage。([讨论 #469](https://github.com/CodesWhat/drydock/discussions/469))
- **安全强化**：升级时匿名访问也会故障关闭，HTTP 触发器具备 SSRF 防护，WebSocket 检查完整来源，会话 cookie 更名为 `drydock.sid`。

完整发行说明见 [CHANGELOG.md](./CHANGELOG.md#160--2026-08-11)。

</details>

<details>
<summary><strong>v1.6.0-rc.13 亮点</strong></summary>

- **摘要比较仅使用匹配仓库的候选项**：`getOrderedRepoDigests` 会筛选 `RepoDigests`，并可自动修复过期锚点。([#670](https://github.com/CodesWhat/drydock/pull/670))
- **所有工作区将 `nanoid` 固定为 3.3.18**，修复 CVE-2026-67213 和 CVE-2026-67214。([#673](https://github.com/CodesWhat/drydock/pull/673))
- **Star History 改为自行托管**，使用同源 `/api/star-history` 路由、边缘缓存和备用 SVG。([#672](https://github.com/CodesWhat/drydock/pull/672))
- **基础镜像更新**：`node:24-alpine` 使用 Node 24.19.0，`aquasec/trivy` 构建阶段使用 0.73.0。([#682](https://github.com/CodesWhat/drydock/pull/682))
- **图标别名解析**覆盖完整图标包并由测试保护。([#683](https://github.com/CodesWhat/drydock/pull/683))

</details>

<details>
<summary><strong>v1.6.0-rc.12 亮点</strong></summary>

- **安全依赖更新**：`brace-expansion` 5.0.9、`ip-address` 10.3.1 和 `fast-uri` 4.1.2。([#659](https://github.com/CodesWhat/drydock/pull/659))
- **成熟度时钟**在显示和阻止逻辑中共同使用 `updatePolicy.maturityMinAgeDays`，日期错误从 `debug` 提升为 `warn`。([#604](https://github.com/CodesWhat/drydock/issues/604))
- **代理注册宽限期**会在显示界面中弱化临时的 `agent-mismatch` 和 `no-update-trigger-configured`，同时准入仍保持故障关闭。([#605](https://github.com/CodesWhat/drydock/issues/605))
- **WebSocket 日志和匿名身份验证**在该模式注册时可以协同工作。([#636](https://github.com/CodesWhat/drydock/issues/636))
- **明确的 501 响应**会说明缺少控制器 Docker 传输。([#637](https://github.com/CodesWhat/drydock/issues/637))

</details>

<details>
<summary><strong>v1.6.0-rc.11 亮点</strong></summary>

- **Portwing 传输**：`transport=docker-api`、`execution=controller`、`events=portwing` 标记启用经过身份验证的 Standard HTTP 或 Edge，以承载由控制器执行的检查、更新、生命周期操作、预览和回滚。Portwing 仍是生命周期事件源，原始清单无法抹除控制器增强的更新结果。([#632](https://github.com/CodesWhat/drydock/issues/632)、[#637](https://github.com/CodesWhat/drydock/issues/637)、[Portwing #76](https://github.com/CodesWhat/portwing/issues/76))
- **通知** — 每个规则/每个提供商的标题和正文模板，带有实时预览，加上审计支持的应用内响铃类别和更新严重性阈值。
- **仪表板** — 零依赖 CSS 网格替换为鼠标/触摸重新排序、有界调整大小、响应式布局、小部件可见性、重置和可选的跨设备首选项同步。
- **更新策略** — 声明式观察程序/标签/UI 优先级、覆盖/恢复审核跟踪、到期倒计时/手动覆盖以及具有堆叠的当前→较新标签视图的固定标签信息可见性。
- **容器资源** — “资源”列默认保持可见，但可以持久隐藏；来源、发行说明和注册表快捷方式仍可从“更多”菜单和卡片页脚访问。
- **性能和恢复** - 每次轮询标签列表重复数据删除、更轻的聚合预测、虚拟化大型日志历史、不可变的实时日志滚动、身份验证引导超时、完整的偏好迁移和陈旧块自我修复。
- **强制执行 v1.6 迁移** — WUD 环境/标签别名、旧版身份验证格式、过时的观察程序开关、模板别名、Kafka `clientId` 和格式错误的仅令牌 Hub/DHI 公共配置不再运行。触发器分类别名保留用于最终错误级别警告版本。

[DEPRECATIONS.md](./DEPRECATIONS.md) 中的完整迁移指南。

</details>

<details>
<summary><strong>v1.5.2亮点</strong></summary>

- **重新创建安全的更新策略** - 成熟度门、跳过的标签/摘要和暂停现在可以在本地和远程代理工作负载的容器重新创建中继续存在。
- **固定标签可靠性** — 完全固定标签再次检测相同标签摘要重建，而 UI 可以显示不可操作的较新同系列标签，而无需更改更新或触发行为。
- **回滚恢复** - 失败的替换创建、网络连接或启动现在会在恢复原始容器之前清除候选容器，并且重复的失败无法通过嵌套回滚重命名进行级联。
- **更安全的容器重建** - 守护程序分配的 MAC 地址不再固定到替换上，而显式配置的主网络 MAC 地址仍然保留。
- **更安静的本地图像轮询** — 本地构建或加载的图像没有注册表摘要，会跳过远程查找，而不是生成重复的授权错误。

完整历史记录在 [CHANGELOG.md](./CHANGELOG.md)。

</details>

<hr>

<h2 align="center" id="screenshots">屏幕截图和现场演示</h2>

<p align="center">
  <img src="docs/assets/drydock-demo.gif" alt="Drydock detecting and applying a container update" width="880">
</p>

<p align="center"><em>发现更新，查看到底发生了什么变化，然后应用它。处理备份、健康检查和回滚。</em></p>

<table>
<tbody><tr>
<td width="50%" align="center"><strong>光</strong></td>
<td width="50%" align="center"><strong>黑暗</strong></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-dashboard-light.png" alt="Dashboard Light"></td>
<td><img src="docs/assets/drydock-dashboard-dark.png" alt="Dashboard Dark"></td>
</tr>
</tbody></table>

<div align="center">

**既然可以亲自体验，为什么还要看截图呢？**

<a href="https://demo.getdrydock.com"><img src="https://img.shields.io/badge/Try_the_Live_Demo-4f46e5?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSI2IDMgMjAgMTIgNiAyMSA2IDMiLz48L3N2Zz4=&logoColor=white" alt="Try the Live Demo" height="36"></a>

完全交互——真实的用户界面，模拟数据，无需安装。完全在浏览器中运行。

</div>

<hr>

<h2 align="center" id="why-drydock">为什么是Drydock</h2>

容器镜像悄然过时。基础镜像修补 CVE、应用程序剪切版本、标签移动。除非您手动监视每个注册表，否则正在运行的容器会落后，直到出现问题或被利用。

大多数工具都会迫使人们做出权衡。自动更新程序（Watchtower、Ouroboros）在几乎没有可见性或控制的情况下拉取并重新启动，并且现在基本上不再维护。仪表板 (Portainer) 管理容器，但不是为更新智能而构建的。 Drydock 是**监控优先**：它会监控 23 个注册表，并在发生任何事情之前准确地告诉您发生了什么变化（主要、次要、补丁或摘要），然后仅在您允许时才采取行动。它比他们中的任何一个都走得更远。 Trivy/Grype 漏洞扫描阻止不安全更新，Cosign 验证签名，更新前映像备份在运行状况检查失败时自动回滚，分布式代理覆盖远程主机，20 个通知和操作集成形成闭环。完整的更新生命周期，带有 Web UI 和 REST API。

<hr>

<h2 align="center" id="features">特点</h2>

| |特色|描述 |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔭  | **监控优先检测**             | 监视每个正在运行的容器，并在发生任何情况之前将每个可用更新分类为主要、次要、补丁或摘要。除非你这么说，否则一切都不会改变。                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 📦  | **23 家注册提供商**          | Docker Hub、GHCR、ECR、ACR、GCR、GAR、GitLab、Quay、Harbor、Artifactory、Nexus 等 12 个。公共和私有、云和自托管，具有每个注册表 TLS 和身份验证。                                                                                                                                                                                                                                                                                                                                                      |
| 🔔  | **20 个触发器**            | 17 个通知通道（Slack、Discord、Telegram、Teams、SMTP、MQTT、ntfy 等）以及 Docker、Docker Compose 和命令操作，具有每个事件/提供商模板、实时预览、阈值过滤和批处理模式。                                                                                                                                                                                                                                                                                                                                                                                                |
| 🥊  | **Update Bouncer**     | Trivy/Grype 漏洞扫描可在部署之前阻止不安全的更新，并具有 Cosign 签名验证和 SBOM 生成功能（CycloneDX 和 SPDX）。                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ↩️  | **镜像备份和自动回滚**          | 预更新映像快照，具有可配置的保留、运行状况检查失败时自动回滚以及从 UI 中一键手动回滚。                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 🪝  | **生命周期挂钩**             | 通过容器标签执行更新前和更新后的 shell 命令，并具有每个钩子超时和失败时中止控制。                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 🗂️ | **Docker Compose 更新**  | 通过 Docker Engine API 以及保留 YAML 的映像修补来拉取并重新创建 Compose 服务。                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 🎛️ | **每个容器的政策**            | 正则表达式标签规则和触发路由使用`dd.*`标签；成熟度门、跳过/暂停/固定和维护窗口通过 UI/API 或观察者配置存储。                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 🛰️ | **分布式代理**              | 通过 SSE 监控远程 Docker 主机。Portwing 0.9.0+ 代理可以使用入站 Standard HTTP 或出站 Edge WebSocket 传输；Drydock 1.6.0-rc.11+ 可通过任一经过身份验证的路径在控制器端执行原生注册表检查以及单个或批量 Docker 更新。Edge 还可连续传输实时日志而无需入站端口；`DD_EXPERIMENTAL_PORTWING=false` 仍是紧急禁用开关。                                                                                                                                                                                                                |
| 🖥️ | **网络仪表板**              | Vue 3 UI 具有零依赖可定制小部件网格、响应式表格/卡片视图、实时 SSE 更新、通知铃控件以及每个容器的详细信息、日志和统计信息。                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 🔗  | **REST API 和 Webhook** | 用于 CI/CD 监视和更新触发器的令牌身份验证端点，以及用于推送事件的签名注册表 Webhook 摄取。                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 🔐  | **OIDC 身份验证**          | 使用 OpenID Connect（Authelia、Auth0、Authentik）保护仪表板。默认情况下，任何身份验证流程发生故障时都会拒绝访问（fail-closed）。                                                                                                                                                                                                                                                                                                                                                                                                       |
| 📈  | **Prometheus 指标**      | 内置 `/metrics` 端点，具有适用于 Prometheus 和 Grafana 监控堆栈的可选身份验证旁路。                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 🌍  | **17 个 UI 语言环境**       | 完整的翻译系统，英语内容完整，并有 16 个由社区维护的语言环境通过 Crowdin 同步，可在配置中切换。                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 🔒  | **ReDoS-免疫正则表达式**      | 每个用户提供的标签模式都通过 re2js（纯 JS RE2 端口）进行编译，以实现线性时间匹配，不会因灾难性回溯模式而停止。                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

<hr>

<h2 align="center" id="supported-integrations">支持的集成</h2>

### 注册表 (23)

Docker Hub · GHCR · ECR · ACR · GCR · GAR · GitLab · Quay · LSCR · Harbor · Artifactory · Nexus · Gitea · Forgejo · Codeberg · MAU · TrueForge · Custom · DOCR · DHI · IBM Cloud · Oracle Cloud · 阿里云

### 行动 (3)

Docker·Docker Compose·命令

### 通知 (17)

Apprise · Discord · Google Chat · Gotify · HTTP · IFTTT · Kafka · Matrix · Mattermost · MQTT · MS Teams · NTFY · Pushover · Rocket.Chat · Slack · SMTP · Telegram

### 身份验证

匿名（通过 `DD_ANONYMOUS_AUTH_CONFIRM=true` 选择加入） · 基本（用户名 + 密码哈希） · OIDC（Authelia、Auth0、Authentik）。默认情况下，任何身份验证流程发生故障时都会拒绝访问（fail-closed）。

### Update Bouncer

Trivy 或 Grype 支持的漏洞扫描会在部署之前阻止不安全的更新。包括 Cosign 签名验证和 SBOM 生成（CycloneDX 和 SPDX）。

<hr>

<h2 align="center" id="feature-comparison">功能比较</h2>

<details>
<summary><strong>drydock 与其他容器更新工具相比如何？</strong></summary>

> ✅ = 支持 &nbsp; ❌ = 不支持 &nbsp; ⚠️ = 部分/有限 &nbsp; † = 已存档，不再维护

<table>
<thead>
<tr>
<th width="28%">功能</th>
<th width="15%" align="center">drydock</th>
<th width="15%" align="center">WUD</th>
<th width="15%" align="center">Diun</th>
<th width="13%" align="center"><em>Watchtower †</em></th>
<th width="14%" align="center"><em>Ouroboros †</em></th>
</tr>
</thead>
<tbody>
<tr><td>Web 界面 / 仪表盘</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>自动更新容器</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Docker Compose 更新</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>触发器 / 通知渠道</td><td align="center">20</td><td align="center">16</td><td align="center">17</td><td align="center">~19</td><td align="center">~6</td></tr>
<tr><td>镜像仓库提供商</td><td align="center">23</td><td align="center">13</td><td align="center">⚠️</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>OIDC / SSO 身份验证</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>REST API</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Prometheus 指标</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>镜像备份与回滚</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>容器分组 / 堆栈</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>生命周期钩子（更新前/后）</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>用于 CI/CD 的 Webhook API</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>启动/停止/重启/更新容器</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>分布式代理（远程）</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>审计日志</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>安全扫描（Trivy/Grype）</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>支持 SemVer 的更新</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>镜像摘要监控</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>多架构（amd64/arm64）</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>容器日志查看器</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>积极维护</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
</tbody>
</table>

> 数据基于截至 2026 年 3 月的公开文档。
> 如果有任何信息不准确，欢迎贡献。

</details>

<hr>

<h2 align="center" id="migration">迁移</h2>

<details>
<summary><strong>从 WUD 迁移（Docker 怎么样？）</strong></summary>

Drydock v1.6 不再在运行时加载 `WUD_*` 环境变量或 `wud.*` 标签。在启动升级服务之前重写它们；持久状态仍然会自动迁移。使用`docker exec -it drydock node dist/index.js config migrate --dry-run`进行预览，然后使用`docker exec -it drydock node dist/index.js config migrate --file .env --file compose.yaml`将配置重写为`DD_*`和`dd.*`命名。

</details>

<hr>

<h2 align="center" id="roadmap">路线图</h2>

<details>
<summary><strong>版本主题及亮点</strong></summary>

此方向至少覆盖未来十二个月，直至 2027 年 8 月。
此处仅列出高级主题；各版本详情请参阅 [CHANGELOG.md](CHANGELOG.md)。

| 版本                                           | 主题           | 亮点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1.3.x** ✅ | 安全稳定         | Trivy 扫描、Update Bouncer、SBOM、7 个新注册表、4 个新触发器、re2js 正则表达式引擎                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **v1.4.x** ✅ | UI 现代化和强化    | Tailwind 4 + 自定义组件、6 个主题、Cmd/K 调色板、OpenAPI 3.1、撰写原生 YAML 更新、双槽扫描、OIDC 强化                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **v1.5.0** ✅ | 可观察性和 i18n   | 触发分类拆分 (`DD_ACTION_*`/`DD_NOTIFICATION_*`)、WebSocket 日志查看器、仪表板自定义、资源监控、通知发件箱 + DLQ、安全扫描摘要、17 个区域设置、SSE 最后事件 ID 重播、使用 Ed25519 身份验证的边缘代理拨出（实验性、`DD_EXPERIMENTAL_PORTWING=true`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **v1.5.1** ✅ | 安全与维护        | GCR/GAR pull-auth 修复、注册表 TLS 完成 (M-2)、hook env-var 注入强化、`DD_SESSION_SECRET__FILE` 支持、调试转储凭据编辑、机密文件权限检查、成熟度门死锁修复、完整 UI 可翻译性 + 社区翻译、维护窗口自动应用门、容器正常运行时间显示、标签/版本列分割显示软件版本（OCI 标签，带有 `dd.inspect.tag.path`双写 + 选择加入 `dd.inspect.tag.version-only` 路由），选择加入 compose 挂载前缀匹配，`${currentReleaseNotes}` 模板变量                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **v1.5.2** ✅ | 政策和固定标签可靠性   | 娱乐安全成熟度/跳过/暂停策略保留、固定标签摘要重建检测和信息同族洞察、回滚候选清理、回滚级联预防、显式 MAC 保存和本地映像注册表跳过行为                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **v1.6.0**   | 通知、策略与发布情报 | 每规则/每触发器通知模板，具有实时预览、通知铃声首选项、跨设备首选项同步、零依赖自定义仪表板网格 ([#281](https://github.com/CodesWhat/drydock/issues/281))、声明性更新策略 ([#320](https://github.com/CodesWhat/drydock/issues/320))、成熟稳定倒计时 + 即时候选人可见性 + 手动覆盖 ([#406](https://github.com/CodesWhat/drydock/discussions/406))、可操作更新状态面板和全局`notify` / `manual` / `auto` 更新模式 ([#325](https://github.com/CodesWhat/drydock/discussions/325))、观察者/imgset/容器标签策略继承以及堆叠当前 → 较新的固定标签可见性 ([#498](https://github.com/CodesWhat/drydock/issues/498))、标准化 44px 跨表、卡片和详细信息的源/发行说明/注册表资源操作([#295](https://github.com/CodesWhat/drydock/discussions/295))、运行状况事件通知 ([#198](https://github.com/CodesWhat/drydock/discussions/198))、双向 Home Assistant MQTT、响应式表/卡列表视图、通过命令或固定 Docker-worker 后端执行 Trivy、Grype 或两者扫描、扫描器资产拉取/热控制、堆外重复数据删除SBOM 存储、Trivy 长扫描正确性 ([#490](https://github.com/CodesWhat/drydock/issues/490))、触发分类迁移警告、v1.6 兼容性删除、文档/API 卫生以及 `/api` → `/api/v1` 迁移完成，并选择加入 wud-card/Homepage 兼容性填充程序 (`DD_COMPAT_WUDCARD`)。 |
| **v1.7.0**   | 智能更新和用户体验    | 依赖性感知排序（[#219](https://github.com/CodesWhat/drydock/discussions/219)）、选择性批量更新（[#232](https://github.com/CodesWhat/drydock/discussions/232)）、每次操作更新策略（[#511](https://github.com/CodesWhat/drydock/discussions/511)）、图像修剪、静态图像监控、图像成熟度指示器、统一的成熟度/更新时间时钟、可点击端口链接、键盘快捷键、PWA、深色主题对比度改进（WCAG 2.2）（[#850](https://github.com/CodesWhat/drydock/issues/850)、[#865](https://github.com/CodesWhat/drydock/discussions/865)）、`DD_TRIGGER_*` 删除（v1.5.0 弃用窗口结束），从图像中删除了curl                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **v1.8.0**   | 车队管理和实时配置    | YAML 配置、实时 UI 配置、卷浏览器、并行更新、SQLite 存储迁移、Home Assistant 更新进度和每容器设备（[#210](https://github.com/CodesWhat/drydock/discussions/210)）、根据声明的上游基础监控本地构建的镜像（[#897](https://github.com/CodesWhat/drydock/discussions/897)）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **v2.0+**                    | 平台扩展及其他      | Swarm/Kubernetes 观察者、GitOps、健康门、金丝雀部署、Web 终端、RBAC、作用域可旋转 API 密钥（用于 HA/仪表板集成的静态承载令牌，[#469](https://github.com/CodesWhat/drydock/discussions/469)）、LDAP/AD、超越 Docker 兼容 API 的本机 Podman 提供程序、CLI、Wolfi 强化映像、套接字代理                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

</details>

<hr>

<h2 align="center" id="star-history">星史</h2>

<div align="center">
  <a href="https://github.com/CodesWhat/drydock/stargazers">
    <img alt="Star History Chart" src="docs/assets/star-history.svg" />
  </a>
</div>

---

<div align="center">

<h2 align="center" id="built-with">技术栈</h2>

[![TypeScript](https://img.shields.io/badge/TypeScript_6.0-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![Vue 3](https://img.shields.io/badge/Vue_3-42b883?logo=vuedotjs&logoColor=fff)](https://vuejs.org/)
[![Express 5](https://img.shields.io/badge/Express_5-000?logo=express&logoColor=fff)](https://expressjs.com/)
[![Vitest](https://img.shields.io/badge/Vitest_4-6E9F18?logo=vitest&logoColor=fff)](https://vitest.dev/)
[![Biome](https://img.shields.io/badge/Biome_2.5-60a5fa?logo=biome&logoColor=fff)](https://biomejs.dev/)
[![Node 24](https://img.shields.io/badge/Node_24_Alpine-339933?logo=nodedotjs&logoColor=fff)](https://nodejs.org/)
[![Anthropic](https://img.shields.io/badge/Anthropic-CC785C?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/)
[![OpenAI](https://img.shields.io/badge/OpenAI-10A37F?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU%2BT3BlbkFJPC90aXRsZT48cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNMjIuMjgxOSA5LjgyMTFhNS45ODQ3IDUuOTg0NyAwIDAgMC0uNTE1Ny00LjkxMDggNi4wNDYyIDYuMDQ2MiAwIDAgMC02LjUwOTgtMi45QTYuMDY1MSA2LjA2NTEgMCAwIDAgNC45ODA3IDQuMTgxOGE1Ljk4NDcgNS45ODQ3IDAgMCAwLTMuOTk3NyAyLjkgNi4wNDYyIDYuMDQ2MiAwIDAgMCAuNzQyNyA3LjA5NjYgNS45OCA1Ljk4IDAgMCAwIC41MTEgNC45MTA3IDYuMDUxIDYuMDUxIDAgMCAwIDYuNTE0NiAyLjkwMDFBNS45ODQ3IDUuOTg0NyAwIDAgMCAxMy4yNTk5IDI0YTYuMDU1NyA2LjA1NTcgMCAwIDAgNS43NzE4LTQuMjA1OCA1Ljk4OTQgNS45ODk0IDAgMCAwIDMuOTk3Ny0yLjkwMDEgNi4wNTU3IDYuMDU1NyAwIDAgMC0uNzQ3NS03LjA3Mjl6bS05LjAyMiAxMi42MDgxYTQuNDc1NSA0LjQ3NTUgMCAwIDEtMi44NzY0LTEuMDQwOGwuMTQxOS0uMDgwNCA0Ljc3ODMtMi43NTgyYS43OTQ4Ljc5NDggMCAwIDAgLjM5MjctLjY4MTN2LTYuNzM2OWwyLjAyIDEuMTY4NmEuMDcxLjA3MSAwIDAgMSAuMDM4LjA1MnY1LjU4MjZhNC41MDQgNC41MDQgMCAwIDEtNC40OTQ1IDQuNDk0NHptLTkuNjYwNy00LjEyNTRhNC40NzA4IDQuNDcwOCAwIDAgMS0uNTM0Ni0zLjAxMzdsLjE0Mi4wODUyIDQuNzgzIDIuNzU4MmEuNzcxMi43NzEyIDAgMCAwIC43ODA2IDBsNS44NDI4LTMuMzY4NXYyLjMzMjRhLjA4MDQuMDgwNCAwIDAgMS0uMDMzMi4wNjE1TDkuNzQgMTkuOTUwMmE0LjQ5OTIgNC40OTkyIDAgMCAxLTYuMTQwOC0xLjY0NjR6TTIuMzQwOCA3Ljg5NTZhNC40ODUgNC40ODUgMCAwIDEgMi4zNjU1LTEuOTcyOFYxMS42YS43NjY0Ljc2NjQgMCAwIDAgLjM4NzkuNjc2NWw1LjgxNDQgMy4zNTQzLTIuMDIwMSAxLjE2ODVhLjA3NTcuMDc1NyAwIDAgMS0uMDcxIDBsLTQuODMwMy0yLjc4NjVBNC41MDQgNC41MDQgMCAwIDEgMi4zNDA4IDcuODcyem0xNi41OTYzIDMuODU1OEwxMy4xMDM4IDguMzY0IDE1LjExOTIgNy4yYS4wNzU3LjA3NTcgMCAwIDEgLjA3MSAwbDQuODMwMyAyLjc5MTNhNC40OTQ0IDQuNDk0NCAwIDAgMS0uNjc2NSA4LjEwNDJ2LTUuNjc3MmEuNzkuNzkgMCAwIDAtLjQwNy0uNjY3em0yLjAxMDctMy4wMjMxbC0uMTQyLS4wODUyLTQuNzczNS0yLjc4MThhLjc3NTkuNzc1OSAwIDAgMC0uNzg1NCAwTDkuNDA5IDkuMjI5N1Y2Ljg5NzRhLjA2NjIuMDY2MiAwIDAgMSAuMDI4NC0uMDYxNWw0LjgzMDMtMi43ODY2YTQuNDk5MiA0LjQ5OTIgMCAwIDEgNi42ODAyIDQuNjZ6TTguMzA2NSAxMi44NjNsLTIuMDItMS4xNjM4YS4wODA0LjA4MDQgMCAwIDEtLjAzOC0uMDU2N1Y2LjA3NDJhNC40OTkyIDQuNDk5MiAwIDAgMSA3LjM3NTctMy40NTM3bC0uMTQyLjA4MDVMOC43MDQgNS40NTlhLjc5NDguNzk0OCAwIDAgMC0uMzkyNy42ODEzem0xLjA5NzYtMi4zNjU0bDIuNjAyLTEuNDk5OCAyLjYwNjkgMS40OTk4djIuOTk5NGwtMi41OTc0IDEuNDk5Ny0yLjYwNjctMS40OTk3WiIvPjwvc3ZnPg%3D%3D)](https://openai.com)

[![SemVer](https://img.shields.io/badge/semver-2.0.0-blue)](https://semver.org/)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=fff)](https://www.conventionalcommits.org/)
[![Keep a Changelog](https://img.shields.io/badge/changelog-Keep%20a%20Changelog-E05735)](https://keepachangelog.com/)

<h2 align="center" id="community-support">社区与支持</h2>

实时聊天和早期支持：**[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**

明确的错误和功能请求请提交到 **[GitHub Issues](https://github.com/CodesWhat/drydock/issues)**；开放式问题、想法和展示请前往 **[GitHub Discussions](https://github.com/CodesWhat/drydock/discussions)**；实时聊天在 **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)** 进行。

### 社区质量检查

感谢帮助测试 v1.4.0 和 v1.5.0 候选版本并报告错误的用户：

[@RK62](https://github.com/RK62) &middot; [@flederohr](https://github.com/flederohr) &middot; [@rj10rd](https://github.com/rj10rd) &middot; [@larueli](https://github.com/larueli) &middot; [@Waler](https://github.com/Waler) &middot; [@ElVit](https://github.com/ElVit) &middot; [@nchieffo](https://github.com/nchieffo) &middot; [@begunfx](https://github.com/begunfx) &middot; [@Ra72xx](https://github.com/Ra72xx)

<h2 align="center" id="codeswhat-ecosystem">CodesWhat 生态系统的一部分</h2>

<table>
  <tbody><tr><th>工具</th><th>角色</th></tr>
  <tr><td><b>drydock</b></td><td>容器更新监控——Web UI 和通知引擎</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/portwing"><b>portwing</b></a></td><td>远程 Docker 代理 — 从 Drydock 或独立的安全套接字级访问</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/sockguard"><b>sockguard</b></a></td><td>Docker 套接字代理 — 默认拒绝白名单过滤器保护套接字</td></tr>
</tbody></table>

这三个工具旨在分层：sockguard 过滤套接字，portwing 远程公开它，drydock 监视容器状态并对其进行操作。

请参阅 [portwing 的 COMPATIBILITY.md](https://github.com/CodesWhat/portwing/blob/main/COMPATIBILITY.md)，了解所有三种工具的完整兼容性矩阵。

---

**[AGPL-3.0 许可证](LICENSE)**

<a href="https://github.com/CodesWhat">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/codeswhat-logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/codeswhat-logo-original.svg" />
    <img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat" height="28">
  </picture>
</a>

<a href="#drydock">返回顶部</a>

</div>
