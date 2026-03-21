#!/bin/bash

set -euo pipefail

CURRENT_REPORT="${1:-}"
BASELINE_REPORT="${2:-}"

DD_LOAD_TEST_MAX_P95_INCREASE_PCT="${DD_LOAD_TEST_MAX_P95_INCREASE_PCT:-20}"
DD_LOAD_TEST_MAX_P99_INCREASE_PCT="${DD_LOAD_TEST_MAX_P99_INCREASE_PCT:-25}"
DD_LOAD_TEST_MAX_RATE_DECREASE_PCT="${DD_LOAD_TEST_MAX_RATE_DECREASE_PCT:-15}"
DD_LOAD_TEST_MAX_P95_MS="${DD_LOAD_TEST_MAX_P95_MS:-1200}"
DD_LOAD_TEST_MAX_P99_MS="${DD_LOAD_TEST_MAX_P99_MS:-2500}"
DD_LOAD_TEST_MIN_REQUEST_RATE="${DD_LOAD_TEST_MIN_REQUEST_RATE:-10}"
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

is_false() {
	local normalized
	normalized="$(printf "%s" "${1}" | tr '[:upper:]' '[:lower:]')"
	case "${normalized}" in
	0 | false | no | off)
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

validate_enforcement_mode() {
	if is_true "${DD_LOAD_TEST_REGRESSION_ENFORCE}" || is_false "${DD_LOAD_TEST_REGRESSION_ENFORCE}"; then
		return 0
	fi

	summary "### Load Test Regression Gate"
	summary "- Invalid DD_LOAD_TEST_REGRESSION_ENFORCE value: \`${DD_LOAD_TEST_REGRESSION_ENFORCE}\` (expected true/false)."
	exit 2
}

exit_with_gate_status() {
	local reason="$1"
	if is_true "${DD_LOAD_TEST_REGRESSION_ENFORCE}"; then
		summary "- Regression status: FAIL (enforced, ${reason})"
		exit 1
	fi
	summary "- Regression status: WARN (advisory, ${reason})"
	exit 0
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

is_less_than() {
	local left="$1"
	local right="$2"
	awk -v left="${left}" -v right="${right}" 'BEGIN {
    if (left < right) {
      exit 0
    }
    exit 1
  }'
}

validate_enforcement_mode

if [ ! -f "${CURRENT_REPORT}" ]; then
	summary "### Load Test Regression Gate"
	summary "- Current report not found: \`${CURRENT_REPORT}\`"
	exit_with_gate_status "missing current report"
fi

if [ ! -f "${BASELINE_REPORT}" ]; then
	summary "### Load Test Regression Gate"
	summary "- Baseline report not found: \`${BASELINE_REPORT}\`"
	exit_with_gate_status "missing baseline report"
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
		exit_with_gate_status "missing or non-numeric metric"
	fi
done

for threshold_name in \
	DD_LOAD_TEST_MAX_P95_INCREASE_PCT \
	DD_LOAD_TEST_MAX_P99_INCREASE_PCT \
	DD_LOAD_TEST_MAX_RATE_DECREASE_PCT \
	DD_LOAD_TEST_MAX_P95_MS \
	DD_LOAD_TEST_MAX_P99_MS \
	DD_LOAD_TEST_MIN_REQUEST_RATE; do
	threshold_value="${!threshold_name}"
	if ! is_number "${threshold_value}"; then
		summary "### Load Test Regression Gate"
		summary "- Invalid threshold config: \`${threshold_name}=${threshold_value}\` (must be numeric)."
		exit 2
	fi
done

p95_increase_pct="$(percent_change "${current_p95}" "${baseline_p95}")"
p99_increase_pct="$(percent_change "${current_p99}" "${baseline_p99}")"
rate_decrease_pct="$(percent_decrease "${current_rate}" "${baseline_rate}")"

if [ "${p95_increase_pct}" = "nan" ] || [ "${p99_increase_pct}" = "nan" ] || [ "${rate_decrease_pct}" = "nan" ]; then
	summary "### Load Test Regression Gate"
	summary "- Baseline metrics are zero or invalid; cannot evaluate regression."
	summary "- Current report: \`${CURRENT_REPORT}\`"
	summary "- Baseline report: \`${BASELINE_REPORT}\`"
	exit_with_gate_status "invalid baseline metrics"
fi

p95_pct_regressed=false
p99_pct_regressed=false
rate_pct_regressed=false
p95_abs_regressed=false
p99_abs_regressed=false
rate_abs_regressed=false

if is_greater_than "${p95_increase_pct}" "${DD_LOAD_TEST_MAX_P95_INCREASE_PCT}"; then
	p95_pct_regressed=true
fi

if is_greater_than "${p99_increase_pct}" "${DD_LOAD_TEST_MAX_P99_INCREASE_PCT}"; then
	p99_pct_regressed=true
fi

if is_greater_than "${rate_decrease_pct}" "${DD_LOAD_TEST_MAX_RATE_DECREASE_PCT}"; then
	rate_pct_regressed=true
fi

if is_greater_than "${current_p95}" "${DD_LOAD_TEST_MAX_P95_MS}"; then
	p95_abs_regressed=true
fi

if is_greater_than "${current_p99}" "${DD_LOAD_TEST_MAX_P99_MS}"; then
	p99_abs_regressed=true
fi

if is_less_than "${current_rate}" "${DD_LOAD_TEST_MIN_REQUEST_RATE}"; then
	rate_abs_regressed=true
fi

summary "### Load Test Regression Gate"
summary "- Current report: \`${CURRENT_REPORT}\`"
summary "- Baseline report: \`${BASELINE_REPORT}\`"
if [ -n "${DD_LOAD_TEST_BASELINE_ARTIFACT_NAME}" ]; then
	summary "- Baseline artifact: \`${DD_LOAD_TEST_BASELINE_ARTIFACT_NAME}\`"
fi
summary "- Relative thresholds: p95 <= +${DD_LOAD_TEST_MAX_P95_INCREASE_PCT}%, p99 <= +${DD_LOAD_TEST_MAX_P99_INCREASE_PCT}%, request_rate >= -${DD_LOAD_TEST_MAX_RATE_DECREASE_PCT}%"
summary "- Absolute thresholds: p95 <= ${DD_LOAD_TEST_MAX_P95_MS} ms, p99 <= ${DD_LOAD_TEST_MAX_P99_MS} ms, request_rate >= ${DD_LOAD_TEST_MIN_REQUEST_RATE} req/s"

p95_pct_status="PASS"
p99_pct_status="PASS"
rate_pct_status="PASS"
p95_abs_status="PASS"
p99_abs_status="PASS"
rate_abs_status="PASS"

if [ "${p95_pct_regressed}" = true ]; then
	p95_pct_status="FAIL"
fi
if [ "${p99_pct_regressed}" = true ]; then
	p99_pct_status="FAIL"
fi
if [ "${rate_pct_regressed}" = true ]; then
	rate_pct_status="FAIL"
fi
if [ "${p95_abs_regressed}" = true ]; then
	p95_abs_status="FAIL"
fi
if [ "${p99_abs_regressed}" = true ]; then
	p99_abs_status="FAIL"
fi
if [ "${rate_abs_regressed}" = true ]; then
	rate_abs_status="FAIL"
fi

summary "- p95: \`${baseline_p95}\` -> \`${current_p95}\` ms | delta \`+${p95_increase_pct}%\` (<= +${DD_LOAD_TEST_MAX_P95_INCREASE_PCT}%: ${p95_pct_status}) | ceiling <= ${DD_LOAD_TEST_MAX_P95_MS} ms: ${p95_abs_status}"
summary "- p99: \`${baseline_p99}\` -> \`${current_p99}\` ms | delta \`+${p99_increase_pct}%\` (<= +${DD_LOAD_TEST_MAX_P99_INCREASE_PCT}%: ${p99_pct_status}) | ceiling <= ${DD_LOAD_TEST_MAX_P99_MS} ms: ${p99_abs_status}"
summary "- request_rate: \`${baseline_rate}\` -> \`${current_rate}\` req/s | delta \`-${rate_decrease_pct}%\` (>= -${DD_LOAD_TEST_MAX_RATE_DECREASE_PCT}%: ${rate_pct_status}) | floor >= ${DD_LOAD_TEST_MIN_REQUEST_RATE} req/s: ${rate_abs_status}"

if [ "${p95_pct_regressed}" = true ] || [ "${p99_pct_regressed}" = true ] || [ "${rate_pct_regressed}" = true ] || [ "${p95_abs_regressed}" = true ] || [ "${p99_abs_regressed}" = true ] || [ "${rate_abs_regressed}" = true ]; then
	if is_true "${DD_LOAD_TEST_REGRESSION_ENFORCE}"; then
		summary "- Regression status: FAIL (enforced)"
		exit 1
	fi
	summary "- Regression status: WARN (advisory mode)"
	exit 0
fi

summary "- Regression status: PASS"
