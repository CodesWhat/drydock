# Quick start

## Run the Docker image
The easiest way to start is to deploy the official _**drydock**_ image.

<!-- tabs:start -->
#### **Socket Proxy (Recommended)**
Using a socket proxy is the most secure way to expose the Docker API. The proxy limits which endpoints Drydock can access.

```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    container_name: drydock
    depends_on:
      - socket-proxy
    environment:
      - DD_WATCHER_LOCAL_HOST=socket-proxy
      - DD_WATCHER_LOCAL_PORT=2375
    ports:
      - 3000:3000

  socket-proxy:
    image: tecnativa/docker-socket-proxy
    container_name: drydock-socket-proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - CONTAINERS=1
      - IMAGES=1
      - EVENTS=1
      - SERVICES=1
      # Add POST=1 and NETWORKS=1 if using the Docker trigger for auto-updates
    restart: unless-stopped
```

#### **Direct Mount**
The simplest setup — mount the Docker socket directly. Works out of the box on most systems.

```yaml
services:
  drydock:
    image: ghcr.io/codeswhat/drydock
    container_name: drydock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    ports:
      - 3000:3000
```

?> If you need a **read-only** socket mount (`:ro`), set `DD_RUN_AS_ROOT=true` to skip Drydock's privilege drop. See the [Docker Socket Security](configuration/watchers/#docker-socket-security) section for details.

#### **Docker CLI**
```bash
docker run -d --name drydock \
  -v "/var/run/docker.sock:/var/run/docker.sock" \
  -p 3000:3000 \
  ghcr.io/codeswhat/drydock
```
<!-- tabs:end -->

?> Please notice that this CE build is currently published on Github Container Registry \
\- Github Container Registry: `ghcr.io/codeswhat/drydock`

## Open the UI
[Open the UI](http://localhost:3000) in a browser and check that everything is working as expected.

## Add your first trigger
?> Everything ok? \
It's time to [**add some triggers**](configuration/triggers/)!

## Going deeper...

?> Need to fine configure how drydock must watch your containers? \
Take a look at the [**watcher documentation**](configuration/watchers/)!
  
?> Need to integrate other registries (ECR, GCR...)? \
Take a look at the [**registry documentation**](configuration/registries/).

## Ready-to-go examples
?> You can find here a **[complete configuration example](configuration/?id=complete-example)** illustrating some common drydock options.
