# Docker Watchers
![logo](docker.png)

Watchers are responsible for scanning Docker containers.

The `docker` watcher lets you configure the Docker hosts you want to watch.

## Variables

| Env var                                                   | Required       | Description                                                                                                            | Supported values                               | Default value when missing                                      |
| --------------------------------------------------------- |:--------------:| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- | 
| `DD_WATCHER_{watcher_name}_CAFILE`                       | :white_circle: | CA pem file path (only for TLS connection)                                                                             |                                                |                                                                 |
| `DD_WATCHER_{watcher_name}_AUTH_BEARER`                  | :white_circle: | Bearer token for remote Docker API auth (HTTPS only)                                                                   |                                                |                                                                 |
| `DD_WATCHER_{watcher_name}_AUTH_PASSWORD`                | :white_circle: | Password for remote Docker API basic auth (HTTPS only)                                                                 |                                                |                                                                 |
| `DD_WATCHER_{watcher_name}_AUTH_TYPE`                    | :white_circle: | Auth mode for remote Docker API auth                                                                                   | `BASIC`, `BEARER`                              | auto-detected from provided credentials                         |
| `DD_WATCHER_{watcher_name}_AUTH_USER`                    | :white_circle: | Username for remote Docker API basic auth (HTTPS only)                                                                 |                                                |                                                                 |
| `DD_WATCHER_{watcher_name}_CERTFILE`                     | :white_circle: | Certificate pem file path (only for TLS connection)                                                                    |                                                |                                                                 |
| `DD_WATCHER_{watcher_name}_CRON`                         | :white_circle: | Scheduling options                                                                                                     | [Valid CRON expression](https://crontab.guru/) | `0 * * * *` (every hour)                                        |
| `DD_WATCHER_{watcher_name}_HOST`                         | :white_circle: | Docker hostname or ip of the host to watch                                                                             |                                                |                                                                 |
| `DD_WATCHER_{watcher_name}_JITTER`                       | :white_circle: | Jitter in ms applied to the CRON to better distribute the load on the registries (on the Hub at the first place) | > 0 | `60000` (1 minute)                                              |
| `DD_WATCHER_{watcher_name}_KEYFILE`                      | :white_circle: | Key pem file path (only for TLS connection)                                                                            |                                                |                                                                 |
| `DD_WATCHER_{watcher_name}_MAINTENANCE_WINDOW`           | :white_circle: | Allowed update schedule (checks outside this window are skipped)                                                       | [Valid CRON expression](https://crontab.guru/) |                                                                 |
| `DD_WATCHER_{watcher_name}_MAINTENANCE_WINDOW_TZ`        | :white_circle: | Timezone used to evaluate `MAINTENANCE_WINDOW`                                                                         | IANA timezone (e.g. `UTC`, `Europe/Paris`)    | `UTC`                                                           |
| `DD_WATCHER_{watcher_name}_PORT`                         | :white_circle: | Docker port of the host to watch                                                                                       |                                                | `2375`                                                          |
| `DD_WATCHER_{watcher_name}_PROTOCOL`                     | :white_circle: | Docker remote API protocol                                                                                              | `http`, `https`                                | `http`                                                          |
| `DD_WATCHER_{watcher_name}_SOCKET`                       | :white_circle: | Docker socket to watch                                                                                                 | Valid unix socket                              | `/var/run/docker.sock`                                          |
| `DD_WATCHER_{watcher_name}_WATCHALL`                     | :white_circle: | If drydock must monitor all containers instead of just running ones                                                        | `true`, `false`                                | `false`                                                         |
| `DD_WATCHER_{watcher_name}_WATCHATSTART` (deprecated)    | :white_circle: | If drydock must check for image updates during startup                                                                     | `true`, `false`                                | `true` if this watcher store is empty                           |
| `DD_WATCHER_{watcher_name}_WATCHBYDEFAULT`               | :white_circle: | If drydock must monitor all containers by default                                                                          | `true`, `false`                                | `true`                                                          |
| `DD_WATCHER_{watcher_name}_WATCHEVENTS`                  | :white_circle: | If drydock must monitor docker events                                                                                      | `true`, `false`                                | `true`                                                          |
| `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_*`       | :white_circle: | Shared per-image defaults (image match + include/exclude/transform/link/display/trigger/lookup)                       | See **Image Set Presets** section below        |                                                                 |

?> If no watcher is configured, a default one named `local` will be automatically created (reading the Docker socket).

?> Multiple watchers can be configured (if you have multiple Docker hosts to watch).  
You just need to give them different names.

!> Socket configuration and host/port configuration are mutually exclusive.

!> If socket configuration is used, don't forget to mount the Docker socket on your drydock container.

!> If host/port configuration is used, don't forget to enable the Docker remote API. \
[See dockerd documentation](https://docs.docker.com/engine/reference/commandline/dockerd/#description)

!> If the Docker remote API is secured with TLS, don't forget to mount and configure the TLS certificates. \
[See dockerd documentation](https://docs.docker.com/engine/security/protect-access/#use-tls-https-to-protect-the-docker-daemon-socket)

!> Remote watcher auth (`AUTH_*`) is only applied on HTTPS connections (`PROTOCOL=https`) or TLS certificate-based connections.

?> When `MAINTENANCE_WINDOW` is configured and a check is skipped outside the allowed schedule, drydock queues one pending check and runs it automatically when the next maintenance window opens.

!> Watching image digests causes an extensive usage of _Docker Registry Pull API_ which is restricted by [**Quotas on the Docker Hub**](https://docs.docker.com/docker-hub/download-rate-limit/). \
By default, drydock enables it only for **non semver** image tags. \
You can tune this behavior per container using the `dd.watch.digest` label. \
If you face [quota related errors](https://docs.docker.com/docker-hub/download-rate-limit/#how-do-i-know-my-pull-requests-are-being-limited), consider slowing down the watcher rate by adjusting the `DD_WATCHER_{watcher_name}_CRON` variable.

## Variable examples

### Watch the local docker host every day at 1am

<!-- tabs:start -->
#### **Docker Compose (Daily CRON)**
```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    ...
    environment:
        - DD_WATCHER_LOCAL_CRON=0 1 * * *
```

#### **Docker (Daily CRON)**
```bash
docker run \
    -e DD_WATCHER_LOCAL_CRON="0 1 * * *" \
  ...
  ghcr.io/codeswhat/drydock
```
<!-- tabs:end -->

### Watch all containers regardless of their status (created, paused, exited, restarting, running...)

<!-- tabs:start -->
#### **Docker Compose (Watch All)**
```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    ...
    environment:
        - DD_WATCHER_LOCAL_WATCHALL=true
```

#### **Docker (Watch All)**
```bash
docker run \
    -e DD_WATCHER_LOCAL_WATCHALL="true" \
  ...
  ghcr.io/codeswhat/drydock
```
<!-- tabs:end -->

### Watch a remote docker host via TCP on 2375

<!-- tabs:start -->
#### **Docker Compose (Remote TCP)**
```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    ...
    environment:
        - DD_WATCHER_MYREMOTEHOST_HOST=myremotehost
```

#### **Docker (Remote TCP)**
```bash
docker run \
    -e DD_WATCHER_MYREMOTEHOST_HOST="myremotehost" \
  ...
  ghcr.io/codeswhat/drydock
```
<!-- tabs:end -->

### Watch a remote docker host behind HTTPS with bearer auth

<!-- tabs:start -->
#### **Docker Compose (HTTPS Bearer)**
```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    ...
    environment:
        - DD_WATCHER_MYREMOTEHOST_HOST=myremotehost
        - DD_WATCHER_MYREMOTEHOST_PORT=443
        - DD_WATCHER_MYREMOTEHOST_PROTOCOL=https
        - DD_WATCHER_MYREMOTEHOST_AUTH_TYPE=BEARER
        - DD_WATCHER_MYREMOTEHOST_AUTH_BEARER=my-secret-token
```

#### **Docker (HTTPS Bearer)**
```bash
docker run \
    -e DD_WATCHER_MYREMOTEHOST_HOST="myremotehost" \
    -e DD_WATCHER_MYREMOTEHOST_PORT="443" \
    -e DD_WATCHER_MYREMOTEHOST_PROTOCOL="https" \
    -e DD_WATCHER_MYREMOTEHOST_AUTH_TYPE="BEARER" \
    -e DD_WATCHER_MYREMOTEHOST_AUTH_BEARER="my-secret-token" \
  ...
  ghcr.io/codeswhat/drydock
```
<!-- tabs:end -->

### Watch a remote docker host via TCP with TLS enabled on 2376

<!-- tabs:start -->
#### **Docker Compose (TLS)**
```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    ...
    environment:
        - DD_WATCHER_MYREMOTEHOST_HOST=myremotehost
        - DD_WATCHER_MYREMOTEHOST_PORT=2376
        - DD_WATCHER_MYREMOTEHOST_CAFILE=/certs/ca.pem
        - DD_WATCHER_MYREMOTEHOST_CERTFILE=/certs/cert.pem
        - DD_WATCHER_MYREMOTEHOST_KEYFILE=/certs/key.pem
    volumes:
        - /my-host/my-certs/ca.pem:/certs/ca.pem:ro
        - /my-host/my-certs/ca.pem:/certs/cert.pem:ro
        - /my-host/my-certs/ca.pem:/certs/key.pem:ro
```

#### **Docker (TLS)**
```bash
docker run \
    -e DD_WATCHER_MYREMOTEHOST_HOST="myremotehost" \
    -e DD_WATCHER_MYREMOTEHOST_PORT="2376" \
    -e DD_WATCHER_MYREMOTEHOST_CAFILE="/certs/ca.pem" \
    -e DD_WATCHER_MYREMOTEHOST_CERTFILE="/certs/cert.pem" \
    -e DD_WATCHER_MYREMOTEHOST_KEYFILE="/certs/key.pem" \
    -v /my-host/my-certs/ca.pem:/certs/ca.pem:ro \
    -v /my-host/my-certs/ca.pem:/certs/cert.pem:ro \
    -v /my-host/my-certs/ca.pem:/certs/key.pem:ro \
  ...
  ghcr.io/codeswhat/drydock
```
<!-- tabs:end -->

!> Don't forget to mount the certificates into the container!

## Docker Socket Security

Drydock runs as a non-root user by default for security. This means a **read-only** Docker socket mount (`:ro`) will fail with a permission error because the Linux VFS denies `connect()` on a read-only bind mount for non-root users.

There are two ways to resolve this:

### Option 1: `DD_RUN_AS_ROOT=true` (quick fix)

Set the `DD_RUN_AS_ROOT` environment variable to skip Drydock's privilege drop and run as root — the same approach used by Portainer, Watchtower, and other Docker management tools.

```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - DD_RUN_AS_ROOT=true
    ports:
      - 3000:3000
```

!> Running as root trades the privilege-drop security boundary for `:ro` socket compatibility. This is safe for most home-lab and single-host setups but may not meet your security requirements in multi-tenant or production environments.

### Option 2: Socket proxy (recommended)

A socket proxy runs as a separate container with access to the Docker socket and exposes only the API endpoints Drydock needs. Drydock connects to the proxy over HTTP, so no socket mount is required at all.

```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    depends_on:
      - socket-proxy
    environment:
      - DD_WATCHER_LOCAL_HOST=socket-proxy
      - DD_WATCHER_LOCAL_PORT=2375
    ports:
      - 3000:3000

  socket-proxy:
    image: tecnativa/docker-socket-proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - CONTAINERS=1
      - IMAGES=1
      - EVENTS=1
      - SERVICES=1
    restart: unless-stopped
```

#### Proxy permissions by feature

| Feature | Required proxy env vars |
|---|---|
| Watch containers (default) | `CONTAINERS=1`, `IMAGES=1`, `EVENTS=1`, `SERVICES=1` |
| Docker trigger (auto-updates) | All of the above **plus** `POST=1`, `NETWORKS=1` |

### Watch 1 local Docker host and 2 remote docker hosts at the same time

<!-- tabs:start -->
#### **Docker Compose (Multiple Hosts)**
```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    ...
    environment:
        -  DD_WATCHER_LOCAL_SOCKET=/var/run/docker.sock
        -  DD_WATCHER_MYREMOTEHOST1_HOST=myremotehost1
        -  DD_WATCHER_MYREMOTEHOST2_HOST=myremotehost2
```

#### **Docker (Multiple Hosts)**
```bash
docker run \
    -e  DD_WATCHER_LOCAL_SOCKET="/var/run/docker.sock" \
    -e  DD_WATCHER_MYREMOTEHOST1_HOST="myremotehost1" \
    -e  DD_WATCHER_MYREMOTEHOST2_HOST="myremotehost2" \
  ...
  ghcr.io/codeswhat/drydock
```
<!-- tabs:end -->

## Image Set Presets

Use `IMGSET` to define reusable defaults by image reference. This is useful when many containers need the same tag filters, link template, icon, or trigger routing.

Looking for ready-to-copy presets for common containers? See [Popular IMGSET Presets](popular-imgsets.md).

### Supported imgset keys

- `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_IMAGE`
- `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_TAG_INCLUDE`
- `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_TAG_EXCLUDE`
- `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_TAG_TRANSFORM`
- `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_LINK_TEMPLATE`
- `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_DISPLAY_NAME`
- `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_DISPLAY_ICON`
- `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_TRIGGER_INCLUDE`
- `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_TRIGGER_EXCLUDE`
- `DD_WATCHER_{watcher_name}_IMGSET_{imgset_name}_REGISTRY_LOOKUP_IMAGE`

### Imgset precedence

- `dd.*` labels on the container (or swarm service/container merged labels) are highest priority.
- `IMGSET` values are defaults applied only when the corresponding label is not set.

### Imgset example

```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    environment:
      - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_IMAGE=ghcr.io/home-assistant/home-assistant
      - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_TAG_INCLUDE=^\\d+\\.\\d+\\.\\d+$$
      - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_DISPLAY_NAME=Home Assistant
      - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_DISPLAY_ICON=hl-home-assistant
      - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_LINK_TEMPLATE=https://www.home-assistant.io/changelogs/core-$${major}$${minor}$${patch}
      - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_TRIGGER_INCLUDE=ntfy.default:major
```

## Labels

To fine-tune the behaviour of drydock _per container_, you can add labels on them.

| Label                 |    Required    | Description                                        | Supported values                                                                                                                                                            | Default value when missing                                                            |
|-----------------------|:--------------:|----------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `dd.display.icon`    | :white_circle: | Custom display icon for the container              | Valid [Fontawesome Icon](https://fontawesome.com/), [Homarr Labs Icon](https://dashboardicons.com/), [Selfh.st Icon](https://selfh.st/icons/), or [Simple Icon](https://simpleicons.org/) (see details below). `mdi:` icons are auto-resolved but not recommended. | `fab fa-docker`                                                                       |
| `dd.display.name`    | :white_circle: | Custom display name for the container              | Valid String                                                                                                                                                                | Container name                                                                        |
| `dd.inspect.tag.path`| :white_circle: | Docker inspect path used to derive a local semver tag | Slash-separated path in `docker inspect` output                                                                                                                             |                                                                                       |
| `dd.registry.lookup.image` | :white_circle: | Alternative image reference used for update lookups | Full image path (for example `library/traefik` or `ghcr.io/traefik/traefik`)                                                                                               |                                                                                       |
| `dd.link.template`   | :white_circle: | Browsable link associated to the container version | JS string template with vars `${container}`, `${original}`, `${transformed}`, `${major}`, `${minor}`, `${patch}`, `${prerelease}`                                           |                                                                                       |
| `dd.tag.exclude`     | :white_circle: | Regex to exclude specific tags                     | Valid JavaScript Regex                                                                                                                                                      |                                                                                       |
| `dd.tag.include`     | :white_circle: | Regex to include specific tags only                | Valid JavaScript Regex                                                                                                                                                      |                                                                                       |
| `dd.tag.transform`   | :white_circle: | Transform function to apply to the tag             | `$valid_regex => $valid_string_with_placeholders` (see below)                                                                                                               |                                                                                       |
| `dd.trigger.exclude` | :white_circle: | Optional list of triggers to exclude               | `$trigger_1_id_or_name,$trigger_2_id_or_name:$threshold`                                                                                                                    |                                                                                       |
| `dd.trigger.include` | :white_circle: | Optional list of triggers to include               | `$trigger_1_id_or_name,$trigger_2_id_or_name:$threshold`                                                                                                                    |                                                                                       |
| `dd.watch.digest`    | :white_circle: | Watch this container digest                        | Valid Boolean                                                                                                                                                               | `false`                                                                               |
| `dd.watch`           | :white_circle: | Watch this container                               | Valid Boolean                                                                                                                                                               | `true` when `DD_WATCHER_{watcher_name}_WATCHBYDEFAULT` is `true` (`false` otherwise) |

!> `dd.inspect.tag.path` is optional and opt-in. Use it only when your image metadata tracks the running app version reliably; some images set unrelated values.
!> Legacy alias `dd.registry.lookup.url` is still accepted for compatibility, but prefer `dd.registry.lookup.image`.

## Label examples

### Include specific containers to watch
Configure drydock to disable WATCHBYDEFAULT feature.
<!-- tabs:start -->
#### **Docker Compose (Disable Watch by Default)**
```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    ...
    environment:
      - DD_WATCHER_LOCAL_WATCHBYDEFAULT=false
```

#### **Docker (Disable Watch by Default)**
```bash
docker run \
    -e DD_WATCHER_LOCAL_WATCHBYDEFAULT="false" \
  ...
  ghcr.io/codeswhat/drydock
```
<!-- tabs:end -->

Then add the `dd.watch=true` label on the containers you want to watch.
<!-- tabs:start -->
#### **Docker Compose (Include Label)**
```yaml
services:
  mariadb:
    image: mariadb:10.4.5
    ...
    labels:
      - dd.watch=true
```

#### **Docker (Include Label)**
```bash
docker run -d --name mariadb --label dd.watch=true mariadb:10.4.5
```
<!-- tabs:end -->

### Exclude specific containers to watch
Ensure `DD_WATCHER_{watcher_name}_WATCHBYDEFAULT` is true (default value).

Then add the `dd.watch=false` label on the containers you want to exclude from being watched.
<!-- tabs:start -->
#### **Docker Compose (Exclude Label)**
```yaml
services:
  mariadb:
    image: mariadb:10.4.5
    ...
    labels:
      - dd.watch=false
```

#### **Docker (Exclude Label)**
```bash
docker run -d --name mariadb --label dd.watch=false mariadb:10.4.5
```
<!-- tabs:end -->

### Derive a semver from Docker inspect when image tag is `latest`

Use this when the running container exposes a version label in `docker inspect`.

<!-- tabs:start -->
#### **Docker Compose (Inspect Tag Path)**
```yaml
services:
  myapp:
    image: ghcr.io/example/myapp:latest
    labels:
      - dd.inspect.tag.path=Config/Labels/org.opencontainers.image.version
```

#### **Docker (Inspect Tag Path)**
```bash
docker run -d \
  --name myapp \
  --label dd.inspect.tag.path=Config/Labels/org.opencontainers.image.version \
  ghcr.io/example/myapp:latest
```
<!-- tabs:end -->

### Use an alternative image for update lookups

Use this when your runtime image is pulled from a cache/proxy registry, but you want updates checked against an upstream image.

<!-- tabs:start -->
#### **Docker Compose (Lookup Image)**
```yaml
services:
  traefik:
    image: harbor.example.com/dockerhub-proxy/traefik:v3.5.3
    labels:
      - dd.watch=true
      - dd.registry.lookup.image=library/traefik
```

#### **Docker (Lookup Image)**
```bash
docker run -d \
  --name traefik \
  --label 'dd.watch=true' \
  --label 'dd.registry.lookup.image=library/traefik' \
  harbor.example.com/dockerhub-proxy/traefik:v3.5.3
```
<!-- tabs:end -->

### Include only 3 digits semver tags
You can filter (by inclusion or exclusion) which versions can be candidates for update.

For example, you can indicate that you want to watch x.y.z versions only
<!-- tabs:start -->
#### **Docker Compose (Tag Include)**
```yaml
services:

  mariadb:
    image: mariadb:10.4.5
    labels:
      - dd.tag.include=^\d+\.\d+\.\d+$$
```

#### **Docker (Tag Include)**
```bash
docker run -d --name mariadb --label 'dd.tag.include=^\d+\.\d+\.\d+$' mariadb:10.4.5
```
<!-- tabs:end -->

### Transform the tags before performing the analysis
In certain cases, tag values are so badly formatted that the resolution algorithm cannot find any valid update candidates or, worst, find bad positive matches.

For example, you can encounter such an issue if you need to deal with tags looking like `1.0.0-99-7b368146`, `1.0.0-273-21d7efa6`...  
By default, drydock will report bad positive matches because of the `sha-1` part at the end of the tag value (`-7b368146`...).  
That's a shame because `1.0.0-99` and `1.0.0-273` would have been valid semver values (`$major.$minor.$patch-$prerelease`).

You can get around this issue by providing a function that keeps only the part you are interested in.  

How does it work?  
The transform function must follow the following syntax:
```
$valid_regex_with_capturing_groups => $valid_string_with_placeholders
```

For example:
```bash
^(\d+\.\d+\.\d+-\d+)-.*$ => $1
```

The capturing groups are accessible with the syntax `$1`, `$2`, `$3`.... 

!> The first capturing group is accessible as `$1`! 

For example, you can indicate that you want to watch x.y.z versions only
<!-- tabs:start -->
#### **Docker Compose (Tag Transform)**
```yaml
services:

  searx:
    image: searx/searx:1.0.0-269-7b368146
    labels:
      - dd.tag.include=^\d+\.\d+\.\d+-\d+-.*$$
      - dd.tag.transform=^(\d+\.\d+\.\d+-\d+)-.*$$ => $$1
```

#### **Docker (Tag Transform)**
```bash
docker run -d --name searx \
--label 'dd.tag.include=^\d+\.\d+\.\d+-\d+-.*$' \
--label 'dd.tag.transform=^(\d+\.\d+\.\d+-\d+)-.*$ => $1' \
searx/searx:1.0.0-269-7b368146
```
<!-- tabs:end -->

### Enable digest watching
Additionally to semver tag tracking, you can also track if the digest associated to the local tag has been updated.  
It can be convenient to monitor image tags known to be overridden (`latest`, `10`, `10.6`...)

<!-- tabs:start -->
#### **Docker Compose (Digest Watch)**
```yaml
services:

  mariadb:
    image: mariadb:10
    labels:
      - dd.tag.include=^\d+$$
      - dd.watch.digest=true
```
#### **Docker (Digest Watch)**
```bash
docker run -d --name mariadb --label 'dd.tag.include=^\d+$' --label dd.watch.digest=true mariadb:10
```
<!-- tabs:end -->

### Associate a link to the container version
You can associate a browsable link to the container version using a templated string.
For example, if you want to associate a mariadb version to a changelog (e.g. https://mariadb.com/kb/en/mariadb-1064-changelog),

you would specify a template like `https://mariadb.com/kb/en/mariadb-${major}${minor}${patch}-changelog`

The available variables are:
- `${original}` the original unparsed tag
- `${transformed}` the original unparsed tag transformed with the optional `dd.tag.transform` label option
- `${major}` the major version (if tag value is semver)
- `${minor}` the minor version (if tag value is semver)
- `${patch}` the patch version (if tag value is semver)
- `${prerelease}` the prerelease version (if tag value is semver)

<!-- tabs:start -->
#### **Docker Compose (Link Template)**
```yaml
services:

  mariadb:
    image: mariadb:10.6.4
    labels:
      - dd.link.template=https://mariadb.com/kb/en/mariadb-$${major}$${minor}$${patch}-changelog
```

#### **Docker (Link Template)**
```bash
docker run -d --name mariadb --label 'dd.link.template=https://mariadb.com/kb/en/mariadb-${major}${minor}${patch}-changelog' mariadb:10
```
<!-- tabs:end -->

### Customize the name and the icon to display
You can customize the name & the icon of a container (displayed in the UI, in Home-Assistant...)

Icons must be prefixed with:
- `fab:` or `fab-` for [Fontawesome brand icons](https://fontawesome.com/) (`fab:github`, `fab-mailchimp`...)
- `far:` or `far-` for [Fontawesome regular icons](https://fontawesome.com/) (`far:heart`, `far-house`...)
- `fas:` or `fas-` for [Fontawesome solid icons](https://fontawesome.com/) (`fas:heart`, `fas-house`...)
- `hl:` or `hl-` for [Homarr Labs icons](https://dashboardicons.com/) (`hl:plex`, `hl-authelia`...)
- `mdi:` or `mdi-` icons are auto-resolved to Dashboard Icons but are **not recommended**; prefer `hl:` or `fa` prefixes instead
- `sh:` or `sh-` for [Selfh.st](https://selfh.st/icons/) (`sh:authentik`, `sh-authelia-light`...) (only works for logo available as `png`)
- `si:` or `si-` for [Simple icons](https://simpleicons.org/) (`si:mysql`, `si-plex`...)

?> If you want to display Fontawesome icons or Simple icons in Home-Assistant, you need to install first the [HASS-fontawesome](https://github.com/thomasloven/hass-fontawesome) and the [HASS-simpleicons](https://github.com/vigonotion/hass-simpleicons) components.

<!-- tabs:start -->
#### **Docker Compose (Display Name & Icon)**
```yaml
services:

  mariadb:
    image: mariadb:10.6.4
    labels:
      - dd.display.name=Maria DB
      - dd.display.icon=si:mariadb
```

#### **Docker (Display Name & Icon)**
```bash
docker run -d --name mariadb --label 'dd.display.name=Maria DB' --label 'dd.display.icon=si:mariadb' mariadb:10.6.4
```
<!-- tabs:end -->

### Assign different triggers to containers
You can assign different triggers and thresholds on a per container basis.

#### Example send a mail notification for all updates but auto-update only if minor or patch

<!-- tabs:start -->
#### **Docker Compose (Trigger Include)**
```yaml
services:

  my_important_service:
    image: my_important_service:1.0.0
    labels:
      - dd.trigger.include=smtp.gmail,dockercompose.local:minor
```

#### **Docker (Trigger Include)**
```bash
docker run -d --name my_important_service --label 'dd.trigger.include=smtp.gmail,dockercompose.local:minor' my_important_service:1.0.0
```
<!-- tabs:end -->

?> `dd.trigger.include=smtp.gmail` is a shorthand for `dd.trigger.include=smtp.gmail:all`
?> `dd.trigger.include=update` (or `dd.trigger.exclude=update`) targets all triggers named `update`, for example `docker.update` and `discord.update`

?> Threshold `all` means that the trigger will run regardless of the nature of the change

?> Threshold `major` means that the trigger will run only if this is a `major`, `minor` or `patch` semver change 

?> Threshold `minor` means that the trigger will run only if this is a `minor` or `patch` semver change

?> Threshold `patch` means that the trigger will run only if this is a `patch` semver change

?> Threshold `digest` means that the trigger will run only on digest updates

?> Any threshold ending with `-no-digest` excludes digest updates for that threshold
