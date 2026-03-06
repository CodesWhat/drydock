#!/bin/bash

set -euo pipefail

REPORT="${1:-}"
TITLE="${2:-Load Test}"
BASELINE_REPORT="${3:-}"
TOP_ENDPOINTS="${DD_LOAD_TEST_SUMMARY_TOP_ENDPOINTS:-8}"

summary() {
	local message="$1"
	echo "${message}"
	if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
		echo "${message}" >>"${GITHUB_STEP_SUMMARY}"
	fi
}

is_number() {
	local value="$1"
	[[ ${value} =~ ^[0-9]+([.][0-9]+)?$ ]]
}

metric_or_na() {
	local report="$1"
	local query="$2"
	local value
	value="$(jq -r "${query} // empty" "${report}")"
	if [ -z "${value}" ]; then
		echo "n/a"
		return
	fi
	echo "${value}"
}

percent_change() {
	local current="$1"
	local baseline="$2"
	awk -v current="${current}" -v baseline="${baseline}" 'BEGIN {
		if (baseline <= 0) {
			print "n/a"
			exit
		}
		printf "%.2f", ((current - baseline) / baseline) * 100
	}'
}

summary "### ${TITLE}"

if [ -z "${REPORT}" ]; then
	summary "- No Artillery JSON report was generated."
	exit 0
fi

if [ ! -f "${REPORT}" ]; then
	summary "- Report file not found: \`${REPORT}\`"
	exit 0
fi

summary "- Report: \`${REPORT}\`"

p95="$(metric_or_na "${REPORT}" '.aggregate.summaries["http.response_time"].p95')"
p99="$(metric_or_na "${REPORT}" '.aggregate.summaries["http.response_time"].p99')"
rate="$(metric_or_na "${REPORT}" '.aggregate.rates["http.request_rate"]')"
requests="$(metric_or_na "${REPORT}" '.aggregate.counters["http.requests"]')"
responses="$(metric_or_na "${REPORT}" '.aggregate.counters["http.responses"]')"
failed="$(metric_or_na "${REPORT}" '.aggregate.counters["vusers.failed"]')"

summary "- http.response_time.p95: \`${p95}\` ms"
summary "- http.response_time.p99: \`${p99}\` ms"
summary "- http.request_rate: \`${rate}\` req/s"
summary "- http.requests/http.responses: \`${requests}\` / \`${responses}\`"
summary "- vusers.failed: \`${failed}\`"

status_codes="$(jq -r '
	(.aggregate.counters // {})
	| to_entries
	| map(select(.key | test("^http\\.codes\\.[0-9]{3}$")))
	| sort_by(-.value)
	| .[]?
	| "\(.key)\t\(.value)"
' "${REPORT}")"

if [ -n "${status_codes}" ]; then
	summary "- HTTP status mix:"
	while IFS=$'\t' read -r code count; do
		summary "  - \`${code}\`: \`${count}\`"
	done <<<"${status_codes}"
fi

codes_4xx="$(jq -r '[((.aggregate.counters // {}) | to_entries[] | select(.key | test("^http\\.codes\\.4[0-9]{2}$")) | .value)] | add // 0' "${REPORT}")"
codes_5xx="$(jq -r '[((.aggregate.counters // {}) | to_entries[] | select(.key | test("^http\\.codes\\.5[0-9]{2}$")) | .value)] | add // 0' "${REPORT}")"
summary "- 4xx/5xx totals: \`${codes_4xx}\` / \`${codes_5xx}\`"

endpoint_rows="$(jq -r --argjson topN "${TOP_ENDPOINTS}" '
	(.aggregate.summaries // {})
	| to_entries
	| map(select(.key | startswith("plugins.metrics-by-endpoint.response_time.")))
	| map({
		endpoint: (.key | sub("^plugins\\.metrics-by-endpoint\\.response_time\\."; "")),
		count: (.value.count // 0),
		p95: (.value.p95 // 0),
		p99: (.value.p99 // 0),
		mean: (.value.mean // 0)
	})
	| map(select(.count > 0))
	| sort_by(-.p95, -.p99, -.count)
	| .[:$topN]
	| .[]?
	| [
		.endpoint,
		(.count | tostring),
		(.p95 | tostring),
		(.p99 | tostring),
		(.mean | tostring)
	] | @tsv
' "${REPORT}")"

if [ -n "${endpoint_rows}" ]; then
	summary ""
	summary "| Slowest Endpoints (by p95) | Count | p95 ms | p99 ms | mean ms |"
	summary "|---|---:|---:|---:|---:|"
	while IFS=$'\t' read -r endpoint count endpoint_p95 endpoint_p99 endpoint_mean; do
		summary "| \`${endpoint}\` | ${count} | ${endpoint_p95} | ${endpoint_p99} | ${endpoint_mean} |"
	done <<<"${endpoint_rows}"
fi

if [ -n "${BASELINE_REPORT}" ] && [ -f "${BASELINE_REPORT}" ]; then
	base_p95="$(metric_or_na "${BASELINE_REPORT}" '.aggregate.summaries["http.response_time"].p95')"
	base_p99="$(metric_or_na "${BASELINE_REPORT}" '.aggregate.summaries["http.response_time"].p99')"
	base_rate="$(metric_or_na "${BASELINE_REPORT}" '.aggregate.rates["http.request_rate"]')"

	summary ""
	summary "- Baseline report: \`${BASELINE_REPORT}\`"

	if is_number "${p95}" && is_number "${base_p95}"; then
		p95_delta="$(percent_change "${p95}" "${base_p95}")"
		summary "- p95 delta: \`${base_p95}\` -> \`${p95}\` ms (\`${p95_delta}%\`)"
	fi
	if is_number "${p99}" && is_number "${base_p99}"; then
		p99_delta="$(percent_change "${p99}" "${base_p99}")"
		summary "- p99 delta: \`${base_p99}\` -> \`${p99}\` ms (\`${p99_delta}%\`)"
	fi
	if is_number "${rate}" && is_number "${base_rate}"; then
		rate_delta="$(percent_change "${rate}" "${base_rate}")"
		summary "- request_rate delta: \`${base_rate}\` -> \`${rate}\` req/s (\`${rate_delta}%\`)"
	fi
fi
