# Updates

## Trigger Coordination Improvements (February 9, 2026)

This update improves how triggers can be coordinated when they share the same trigger name (for example `docker.update` and `discord.update`).

### What changed

#### 1. Trigger execution ordering
You can now control trigger execution order with:

`WUD_TRIGGER_{trigger_type}_{trigger_name}_ORDER`

- Lower values run first
- Default is `100`
- If two triggers have the same `ORDER`, they are sorted by trigger id

Example:
```bash
WUD_TRIGGER_DOCKER_UPDATE_ORDER=10
WUD_TRIGGER_DISCORD_UPDATE_ORDER=20
```

This ensures the Docker update trigger runs before the Discord notification trigger for the same update event.

#### 2. Trigger name aliases in container labels
Container labels `wud.trigger.include` and `wud.trigger.exclude` now accept either:
- full trigger id (`docker.update`)
- trigger name alias (`update`)

Example:
```bash
wud.trigger.exclude=update
```

This applies to all triggers named `update` (for example `docker.update`, `discord.update`).

#### 3. Shared threshold by trigger name
Triggers sharing the same trigger name can share `THRESHOLD` automatically:
- if exactly one threshold value is explicitly set among same-name triggers, that value is inherited by the others
- if multiple different threshold values are set, no inheritance is applied

Example:
```bash
WUD_TRIGGER_DOCKER_UPDATE_THRESHOLD=minor
```

With no explicit Discord threshold, `discord.update` inherits `minor`.

### Recommended setup for "update then notify"
```bash
WUD_TRIGGER_DOCKER_UPDATE_THRESHOLD=minor
WUD_TRIGGER_DOCKER_UPDATE_ORDER=10
WUD_TRIGGER_DOCKER_UPDATE_PRUNE=true

WUD_TRIGGER_DISCORD_UPDATE_ORDER=20
WUD_TRIGGER_DISCORD_UPDATE_URL=<discord_webhook_url>
WUD_TRIGGER_DISCORD_UPDATE_SIMPLETITLE=Updated ${container.name}
WUD_TRIGGER_DISCORD_UPDATE_SIMPLEBODY=Container ${container.name} has been updated from ${container.updateKind.localValue} to ${container.updateKind.remoteValue}
```

