# Drydock Security Assurance Case

Last reviewed: 2026-08-12

This document states Drydock's security requirements, threat boundaries, and
the public evidence supporting its security claims. It is a living assurance
case, not a claim that Drydock can make a Docker daemon safe after an attacker
has gained authorized Docker API access.

## Security requirements and limits

Drydock is intended to:

- deny protected API access unless authentication succeeds, with anonymous
  operation requiring an explicit acknowledgement;
- validate untrusted network, registry, webhook, configuration, and update
  inputs before using them;
- keep credentials out of logs, debug bundles, release artifacts, and browser
  responses;
- limit outbound requests so registry and notification features cannot be used
  as an unrestricted SSRF or redirect path;
- ship changes only after automated tests, static analysis, dependency checks,
  and release verification pass; and
- produce signed, attributable release artifacts with provenance and SBOMs.

An authenticated Drydock deployment may inspect and update containers through
the Docker API. Docker socket access is effectively host-root access. Drydock
does not turn an unrestricted socket into a least-privilege interface. Operators
should place [Sockguard](https://github.com/CodesWhat/sockguard) or another
allowlisting proxy between Drydock and the daemon, restrict network access, and
protect every configured credential. The supported-version and disclosure
commitments are defined in [`SECURITY.md`](SECURITY.md).

## Threat model and trust boundaries

The relevant threat actors are unauthenticated network clients, authenticated
but malicious users, hostile registry or webhook responses, compromised remote
services, malicious container metadata, and a contributor or dependency that
attempts to alter the build or release process.

The principal trust boundaries are:

1. **Client to HTTP API and UI.** Network data becomes application input. Auth,
   rate limiting, schema validation, output encoding, and security headers are
   enforced here.
2. **Drydock to Docker or Portwing.** Crossing this boundary can change host
   workloads. Authentication and update policy are enforced by Drydock, while
   endpoint-level least privilege belongs at a socket proxy.
3. **Drydock to registries and notification providers.** Remote URLs, redirects,
   DNS answers, response sizes, and credentials are treated as untrusted.
4. **Process to persistent state and secrets.** Secret-file permissions,
   redaction, bounded debug exports, and integrity checks protect this boundary.
5. **Source to release artifact.** Reviewed source crosses CI, build, signing,
   provenance, and publication controls before users receive an artifact.

## Claims and evidence

### Fail-safe defaults and complete mediation

Authentication configuration fails closed at the request boundary rather than by
terminating the process. With no authentication configured and anonymous access
not confirmed, no Passport strategy is registered: protected requests are
rejected and `/health` reports `503 auth strategies not yet registered` instead
of serving traffic unauthenticated. Anonymous mode must be explicitly confirmed
via `DD_ANONYMOUS_AUTH_CONFIRM`, and protected routes share the authentication
middleware rather than opting in route by route. Docker updates flow through the
same policy and operation tracking used by the API and UI. Regression tests cover
authentication failure, authorization, rate limiting, update admission, and agent
boundaries.

Evidence: [`app/authentications/`](app/authentications),
[`app/api/`](app/api), [`app/updates/`](app/updates), and the tests adjacent to
those modules.

### Least privilege and secret handling

The published container is designed for a read-only root filesystem and minimal
runtime privileges. Configuration supports mounted secret files. Debug output
and structured logs redact credential-bearing fields. CI release signing uses
short-lived GitHub OIDC identities instead of a maintainer-held signing key.

Evidence: [`Dockerfile`](Dockerfile), [`app/debug/`](app/debug),
[`app/log/`](app/log), the hardened deployment in [`README.md`](README.md), and
[`.github/workflows/release-cut.yml`](.github/workflows/release-cut.yml).

### Untrusted input, injection, and outbound-request controls

Inputs are parsed into typed configuration and request models. Outbound HTTP
controls are applied per path rather than uniformly, so this section states them
individually rather than claiming a blanket policy:

| Path | Timeout | Redirects refused | Response size capped | Metadata/link-local address refused |
| --- | --- | --- | --- | --- |
| Registry auth and manifests (`app/registries/`) | yes | yes | no | no |
| HTTP trigger (`app/triggers/providers/http/`) | yes | yes | no | yes |
| Agent Docker proxy (`app/agent/`) | yes | yes | yes | no |
| Icon fetch (`app/api/icons/`) | yes | no | yes | no |
| Release notes (`app/release-notes/`) | yes | no | no | no |
| Notification providers calling axios directly (Apprise, Discord, Google Chat, Matrix, Mattermost, ntfy, Rocket.Chat, Teams, Telegram) | yes | no | no | no |
| IFTTT notification provider (`app/triggers/providers/ifttt/`) | no | no | no | no |
| Notification providers wrapping a vendor SDK (Gotify, Kafka, Pushover, Slack, SMTP) | vendor default | vendor default | vendor default | vendor default |

Shell-like update and hook surfaces use explicit argument handling and
validation. Tests include malformed input, redirect, metadata-address,
traversal, injection, and resource-limit cases.

The gaps in that table are real and deliberate to state. Only the HTTP trigger,
which takes an operator-supplied URL, resolves and refuses cloud metadata and
link-local addresses; several notification providers are self-hostable and so
also take an operator-supplied host, without that check. Release notes and icons
follow redirects, and release notes applies no response-size cap. IFTTT is the
one path with no timeout at all: it calls axios without the shared
`getOutboundHttpTimeoutMs()` value its nine sibling providers pass, tracked as
[#704](https://github.com/CodesWhat/drydock/issues/704). Providers built on a
vendor SDK inherit whatever controls that dependency applies; Drydock does not
establish them and does not claim them here.

Evidence: [`app/configuration/`](app/configuration),
[`app/registries/`](app/registries), [`app/release-notes/`](app/release-notes),
[`app/api/icons/`](app/api/icons), and
[`app/triggers/providers/`](app/triggers/providers).

### Common weakness and dependency controls

CI applies TypeScript compilation, Biome, CodeQL, dependency review, secret
scanning, Grype, workflow security checks, unit and integration tests, browser
tests, and 100% line, branch, function, and statement coverage gates for the
backend and UI. Monthly mutation testing provides a separate signal about
assertion quality. Lockfiles and SHA-pinned Actions make dependency changes
reviewable and repeatable.

Evidence: [`.github/workflows/ci-verify.yml`](.github/workflows/ci-verify.yml),
[`.github/workflows/security-grype.yml`](.github/workflows/security-grype.yml),
[`.github/workflows/quality-mutation-monthly.yml`](.github/workflows/quality-mutation-monthly.yml),
[`CONTRIBUTING.md`](CONTRIBUTING.md), and the public CI, coverage, and Scorecard
badges in [`README.md`](README.md).

### Release integrity

The release workflow waits for the required CI and browser-test results, builds
the selected revision, creates an SBOM, signs images and archives with Sigstore,
attests provenance through GitHub, verifies those records, and only then
publishes tags and release assets. General-availability releases promote the
previously tested release-candidate digest instead of rebuilding it.

A GA promotion normally requires the candidate to have soaked for seven days,
measured from its release publication time. That floor can be overridden by
dispatch, and the override is deliberately noisy rather than silent: it requires
a justification of at least 20 characters, emits a workflow warning naming the
actual candidate age, and records the justification in both the run summary and
the published release notes. v1.6.0 was promoted this way, at three days.

Evidence: [`.github/workflows/release-cut.yml`](.github/workflows/release-cut.yml)
and the public [release history](https://github.com/CodesWhat/drydock/releases).

## Residual risk

No assurance case eliminates risk. The largest residual risk is the authority
of the Docker API itself. A stolen deployment credential, an overly broad socket
policy, a compromised host, or a malicious authenticated administrator can still
cause host-level impact. External registries and notification providers can be
unavailable or return hostile data. Operators remain responsible for network
segmentation, backups, credential rotation, host patching, and reviewing the
security implications of enabled update and notification features.
