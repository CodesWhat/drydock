# Container API
This API allows to query the state of the watched containers.

## Get all containers
This operation lets you get all the watched cainers.

```bash
curl http://wud:3000/api/containers

[
   {
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}
]
```

## Watch all Containers
This operation triggers a manual watch on all containers.

```bash
curl -X POST http://wud:3000/api/containers/watch

[{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}]
```

## Get a Container by id

This operation lets you get a container by id.

```bash
curl http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816

{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}
```

## Get all triggers associated to the container

This operation lets you get the list of the containers associated to the container.

```bash
curl http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816/triggers

[
  {
    "id": "ntfy.one",
    "type": "ntfy",
    "name": "one",
    "configuration": {
      "topic": "235ef38e-f1db-414a-964f-ce3f2cc8094d",
      "url": "https://ntfy.sh",
      "threshold": "major",
      "mode": "simple",
      "once": true,
      "simpletitle": "New ${kind} found for container ${name}",
      "simplebody": "Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}",
      "batchtitle": "${containers.length} updates available",
    }
  }
]
```

## Watch a Container
This operation triggers a manual watch on a container.

```bash
curl -X POST http://wud:3000/api/containers/ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72/watch

{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}
```

## Run a trigger on the container

This operation lets you manually run a trigger on the container.

```bash
curl -X POST http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816/triggers/ntfy/one
```

## Update container update policy (skip/snooze)

This operation lets you control per-container update suppression policy (stored in WUD DB):

- `skip-current`: skip the currently detected remote tag or digest
- `clear-skips`: remove `skipTags` and `skipDigests`
- `snooze`: suppress update notifications until a date (supports `days` or explicit `snoozeUntil`)
- `unsnooze`: remove `snoozeUntil`
- `clear`: remove all update policy

```bash
curl -X PATCH http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816/update-policy \
  -H 'Content-Type: application/json' \
  -d '{"action":"skip-current"}'
```

```bash
curl -X PATCH http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816/update-policy \
  -H 'Content-Type: application/json' \
  -d '{"action":"snooze","days":7}'
```

## Delete a Container
This operation lets you delete a container by id.

```bash
curl -X DELETE http://wud:3000/api/containers/ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72
```
