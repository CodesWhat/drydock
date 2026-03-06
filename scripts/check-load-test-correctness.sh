#!/bin/bash

set -euo pipefail

REPORT="${1:-}"
TITLE="${2:-Load Test Correctness}"

DD_LOAD_TEST_CORRECTNESS_ENFORCE="${DD_LOAD_TEST_CORRECTNESS_ENFORCE:-false}"
DD_LOAD_TEST_MAX_5XX="${DD_LOAD_TEST_MAX_5XX:-0}"
DD_LOAD_TEST_MAX_VUSERS_FAILED="${DD_LOAD_TEST_MAX_VUSERS_FAILED:-0}"
DD_LOAD_TEST_MIN_429="${DD_LOAD_TEST_MIN_429:-0}"
DD_LOAD_TEST_MAX_429="${DD_LOAD_TEST_MAX_429:-}"

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

is_greater_than() {
	local left="$1"
	local right="$2"
	awk -v left="${left}" -v right="${right}" 'BEGIN { exit !(left > right) }'
}

is_less_than() {
	local left="$1"
	local right="$2"
	awk -v left="${left}" -v right="${right}" 'BEGIN { exit !(left < right) }'
}

summary "### ${TITLE}"

if [ -z "${REPORT}" ]; then
	summary "- Report path is empty."
	if is_true "${DD_LOAD_TEST_CORRECTNESS_ENFORCE}"; then
		summary "- Correctness status: FAIL (enforced, missing report)"
		exit 1
	fi
	summary "- Correctness status: WARN (advisory, missing report)"
	exit 0
fi

if [ ! -f "${REPORT}" ]; then
	summary "- Report file not found: \`${REPORT}\`"
	if is_true "${DD_LOAD_TEST_CORRECTNESS_ENFORCE}"; then
		summary "- Correctness status: FAIL (enforced, missing report)"
		exit 1
	fi
	summary "- Correctness status: WARN (advisory, missing report)"
	exit 0
fi

vusers_failed="$(jq -r '.aggregate.counters["vusers.failed"] // 0' "${REPORT}")"
codes_429="$(jq -r '.aggregate.counters["http.codes.429"] // 0' "${REPORT}")"
codes_5xx="$(jq -r '[((.aggregate.counters // {}) | to_entries[] | select(.key | test("^http\\.codes\\.5[0-9]{2}$")) | .value)] | add // 0' "${REPORT}")"

for metric in vusers_failed codes_429 codes_5xx DD_LOAD_TEST_MAX_5XX DD_LOAD_TEST_MAX_VUSERS_FAILED DD_LOAD_TEST_MIN_429; do
	if ! is_number "${!metric}"; then
		summary "- Non-numeric value for ${metric}: \`${!metric}\`"
		if is_true "${DD_LOAD_TEST_CORRECTNESS_ENFORCE}"; then
			summary "- Correctness status: FAIL (enforced, invalid config)"
			exit 1
		fi
		summary "- Correctness status: WARN (advisory, invalid config)"
		exit 0
	fi
done

if [ -n "${DD_LOAD_TEST_MAX_429}" ] && ! is_number "${DD_LOAD_TEST_MAX_429}"; then
	summary "- Non-numeric value for DD_LOAD_TEST_MAX_429: \`${DD_LOAD_TEST_MAX_429}\`"
	if is_true "${DD_LOAD_TEST_CORRECTNESS_ENFORCE}"; then
		summary "- Correctness status: FAIL (enforced, invalid config)"
		exit 1
	fi
	summary "- Correctness status: WARN (advisory, invalid config)"
	exit 0
fi

summary "- Report: \`${REPORT}\`"
summary "- Rules: vusers.failed <= ${DD_LOAD_TEST_MAX_VUSERS_FAILED}, 5xx <= ${DD_LOAD_TEST_MAX_5XX}, 429 >= ${DD_LOAD_TEST_MIN_429}${DD_LOAD_TEST_MAX_429:+, 429 <= ${DD_LOAD_TEST_MAX_429}}"

regressed=false

if is_greater_than "${vusers_failed}" "${DD_LOAD_TEST_MAX_VUSERS_FAILED}"; then
	regressed=true
	summary "- vusers.failed: \`${vusers_failed}\` FAIL"
else
	summary "- vusers.failed: \`${vusers_failed}\` PASS"
fi

if is_greater_than "${codes_5xx}" "${DD_LOAD_TEST_MAX_5XX}"; then
	regressed=true
	summary "- 5xx total: \`${codes_5xx}\` FAIL"
else
	summary "- 5xx total: \`${codes_5xx}\` PASS"
fi

if is_less_than "${codes_429}" "${DD_LOAD_TEST_MIN_429}"; then
	regressed=true
	summary "- 429 total: \`${codes_429}\` FAIL (below minimum)"
else
	summary "- 429 total: \`${codes_429}\` PASS"
fi

if [ -n "${DD_LOAD_TEST_MAX_429}" ] && is_greater_than "${codes_429}" "${DD_LOAD_TEST_MAX_429}"; then
	regressed=true
	summary "- 429 upper bound: \`${codes_429}\` FAIL (above maximum)"
fi

if [ "${regressed}" = true ]; then
	if is_true "${DD_LOAD_TEST_CORRECTNESS_ENFORCE}"; then
		summary "- Correctness status: FAIL (enforced)"
		exit 1
	fi
	summary "- Correctness status: WARN (advisory mode)"
	exit 0
fi

summary "- Correctness status: PASS"
