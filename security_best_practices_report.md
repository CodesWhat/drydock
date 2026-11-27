# Drydock Security Best-Practices Review

Date: 2026-08-13

Baseline: `7ea69aa86b26296fe70a665de816cb9886c4f2d8` on `dev/v1.7`

Scope: Express backend, Vue dashboard, Next.js website, authentication and sessions, registry and agent transports, container operations, WebSockets, triggers and hooks, filesystem and subprocess boundaries, Docker image, dependencies, and GitHub Actions.

## Executive summary

This review found one High and five Medium security issues. All six are remediated in the reviewed change with regression coverage.

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| DD-SEC-001 | High | Concurrent login requests could start unbounded expensive password verification before lockout accounting | Remediated |
| DD-SEC-002 | Medium | Standard agent requests and unterminated SSE events had no resource bounds | Remediated |
| DD-SEC-003 | Medium | Container log downloads accepted unbounded history and compressed fully buffered output | Remediated |
| DD-SEC-004 | Medium | Local Docker log WebSockets lacked the slow-viewer backpressure guard used by remote streams | Remediated |
| DD-SEC-005 | Medium | Registry data requests followed redirects despite the documented refusal policy | Remediated |
| DD-SEC-006 | Medium | Command and hook strings could expose literal credentials through APIs and logs | Remediated |

No reachable dependency vulnerability or committed credential was confirmed. Existing residual risks that are already stated in `SECURITY-ASSURANCE.md`, including operator-authorized shell execution and outbound response-size limits that vary by integration, remain deployment considerations rather than new findings from this pass.

## Methodology and validation

The review combined source tracing, test-first remediation, and repository scanners. It covered authentication, authorization, CSRF and origin enforcement, request parsing, outbound HTTP, registry authentication, agent transports, WebSockets, container log handling, subprocess execution, browser security policy, filesystem confinement, CI permissions, action pinning, dependencies, and container configuration.

Checks performed on 2026-08-13 included:

- production `npm audit` for the root, `app`, `ui`, `e2e`, `apps/demo`, and `apps/web` lockfiles, all with zero findings
- Gitleaks across the complete Git history, with no credential confirmed
- Grype over tracked source with no finding
- Trivy vulnerability and misconfiguration scans with no finding after the repository policy; secret results were placeholder Slack URLs in versioned documentation, and the Docker `USER` result was the documented runtime `su-exec` privilege drop
- Actionlint with no finding
- Zizmor in normal and pedantic modes; no high-severity workflow issue was found, and the medium Scorecard permission result is intentional
- Semgrep with 114 JavaScript/TypeScript and Docker rules; the reported Docker, test-only TLS, documentation, and Renovate results were false positives. Some test files timed out or did not parse, so this was not treated as a complete clean scan
- the repository Qlty gate, which completed successfully with one non-blocking comment note
- backend security tests, UI security tests, website security scripts, focused affected-path tests, TypeScript builds, and repository pre-push verification

## Findings

### DD-SEC-001: Concurrent password verification could exhaust CPU and memory

- Status: Remediated on 2026-08-13
- Severity: High
- Category: Authentication resource exhaustion
- CWE: CWE-400, Uncontrolled Resource Consumption
- Affected code: `app/api/auth-lockout.ts`, `app/authentications/providers/basic/Basic.ts`

#### Evidence and impact

The login lockout checked completed failures before Passport ran, then recorded a failure only after password verification returned. Concurrent requests could therefore all pass the initial lockout check and begin Argon2 verification before any request incremented the failure count. Accepted Argon2 hashes may request substantial memory, and username mismatches intentionally perform the same derivation to prevent username enumeration.

An unauthenticated burst immediately after startup could queue many CPU- and memory-intensive derivations, delaying legitimate authentication or exhausting the controller. The route-level request-rate limit limited request count over time but did not cap concurrent expensive work.

#### Remediation

`authenticateLogin` now reserves one of two global verification slots before invoking Passport. Excess attempts receive HTTP 429 and `Retry-After: 1` before password hashing starts. `DD_AUTH_MAX_CONCURRENT_LOGIN_ATTEMPTS` permits a positive operator override. The slot is released when Passport completes, including authentication failures. See `app/api/auth-lockout.ts:36`, `app/api/auth-lockout.ts:126-129`, and `app/api/auth-lockout.ts:501-522`.

The regression test holds two Passport callbacks open, proves a third request never reaches Passport, then completes one callback and proves capacity is released.

### DD-SEC-002: Standard agent transport had unbounded requests and SSE fragments

- Status: Remediated on 2026-08-13
- Severity: Medium
- Category: Outbound transport resource exhaustion
- CWE: CWE-400, Uncontrolled Resource Consumption
- Affected code: `app/agent/AgentClient.ts`

#### Evidence and impact

Ordinary agent inventory, watcher, trigger, log, and action requests did not set a timeout, response limit, request-body limit, or redirect refusal. The long-lived SSE parser also retained an incomplete event until a blank-line delimiter arrived, with no maximum size.

A configured, reachable malicious or compromised agent could leave controller operations open, return very large JSON, redirect a request carrying the custom agent credential, or grow one unterminated SSE event until the controller ran out of memory. This was not an unauthenticated internet path. Operators choose the agent endpoint, and shared-secret HTTP already requires an explicit insecure override.

#### Remediation

Ordinary requests now use a 30-second timeout, 16 MiB request and response limits, and `maxRedirects: 0`. Both token and Ed25519 modes use the same bounds without changing the exact signed request target. The SSE connection remains intentionally long-lived, but refuses redirects and destroys/reconnects when an incomplete event exceeds 16 MiB. See `app/agent/AgentClient.ts:401-417`, `app/agent/AgentClient.ts:462-500`, and `app/agent/AgentClient.ts:1165-1194`.

### DD-SEC-003: Container log downloads accepted unbounded history

- Status: Remediated on 2026-08-13
- Severity: Medium
- Category: Authenticated resource exhaustion
- CWE: CWE-400, Uncontrolled Resource Consumption
- Affected code: `app/api/container/logs.ts`

#### Evidence and impact

The authenticated download endpoint forwarded an arbitrary `tail`, fully materialized local or agent log output, converted it to text, and optionally called synchronous `gzipSync`. One request for a large history could consume multiple full-size buffers and block the Node event loop. Explicit anonymous mode extended the same path to unauthenticated clients.

#### Remediation

The endpoint clamps `tail` to 0 through 10,000 lines and rejects materialized output over 16 MiB with HTTP 413 before text demultiplexing or gzip. Agent requests are independently capped at the transport layer by DD-SEC-002. See `app/api/container/logs.ts:109-121`, `app/api/container/logs.ts:226-241`, and `app/api/container/logs.ts:272-281`.

The local Docker client still materializes its bounded line result before the byte check. Docker log-driver retention and maximum-line policy remain operational controls for unusually large individual log records.

### DD-SEC-004: Local log WebSockets lacked slow-viewer backpressure

- Status: Remediated on 2026-08-13
- Severity: Medium
- Category: WebSocket resource exhaustion
- CWE: CWE-400, Uncontrolled Resource Consumption
- Affected code: `app/api/container/log-stream.ts`

#### Evidence and impact

Edge-agent and system-log streams already closed slow viewers when their WebSocket send queue crossed a fixed budget. The local Docker path continued reading and sending without checking `bufferedAmount`. A slow authenticated viewer following a noisy local container could grow the WebSocket queue until memory was exhausted.

#### Remediation

The local path now applies the same 1 MiB viewer-buffer limit before every message, closes a slow viewer with code 1013, and destroys the Docker stream during cleanup. Initial history is capped at 10,000 lines. See `app/api/container/log-stream.ts:35-37`, `app/api/container/log-stream.ts:148-158`, and `app/api/container/log-stream.ts:475-529`.

### DD-SEC-005: Registry data requests followed redirects

- Status: Remediated on 2026-08-13
- Severity: Medium
- Category: Server-side request forgery and credential-boundary drift
- CWE: CWE-918, Server-Side Request Forgery
- Affected code: `app/registries/Registry.ts`

#### Evidence and impact

Bearer-token acquisition explicitly refused redirects, and `SECURITY-ASSURANCE.md` stated that registry manifests did too. The central registry data request did not set `maxRedirects`, so Axios used its redirect-following default for manifests, tags, and blobs.

A malicious or compromised configured registry could redirect the controller to an unintended network target. Redirect-library header stripping reduced some credential-forwarding risk but did not remove the SSRF and availability impact.

#### Remediation

The central registry request sets `maxRedirects: 0`; all authenticated registry data calls inherit it. See `app/registries/Registry.ts:499-509`. A regression test asserts the actual Axios request options, so the assurance claim is pinned to the behavior rather than a hand-maintained expected value.

### DD-SEC-006: Command and hook strings could expose literal credentials

- Status: Remediated on 2026-08-13
- Severity: Medium
- Category: Sensitive information exposure through logs and API responses
- CWE: CWE-532, Insertion of Sensitive Information into Log File
- Affected code: `app/registry/trigger-config-redaction.ts`, `app/triggers/providers/command/Command.ts`, `app/triggers/hooks/HookRunner.ts`

#### Evidence and impact

Command trigger configuration returned `cmd` through the authenticated component API and logged it during registration. Successful, failed, and stderr-producing command executions logged the full command again. Hook execution logged the full label-provided command. The documentation included a webhook-bearing hook directly in a container label.

If an operator embedded a token, signed URL, or password in one of those command strings, it became visible to API readers, stdout collectors, and the in-memory log API.

#### Remediation

Trigger configuration now treats `cmd` as sensitive and returns `[REDACTED]`; command completion and failure logs no longer include the configured command or the child-process error text that can echo it; hook startup logs include only the hook label. The documentation now uses a script and tells operators to read credentials from a mounted secret or environment variable. See `app/registry/trigger-config-redaction.ts:1-19`, `app/triggers/providers/command/Command.ts:213-220`, and `app/triggers/hooks/HookRunner.ts:321-343`.

Regression tests use a canary URL and prove it does not appear in API output, successful or failed command logs, or hook startup logs.

## No-findings areas

The review did not identify an additional confirmed defect in Express session handling, CSRF and mutation content-type enforcement, CORS, webhook raw-body HMAC verification, WebSocket upgrade origin and authentication checks, Vue/Next.js XSS sinks and CSP, filesystem path confinement, release signing, or GitHub Actions trust boundaries. This statement is limited to the reviewed baseline and checks above; it is not a guarantee that no defect exists.
