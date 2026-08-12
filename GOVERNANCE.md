# Drydock Governance

## Model

Drydock uses a lead-maintainer model. Work is proposed and reviewed in public
issues, discussions, and pull requests. The lead maintainer owns project scope,
release readiness, and final decisions when consensus cannot be reached.

The current project roles are:

| Role | Current assignment | Responsibilities |
| --- | --- | --- |
| Lead maintainer | [`@scttbnsn`](https://github.com/scttbnsn) | Product direction, issue triage, security response, release approval, and final technical decisions |
| Continuity maintainer | [`@biggest-littlest`](https://github.com/biggest-littlest) | CodesWhat organization administration, access recovery, and release continuity when the lead maintainer is unavailable |
| Code owners | Accounts listed in [`.github/CODEOWNERS`](.github/CODEOWNERS) | Review changes in owned areas and identify risk, compatibility, and test requirements |
| Contributors | Anyone participating through issues, discussions, or pull requests | Propose, implement, test, document, and review changes |

Roles are based on sustained project work and trust. The lead maintainer may add
or remove code owners and maintainers through a public pull request that updates
the relevant repository records. Organization-owner changes are recorded by
GitHub's organization audit log.

## Decisions and disputes

Routine changes are decided through pull-request review. Larger changes should
start with a GitHub issue or discussion that records the problem, alternatives,
security and compatibility effects, and the intended outcome. The project seeks
rough consensus, but the lead maintainer makes the final decision when a timely
decision is required. The reason should be recorded in the issue or pull request.

Security reports follow [`SECURITY.md`](SECURITY.md) and stay private until a fix
and coordinated disclosure are ready. Conduct reports follow
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Change and release control

Changes are made on branches and merged through pull requests. Development
targets the active `dev/vX.Y` branch. `main` advances through a reviewed release
sync and is the source for signed release tags and artifacts. Required CI checks
must pass before merge, and the release workflow independently verifies the
selected source revision before publication.

## Access continuity

The repository is owned by the CodesWhat GitHub organization, which has two
owner accounts: `@scttbnsn` and `@biggest-littlest`. Either owner can administer
the repository, close issues, restore maintainer access, manage Actions and
release environments, and continue the pull-request and release process.
Repository code owners provide an additional public record of review coverage.

Canonical source, issues, CI, release workflows, container images, and release
artifacts are kept in GitHub and GHCR. Releases use GitHub Actions OIDC for
keyless signing and attestations, so continuity does not depend on a private
signing key held on one maintainer's workstation. If one maintainer becomes
unavailable, the remaining organization owner can revoke stale access, update
role assignments, merge approved work, and publish a release within one week.

Project forking is always available under the AGPL-3.0 license, but it is not the
primary continuity plan.
