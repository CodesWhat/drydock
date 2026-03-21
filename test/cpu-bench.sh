#!/usr/bin/env bash
# CPU idle benchmark: measure healthcheck strategy impact
#
# Measures CPU via docker stats over a measurement window.
# Samples every N seconds and computes averages via awk.
#
# Usage:
#   docker compose -f test/cpu-bench-compose.yml up -d
#   ./test/cpu-bench.sh [warmup_seconds] [measure_seconds] [sample_interval]
#
# Defaults: 180s warmup, 60s measurement, 2s sample interval

set -euo pipefail

WARMUP=${1:-180}
MEASURE=${2:-60}
INTERVAL=${3:-2}
CONTAINERS="cpu-hc-binary cpu-hc-curl cpu-hc-node cpu-hc-none"
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

echo "=== Drydock CPU Healthcheck Benchmark ==="
echo ""
echo "Containers: $CONTAINERS"
echo "Warmup:     ${WARMUP}s"
echo "Measure:    ${MEASURE}s"
echo "Interval:   ${INTERVAL}s"
echo ""

# Verify all containers are running
for c in $CONTAINERS; do
	if ! docker inspect --format='{{.State.Running}}' "$c" 2>/dev/null | grep -q true; then
		echo "ERROR: Container $c is not running."
		echo "Run: docker compose -f test/cpu-bench-compose.yml up -d"
		exit 1
	fi
done

echo "All containers running. Warming up for ${WARMUP}s..."
sleep "$WARMUP"

echo ""
echo "Collecting CPU samples for ${MEASURE}s (every ${INTERVAL}s)..."
echo ""

# Collect samples to temp file: "container_name cpu_percent"
true >"$TMPFILE"
ELAPSED=0
while [ "$ELAPSED" -lt "$MEASURE" ]; do
	# shellcheck disable=SC2086
	docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' $CONTAINERS 2>/dev/null | while IFS=' ' read -r name cpu_pct; do
		cpu_val=${cpu_pct%\%}
		echo "$name $cpu_val" >>"$TMPFILE"
	done

	ELAPSED=$((ELAPSED + INTERVAL))
	if [ "$ELAPSED" -lt "$MEASURE" ]; then
		sleep "$INTERVAL"
	fi
done

# Compute and display results
TOTAL_SAMPLES=$(grep -c "cpu-hc-curl" "$TMPFILE" 2>/dev/null || echo 0)

echo "=== Results (${MEASURE}s measurement, ${TOTAL_SAMPLES} samples per container) ==="
echo ""
printf "%-20s %10s %10s %10s %10s\n" "Container" "Avg CPU%" "Min CPU%" "Max CPU%" "Samples"
printf "%-20s %10s %10s %10s %10s\n" "--------------------" "----------" "----------" "----------" "----------"

for c in $CONTAINERS; do
	RESULT=$(grep "^$c " "$TMPFILE" | awk '
    BEGIN { sum=0; count=0; min=9999; max=0 }
    {
      sum += $2; count++
      if ($2 < min) min = $2
      if ($2 > max) max = $2
    }
    END {
      if (count > 0) printf "%.2f %.2f %.2f %d", sum/count, min, max, count
      else printf "N/A N/A N/A 0"
    }
  ')
	read -r avg mn mx cnt <<<"$RESULT"
	printf "%-20s %9s%% %9s%% %9s%% %10s\n" "$c" "$avg" "$mn" "$mx" "$cnt"
done

echo ""
echo "Legend:"
echo "  cpu-hc-binary = static C binary healthcheck (30s interval)"
echo "  cpu-hc-curl   = curl healthcheck (30s interval)"
echo "  cpu-hc-node   = node -e healthcheck (30s interval)"
echo "  cpu-hc-none   = healthcheck disabled (true idle baseline)"
