# Quality Smells: File-by-File Agent Prompts

Generated from: line count + `any` count + unsafe pattern count (`as any`, `catch (e: any)`, `: any`, `Promise<any>`).

## Inventory

| Priority | Lines | any | Unsafe | File |
|---|---:|---:|---:|---|
| P0 | 2159 | 2 | 0 | `app/triggers/providers/dockercompose/Dockercompose.ts` |
| P0 | 1526 | 1 | 0 | `ui/src/layouts/AppLayout.vue` |
| P1 | 1139 | 1 | 1 | `app/triggers/providers/docker/Docker.ts` |
| P0 | 1056 | 32 | 31 | `app/watchers/providers/docker/Docker.ts` |
| P2 | 937 | 0 | 0 | `ui/src/components/containers/ContainerFullPageTabContent.vue` |
| P2 | 901 | 0 | 0 | `ui/src/components/containers/ContainerSideTabContent.vue` |
| P2 | 881 | 0 | 0 | `app/triggers/providers/Trigger.ts` |
| P2 | 862 | 1 | 0 | `ui/src/views/ContainersView.vue` |
| P2 | 818 | 0 | 0 | `app/authentications/providers/oidc/Oidc.ts` |
| P1 | 810 | 10 | 10 | `app/registry/index.ts` |
| P2 | 804 | 0 | 0 | `app/triggers/providers/docker/ContainerUpdateExecutor.ts` |
| P2 | 801 | 0 | 0 | `ui/src/views/AgentsView.vue` |
| P2 | 792 | 1 | 0 | `ui/src/views/dashboard/useDashboardComputed.ts` |
| P2 | 773 | 2 | 1 | `app/store/container.ts` |
| P2 | 769 | 2 | 2 | `app/model/container.ts` |
| P2 | 750 | 3 | 3 | `app/security/scan.ts` |
| P3 | 687 | 1 | 0 | `app/configuration/index.ts` |
| P3 | 677 | 1 | 0 | `app/watchers/providers/docker/oidc.ts` |
| P3 | 662 | 2 | 0 | `ui/src/views/DashboardView.vue` |
| P3 | 621 | 2 | 2 | `ui/src/utils/container-mapper.ts` |
| P3 | 602 | 3 | 0 | `app/authentications/providers/basic/Basic.ts` |
| P3 | 573 | 1 | 1 | `app/api/container/log-stream.ts` |
| P0 | 523 | 23 | 20 | `app/agent/AgentClient.ts` |
| P2 | 497 | 9 | 5 | `app/registries/Registry.ts` |
| P2 | 492 | 6 | 6 | `app/watchers/providers/docker/tag-candidates.ts` |
| P3 | 465 | 1 | 0 | `app/watchers/providers/docker/docker-image-details-orchestration.ts` |
| P1 | 429 | 13 | 13 | `app/watchers/providers/docker/docker-helpers.ts` |
| P2 | 414 | 7 | 6 | `app/watchers/providers/docker/container-init.ts` |
| P3 | 376 | 1 | 0 | `ui/src/views/LoginView.vue` |
| P3 | 375 | 1 | 0 | `app/triggers/providers/trigger-expression-parser.ts` |
| P2 | 354 | 4 | 0 | `app/api/container/filters.ts` |
| P3 | 342 | 2 | 2 | `app/release-notes/index.ts` |
| P2 | 323 | 5 | 5 | `app/triggers/providers/dockercompose/ComposeFileParser.ts` |
| P1 | 312 | 10 | 0 | `app/triggers/providers/docker/RegistryResolver.ts` |
| P3 | 287 | 1 | 1 | `app/triggers/providers/dockercompose/PostStartExecutor.ts` |
| P0 | 279 | 35 | 3 | `app/registry/trigger-shared-config.ts` |
| P0 | 259 | 19 | 19 | `app/watchers/providers/docker/runtime-details.ts` |
| P2 | 243 | 9 | 9 | `app/triggers/providers/docker/HealthMonitor.ts` |
| P3 | 229 | 2 | 2 | `app/agent/api/event.ts` |
| P3 | 206 | 3 | 3 | `app/triggers/providers/dockercompose/ComposeFileLockManager.ts` |
| P3 | 205 | 2 | 0 | `app/api/container-actions.ts` |
| P2 | 201 | 5 | 3 | `app/watchers/providers/docker/docker-remote-auth.ts` |
| P0 | 168 | 16 | 16 | `app/watchers/providers/docker/docker-event-orchestration.ts` |
| P3 | 164 | 1 | 1 | `app/agent/api/index.ts` |
| P3 | 162 | 1 | 0 | `ui/src/components/containers/ContainersListContent.vue` |
| P2 | 159 | 6 | 6 | `app/watchers/providers/docker/container-event-update.ts` |
| P3 | 154 | 3 | 0 | `app/triggers/providers/pushover/Pushover.ts` |
| P3 | 153 | 1 | 1 | `app/tag/index.ts` |
| P2 | 151 | 5 | 5 | `app/registry/Component.ts` |
| P3 | 147 | 1 | 1 | `app/tag/suggest.ts` |
| P3 | 145 | 1 | 1 | `app/watchers/providers/docker/image-comparison.ts` |
| P3 | 145 | 1 | 0 | `ui/src/composables/useContainerFilters.ts` |
| P3 | 124 | 1 | 0 | `ui/src/services/auth.ts` |
| P3 | 124 | 1 | 0 | `app/registries/providers/hub/Hub.ts` |
| P3 | 115 | 1 | 1 | `app/triggers/hooks/HookRunner.ts` |
| P3 | 110 | 1 | 1 | `app/release-notes/providers/GithubProvider.ts` |
| P3 | 110 | 1 | 0 | `app/registries/providers/quay/Quay.ts` |
| P3 | 109 | 1 | 1 | `app/agent/api/container.ts` |
| P3 | 106 | 1 | 1 | `app/registries/providers/mau/Mau.ts` |
| P3 | 104 | 1 | 0 | `app/api/auth-strategies.ts` |
| P3 | 96 | 1 | 1 | `app/triggers/providers/teams/Teams.ts` |
| P3 | 81 | 1 | 1 | `app/triggers/providers/mattermost/Mattermost.ts` |
| P3 | 73 | 1 | 0 | `app/registries/providers/trueforge/trueforge.ts` |
| P3 | 72 | 1 | 1 | `app/triggers/providers/googlechat/Googlechat.ts` |
| P3 | 71 | 2 | 2 | `app/agent/api/watcher.ts` |
| P3 | 71 | 1 | 1 | `app/agent/api/trigger.ts` |
| P3 | 64 | 1 | 1 | `app/registries/providers/shared/SelfHostedBasic.ts` |
| P3 | 39 | 1 | 1 | `app/vitest.config.ts` |
| P3 | 37 | 2 | 2 | `app/agent/components/AgentTrigger.ts` |
| P3 | 37 | 2 | 1 | `app/agent/components/AgentWatcher.ts` |
| P3 | 35 | 1 | 0 | `app/api/auth-remember-me.ts` |
| P3 | 28 | 2 | 1 | `app/watchers/Watcher.ts` |
| P3 | 17 | 1 | 1 | `app/vitest.coverage-provider.ts` |
| P3 | 13 | 2 | 1 | `ui/src/env.d.ts` |

## Prompts

### P0 — app/triggers/providers/dockercompose/Dockercompose.ts (lines=2159, any=2, unsafe=0)

```text
You are working on one file only: app/triggers/providers/dockercompose/Dockercompose.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/dockercompose/Dockercompose.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/dockercompose/Dockercompose.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P0 — ui/src/layouts/AppLayout.vue (lines=1526, any=1, unsafe=0)

```text
You are working on one file only: ui/src/layouts/AppLayout.vue\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/layouts/AppLayout.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/layouts/AppLayout.vue\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P1 — app/triggers/providers/docker/Docker.ts (lines=1139, any=1, unsafe=1)

```text
You are working on one file only: app/triggers/providers/docker/Docker.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/docker/Docker.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/docker/Docker.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P0 — app/watchers/providers/docker/Docker.ts (lines=1056, any=32, unsafe=31)

```text
You are working on one file only: app/watchers/providers/docker/Docker.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/Docker.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/Docker.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — ui/src/components/containers/ContainerFullPageTabContent.vue (lines=937, any=0, unsafe=0)

```text
You are working on one file only: ui/src/components/containers/ContainerFullPageTabContent.vue\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/components/containers/ContainerFullPageTabContent.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/components/containers/ContainerFullPageTabContent.vue\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — ui/src/components/containers/ContainerSideTabContent.vue (lines=901, any=0, unsafe=0)

```text
You are working on one file only: ui/src/components/containers/ContainerSideTabContent.vue\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/components/containers/ContainerSideTabContent.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/components/containers/ContainerSideTabContent.vue\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/triggers/providers/Trigger.ts (lines=881, any=0, unsafe=0)

```text
You are working on one file only: app/triggers/providers/Trigger.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/Trigger.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/Trigger.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — ui/src/views/ContainersView.vue (lines=862, any=1, unsafe=0)

```text
You are working on one file only: ui/src/views/ContainersView.vue\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/views/ContainersView.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/views/ContainersView.vue\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/authentications/providers/oidc/Oidc.ts (lines=818, any=0, unsafe=0)

```text
You are working on one file only: app/authentications/providers/oidc/Oidc.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/authentications/providers/oidc/Oidc.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/authentications/providers/oidc/Oidc.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P1 — app/registry/index.ts (lines=810, any=10, unsafe=10)

```text
You are working on one file only: app/registry/index.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/registry/index.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/registry/index.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/triggers/providers/docker/ContainerUpdateExecutor.ts (lines=804, any=0, unsafe=0)

```text
You are working on one file only: app/triggers/providers/docker/ContainerUpdateExecutor.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/docker/ContainerUpdateExecutor.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/docker/ContainerUpdateExecutor.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — ui/src/views/AgentsView.vue (lines=801, any=0, unsafe=0)

```text
You are working on one file only: ui/src/views/AgentsView.vue\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/views/AgentsView.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/views/AgentsView.vue\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — ui/src/views/dashboard/useDashboardComputed.ts (lines=792, any=1, unsafe=0)

```text
You are working on one file only: ui/src/views/dashboard/useDashboardComputed.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/views/dashboard/useDashboardComputed.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/views/dashboard/useDashboardComputed.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/store/container.ts (lines=773, any=2, unsafe=1)

```text
You are working on one file only: app/store/container.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/store/container.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/store/container.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/model/container.ts (lines=769, any=2, unsafe=2)

```text
You are working on one file only: app/model/container.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/model/container.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/model/container.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/security/scan.ts (lines=750, any=3, unsafe=3)

```text
You are working on one file only: app/security/scan.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/security/scan.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/security/scan.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/configuration/index.ts (lines=687, any=1, unsafe=0)

```text
You are working on one file only: app/configuration/index.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/configuration/index.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/configuration/index.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/watchers/providers/docker/oidc.ts (lines=677, any=1, unsafe=0)

```text
You are working on one file only: app/watchers/providers/docker/oidc.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/oidc.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/oidc.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — ui/src/views/DashboardView.vue (lines=662, any=2, unsafe=0)

```text
You are working on one file only: ui/src/views/DashboardView.vue\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/views/DashboardView.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/views/DashboardView.vue\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — ui/src/utils/container-mapper.ts (lines=621, any=2, unsafe=2)

```text
You are working on one file only: ui/src/utils/container-mapper.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/utils/container-mapper.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/utils/container-mapper.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/authentications/providers/basic/Basic.ts (lines=602, any=3, unsafe=0)

```text
You are working on one file only: app/authentications/providers/basic/Basic.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/authentications/providers/basic/Basic.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/authentications/providers/basic/Basic.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/api/container/log-stream.ts (lines=573, any=1, unsafe=1)

```text
You are working on one file only: app/api/container/log-stream.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/api/container/log-stream.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/api/container/log-stream.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P0 — app/agent/AgentClient.ts (lines=523, any=23, unsafe=20)

```text
You are working on one file only: app/agent/AgentClient.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/agent/AgentClient.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/agent/AgentClient.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/registries/Registry.ts (lines=497, any=9, unsafe=5)

```text
You are working on one file only: app/registries/Registry.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/registries/Registry.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/registries/Registry.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/watchers/providers/docker/tag-candidates.ts (lines=492, any=6, unsafe=6)

```text
You are working on one file only: app/watchers/providers/docker/tag-candidates.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/tag-candidates.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/tag-candidates.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/watchers/providers/docker/docker-image-details-orchestration.ts (lines=465, any=1, unsafe=0)

```text
You are working on one file only: app/watchers/providers/docker/docker-image-details-orchestration.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/docker-image-details-orchestration.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/docker-image-details-orchestration.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P1 — app/watchers/providers/docker/docker-helpers.ts (lines=429, any=13, unsafe=13)

```text
You are working on one file only: app/watchers/providers/docker/docker-helpers.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/docker-helpers.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/docker-helpers.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/watchers/providers/docker/container-init.ts (lines=414, any=7, unsafe=6)

```text
You are working on one file only: app/watchers/providers/docker/container-init.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/container-init.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/container-init.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — ui/src/views/LoginView.vue (lines=376, any=1, unsafe=0)

```text
You are working on one file only: ui/src/views/LoginView.vue\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/views/LoginView.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/views/LoginView.vue\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/triggers/providers/trigger-expression-parser.ts (lines=375, any=1, unsafe=0)

```text
You are working on one file only: app/triggers/providers/trigger-expression-parser.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/trigger-expression-parser.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/trigger-expression-parser.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/api/container/filters.ts (lines=354, any=4, unsafe=0)

```text
You are working on one file only: app/api/container/filters.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/api/container/filters.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/api/container/filters.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/release-notes/index.ts (lines=342, any=2, unsafe=2)

```text
You are working on one file only: app/release-notes/index.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/release-notes/index.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/release-notes/index.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/triggers/providers/dockercompose/ComposeFileParser.ts (lines=323, any=5, unsafe=5)

```text
You are working on one file only: app/triggers/providers/dockercompose/ComposeFileParser.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/dockercompose/ComposeFileParser.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/dockercompose/ComposeFileParser.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P1 — app/triggers/providers/docker/RegistryResolver.ts (lines=312, any=10, unsafe=0)

```text
You are working on one file only: app/triggers/providers/docker/RegistryResolver.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/docker/RegistryResolver.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/docker/RegistryResolver.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/triggers/providers/dockercompose/PostStartExecutor.ts (lines=287, any=1, unsafe=1)

```text
You are working on one file only: app/triggers/providers/dockercompose/PostStartExecutor.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/dockercompose/PostStartExecutor.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/dockercompose/PostStartExecutor.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P0 — app/registry/trigger-shared-config.ts (lines=279, any=35, unsafe=3)

```text
You are working on one file only: app/registry/trigger-shared-config.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/registry/trigger-shared-config.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/registry/trigger-shared-config.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P0 — app/watchers/providers/docker/runtime-details.ts (lines=259, any=19, unsafe=19)

```text
You are working on one file only: app/watchers/providers/docker/runtime-details.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/runtime-details.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/runtime-details.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/triggers/providers/docker/HealthMonitor.ts (lines=243, any=9, unsafe=9)

```text
You are working on one file only: app/triggers/providers/docker/HealthMonitor.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/docker/HealthMonitor.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/docker/HealthMonitor.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/agent/api/event.ts (lines=229, any=2, unsafe=2)

```text
You are working on one file only: app/agent/api/event.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/agent/api/event.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/agent/api/event.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/triggers/providers/dockercompose/ComposeFileLockManager.ts (lines=206, any=3, unsafe=3)

```text
You are working on one file only: app/triggers/providers/dockercompose/ComposeFileLockManager.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/dockercompose/ComposeFileLockManager.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/dockercompose/ComposeFileLockManager.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/api/container-actions.ts (lines=205, any=2, unsafe=0)

```text
You are working on one file only: app/api/container-actions.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/api/container-actions.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/api/container-actions.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/watchers/providers/docker/docker-remote-auth.ts (lines=201, any=5, unsafe=3)

```text
You are working on one file only: app/watchers/providers/docker/docker-remote-auth.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/docker-remote-auth.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/docker-remote-auth.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P0 — app/watchers/providers/docker/docker-event-orchestration.ts (lines=168, any=16, unsafe=16)

```text
You are working on one file only: app/watchers/providers/docker/docker-event-orchestration.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/docker-event-orchestration.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/docker-event-orchestration.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/agent/api/index.ts (lines=164, any=1, unsafe=1)

```text
You are working on one file only: app/agent/api/index.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/agent/api/index.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/agent/api/index.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — ui/src/components/containers/ContainersListContent.vue (lines=162, any=1, unsafe=0)

```text
You are working on one file only: ui/src/components/containers/ContainersListContent.vue\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/components/containers/ContainersListContent.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/components/containers/ContainersListContent.vue\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/watchers/providers/docker/container-event-update.ts (lines=159, any=6, unsafe=6)

```text
You are working on one file only: app/watchers/providers/docker/container-event-update.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/container-event-update.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/container-event-update.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/triggers/providers/pushover/Pushover.ts (lines=154, any=3, unsafe=0)

```text
You are working on one file only: app/triggers/providers/pushover/Pushover.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/pushover/Pushover.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/pushover/Pushover.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/tag/index.ts (lines=153, any=1, unsafe=1)

```text
You are working on one file only: app/tag/index.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/tag/index.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/tag/index.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P2 — app/registry/Component.ts (lines=151, any=5, unsafe=5)

```text
You are working on one file only: app/registry/Component.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/registry/Component.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/registry/Component.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/tag/suggest.ts (lines=147, any=1, unsafe=1)

```text
You are working on one file only: app/tag/suggest.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/tag/suggest.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/tag/suggest.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/watchers/providers/docker/image-comparison.ts (lines=145, any=1, unsafe=1)

```text
You are working on one file only: app/watchers/providers/docker/image-comparison.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/providers/docker/image-comparison.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/providers/docker/image-comparison.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — ui/src/composables/useContainerFilters.ts (lines=145, any=1, unsafe=0)

```text
You are working on one file only: ui/src/composables/useContainerFilters.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/composables/useContainerFilters.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/composables/useContainerFilters.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — ui/src/services/auth.ts (lines=124, any=1, unsafe=0)

```text
You are working on one file only: ui/src/services/auth.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/services/auth.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/services/auth.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/registries/providers/hub/Hub.ts (lines=124, any=1, unsafe=0)

```text
You are working on one file only: app/registries/providers/hub/Hub.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/registries/providers/hub/Hub.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/registries/providers/hub/Hub.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/triggers/hooks/HookRunner.ts (lines=115, any=1, unsafe=1)

```text
You are working on one file only: app/triggers/hooks/HookRunner.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/hooks/HookRunner.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/hooks/HookRunner.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/release-notes/providers/GithubProvider.ts (lines=110, any=1, unsafe=1)

```text
You are working on one file only: app/release-notes/providers/GithubProvider.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/release-notes/providers/GithubProvider.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/release-notes/providers/GithubProvider.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/registries/providers/quay/Quay.ts (lines=110, any=1, unsafe=0)

```text
You are working on one file only: app/registries/providers/quay/Quay.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/registries/providers/quay/Quay.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/registries/providers/quay/Quay.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/agent/api/container.ts (lines=109, any=1, unsafe=1)

```text
You are working on one file only: app/agent/api/container.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/agent/api/container.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/agent/api/container.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/registries/providers/mau/Mau.ts (lines=106, any=1, unsafe=1)

```text
You are working on one file only: app/registries/providers/mau/Mau.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/registries/providers/mau/Mau.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/registries/providers/mau/Mau.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/api/auth-strategies.ts (lines=104, any=1, unsafe=0)

```text
You are working on one file only: app/api/auth-strategies.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/api/auth-strategies.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/api/auth-strategies.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/triggers/providers/teams/Teams.ts (lines=96, any=1, unsafe=1)

```text
You are working on one file only: app/triggers/providers/teams/Teams.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/teams/Teams.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/teams/Teams.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/triggers/providers/mattermost/Mattermost.ts (lines=81, any=1, unsafe=1)

```text
You are working on one file only: app/triggers/providers/mattermost/Mattermost.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/mattermost/Mattermost.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/mattermost/Mattermost.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/registries/providers/trueforge/trueforge.ts (lines=73, any=1, unsafe=0)

```text
You are working on one file only: app/registries/providers/trueforge/trueforge.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/registries/providers/trueforge/trueforge.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/registries/providers/trueforge/trueforge.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/triggers/providers/googlechat/Googlechat.ts (lines=72, any=1, unsafe=1)

```text
You are working on one file only: app/triggers/providers/googlechat/Googlechat.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/triggers/providers/googlechat/Googlechat.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/triggers/providers/googlechat/Googlechat.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/agent/api/watcher.ts (lines=71, any=2, unsafe=2)

```text
You are working on one file only: app/agent/api/watcher.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/agent/api/watcher.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/agent/api/watcher.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/agent/api/trigger.ts (lines=71, any=1, unsafe=1)

```text
You are working on one file only: app/agent/api/trigger.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/agent/api/trigger.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/agent/api/trigger.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/registries/providers/shared/SelfHostedBasic.ts (lines=64, any=1, unsafe=1)

```text
You are working on one file only: app/registries/providers/shared/SelfHostedBasic.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/registries/providers/shared/SelfHostedBasic.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/registries/providers/shared/SelfHostedBasic.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/vitest.config.ts (lines=39, any=1, unsafe=1)

```text
You are working on one file only: app/vitest.config.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/vitest.config.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/vitest.config.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/agent/components/AgentTrigger.ts (lines=37, any=2, unsafe=2)

```text
You are working on one file only: app/agent/components/AgentTrigger.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/agent/components/AgentTrigger.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/agent/components/AgentTrigger.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/agent/components/AgentWatcher.ts (lines=37, any=2, unsafe=1)

```text
You are working on one file only: app/agent/components/AgentWatcher.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/agent/components/AgentWatcher.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/agent/components/AgentWatcher.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/api/auth-remember-me.ts (lines=35, any=1, unsafe=0)

```text
You are working on one file only: app/api/auth-remember-me.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/api/auth-remember-me.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/api/auth-remember-me.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/watchers/Watcher.ts (lines=28, any=2, unsafe=1)

```text
You are working on one file only: app/watchers/Watcher.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/watchers/Watcher.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/watchers/Watcher.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — app/vitest.coverage-provider.ts (lines=17, any=1, unsafe=1)

```text
You are working on one file only: app/vitest.coverage-provider.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: app/vitest.coverage-provider.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" app/vitest.coverage-provider.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

### P3 — ui/src/env.d.ts (lines=13, any=2, unsafe=1)

```text
You are working on one file only: ui/src/env.d.ts\n\nGoal: improve code quality with zero behavior change.\nDo in this file:\n1. Replace `any` with explicit types or `unknown` + narrowing guards.\n2. Replace `catch (e: any)` with `catch (e: unknown)` and normalize error messages safely.\n3. Remove `as any` by introducing narrow local interfaces/types where possible.\n4. Keep public API unchanged; do not rename exported symbols.\n5. Keep edits minimal and focused to this file.\n\nValidation:\n- Run targeted tests near this area (example candidate: ui/src/env.d.test.ts if it exists).\n- Run: rg -n "\\bany\\b|as any|catch \\((e|error): any\\)|Promise<any>|: any\\b" ui/src/env.d.ts\n- Ensure no behavior/assertion changes.\n\nReturn: short summary + patch.\n```

