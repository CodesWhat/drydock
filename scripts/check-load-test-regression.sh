#!/bin/bash

set -euo pipefail

CURRENT_REPORT="${1:-}"
BASELINE_REPORT="${2:-}"

DD_LOAD_TEST_MAX_P95_INCREASE_PCT="${DD_LOAD_TEST_MAX_P95_INCREASE_PCT:-20}"
DD_LOAD_TEST_MAX_P99_INCREASE_PCT="${DD_LOAD_TEST_MAX_P99_INCREASE_PCT:-25}"
DD_LOAD_TEST_MAX_RATE_DECREASE_PCT="${DD_LOAD_TEST_MAX_RATE_DECREASE_PCT:-15}"
DD_LOAD_TEST_REGRESSION_ENFORCE="${DD_LOAD_TEST_REGRESSION_ENFORCE:-false}"
DD_LOAD_TEST_BASELINE_ARTIFACT_NAME="${DD_LOAD_TEST_BASELINE_ARTIFACT_NAME:-}"

if [ -z "${CURRENT_REPORT}" ] || [ -z "${BASELINE_REPORT}" ]; then
	echo "Usage: $0 <current-report.json> <baseline-report.json>"
	exit 2
fi

summary() {
	local message="$1"
	echo "${message}"
	if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
		echo "${message}" >>"${GITHUB_STEP_SUMMARY}"
	fi
}

is_true() {
	local normalized
	normalized="$(printf "%s" "${1}" | tr '[:upper:]' '[:lower:]')"
	case "${normalized}" in
	1 | true | yes | on)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_number() {
	local value="$1"
	[[ ${value} =~ ^[0-9]+([.][0-9]+)?$ ]]
}

load_metric() {
	local report="$1"
	local query="$2"
	jq -r "${query} // empty" "${report}"
}

percent_change() {
	local current="$1"
	local baseline="$2"
	awk -v current="${current}" -v baseline="${baseline}" 'BEGIN {
    if (baseline <= 0) {
      print "nan"
      exit
    }
    printf "%.2f", ((current - baseline) / baseline) * 100
  }'
}

percent_decrease() {
	local current="$1"
	local baseline="$2"
	awk -v current="${current}" -v baseline="${baseline}" 'BEGIN {
    if (baseline <= 0) {
      print "nan"
      exit
    }
    printf "%.2f", ((baseline - current) / baseline) * 100
  }'
}

is_greater_than() {
	local left="$1"
	local right="$2"
	awk -v left="${left}" -v right="${right}" 'BEGIN {
    if (left > right) {
      exit 0
    }
    exit 1
  }'
}

if [ ! -f "${CURRENT_REPORT}" ]; then
	summary "### Load Test Regression Gate"
	summary "- Current report not found: \`${CURRENT_REPORT}\`"
	exit 0
fi

if [ ! -f "${BASELINE_REPORT}" ]; then
	summary "### Load Test Regression Gate"
	summary "- Baseline report not found: \`${BASELINE_REPORT}\`"
	exit 0
fi

current_p95="$(load_metric "${CURRENT_REPORT}" '.aggregate.summaries["http.response_time"].p95')"
current_p99="$(load_metric "${CURRENT_REPORT}" '.aggregate.summaries["http.response_time"].p99')"
current_rate="$(load_metric "${CURRENT_REPORT}" '.aggregate.rates["http.request_rate"]')"

baseline_p95="$(load_metric "${BASELINE_REPORT}" '.aggregate.summaries["http.response_time"].p95')"
baseline_p99="$(load_metric "${BASELINE_REPORT}" '.aggregate.summaries["http.response_time"].p99')"
baseline_rate="$(load_metric "${BASELINE_REPORT}" '.aggregate.rates["http.request_rate"]')"

for metric_name in current_p95 current_p99 current_rate baseline_p95 baseline_p99 baseline_rate; do
	metric_value="${!metric_name}"
	if ! is_number "${metric_value}"; then
		summary "### Load Test Regression Gate"
		summary "- Missing or non-numeric metric: \`${metric_name}\` from reports."
		summary "- Current report: \`${CURRENT_REPORT}\`"
		summary "- Baseline report: \`${BASELINE_REPORT}\`"
		exit 0
	fi
done

p95_increase_pct="$(percent_change "${current_p95}" "${baseline_p95}")"
p99_increase_pct="$(percent_change "${current_p99}" "${baseline_p99}")"
rate_decrease_pct="$(percent_decrease "${current_rate}" "${baseline_rate}")"

if [ "${p95_increase_pct}" = "nan" ] || [ "${p99_increase_pct}" = "nan" ] || [ "${rate_decrease_pct}" = "nan" ]; then
	summary "### Load Test Regression Gate"
	summary "- Baseline metrics are zero or invalid; skipping regression check."
	summary "- Current report: \`${CURRENT_REPORT}\`"
	summary "- Baseline report: \`${BASELINE_REPORT}\`"
	exit 0
fi

p95_regressed=false
p99_regressed=false
rate_regressed=false

if is_greater_than "${p95_increase_pct}" "${DD_LOAD_TEST_MAX_P95_INCREASE_PCT}"; then
	p95_regressed=true
fi

if is_greater_than "${p99_increase_pct}" "${DD_LOAD_TEST_MAX_P99_INCREASE_PCT}"; then
	p99_regressed=true
fi

if is_greater_than "${rate_decrease_pct}" "${DD_LOAD_TEST_MAX_RATE_DECREASE_PCT}"; then
	rate_regressed=true
fi

summary "### Load Test Regression Gate"
summary "- Current report: \`${CURRENT_REPORT}\`"
summary "- Baseline report: \`${BASELINE_REPORT}\`"
if [ -n "${DD_LOAD_TEST_BASELINE_ARTIFACT_NAME}" ]; then
	summary "- Baseline artifact: \`${DD_LOAD_TEST_BASELINE_ARTIFACT_NAME}\`"
fi
summary "- Thresholds: p95 <= +${DD_LOAD_TEST_MAX_P95_INCREASE_PCT}%, p99 <= +${DD_LOAD_TEST_MAX_P99_INCREASE_PCT}%, request_rate >= -${DD_LOAD_TEST_MAX_RATE_DECREASE_PCT}%"

if [ "${p95_regressed}" = true ]; then
	summary "- p95: \`${baseline_p95}\` -> \`${current_p95}\` ms (\`+${p95_increase_pct}%\`) FAIL"
else
	summary "- p95: \`${baseline_p95}\` -> \`${current_p95}\` ms (\`+${p95_increase_pct}%\`) PASS"
fi

if [ "${p99_regressed}" = true ]; then
	summary "- p99: \`${baseline_p99}\` -> \`${current_p99}\` ms (\`+${p99_increase_pct}%\`) FAIL"
else
	summary "- p99: \`${baseline_p99}\` -> \`${current_p99}\` ms (\`+${p99_increase_pct}%\`) PASS"
fi

if [ "${rate_regressed}" = true ]; then
	summary "- request_rate: \`${baseline_rate}\` -> \`${current_rate}\` req/s (\`-${rate_decrease_pct}%\`) FAIL"
else
	summary "- request_rate: \`${baseline_rate}\` -> \`${current_rate}\` req/s (\`-${rate_decrease_pct}%\`) PASS"
fi

if [ "${p95_regressed}" = true ] || [ "${p99_regressed}" = true ] || [ "${rate_regressed}" = true ]; then
	if is_true "${DD_LOAD_TEST_REGRESSION_ENFORCE}"; then
		summary "- Regression status: FAIL (enforced)"
		exit 1
	fi
	summary "- Regression status: WARN (advisory mode)"
	exit 0
fi

summary "- Regression status: PASS"
