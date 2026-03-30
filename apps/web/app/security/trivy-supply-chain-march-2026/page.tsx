import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Trivy Supply Chain Compromise - Drydock Security Advisory",
  description:
    "Analysis of the March 2026 Trivy supply chain breach (GHSA-69fq-xp46-6x23). Drydock is not affected. Full audit and recommendations for users.",
  openGraph: {
    title: "Trivy Supply Chain Compromise - Drydock Security Advisory",
    description: "Analysis of the March 2026 Trivy supply chain breach. Drydock is not affected.",
    type: "article",
  },
};

export default function TrivyAdvisoryPage() {
  return (
    <main className="relative min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-950 dark:to-neutral-900">
      <div className="bg-grid-neutral-200/50 dark:bg-grid-neutral-800/50 fixed inset-0" />

      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
            <Link
              href="/"
              className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              &larr; Back to Drydock
            </Link>
            <Link
              href="/docs"
              className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Documentation
            </Link>
          </div>
        </header>

        {/* Content */}
        <article className="mx-auto max-w-4xl px-6 py-16">
          <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm sm:p-12 dark:border-neutral-800 dark:bg-neutral-950">
            {/* Title block */}
            <div className="mb-12">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                  Not Affected
                </Badge>
                <Badge variant="outline">GHSA-69fq-xp46-6x23</Badge>
                <Badge variant="outline">CWE-506</Badge>
              </div>
              <h1 className="mb-3 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-100">
                Trivy Supply Chain Compromise
              </h1>
              <p className="text-lg text-neutral-600 dark:text-neutral-400">
                Security advisory &middot; March 22, 2026
              </p>
            </div>

            {/* Summary box */}
            <div className="mb-12 rounded-lg border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800/50 dark:bg-emerald-950/30">
              <h2 className="mb-2 text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                Drydock is not affected by this breach
              </h2>
              <p className="text-emerald-800 dark:text-emerald-300">
                We have audited our entire CI/CD pipeline, dependency tree, and runtime
                integrations. Drydock does not use the compromised GitHub Actions, did not pull the
                backdoored binary, and all workflow actions are pinned by immutable commit SHA. No
                user action is required for Drydock itself.
              </p>
            </div>

            {/* Body */}
            <div className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-semibold prose-a:text-blue-600 dark:prose-a:text-blue-400">
              <h2>What happened</h2>
              <p>
                On March 19, 2026, a threat actor known as TeamPCP used compromised credentials to
                execute a multi-stage supply chain attack against{" "}
                <a
                  href="https://github.com/aquasecurity/trivy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Aqua Security&apos;s Trivy
                </a>
                , a widely-used vulnerability scanner for containers, Kubernetes, and
                infrastructure-as-code.
              </p>
              <p>The attack compromised three components:</p>
              <ul>
                <li>
                  <strong>trivy-action</strong> &mdash; 76 of 77 release tags were force-pushed to
                  malicious commits containing a credential-stealing payload
                </li>
                <li>
                  <strong>setup-trivy</strong> &mdash; all 7 existing tags were replaced with
                  malicious versions
                </li>
                <li>
                  <strong>Trivy binary v0.69.4</strong> &mdash; a backdoored release was published
                  via the official release pipeline
                </li>
              </ul>

              <h2>Exposure windows</h2>
              <div className="overflow-x-auto">
                <table className="w-auto">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Start (UTC)</th>
                      <th>End (UTC)</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>trivy v0.69.4</td>
                      <td>Mar 19 18:22</td>
                      <td>Mar 19 ~21:42</td>
                      <td>~3 hours</td>
                    </tr>
                    <tr>
                      <td>trivy-action</td>
                      <td>Mar 19 ~17:43</td>
                      <td>Mar 20 ~05:40</td>
                      <td>~12 hours</td>
                    </tr>
                    <tr>
                      <td>setup-trivy</td>
                      <td>Mar 19 ~17:43</td>
                      <td>Mar 19 ~21:44</td>
                      <td>~4 hours</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h2>How the attack worked</h2>
              <p>
                The root cause was a continuation of an earlier supply chain attack from late
                February 2026. Aqua Security rotated credentials but the process was not atomic
                &mdash; the attacker was able to exfiltrate newly rotated secrets during the
                rotation window, retaining write access to the repositories.
              </p>
              <p>
                The attacker used Git&apos;s mutable tag mechanism to silently replace trusted code:
              </p>
              <pre>
                <code>{`git tag -f 0.24.0 <malicious-commit>
git push -f origin refs/tags/0.24.0`}</code>
              </pre>
              <p>
                Since GitHub&apos;s release page doesn&apos;t visually change when a tag is
                repointed, any workflow referencing these actions by version tag (e.g.,{" "}
                <code>@0.24.0</code>) would silently execute the malicious payload on its next run.
              </p>

              <h3>Payload behavior</h3>
              <p>
                The malicious <code>entrypoint.sh</code> prepended ~105 lines of attack code before
                the legitimate Trivy scanner. It executed a multi-stage credential theft operation:
              </p>
              <ol>
                <li>
                  <strong>Runner process discovery</strong> &mdash; enumerated GitHub Actions runner
                  PIDs and scraped <code>/proc/&lt;PID&gt;/environ</code> for secrets
                </li>
                <li>
                  <strong>Memory scraping</strong> &mdash; on GitHub-hosted runners, read{" "}
                  <code>Runner.Worker</code> process memory via <code>/proc/&lt;PID&gt;/mem</code>{" "}
                  looking for JSON structures matching{" "}
                  <code>{`"name":{"value":"...","isSecret":true}`}</code>
                </li>
                <li>
                  <strong>Filesystem harvesting</strong> &mdash; on self-hosted runners, swept 50+
                  paths for SSH keys, cloud credentials (AWS, GCP, Azure), Kubernetes tokens,
                  database configs, <code>.env</code> files, TLS private keys, and cryptocurrency
                  wallets
                </li>
                <li>
                  <strong>Encrypted exfiltration</strong> &mdash; data was AES-256-CBC encrypted
                  with an RSA-4096 wrapped session key and POSTed to a typosquatted domain (
                  <code>scan.aquasecurtiy[.]org</code>)
                </li>
                <li>
                  <strong>Fallback exfiltration</strong> &mdash; if the primary channel failed and a
                  GitHub PAT was available, the payload created a public <code>tpcp-docs</code>{" "}
                  repository on the victim&apos;s account and uploaded the stolen data as a release
                  asset
                </li>
                <li>
                  <strong>Cleanup</strong> &mdash; all temporary files were removed and the
                  legitimate Trivy scanner ran normally, making the compromise invisible in workflow
                  logs
                </li>
              </ol>

              <h2>Why Drydock is not affected</h2>
              <p>We audited every potential exposure vector:</p>

              <h3>1. No use of compromised GitHub Actions</h3>
              <p>
                Drydock does not use <code>aquasecurity/trivy-action</code> or{" "}
                <code>aquasecurity/setup-trivy</code> in any GitHub Actions workflow. Our CI/CD
                pipeline was never exposed to the compromised entrypoint scripts.
              </p>

              <h3>2. Bundled Trivy binary is a safe version</h3>
              <p>
                Drydock&apos;s Docker image includes Trivy and cosign binaries for local
                vulnerability scanning and image signature verification. The Trivy binary is
                installed from Alpine&apos;s package repository and pinned at{" "}
                <strong>v0.69.3-r1</strong> in the Dockerfile, which predates the compromised
                v0.69.4 release. Aqua Security has confirmed that v0.69.3 is safe and protected by
                GitHub&apos;s immutable releases feature.
              </p>
              <pre>
                <code>{`# From Drydock's Dockerfile — Trivy pinned to safe version
apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/testing trivy=0.69.3-r1`}</code>
              </pre>
              <p>
                <strong>Correction (March 22):</strong> Our initial audit stated the Dockerfile
                pinned Trivy, but the <code>main</code> branch Dockerfile did not include an
                explicit version constraint for the Trivy APK package at the time of publication.
                This does not change the outcome: no Docker image builds ran during the exposure
                window, the Alpine repository was serving v0.69.3 (safe), and even if a compromised
                Trivy binary had been installed, it would only be used to scan container images for
                CVEs &mdash; it has no access to CI runner secrets, SSH keys, process memory, or any
                of the targets the GitHub Actions payload exploited. The QA test compose file also
                referenced <code>aquasec/trivy:latest</code>, but that environment only runs on
                developer machines, never in CI or production. As a defense-in-depth measure, we
                have pinned both: <code>trivy=0.69.3-r1</code> in the Dockerfile and{" "}
                <code>aquasec/trivy:0.69.3</code> in the QA compose.
              </p>
              <p>
                Additionally, our CI/CD linting uses Trivy through{" "}
                <a href="https://qlty.sh" target="_blank" rel="noopener noreferrer">
                  Qlty
                </a>
                , which also has v0.69.3 cached locally.
              </p>

              <h3>3. All GitHub Actions pinned by commit SHA</h3>
              <p>
                Every third-party action in Drydock&apos;s workflows is pinned by full, immutable
                commit SHA &mdash; not by mutable version tags. This is the primary defense against
                the tag repointing attack described in{" "}
                <a
                  href="https://www.crowdstrike.com/en-us/blog/from-scanner-to-stealer-inside-the-trivy-action-supply-chain-compromise/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  CrowdStrike&apos;s analysis
                </a>
                :
              </p>
              <pre>
                <code>{`# Drydock workflow example — all actions SHA-pinned
uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd        # v6.0.2
uses: step-security/harden-runner@fa2e9d605c4eeb9fcad4c99c224cee0c6c7f3594  # v2.16.0
uses: docker/build-push-action@d08e5c354a6adb9ed34480a06d141179aa583294    # v7.0.0`}</code>
              </pre>

              <h3>4. Additional CI security layers</h3>
              <ul>
                <li>
                  <strong>StepSecurity Harden Runner</strong> &mdash; every CI job runs{" "}
                  <code>step-security/harden-runner</code> for runtime security monitoring on GitHub
                  Actions runners
                </li>
                <li>
                  <strong>OpenSSF Scorecard</strong> &mdash; automated security health checks on
                  every push
                </li>
                <li>
                  <strong>Dependency review</strong> &mdash;{" "}
                  <code>actions/dependency-review-action</code> audits dependency changes on every
                  PR
                </li>
                <li>
                  <strong>Cosign image signing</strong> &mdash; all published Docker images are
                  signed with Sigstore cosign and include build provenance attestations
                </li>
              </ul>

              <h2>Verifying your Drydock installation</h2>
              <p>
                Drydock bundles Trivy and cosign in its Docker image for local vulnerability
                scanning and image signature verification. All official Drydock releases pin Trivy
                at v0.69.3-r1, which is confirmed safe. You can verify your running instance:
              </p>
              <pre>
                <code>{`# Check the Trivy version inside your Drydock container
docker exec drydock trivy --version

# Safe versions: v0.69.2 or v0.69.3
# Compromised version: v0.69.4`}</code>
              </pre>
              <p>
                If you use an external Trivy server via <code>DD_SECURITY_TRIVY_SERVER</code>,
                verify that server independently as well.
              </p>

              <h2>Recommendations for Drydock users</h2>

              <h3>If you use trivy-action in your own CI pipelines</h3>
              <p>
                Check whether your workflows ran between March 19&ndash;20, 2026. If they did, treat
                all secrets accessible to those runners as compromised. Rotate credentials
                immediately and follow{" "}
                <a
                  href="https://github.com/aquasecurity/trivy/discussions/10425"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Aqua Security&apos;s remediation guidance
                </a>
                .
              </p>

              <h3>If you self-host a Trivy server</h3>
              <p>
                Verify your Trivy version is not v0.69.4. Update to v0.69.3 or wait for the next
                clean release. Check for the persistence mechanism: look for{" "}
                <code>~/.config/systemd/user/sysmon.py</code> on systems where Trivy was installed.
              </p>

              <h3>Search for exfiltration artifacts</h3>
              <p>
                Look for repositories named <code>tpcp-docs</code> in your GitHub organization. The
                presence of such a repository indicates that the fallback exfiltration mechanism was
                triggered.
              </p>

              <h3>Pin all GitHub Actions by commit SHA</h3>
              <p>
                This is the single most effective defense against tag repointing attacks. Git tags
                are mutable pointers &mdash; they can be silently redirected to malicious commits
                without any visible change on the release page. SHA pins are immutable.
              </p>
              <pre>
                <code>{`# Vulnerable: mutable tag reference
uses: aquasecurity/trivy-action@0.24.0

# Safe: immutable SHA reference
uses: aquasecurity/trivy-action@<full-commit-sha>  # 0.24.0`}</code>
              </pre>

              <h2>References</h2>
              <ul>
                <li>
                  <a
                    href="https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Aqua Security Advisory &mdash; GHSA-69fq-xp46-6x23
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/aquasecurity/trivy/discussions/10425"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Aqua Security Disclosure &mdash; GitHub Discussion
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.crowdstrike.com/en-us/blog/from-scanner-to-stealer-inside-the-trivy-action-supply-chain-compromise/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    CrowdStrike &mdash; From Scanner to Stealer: Inside the trivy-action Supply
                    Chain Compromise
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.bleepingcomputer.com/news/security/trivy-vulnerability-scanner-breach-pushed-infostealer-via-github-actions/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    BleepingComputer &mdash; Trivy Vulnerability Scanner Breach
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/CodesWhat/drydock/discussions/197"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Drydock Community Discussion #197
                  </a>
                </li>
              </ul>

              <h2>Timeline</h2>
              <div className="overflow-x-auto">
                <table className="w-auto">
                  <thead>
                    <tr>
                      <th>Date (UTC)</th>
                      <th>Event</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Late Feb 2026</td>
                      <td>Initial compromise of Aqua Security credentials</td>
                    </tr>
                    <tr>
                      <td>Mar 1, 2026</td>
                      <td>Aqua Security discloses initial incident, begins credential rotation</td>
                    </tr>
                    <tr>
                      <td>Mar 19, 17:43</td>
                      <td>
                        Attacker force-pushes 76 trivy-action tags and 7 setup-trivy tags to
                        malicious commits
                      </td>
                    </tr>
                    <tr>
                      <td>Mar 19, 18:22</td>
                      <td>Backdoored trivy v0.69.4 binary published via release pipeline</td>
                    </tr>
                    <tr>
                      <td>Mar 19, ~21:42</td>
                      <td>Malicious trivy v0.69.4 release pulled (~3 hour window)</td>
                    </tr>
                    <tr>
                      <td>Mar 20, ~05:40</td>
                      <td>Malicious trivy-action tags remediated (~12 hour window)</td>
                    </tr>
                    <tr>
                      <td>Mar 20</td>
                      <td>
                        CrowdStrike publishes technical analysis after discovering the attack via
                        Falcon detections
                      </td>
                    </tr>
                    <tr>
                      <td>Mar 21</td>
                      <td>Aqua Security publishes GHSA-69fq-xp46-6x23</td>
                    </tr>
                    <tr>
                      <td>Mar 22</td>
                      <td>
                        Drydock completes audit, publishes this advisory and community response
                      </td>
                    </tr>
                    <tr>
                      <td>Mar 22 (update)</td>
                      <td>
                        Post-publication audit found Dockerfile lacked explicit Trivy version pin;
                        hardened Dockerfile and QA compose to pin safe versions
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Back link */}
            <div className="mt-12 border-t border-neutral-200 pt-8 dark:border-neutral-800">
              <Link
                href="/"
                className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                &larr; Back to Drydock
              </Link>
            </div>
          </div>
        </article>

        <SiteFooter />
      </div>
    </main>
  );
}
