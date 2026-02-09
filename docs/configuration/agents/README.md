# Agents

The **Agent Mode** allows running WUD in a distributed manner.

- **Agent Node**: Runs near the Docker socket (or other container sources). It performs discovery and update checks.
- **Controller Node**: The central instance. It manages its own local watchers AND connects to remote Agents. It aggregates containers from Agents, and handles persistence, UI, and Notifications.

## Architecture

The Controller connects to one or more Agents via HTTP/HTTPS. The Agent pushes real-time updates (container changes, new versions found) to the Controller using Server-Sent Events (SSE).

## Agent Configuration

To run WUD in Agent mode, start the application with the `--agent` command line flag.

### Environment Variables

| Env var | Required | Description | Default |
| :--- | :---: | :--- | :--- |
| `WUD_AGENT_SECRET` | :red_circle: | Secret token for authentication (must match Controller configuration) | |
| `WUD_AGENT_SECRET_FILE` | :white_circle: | Path to file containing the secret token | |
| `WUD_SERVER_PORT` | :white_circle: | Port to listen on | `3000` |
| `WUD_SERVER_TLS_*` | :white_circle: | Standard [Server](/configuration/server/) TLS options | |
| `WUD_WATCHER_{name}_*` | :red_circle: | [Watcher](/configuration/watchers/) configuration (At least one is required) | |
| `WUD_REGISTRY_{name}_*` | :white_circle: | [Registry](/configuration/registries/) configuration (For update checks) | |

### Example (Docker Compose)

```yaml
services:
  wud-agent:
    image: codeswhat/whatsupdocker-ce
    command: --agent
    environment:
      - WUD_AGENT_SECRET=mysecretkey
      - WUD_WATCHER_LOCAL_SOCKET=/var/run/docker.sock
      - WUD_LOG_LEVEL=debug
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

## Controller Configuration

To connect a Controller to an Agent, use the `WUD_AGENT_{name}_*` environment variables.

### Environment Variables

| Env var | Required | Description | Default |
| :--- | :---: | :--- | :--- |
| `WUD_AGENT_{name}_SECRET` | :red_circle: | Secret token to authenticate with the Agent | |
| `WUD_AGENT_{name}_SECRET_FILE` | :white_circle: | Path to file containing the secret token | |
| `WUD_AGENT_{name}_HOST` | :red_circle: | Hostname or IP of the Agent | |
| `WUD_AGENT_{name}_PORT` | :white_circle: | Port of the Agent | `3000` |
| `WUD_AGENT_{name}_CAFILE` | :white_circle: | CA certificate path for TLS connection | |
| `WUD_AGENT_{name}_CERTFILE` | :white_circle: | Client certificate path for TLS connection | |
| `WUD_AGENT_{name}_KEYFILE` | :white_circle: | Client key path for TLS connection | |

### Example (Docker Compose)

```yaml
services:
  wud-controller:
    image: codeswhat/whatsupdocker-ce
    environment:
      - WUD_AGENT_REMOTE1_HOST=192.168.1.50
      - WUD_AGENT_REMOTE1_SECRET=mysecretkey
    ports:
      - 3000:3000
```

## Features in Agent Mode

- **Watchers**: Run on the Agent to discover containers.
- **Registries**: Configured on the Agent to check for updates.
- **Triggers**: 
    - `docker` and `dockercompose` triggers are executed **on the Agent** (allowing update of remote containers).
    - Notification triggers (e.g. `smtp`, `discord`) are executed **on the Controller**.
