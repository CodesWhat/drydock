# Update Guard (Security)

Update Guard runs security scanning in a safe-pull flow:

1. Candidate image is scanned before update
2. Update is blocked when CVEs match configured blocking severities
3. Scan result is stored in `container.security.scan` and exposed in API/UI

## Enablement

Security scanning is disabled by default.
To enable it, set:

```bash
DD_SECURITY_SCANNER=trivy
```

## Variables

| Env var | Required | Description | Supported values | Default value when missing |
| --- | :---: | --- | --- | --- |
| `DD_SECURITY_SCANNER` | :white_check_mark: | Enable scanner provider | `trivy` | disabled |
| `DD_SECURITY_BLOCK_SEVERITY` | :white_circle: | Blocking severities (comma-separated) | Any of `UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL` | `CRITICAL,HIGH` |
| `DD_SECURITY_TRIVY_SERVER` | :white_circle: | Trivy server URL (enables client/server mode) | URL | empty (local CLI mode) |
| `DD_SECURITY_TRIVY_COMMAND` | :white_circle: | Trivy command path for local CLI mode | executable path | `trivy` |
| `DD_SECURITY_TRIVY_TIMEOUT` | :white_circle: | Trivy command timeout in milliseconds | integer (`>=1000`) | `120000` |

## Trivy modes

### Client mode (local CLI)

Use this mode when the `trivy` binary is available inside the drydock runtime.

?> **Tip:** Local CLI mode requires the `trivy` binary inside the container. Build a custom image or use server mode with a standalone Trivy instance.

```yaml
services:
  drydock:
    image: your-org/drydock-with-trivy:latest
    environment:
      - DD_SECURITY_SCANNER=trivy
      - DD_SECURITY_BLOCK_SEVERITY=CRITICAL,HIGH
      - DD_SECURITY_TRIVY_COMMAND=trivy
      - DD_SECURITY_TRIVY_TIMEOUT=120000
```

### Server mode (Trivy server)

Use this mode when running a separate Trivy server and letting drydock call it.

```yaml
services:
  trivy:
    image: aquasec/trivy:latest
    command: server --listen 0.0.0.0:4954

  drydock:
    image: codeswhat/drydock:latest
    depends_on:
      - trivy
    environment:
      - DD_SECURITY_SCANNER=trivy
      - DD_SECURITY_BLOCK_SEVERITY=CRITICAL,HIGH
      - DD_SECURITY_TRIVY_SERVER=http://trivy:4954
      - DD_SECURITY_TRIVY_TIMEOUT=120000
```
