#!/usr/bin/env bash
# Coverage gate for pre-push hook.
# Runs vitest --coverage with JSON reporter, then parses the output
# to produce a machine-readable gap report at .coverage-gaps.json.
#
# On failure: prints exact files + uncovered lines so an agent can fix them.
# The gap report is gitignored and read by agents to know what to test.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

export GAPS_FILE=".coverage-gaps.json"
fail=0

run_coverage() {
  local workspace=$1
  local json_dir="${workspace}/coverage"

  echo "📊 ${workspace}: running coverage..."
  if ! (cd "${workspace}" && npx vitest run --coverage --reporter=json --reporter=dot 2>&1); then
    echo "❌ ${workspace} coverage below threshold" >&2
    fail=1
  fi
}

run_coverage "app"
run_coverage "ui"

# Parse coverage JSON summaries into a single gap report
node -e '
const fs = require("fs");
const path = require("path");
const gaps = [];

for (const workspace of ["app", "ui"]) {
  const summaryPath = path.join(workspace, "coverage", "coverage-summary.json");
  if (!fs.existsSync(summaryPath)) continue;
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

  for (const [file, data] of Object.entries(summary)) {
    if (file === "total") continue;
    const rel = path.relative(process.cwd(), file);
    const uncovered = {};
    let hasGap = false;

    for (const metric of ["lines", "statements", "branches", "functions"]) {
      const m = data[metric];
      if (m && m.pct < 100) {
        uncovered[metric] = { pct: m.pct, covered: m.covered, total: m.total };
        hasGap = true;
      }
    }

    if (hasGap) {
      gaps.push({ file: rel, ...uncovered });
    }
  }
}

fs.writeFileSync(process.env.GAPS_FILE, JSON.stringify(gaps, null, 2) + "\n");

if (gaps.length > 0) {
  console.error("");
  console.error("┌─────────────────────────────────────────────────┐");
  console.error("│  COVERAGE GAPS — fix these files to reach 100%  │");
  console.error("└─────────────────────────────────────────────────┘");
  console.error("");
  for (const g of gaps) {
    const metrics = Object.entries(g)
      .filter(([k]) => k !== "file")
      .map(([k, v]) => `${k}: ${v.pct}% (${v.covered}/${v.total})`)
      .join(", ");
    console.error(`  ${g.file}`);
    console.error(`    ${metrics}`);
  }
  console.error("");
  console.error(`Gap report written to ${process.env.GAPS_FILE}`);
  console.error("Agents: read this file to know exactly what tests to write.");
}
' 2>&1

if [ $fail -ne 0 ]; then
  echo ""
  echo "Coverage thresholds not met. Fix gaps before pushing."
  echo "Run: cat .coverage-gaps.json  — to see exact gaps"
  exit 1
fi

# Clean state — remove gap file when everything passes
rm -f "${GAPS_FILE}"
echo "✅ Coverage thresholds met (100%)."
