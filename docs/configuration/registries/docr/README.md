# DOCR (DigitalOcean Container Registry)

The `docr` registry lets you configure [DigitalOcean Container Registry](https://docs.digitalocean.com/products/container-registry/) integration.

### Variables

| Env var                                       | Required       | Description                                | Supported values         | Default value when missing |
| --------------------------------------------- |:--------------:| ------------------------------------------ | ------------------------ | -------------------------- |
| `WUD_REGISTRY_DOCR_{REGISTRY_NAME}_TOKEN`     | :white_circle: | DigitalOcean API token (recommended)       |                          |                            |
| `WUD_REGISTRY_DOCR_{REGISTRY_NAME}_LOGIN`     | :white_circle: | Registry username for basic auth           |                          | `doctl` when `TOKEN` is set |
| `WUD_REGISTRY_DOCR_{REGISTRY_NAME}_PASSWORD`  | :white_circle: | Registry password for basic auth           |                          |                            |
| `WUD_REGISTRY_DOCR_{REGISTRY_NAME}_AUTH`      | :white_circle: | Base64 encoded `login:password` credential | Valid base64 string      |                            |

?> `TOKEN` is a convenience alias. WUD maps it to basic auth automatically.
?> The DOCR endpoint is fixed to `https://registry.digitalocean.com`.

### Examples

#### Configure with API token

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  whatsupdocker:
    image: ghcr.io/codeswhat/whatsupdocker-ce
    ...
    environment:
      - WUD_REGISTRY_DOCR_PRIVATE_TOKEN=dop_v1_xxxxxxxxxxxxx
```
#### **Docker**
```bash
docker run \
  -e "WUD_REGISTRY_DOCR_PRIVATE_TOKEN=dop_v1_xxxxxxxxxxxxx" \
  ...
  ghcr.io/codeswhat/whatsupdocker-ce
```
<!-- tabs:end -->

#### Configure with explicit basic auth

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  whatsupdocker:
    image: ghcr.io/codeswhat/whatsupdocker-ce
    ...
    environment:
      - WUD_REGISTRY_DOCR_PRIVATE_LOGIN=doctl
      - WUD_REGISTRY_DOCR_PRIVATE_PASSWORD=dop_v1_xxxxxxxxxxxxx
```
#### **Docker**
```bash
docker run \
  -e "WUD_REGISTRY_DOCR_PRIVATE_LOGIN=doctl" \
  -e "WUD_REGISTRY_DOCR_PRIVATE_PASSWORD=dop_v1_xxxxxxxxxxxxx" \
  ...
  ghcr.io/codeswhat/whatsupdocker-ce
```
<!-- tabs:end -->

#### Configure with `AUTH` from `~/.docker/config.json`

If your Docker config has:

```json
{
  "auths": {
    "registry.digitalocean.com": {
      "auth": "ZG9jdGw6ZG9wX3YxX3h4eHh4eHh4eHh4"
    }
  }
}
```

use:

```bash
docker run \
  -e "WUD_REGISTRY_DOCR_PRIVATE_AUTH=ZG9jdGw6ZG9wX3YxX3h4eHh4eHh4eHh4" \
  ...
  ghcr.io/codeswhat/whatsupdocker-ce
```
