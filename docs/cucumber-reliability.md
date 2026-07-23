# Cucumber CI reliability audit

Audit snapshot: 2026-07-22T13:38Z

## Result

The check named `🥒 E2E: Cucumber` was unreliable, but Cucumber scenario execution was not the dominant cause. The job combined dependency installation, public image pulls, a second application build, application startup, live-registry discovery, API and stream contracts, and browser navigation under one check name.

The audit covered every retained `CI Verify` run available through GitHub Actions:

- 761 workflow runs from 2026-03-22 through the audit snapshot
- all 32 workflow rerun histories
- 780 Cucumber job attempts: 401 passed, 30 failed, 290 skipped, and 59 cancelled
- 431 completed attempts, with a 7.0% observed failure rate
- 29 of 30 failed logs inspected; the remaining expired log was classified from its check annotations

Of the 30 failures, 25 were deterministic code, configuration, fixture, or dependency-metadata regressions; four were genuine external/readiness transients; and one had insufficient retained evidence. Only five reached a meaningful product or test-contract assertion. Twenty-five failed in setup, build, readiness, dependency installation, or browser runtime initialization.

## Failure taxonomy

| Failure signature | Attempts | Classification | Resolution |
|---|---:|---|---|
| Exact Alpine package revision drift during the redundant application build | 9 | Deterministic bootstrap | Cucumber now downloads and runs the exact QA image built by the required build job. |
| Missing or mismatched Playwright browser runtime | 5 | Deterministic runtime | Browser navigation was removed from Cucumber and remains covered by the separately release-gated Playwright workflow. |
| Fixture process exited before or after discovery | 2 | Deterministic harness | Keep-alive entrypoints added by #436 keep the required Home Assistant fixtures available. |
| Live-registry/readiness shortfall without a product exception | 2 | External/readiness | Readiness now checks the six active public fixtures and reports the exact missing or unresolved provider fields. |
| Watcher error-restoration mutation regression | 1 | Deterministic product | Fixed by #551; exact fixture readiness makes this class attributable instead of reporting only 7/8 ready. |
| Stale browser text assertions | 2 | Deterministic contract drift | Browser route/copy smoke was removed from Cucumber; Playwright owns semantic UI assertions. |
| Removed unversioned readiness endpoint | 1 | Deterministic harness | A repository invariant protects the versioned endpoint. |
| Missing credential-gated GitLab fixture | 1 | Deterministic fixture/tag mismatch | GitLab scenarios remain explicitly tagged and excluded when the fixture is unavailable. |
| Missing required session secret | 1 | Deterministic startup | Startup supplies the required test secret and strict health semantics. |
| Stale watcher cron assertion | 1 | Deterministic contract drift | Normal contract correction; global retries no longer obscure this class. |
| Package/lock mismatch | 2 | Deterministic dependency metadata | Dependency installation is a distinct named step, so this fails before Cucumber and with the correct attribution. |
| npm registry connection reset | 1 | External transient | Only dependency installation is retried. The scenario suite is not. |
| GitLab registry pull timeout | 1 | External transient | Fixture setup retains a boundary-specific retry. |
| Expired fixture setup log | 1 | Unknown | New diagnostics preserve fixture, readiness, and application evidence. |

Representative evidence includes the [Alpine build failure](https://github.com/CodesWhat/drydock/actions/runs/29317755504), [Playwright runtime mismatch](https://github.com/CodesWhat/drydock/actions/runs/29309859241), [watcher error-restoration failure surfaced as 7/8 readiness](https://github.com/CodesWhat/drydock/actions/runs/29552146138), [npm connection reset](https://github.com/CodesWhat/drydock/actions/runs/29877740897), [stale responsive UI assertion](https://github.com/CodesWhat/drydock/actions/runs/29918885848), and the [latest package/lock mismatch](https://github.com/CodesWhat/drydock/actions/runs/29923008150).

## Reliability policy

- Isolate retries to dependency and fixture-setup boundaries; never retry the scenario suite.
- Run the exact image artifact already accepted by the build gate.
- Treat non-2xx health responses as not ready.
- Gate startup on a checked manifest of exact identities and metadata used by active scenarios, not an aggregate count or inactive providers.
- Restore shared mutable state even when a scenario fails midway.
- Keep browser navigation and rendering in the dedicated Playwright workflow.
- On failure or cancellation, collect application logs, fixture state/logs, health output, and the readiness response; upload those diagnostics plus any Cucumber JSON, JUnit, and HTML reports that were produced.

The blanket `--retry 1` was removed. It could not repair any failure before scenario execution, doubled deterministic failure time, and did not retain evidence when a retry recovered.

## Release-gate follow-on

Moving browser coverage out of Cucumber exposed additional reliability problems in the required Playwright lane. The direct-route smoke loop repeatedly reloaded the authenticated application and pushed the shared QA process over both its production API limit of 1,000 requests per 15 minutes per rate-limit key and its 100-request icon-proxy limit. Later tests then received HTTP 429 responses, producing a cascade of unrelated-looking fixture, modal, and rendering failures. Five whole-test retries added 127 API requests and recovered no failures. The outer API maximum remains 1,000 by default, while the short-lived QA stack uses explicit 10,000-request API and 1,000-request icon budgets so the synthetic release gate can exercise live responses without weakening deployed defaults. Playwright keeps first-failure traces, screenshots, video, and logs but no longer retries the complete test.

The same run exposed a fail-open fixture bootstrap. The nested Docker daemon repeatedly failed to resolve the image mirror, but shell execution continued and Drydock started without the required remote containers. The bootstrap now retries each image pull through the runner daemon, transfers the downloaded image into the nested daemon, exits on the first unrecovered setup error, and is a required successful dependency of Drydock startup. Missing remote fixtures therefore fail at setup with the registry error instead of surfacing later as unrelated UI behavior.

The health-transition test also waited for an asynchronous Docker event to refresh Drydock's container snapshot within 30 seconds. A first correction invoked the targeted container watch endpoint immediately after toggling the fixture, but [exact-SHA verification](https://github.com/CodesWhat/drydock/actions/runs/29944099887) captured the remaining race: the toggle returned in 6 ms, the scan captured the still-healthy Docker state 2 ms later, and registry enrichment then took 29 seconds before returning that stale snapshot. The QA fixture now acknowledges its unhealthy endpoint only after its own Docker healthcheck has observed the marker, and the test performs one bounded targeted scan instead of nesting that long-running request inside a poll.

The targeted scan also exposed a product bug in the endpoint: it refreshed live Docker containers, then scanned the stale store object captured before the refresh and could overwrite the new health. The endpoint now scans the refreshed object, retaining the real watcher and SSE behavior under test without depending on event-delivery timing.

Exact-main verification for rc.5 then exposed a separate suite-startup race in [Playwright run 29967817350](https://github.com/CodesWhat/drydock/actions/runs/29967817350). The first attempt reached the health-transition scenario while a full watcher scan still held the shared QA process; the rerun passed that scenario but started browser assertions before the first 27-container local scan had completed, so group and update-result fixtures were only partially populated. The QA `/health` endpoint had correctly reported that Express was serving requests, but it did not promise that watcher enrichment was complete. Two-minute cron polling and Docker-event refreshes could also start another full scan during the suite.

Playwright's authenticated setup now waits for one exact 29-container snapshot with representative local and remote groups, registry results, and update availability before any browser scenario runs. It does not trigger another scan alongside the built-in startup scan. The browser-only compose fixture parks later cron runs and disables event-driven refreshes, leaving production watcher defaults unchanged while keeping the accepted snapshot stable. A cold-stack validation produced one local and one remote startup scan, and the complete 34-scenario browser suite then passed with no retries (33 passed, one intentional skip).

## Residual risk and follow-up threshold

The remaining nondeterministic boundary is live public-registry behavior. It produced two direct readiness failures plus the npm and GitLab transport failures in the 30-attempt history. Exact readiness and richer artifacts make those failures actionable, but do not make Docker Hub, Quay, npm, or other providers deterministic.

Keep the required fixture manifest aligned with active examples. If live-registry availability causes another blocking failure after these changes, the next change is to build a local registry fixture for the required core lane and move provider-specific live checks into a separately named external-integration lane. That work should restore the exact digest/update assertions that were weakened historically, not remove more coverage.

The operational target is zero unexplained failures and no silent pass-on-retry behavior. Reassess this report after 100 completed applicable Cucumber jobs or the first repeated live-registry failure, whichever comes first.
