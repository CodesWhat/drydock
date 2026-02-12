# Docker-Compose
![logo](docker-compose.png)

The `dockercompose` trigger lets you update docker-compose.yml files & replace existing containers with their updated versions.

The trigger will:
- Update the related docker-compose.yml file
- Clone the existing container specification
- Pull the new image
- Stop the existing container
- Remove the existing container
- Create the new container
- Start the new container (if the previous one was running)
- Run `post_start` hooks declared on the updated service (if any)
- Remove the previous image (optionally)

### Variables

| Env var                                           | Required       | Description                                                    | Supported values | Default value when missing |
| ------------------------------------------------- |:--------------:| -------------------------------------------------------------- | ---------------- | -------------------------- | 
| `DD_TRIGGER_DOCKERCOMPOSE_{trigger_name}_FILE`   | :red_circle:   | The docker-compose.yml file location                           |                  |                            |
| `DD_TRIGGER_DOCKERCOMPOSE_{trigger_name}_BACKUP` | :white_circle: | Backup the docker-compose.yml file as `.back` before updating? | `true`, `false`  | `false`                    |
| `DD_TRIGGER_DOCKERCOMPOSE_{trigger_name}_PRUNE`  | :white_circle: | If the old image must be pruned after upgrade                  | `true`, `false`  | `false`                    |
| `DD_TRIGGER_DOCKERCOMPOSE_{trigger_name}_DRYRUN` | :white_circle: | When enabled, only pull the new image ahead of time            | `true`, `false`  | `false`                    |

?> This trigger also supports the [common configuration variables](configuration/triggers/?id=common-trigger-configuration). but only supports the `batch` mode.

!> This trigger will only work with locally watched containers.

!> Do not forget to mount the docker-compose.yml file in the drydock container.

### Troubleshooting: `permission denied` (`EACCES`)

If logs show an error like:

```text
EACCES: permission denied, access '/drydock/.../docker-compose.yml'
```

the mounted compose file (or parent directory) is not readable by the Drydock process.

Ways to fix:

- Grant read access on the mounted path for the user/group used by the Drydock container.
- Add the host group that owns the compose files with `group_add` so Drydock can read them.
- Quick workaround: set `DD_RUN_AS_ROOT=true` to skip privilege drop (less secure).

Example using `group_add`:

```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    group_add:
      - "${COMPOSE_FILES_GID}"
    volumes:
      - /var/lib/docker/volumes/portainer_data/_data/compose:/drydock:ro
    environment:
      - DD_TRIGGER_DOCKERCOMPOSE_EXAMPLE_FILE=/drydock/5/docker-compose.yml
```

?> `COMPOSE_FILES_GID` should match the GID that owns the mounted compose files on the host.

### Examples

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    ...
    volumes:
    - /etc/my-services/docker-compose.yml:/drydock/docker-compose.yml
    environment:
      - DD_TRIGGER_DOCKERCOMPOSE_EXAMPLE_FILE=/drydock/docker-compose.yml
```
#### **Docker**
```bash
docker run \
  -v /etc/my-services/docker-compose.yml:/drydock/docker-compose.yml
  -e "DD_TRIGGER_DOCKERCOMPOSE_EXAMPLE_FILE=/drydock/docker-compose.yml" \
  ...
  ghcr.io/codeswhat/drydock
```
#### **Label**
```yaml
labels:
  dd.compose.file: "/my/path/docker-compose.yaml
```
<!-- tabs:end -->
