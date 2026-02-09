# Agent API

The Agent exposes specific endpoints for the Controller to synchronize state and receive events. These are generally internal APIs used by the Controller but are documented here for reference or advanced debugging.

Authentication is required for all endpoints via the `X-Wud-Agent-Secret` header.

## Get State
Returns a snapshot of the Agent's current state (containers, watchers, triggers).

```bash
# Get Containers
curl -H "X-Wud-Agent-Secret: <SECRET>" http://agent:3000/api/containers

# Get Watchers
curl -H "X-Wud-Agent-Secret: <SECRET>" http://agent:3000/api/watchers

# Get Triggers
curl -H "X-Wud-Agent-Secret: <SECRET>" http://agent:3000/api/triggers
```

## Watch Resources
Trigger a manual watch on a specific watcher or container hosted by the Agent.

```bash
# Watch a specific watcher (discovery)
curl -X POST \
  -H "X-Wud-Agent-Secret: <SECRET>" \
  http://agent:3000/api/watchers/:type/:name

# Watch a specific container (discovery)
curl -X POST \
  -H "X-Wud-Agent-Secret: <SECRET>" \
  http://agent:3000/api/watchers/:type/:name/container/:id
```

## Delete a Container
Delete a container from the Agent's state.
> **Note**: This operation requires `WUD_SERVER_FEATURE_DELETE` to be enabled on the Agent.

```bash
curl -X DELETE \
  -H "X-Wud-Agent-Secret: <SECRET>" \
  http://agent:3000/api/containers/:id
```

## Real-time Events (SSE)
Subscribes to real-time updates from the Agent using Server-Sent Events (SSE).

The Agent pushes events when containers are added, updated, or removed.

### Endpoint
```bash
curl -N -H "X-Wud-Agent-Secret: <SECRET>" -H "Accept: text/event-stream" http://agent:3000/api/events
```

### Protocol
Events are sent as JSON objects with the following structure:
```json
data: {
  "type": "event_type",
  "data": { ...payload... }
}
```

### Supported Events

#### `wud:ack`
Sent immediately upon connection to confirm the handshake.
```json
{
  "type": "wud:ack",
  "data": {
    "version": "1.0.0"
  }
}
```

#### `wud:container-added`
Sent when a new container is discovered.
```json
{
  "type": "wud:container-added",
  "data": { ...container_object... }
}
```

#### `wud:container-updated`
Sent when an existing container is updated (e.g. status change, new image tag).
```json
{
  "type": "wud:container-updated",
  "data": { ...container_object... }
}
```

#### `wud:container-removed`
Sent when a container is removed (e.g. stopped and pruned).
```json
{
  "type": "wud:container-removed",
  "data": {
    "id": "container_id"
  }
}
```

## Execute Remote Trigger
Executes a specific trigger on the Agent (e.g., to update a container).

```bash
curl -X POST \
  -H "X-Wud-Agent-Secret: <SECRET>" \
  -H "Content-Type: application/json" \
  -d '{ ...container_json... }' \
  http://agent:3000/api/triggers/:type/:name
```