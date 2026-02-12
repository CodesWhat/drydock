# Popular IMGSET Presets

Copy/paste these YAML `environment` blocks into your `drydock` service.

Update `DD_WATCHER_LOCAL_...` if your watcher name is not `local`.

## Home Assistant

```yaml
environment:
  - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_IMAGE=ghcr.io/home-assistant/home-assistant
  - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_TAG_INCLUDE=^\\d+\\.\\d+\\.\\d+$$
  - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_TAG_EXCLUDE=(alpha|beta|rc)
  - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_DISPLAY_NAME=Home Assistant
  - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_DISPLAY_ICON=mdi-home-assistant
  - DD_WATCHER_LOCAL_IMGSET_HOMEASSISTANT_LINK_TEMPLATE=https://www.home-assistant.io/changelogs/core-$${major}$${minor}$${patch}
```

## Traefik

```yaml
environment:
  - DD_WATCHER_LOCAL_IMGSET_TRAEFIK_IMAGE=traefik
  - DD_WATCHER_LOCAL_IMGSET_TRAEFIK_TAG_INCLUDE=^\\d+\\.\\d+\\.\\d+$$
  - DD_WATCHER_LOCAL_IMGSET_TRAEFIK_TAG_EXCLUDE=(alpha|beta|rc)
  - DD_WATCHER_LOCAL_IMGSET_TRAEFIK_DISPLAY_NAME=Traefik
  - DD_WATCHER_LOCAL_IMGSET_TRAEFIK_DISPLAY_ICON=mdi-cloud
  - DD_WATCHER_LOCAL_IMGSET_TRAEFIK_LINK_TEMPLATE=https://github.com/traefik/traefik/releases/tag/v$${major}.$${minor}.$${patch}
```

## Caddy

```yaml
environment:
  - DD_WATCHER_LOCAL_IMGSET_CADDY_IMAGE=caddy
  - DD_WATCHER_LOCAL_IMGSET_CADDY_TAG_INCLUDE=^\\d+\\.\\d+\\.\\d+$$
  - DD_WATCHER_LOCAL_IMGSET_CADDY_TAG_EXCLUDE=(beta|rc)
  - DD_WATCHER_LOCAL_IMGSET_CADDY_DISPLAY_NAME=Caddy
  - DD_WATCHER_LOCAL_IMGSET_CADDY_DISPLAY_ICON=mdi-web
  - DD_WATCHER_LOCAL_IMGSET_CADDY_LINK_TEMPLATE=https://github.com/caddyserver/caddy/releases/tag/v$${major}.$${minor}.$${patch}
```

## Nginx

```yaml
environment:
  - DD_WATCHER_LOCAL_IMGSET_NGINX_IMAGE=nginx
  - DD_WATCHER_LOCAL_IMGSET_NGINX_TAG_INCLUDE=^\\d+\\.\\d+\\.\\d+$$
  - DD_WATCHER_LOCAL_IMGSET_NGINX_TAG_EXCLUDE=(alpine|perl|rc)
  - DD_WATCHER_LOCAL_IMGSET_NGINX_DISPLAY_NAME=Nginx
  - DD_WATCHER_LOCAL_IMGSET_NGINX_DISPLAY_ICON=mdi-nginx
  - DD_WATCHER_LOCAL_IMGSET_NGINX_LINK_TEMPLATE=https://github.com/nginx/nginx/releases/tag/release-$${major}.$${minor}.$${patch}
```

## PostgreSQL

```yaml
environment:
  - DD_WATCHER_LOCAL_IMGSET_POSTGRES_IMAGE=postgres
  - DD_WATCHER_LOCAL_IMGSET_POSTGRES_TAG_INCLUDE=^\\d+(\\.\\d+)?$$
  - DD_WATCHER_LOCAL_IMGSET_POSTGRES_TAG_EXCLUDE=(alpine|beta|rc)
  - DD_WATCHER_LOCAL_IMGSET_POSTGRES_DISPLAY_NAME=PostgreSQL
  - DD_WATCHER_LOCAL_IMGSET_POSTGRES_DISPLAY_ICON=mdi-elephant
  - DD_WATCHER_LOCAL_IMGSET_POSTGRES_LINK_TEMPLATE=https://www.postgresql.org/docs/release/$${major}.$${minor}/
```

## Redis

```yaml
environment:
  - DD_WATCHER_LOCAL_IMGSET_REDIS_IMAGE=redis
  - DD_WATCHER_LOCAL_IMGSET_REDIS_TAG_INCLUDE=^\\d+(\\.\\d+)?$$
  - DD_WATCHER_LOCAL_IMGSET_REDIS_TAG_EXCLUDE=(alpine|beta|rc)
  - DD_WATCHER_LOCAL_IMGSET_REDIS_DISPLAY_NAME=Redis
  - DD_WATCHER_LOCAL_IMGSET_REDIS_DISPLAY_ICON=mdi-redis
  - DD_WATCHER_LOCAL_IMGSET_REDIS_LINK_TEMPLATE=https://github.com/redis/redis/releases/tag/$${major}.$${minor}
```

## n8n

```yaml
environment:
  - DD_WATCHER_LOCAL_IMGSET_N8N_IMAGE=n8nio/n8n
  - DD_WATCHER_LOCAL_IMGSET_N8N_TAG_INCLUDE=^\\d+\\.\\d+\\.\\d+$$
  - DD_WATCHER_LOCAL_IMGSET_N8N_TAG_EXCLUDE=(alpha|beta|rc)
  - DD_WATCHER_LOCAL_IMGSET_N8N_DISPLAY_NAME=n8n
  - DD_WATCHER_LOCAL_IMGSET_N8N_DISPLAY_ICON=mdi-graph-outline
  - DD_WATCHER_LOCAL_IMGSET_N8N_LINK_TEMPLATE=https://github.com/n8n-io/n8n/releases/tag/n8n@$${major}.$${minor}.$${patch}
```

## AdGuard Home

```yaml
environment:
  - DD_WATCHER_LOCAL_IMGSET_ADGUARDHOME_IMAGE=adguard/adguardhome
  - DD_WATCHER_LOCAL_IMGSET_ADGUARDHOME_TAG_INCLUDE=^v?\\d+\\.\\d+\\.\\d+$$
  - DD_WATCHER_LOCAL_IMGSET_ADGUARDHOME_TAG_EXCLUDE=(beta|rc)
  - DD_WATCHER_LOCAL_IMGSET_ADGUARDHOME_DISPLAY_NAME=AdGuard Home
  - DD_WATCHER_LOCAL_IMGSET_ADGUARDHOME_DISPLAY_ICON=mdi-shield-home
  - DD_WATCHER_LOCAL_IMGSET_ADGUARDHOME_LINK_TEMPLATE=https://github.com/AdguardTeam/AdGuardHome/releases/tag/v$${major}.$${minor}.$${patch}
```
