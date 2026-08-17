# Releasing drydock

`CONTRIBUTING.md` covers the contributor PR flow. This is the maintainer flow: how a release actually gets cut, from RC through GA. Everything here is driven by one workflow, `.github/workflows/release-cut.yml`, dispatched manually from `main`.

## Overview

`release-cut.yml` builds a recoverable, idempotent pipeline: images are first pushed under run-scoped staging tags, signed, attested, and attached to a **draft** GitHub release before anything user-facing is touched. Image tags, the git tag, and the public release are only finalized at the end, in that order — a failed run can safely be re-dispatched and it resumes from verified state instead of redoing work.

The workflow only runs from `refs/heads/main` (the cosign OIDC identity is pinned to that ref) and only via `workflow_dispatch` — **Actions → 🏷️ Release: Cut → Run workflow**, run on `main`.

Two shapes of release come out of the same workflow:

- **RC (prerelease)** — builds fresh, multi-arch, from `main` HEAD.
- **GA** — never rebuilds. It promotes an exact, already-soaked RC digest and tags the exact RC source commit.

## Before dispatching

1. **Sync `main` with the active dev branch first if it's drifted.** `main` is never an independent commit target — it only advances by merging from `dev/vX.Y` immediately before a cut, for every RC, not just GA. The workflow itself asserts this (see [Branch flow](#branch-flow-and-drift-check) below) and fails the whole run if it's out of sync, so do the merge before dispatching, not after.

2. **Run the local precheck** — this cannot run in CI because it reads a gitignored file:

   ```bash
   npm run release:precheck v1.6.0
   ```

   Surfaces open GitHub Discussions still owed a "shipped in `<version>`" reply, read from `.planning/roadmap/current-tracker.md` (gitignored, lives at the bare repo root — invisible to the GitHub-hosted runner). Exits non-zero on a GA tag with pending replies; pass `--force` to bypass. Post the replies and tick the boxes, then dispatch.

3. **CHANGELOG.md needs the entry before you dispatch.** The workflow reads `CHANGELOG.md` as it exists at the dispatch-time `main` HEAD and fails the run if the heading is missing or empty:

   ```text
   ## [1.6.0] - 2026-08-11
   ```

   No leading `v` in the heading, unlike the tag itself. (For a GA promoted from an RC, this heading is added to `main` on GA day — it's never present in the RC's own commit.)

4. **Green CI on the target SHA.** The workflow polls for a successful `ci-verify.yml` run, then separately for a successful `e2e-playwright.yml` run, both on the SHA it's about to release — each poll allows up to 18 attempts, 300s apart (up to 90 minutes per workflow) before failing the run. Don't dispatch against a commit that hasn't finished CI; you'll just be waiting out the polling budget for something that was never going to turn green.

## Cutting an RC

Dispatch with just `release_tag` set, e.g. `v1.6.0-rc.14`. Leave `candidate_tag`, `candidate_digest`, and `soak_override_reason` empty — they're GA-only and the workflow hard-fails if any of them are set on a prerelease.

`release_tag` must match `^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$` — i.e. `vX.Y.Z` or `vX.Y.Z-<prerelease>` (`v1.6.0` or `v1.6.0-rc.14`). The tag's base version must match every manifest checked by the release precheck: `package.json`, `package-lock.json`, `app/package.json`, `app/package-lock.json`, `ui/package.json`, `ui/package-lock.json`, `e2e/package.json`, `e2e/package-lock.json`, `apps/demo/package.json`, and `apps/demo/package-lock.json`. The tag must not already exist pointing anywhere else.

The workflow builds the multi-arch image (`linux/amd64,linux/arm64`) fresh from `main`, pushes it under a run-scoped staging tag, signs it with cosign (keyless, GitHub OIDC), attests SLSA Build L2 provenance and a Trivy SPDX SBOM, generates a `git archive` tarball with matching signature/attestation, and publishes it all as a GitHub prerelease. **Registry tags never carry the `v` prefix** — the workflow strips it itself (`${RELEASE_TAG#v}`), so `v1.6.0-rc.13` publishes as `ghcr.io/codeswhat/drydock:1.6.0-rc.13`, `docker.io/codeswhat/drydock:1.6.0-rc.13`, and the Quay equivalent.

## Promoting to GA

GA promotion requires three additional inputs:

| Input | Format | Notes |
|---|---|---|
| `release_tag` | `vX.Y.Z` (no prerelease suffix) | e.g. `v1.6.0` |
| `candidate_tag` | exact `vX.Y.Z-rc.N` | e.g. `v1.6.0-rc.13` — must belong to the same `X.Y.Z` as `release_tag`, and must already exist as a published GitHub prerelease |
| `candidate_digest` | exact `sha256:<64 lowercase hex>` | the digest that `candidate_tag` publishes in GHCR, Docker Hub, **and** Quay — the workflow re-resolves all three and fails if any don't match |

### The seven-day soak floor

GA promotion requires the candidate to be **at least seven full days old (604800 seconds)**, measured from **the RC's GitHub release publication time (`publishedAt`)** — not the git tag's creation date, and not when the RC's build finished. Those can differ by minutes to hours depending on when the draft release was finalized.

If the candidate is younger than that, the run fails outright *unless* `soak_override_reason` is supplied.

### `soak_override_reason` — the escape hatch

GA-only. Leave it blank to enforce the full seven-day soak — that's the default and expected path. If the candidate is under 604800 seconds old:

- **Blank or whitespace-only** → hard fail, workflow stops. No implicit override.
- **Under 20 characters after trimming** → hard fail: `soak_override_reason must be at least 20 characters of real justification to bypass the seven-day soak`. This is a floor on substance, not just presence — a placeholder like `"skip"` doesn't clear it.
- **20+ characters** → the soak requirement is bypassed, and the workflow:
  - Emits an `::warning::` annotation naming the real candidate age (both seconds and days), visible on the run's Actions summary
  - Writes a `:warning: Seven-day soak overridden for GA promotion` block into the job's `$GITHUB_STEP_SUMMARY`, with the candidate tag, exact age, and the reason text
  - Appends the same age + reason as a trailing note in the **published release notes**, so anyone reading the GA release later — not just the person watching the Actions run — can see the soak was cut short and why

The reason is carried between steps as a temp file, not inlined into a `GITHUB_OUTPUT` key=value pair, specifically because it's free text from a `workflow_dispatch` input and could otherwise be used for output injection (a line starting with `::` or an embedded delimiter).

**Real case:** v1.6.0 GA was promoted with this override on 2026-08-12, at roughly three days of soak (candidate age 260253s, ~3.0 days) against the 604800s requirement. The published release notes carry the reason: rc.13's fleet soak had passed clean three days earlier, the candidate digest was byte-identical across all three registries, and there were no open regressions against the milestone — the owner made the call to ship early rather than wait out the remaining four days.

### What promotion actually does

GA never rebuilds the image or the release artifact. It:

1. Downloads the candidate's already-published `.tar.gz`, `.sha256`, `.bundle`, `.sig`, `.pem`, and `.intoto.jsonl` from the RC's GitHub release
2. Verifies the checksum, the cosign signature, and the SLSA Build L2 provenance attestation against the RC's original `SOURCE_SHA` (honest at RC-cut time, since source and target SHA were identical then)
3. Rebuilds a fresh `git archive` of the candidate tag's commit today and compares decompressed tar bytes against the downloaded artifact, proving the soaked bytes are still exactly what that source SHA's tree contains
4. Republishes those same verified bytes under the GA tag/filenames, re-tags the exact RC image digest under the GA image tags (`{major}.{minor}.{patch}`, `{major}.{minor}`, `{major}`, and `latest`) without rebuilding, and re-verifies the exact digest was published in every registry
5. Pushes the GA git tag pointing at the RC's original commit (not at today's `main` HEAD) and publishes the GitHub release

This is a deliberate design choice, not an oversight: `actions/attest-build-provenance` always records the workflow run's own checkout commit as the attested build source, and at GA that's today's `main` HEAD, never the seven-day-soaked candidate commit the tarball actually came from. Rebuilding and re-attesting at GA would produce an attestation that verifies cleanly while asserting something false. Promoting the RC's existing, honestly-attested bytes avoids that.

## After the cut

Both RC and GA runs finish with, in order: exact-digest image tags published to GHCR/Docker Hub/Quay, the git tag pushed, and the GitHub release flipped from draft to public. The job's `$GITHUB_STEP_SUMMARY` records the source SHA, bump level, version, tag, and image digest for every run.

**Verify:**

- The `release-cut.yml` run is green
- `docker pull ghcr.io/codeswhat/drydock:<version>` (also `docker.io/codeswhat/drydock` and `quay.io/codeswhat/drydock`)
- The GitHub release has the tarball, checksum, signature bundle, `.intoto.jsonl`, and image SPDX SBOM attached
- `gh attestation verify oci://ghcr.io/codeswhat/drydock@<digest> --repo CodesWhat/drydock` for the container; the same pattern for the tarball via `cosign verify-blob`

## Branch flow and drift check

Feature and fix branches PR into `dev/vX.Y`, never `main`, per `CONTRIBUTING.md`. `main` only ever moves by merging `dev/vX.Y` into it, immediately before a cut. The workflow enforces this itself, before doing anything else:

```bash
git diff --quiet origin/main origin/dev/vX.Y
```

**This compares trees, not commit ancestry — deliberately.** drydock's branch protection allows squash merges only (`allow_squash_merge: true`, `allow_merge_commit: false`, `allow_rebase_merge: false`). Every `dev` → `main` sync therefore mints a brand-new commit that `dev` itself never has, which means `git merge-base --is-ancestor origin/dev/vX.Y origin/main` would fail on *every* cut after the first, sync or no sync. Tree equality is the invariant that actually holds.

If the two have drifted, the run fails with a diffstat and refuses to tag — forward-port the missing content into `dev/vX.Y` (or reconcile whichever side is ahead) and re-dispatch. If `dev/vX.Y` doesn't exist on origin at all (retired post-GA, or not yet cut), the check is a no-op.

The same step also asserts `renovate.json`'s `baseBranchPatterns` names exactly the `dev/vX.Y` branch this cut targets. Renovate has to name one concrete branch (a pattern would double every dependency PR against every matching `dev/vX.Y`), so it has to be rotated at every branch cut — this is the one moment in the pipeline where the correct target is unambiguous, so a stale value fails the cut with the exact value to set rather than silently leaving the bot aimed at a dead branch.

## If something goes wrong

The pipeline is designed to be resumed, not restarted: re-dispatching the same `release_tag` after a partial failure picks up from whatever was already published (existing tags, existing draft release) and continues. It refuses to touch a release that's already public (`Release ${RELEASE_TAG} is already public; refusing to alter it`) or a tag that already points somewhere else.

If a bad release already went out, don't delete the tag or the release — that breaks pinned image digests and anything that already resolved them. Cut a patch release through the normal flow instead, and edit the bad release's notes to point at the fix.
