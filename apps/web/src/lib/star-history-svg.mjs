/**
 * Self-hosted Star History chart rendering (#671).
 *
 * Pure functions only — consumed by the /api/star-history route handler and
 * unit-tested directly from scripts/star-history-svg.test.mjs. No fetch, no
 * environment access: the route fetches stargazer timestamps and passes them
 * in, so everything here is deterministic.
 *
 * Replaces the api.star-history.com embed, which broke when that service's
 * GitHub tokens were rate-limited (their issue #548): the site and README now
 * render this SVG from our own origin instead of a third party.
 */

// Sky-600 — the site's "ocean" aurora family. Validated against both the
// light and dark card surfaces (lightness band + >= 3:1 contrast), so one
// accent serves both themes; text wears neutral ink tokens, never the accent.
const ACCENT = "#0284c7";

const THEMES = {
  light: {
    ink: "#171717",
    muted: "#525252",
    grid: "rgba(23, 23, 23, 0.08)",
    axis: "rgba(23, 23, 23, 0.16)",
    area: "rgba(2, 132, 199, 0.10)",
  },
  dark: {
    ink: "#f5f5f5",
    muted: "#a3a3a3",
    grid: "rgba(245, 245, 245, 0.08)",
    axis: "rgba(245, 245, 245, 0.18)",
    area: "rgba(2, 132, 199, 0.18)",
  },
};

const WIDTH = 720;
const HEIGHT = 480;
const MARGIN = { top: 48, right: 40, bottom: 44, left: 56 };

export function resolveTheme(value) {
  return value === "dark" ? "dark" : "light";
}

/**
 * Turn raw starred_at timestamps into a cumulative [{time, count}] series,
 * sorted and terminated with a "now" point so the line reaches the right edge.
 * Invalid timestamps are dropped rather than poisoning the sort.
 */
export function buildCumulativeSeries(starredAt, now) {
  const times = (Array.isArray(starredAt) ? starredAt : [])
    .map((value) => new Date(value).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);

  const nowTime = new Date(now).getTime();
  const series = times.map((time, index) => ({ time, count: index + 1 }));
  const last = series[series.length - 1];
  if (Number.isFinite(nowTime) && (!last || nowTime > last.time)) {
    series.push({ time: nowTime, count: last ? last.count : 0 });
  }
  return series;
}

/**
 * Pick the y-axis {step, ticks} whose ceiling (step × ticks) is the tightest
 * "nice" bound over max, so the line fills the plot instead of floating in
 * the bottom half. Steps are 1/2/2.5/5 × 10^n with 3–5 ticks; 2.5 only at
 * n ≥ 1 so labels stay integers.
 */
function niceScale(max) {
  const target = Math.max(1, max);
  let best;
  for (let power = 1; power <= 10 ** 9; power *= 10) {
    for (const base of [1, 2, 2.5, 5]) {
      const step = base * power;
      if (!Number.isInteger(step)) {
        continue;
      }
      for (let ticks = 3; ticks <= 5; ticks += 1) {
        const ceiling = step * ticks;
        if (ceiling >= target && (!best || ceiling < best.ceiling)) {
          best = { step, ticks, ceiling };
        }
      }
    }
    if (best) {
      return best;
    }
  }
  return { step: target, ticks: 1, ceiling: target };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/gu, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMonthYear(time) {
  const date = new Date(time);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function toFixed1(value) {
  return Number(value.toFixed(1));
}

/**
 * Render the cumulative-stars SVG. Transparent background — the homepage card
 * and GitHub's README canvas both supply their own surface, and the README
 * <picture> element selects the matching theme variant.
 */
export function renderStarHistorySvg({ series, theme, repoSlug }) {
  const palette = THEMES[resolveTheme(theme)];
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const total = series.length ? series[series.length - 1].count : 0;
  const { step, ticks } = niceScale(total);
  const yMax = step * ticks;
  const minTime = series.length ? series[0].time : 0;
  const maxTime = series.length ? series[series.length - 1].time : 1;
  const timeSpan = Math.max(1, maxTime - minTime);

  const xFor = (time) => MARGIN.left + ((time - minTime) / timeSpan) * plotWidth;
  const yFor = (count) => MARGIN.top + plotHeight - (count / yMax) * plotHeight;

  const points = series.map(
    ({ time, count }) => `${toFixed1(xFor(time))},${toFixed1(yFor(count))}`,
  );
  const baselineY = toFixed1(yFor(0));
  const linePath = points.length ? `M${points.join(" L")}` : "";
  const areaPath = points.length
    ? `${linePath} L${toFixed1(xFor(maxTime))},${baselineY} L${toFixed1(xFor(minTime))},${baselineY} Z`
    : "";

  const gridLines = [];
  const yLabels = [];
  for (let tick = 0; tick <= ticks; tick += 1) {
    const value = tick * step;
    const y = toFixed1(yFor(value));
    if (tick > 0) {
      gridLines.push(
        `<line x1="${MARGIN.left}" y1="${y}" x2="${WIDTH - MARGIN.right}" y2="${y}" stroke="${palette.grid}" stroke-width="1" />`,
      );
    }
    yLabels.push(
      `<text x="${MARGIN.left - 10}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="${palette.muted}" font-size="12">${value}</text>`,
    );
  }

  const xLabels = [];
  if (series.length) {
    const midTime = minTime + timeSpan / 2;
    const labelY = HEIGHT - MARGIN.bottom + 24;
    xLabels.push(
      `<text x="${MARGIN.left}" y="${labelY}" text-anchor="start" fill="${palette.muted}" font-size="12">${formatMonthYear(minTime)}</text>`,
      `<text x="${toFixed1(MARGIN.left + plotWidth / 2)}" y="${labelY}" text-anchor="middle" fill="${palette.muted}" font-size="12">${formatMonthYear(midTime)}</text>`,
      `<text x="${WIDTH - MARGIN.right}" y="${labelY}" text-anchor="end" fill="${palette.muted}" font-size="12">${formatMonthYear(maxTime)}</text>`,
    );
  }

  const endX = points.length ? toFixed1(xFor(maxTime)) : 0;
  const endY = points.length ? toFixed1(yFor(total)) : 0;
  // Keep the end label inside the plot even when the last point hugs the top.
  const endLabelY = Math.max(endY - 12, MARGIN.top + 12);
  const endMarker = points.length
    ? `<circle cx="${endX}" cy="${endY}" r="4" fill="${ACCENT}" />
  <text x="${endX}" y="${toFixed1(endLabelY)}" text-anchor="end" fill="${palette.ink}" font-size="16" font-weight="600">${total}</text>`
    : "";

  const fontFamily =
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="GitHub star history for ${escapeXml(repoSlug)}: ${total} stars">
  <g font-family="${fontFamily}">
  <text x="${MARGIN.left}" y="24" fill="${palette.ink}" font-size="14" font-weight="600">GitHub stars</text>
  <text x="${MARGIN.left}" y="24" dx="88" fill="${palette.muted}" font-size="13">${escapeXml(repoSlug)}</text>
  ${gridLines.join("\n  ")}
  <line x1="${MARGIN.left}" y1="${baselineY}" x2="${WIDTH - MARGIN.right}" y2="${baselineY}" stroke="${palette.axis}" stroke-width="1" />
  ${areaPath ? `<path d="${areaPath}" fill="${palette.area}" />` : ""}
  ${linePath ? `<path d="${linePath}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />` : ""}
  ${endMarker}
  ${yLabels.join("\n  ")}
  ${xLabels.join("\n  ")}
  </g>
</svg>`;
}

/**
 * Served with a short cache lifetime when the stargazer fetch fails outright,
 * so the image element still renders something sane and retries soon.
 */
export function renderStarHistoryFallbackSvg({ theme, repoSlug }) {
  const palette = THEMES[resolveTheme(theme)];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="GitHub star history for ${escapeXml(repoSlug)} is temporarily unavailable">
  <text x="${WIDTH / 2}" y="${HEIGHT / 2}" text-anchor="middle" fill="${palette.muted}" font-size="14" font-family="ui-sans-serif, system-ui, sans-serif">Star history is loading — check back shortly.</text>
</svg>`;
}
