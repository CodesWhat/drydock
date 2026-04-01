import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Axios Supply Chain Compromise - Drydock Security Advisory",
  description:
    "Analysis of the March 2026 axios npm supply chain compromise (axios@1.14.1, axios@0.30.4). Drydock is not affected. Full audit and recommendations for users.",
  openGraph: {
    title: "Axios Supply Chain Compromise - Drydock Security Advisory",
    description:
      "Analysis of the March 2026 axios npm supply chain compromise. Drydock is not affected.",
    type: "article",
  },
};

export default function AxiosAdvisoryPage() {
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
                <Badge variant="outline">CWE-506</Badge>
              </div>
              <h1 className="mb-3 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-100">
                Axios npm Supply Chain Compromise
              </h1>
              <p className="text-lg text-neutral-600 dark:text-neutral-400">
                Security advisory &middot; March 31, 2026
              </p>
            </div>

            {/* Summary box */}
            <div className="mb-12 rounded-lg border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800/50 dark:bg-emerald-950/30">
              <h2 className="mb-2 text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                Drydock is not affected by this compromise
              </h2>
              <p className="text-emerald-800 dark:text-emerald-300">
                Drydock&apos;s lockfile pinned axios at v1.13.6 throughout the exposure window. The
                compromised versions (1.14.1 and 0.30.4) were never installed, resolved, or executed
                in any Drydock environment. As an additional defense-in-depth measure, all dependency
                versions across the project have been pinned to exact versions, eliminating semver
                range resolution as an attack vector.
              </p>
            </div>

            {/* Body */}
            <div className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-semibold prose-a:text-blue-600 dark:prose-a:text-blue-400">
              <h2>What happened</h2>
              <p>
                On March 30&ndash;31, 2026, two malicious versions of the{" "}
                <a
                  href="https://www.npmjs.com/package/axios"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  axios
                </a>{" "}
                npm package were published: <strong>axios@1.14.1</strong> (tagged{" "}
                <code>latest</code>) and <strong>axios@0.30.4</strong> (tagged <code>legacy</code>).
                Both introduced a malicious dependency called <code>plain-crypto-js@4.2.1</code>,
                which contained a cross-platform Remote Access Trojan (RAT) executed via a{" "}
                <code>postinstall</code> script.
              </p>
              <p>
                The RAT targeted macOS, Windows, and Linux systems. Any environment that ran{" "}
                <code>npm install</code> and resolved to either compromised version automatically
                executed the malicious payload.
              </p>
              <p>
                The malicious packages were detected by{" "}
                <a href="https://socket.dev" target="_blank" rel="noopener noreferrer">
                  Socket
                </a>{" "}
                within approximately 6 minutes of publication and were removed from the npm registry
                within approximately 3 hours. At least 135 infected endpoints were observed during
                the exposure window.
              </p>

              <h2>Compromised versions</h2>
              <div className="overflow-x-auto">
                <table className="w-auto">
                  <thead>
                    <tr>
                      <th>Package</th>
                      <th>Version</th>
                      <th>npm Tag</th>
                      <th>Published (UTC)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>axios</td>
                      <td>
                        <code>1.14.1</code>
                      </td>
                      <td>
                        <code>latest</code>
                      </td>
                      <td>Mar 31, 00:21</td>
                    </tr>
                    <tr>
                      <td>axios</td>
                      <td>
                        <code>0.30.4</code>
                      </td>
                      <td>
                        <code>legacy</code>
                      </td>
                      <td>Mar 31, 01:00</td>
                    </tr>
                    <tr>
                      <td>plain-crypto-js</td>
                      <td>
                        <code>4.2.1</code>
                      </td>
                      <td>&mdash;</td>
                      <td>Mar 30, 23:59</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h2>How the attack worked</h2>
              <p>
                The <code>plain-crypto-js@4.2.1</code> phantom dependency contained a{" "}
                <code>postinstall</code> script that deployed a cross-platform RAT with capabilities
                including:
              </p>
              <ul>
                <li>
                  <strong>Credential theft</strong> &mdash; harvesting of stored credentials and
                  authentication tokens
                </li>
                <li>
                  <strong>Data exfiltration</strong> &mdash; extraction of sensitive data to
                  attacker-controlled infrastructure
                </li>
                <li>
                  <strong>Persistent access</strong> &mdash; installation of a persistent backdoor
                  for ongoing remote access
                </li>
              </ul>
              <p>
                The attack is attributed to North Korean state-sponsored actors (UNC1069/BlueNoroff)
                based on overlaps with known DPRK malware families and the internal project name{" "}
                <code>macWebT</code> linking to BlueNoroff&apos;s documented <code>webT</code>{" "}
                module.
              </p>

              <h2>Why Drydock is not affected</h2>
              <p>We audited every potential exposure vector:</p>

              <h3>1. Lockfile pinned to safe version</h3>
              <p>
                Drydock&apos;s <code>app/package-lock.json</code> resolves axios to{" "}
                <strong>v1.13.6</strong>, which is the last legitimate release before the
                compromise. The lockfile was committed before the attack window and was not modified
                during it.
              </p>
              <pre>
                <code>{`# From app/package-lock.json
"node_modules/axios": {
  "version": "1.13.6",
  "resolved": "https://registry.npmjs.org/axios/-/axios-1.13.6.tgz"
}`}</code>
              </pre>

              <h3>2. No plain-crypto-js in dependency tree</h3>
              <p>
                The malicious phantom dependency <code>plain-crypto-js</code> does not appear
                anywhere in Drydock&apos;s dependency tree. Only the compromised axios versions
                introduced this dependency.
              </p>

              <h3>3. All versions now pinned to exact</h3>
              <p>
                As a defense-in-depth response, all dependency versions across{" "}
                <code>app/</code>, <code>ui/</code>, and <code>e2e/</code> workspaces have been
                pinned to exact resolved versions (no <code>^</code> or <code>~</code> ranges).
                This eliminates the risk of semver range resolution pulling in a future compromised
                version, even if the lockfile is regenerated.
              </p>
              <pre>
                <code>{`# Before (vulnerable to range resolution)
"axios": "^1.13.6"

# After (immutable)
"axios": "1.13.6"`}</code>
              </pre>

              <h3>4. Docker image builds use lockfile</h3>
              <p>
                Drydock&apos;s Dockerfile uses <code>npm ci</code> which strictly resolves from the
                lockfile and fails if the lockfile is out of sync with <code>package.json</code>.
                This prevents any Docker build from pulling an unexpected version.
              </p>

              <h2>Recommendations for Drydock users</h2>

              <h3>Check your own systems</h3>
              <p>
                If any of your development environments, CI pipelines, or servers ran{" "}
                <code>npm install</code> on a project using axios between March 30&ndash;31, 2026,
                check whether axios@1.14.1 or axios@0.30.4 was resolved:
              </p>
              <pre>
                <code>{`# Check your lockfile for compromised versions
grep -E '"version": "(1\\.14\\.1|0\\.30\\.4)"' package-lock.json

# Check if the malicious dependency was installed
ls node_modules/plain-crypto-js 2>/dev/null && echo "COMPROMISED" || echo "CLEAN"`}</code>
              </pre>

              <h3>If you are compromised</h3>
              <ul>
                <li>
                  <strong>Treat the system as fully compromised</strong> &mdash; the RAT has
                  credential theft and data exfiltration capabilities
                </li>
                <li>
                  <strong>Rotate all credentials</strong> on affected systems immediately
                </li>
                <li>
                  <strong>Rebuild affected systems</strong> from a known-clean state
                </li>
                <li>
                  Monitor for C2 communications to <code>calltan[.]com</code> and{" "}
                  <code>callnrwise[.]com</code>
                </li>
              </ul>

              <h3>Pin your dependencies</h3>
              <p>
                Remove <code>^</code> and <code>~</code> ranges from all dependency versions.
                Lockfiles protect against range resolution in most cases, but exact pins provide
                defense-in-depth for scenarios where lockfiles are regenerated or missing.
              </p>

              <h2>References</h2>
              <ul>
                <li>
                  <a
                    href="https://www.huntress.com/blog/supply-chain-compromise-axios-npm-package"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Huntress &mdash; Supply Chain Compromise: axios npm Package (third-party
                    analysis)
                  </a>
                </li>
                <li>
                  <a
                    href="https://socket.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Socket &mdash; npm malware detection (detected within 6 minutes)
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
                      <td>Mar 30, 23:59</td>
                      <td>
                        <code>plain-crypto-js@4.2.1</code> published with malicious payload
                      </td>
                    </tr>
                    <tr>
                      <td>Mar 31, 00:05</td>
                      <td>Socket detects malware (~6 min after publish)</td>
                    </tr>
                    <tr>
                      <td>Mar 31, 00:21</td>
                      <td>
                        <code>axios@1.14.1</code> published and tagged <code>latest</code>
                      </td>
                    </tr>
                    <tr>
                      <td>Mar 31, 00:23</td>
                      <td>First infection observed (89 seconds post-publish)</td>
                    </tr>
                    <tr>
                      <td>Mar 31, 01:00</td>
                      <td>
                        <code>axios@0.30.4</code> published and tagged <code>legacy</code>
                      </td>
                    </tr>
                    <tr>
                      <td>Mar 31, ~03:00</td>
                      <td>Malicious packages removed from npm registry</td>
                    </tr>
                    <tr>
                      <td>Apr 1</td>
                      <td>
                        Drydock completes audit, pins all dependency versions to exact, publishes
                        this advisory
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
