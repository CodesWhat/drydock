#!/usr/bin/env node
// Validates rc.21 cron default change (hourly → 6-hourly).
// Simulates Cesc1986's reported fleet (#342): 24 containers, ~60% Docker Hub,
// ~40% GHCR. Does NOT hit real registries — synthetic request counter only.
//
// Four counters per cycle (each mapped to the correct quota bucket):
//   hubPulls     — manifest HEAD per Hub container (1/container/cycle)
//                  counted against Docker Hub pull quota (200 auth / 100 anon per 6h)
//   hubOther     — auth + tag-list per Hub container (not quota-counted by Hub policy)
//   ghcrRegistry — manifest + auth + tag-list against GHCR OCI endpoints
//                  (no documented per-account quota for authenticated users)
//   githubApi    — release-notes lookup (api.github.com/repos) per GHCR container
//                  counted against GitHub REST API limit (5,000/hr → 30,000/6h)
//
// Simulates a 6-hour window at both cadences:
//   - Hourly:   cron "0 * * * *"   → 6 cycles
//   - 6-hourly: cron "0 */6 * * *" → 1 cycle
//
// Run as: node scripts/bench/registry-rate.mjs

const FLEET = [
  // Docker Hub containers (~60% = 14 containers)
  { host: 'hub', name: 'nginx',                 tagPages: 2 },
  { host: 'hub', name: 'postgres',              tagPages: 2 },
  { host: 'hub', name: 'redis',                 tagPages: 1 },
  { host: 'hub', name: 'traefik',               tagPages: 2 },
  { host: 'hub', name: 'grafana',               tagPages: 2 },
  { host: 'hub', name: 'influxdb',              tagPages: 1 },
  { host: 'hub', name: 'portainer',             tagPages: 1 },
  { host: 'hub', name: 'homer',                 tagPages: 1 },
  { host: 'hub', name: 'vaultwarden',           tagPages: 2 },
  { host: 'hub', name: 'photoprism',            tagPages: 3 },
  { host: 'hub', name: 'nextcloud',             tagPages: 2 },
  { host: 'hub', name: 'jellyfin',              tagPages: 2 },
  { host: 'hub', name: 'plex',                  tagPages: 1 },
  { host: 'hub', name: 'overseerr',             tagPages: 1 },
  // GHCR containers (~40% = 10 containers)
  // immich-server-class: 24 tag pages (outlier, source of Cesc's GHCR 429s)
  { host: 'ghcr', name: 'immich-server',        tagPages: 24 },
  { host: 'ghcr', name: 'immich-microservices', tagPages: 24 },
  // typical GHCR images: 1-3 pages
  { host: 'ghcr', name: 'paperless-ngx',        tagPages: 2 },
  { host: 'ghcr', name: 'linkwarden',           tagPages: 1 },
  { host: 'ghcr', name: 'stirling-pdf',         tagPages: 2 },
  { host: 'ghcr', name: 'it-tools',             tagPages: 1 },
  { host: 'ghcr', name: 'homarr',               tagPages: 2 },
  { host: 'ghcr', name: 'mealie',               tagPages: 1 },
  { host: 'ghcr', name: 'komga',                tagPages: 1 },
  { host: 'ghcr', name: 'kavita',               tagPages: 3 },
];

// Quota ceilings (6-hour window).
const CEILINGS = {
  hubPullsAuth:  200,   // Docker Hub authenticated pull quota per 6h
  hubPullsAnon:  100,   // Docker Hub anonymous pull quota per 6h
  githubApi:     30_000, // GitHub REST API: 5,000/hr × 6 = 30,000/6h (authenticated)
};

function simulateWindow(cycles) {
  const totals = { hubPulls: 0, hubOther: 0, ghcrRegistry: 0, githubApi: 0 };
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const c of FLEET) {
      if (c.host === 'hub') {
        totals.hubPulls  += 1;               // 1 manifest HEAD — quota-counted
        totals.hubOther  += 1 + c.tagPages;  // 1 auth + N tag-list pages — not quota-counted
      } else {
        // ghcr: auth + manifest HEAD + tag-list pages go to GHCR OCI endpoints
        totals.ghcrRegistry += 1 + 1 + c.tagPages;
        // release-notes lookup hits api.github.com/repos — counts against GitHub REST quota
        totals.githubApi    += 1;
      }
    }
  }
  return totals;
}

function pct(used, ceiling) {
  return ((used / ceiling) * 100).toFixed(1);
}

function headroom(used, ceiling) {
  const left = ceiling - used;
  return left >= 0
    ? `${left} req headroom (${(100 - (used / ceiling) * 100).toFixed(1)}% free)`
    : `OVER by ${-left} req`;
}

function main() {
  const hubContainers  = FLEET.filter((c) => c.host === 'hub');
  const ghcrContainers = FLEET.filter((c) => c.host === 'ghcr');

  const hourlyCycles   = 6;
  const sixHourlyCycles = 1;

  const H  = simulateWindow(hourlyCycles);
  const SH = simulateWindow(sixHourlyCycles);

  console.log('\n## Registry rate-limit bench — rc.21 cron default validation\n');
  console.log(`Fleet: ${FLEET.length} containers (${hubContainers.length} Docker Hub, ${ghcrContainers.length} GHCR)`);
  console.log(`  immich-server-class: ${FLEET.find((c) => c.name === 'immich-server').tagPages} tag pages each`);
  console.log('');

  // Four-counter table
  const w = [28, 22, 22, 15];
  const row = (a, b, c, d) =>
    `| ${a.padEnd(w[0])} | ${b.padEnd(w[1])} | ${c.padEnd(w[2])} | ${d.padEnd(w[3])} |`;
  const sep = `| ${'-'.repeat(w[0])} | ${'-'.repeat(w[1])} | ${'-'.repeat(w[2])} | ${'-'.repeat(w[3])} |`;

  console.log(row('Counter', 'Hourly (6 cycles)', '6-Hourly (1 cycle)', 'Speedup'));
  console.log(sep);
  const counters = [
    ['hubPulls',     'Hub manifest HEADs (quota-counted)'],
    ['hubOther',     'Hub auth + tag-list (not quota-counted)'],
    ['ghcrRegistry', 'GHCR registry calls (OCI; no pub. quota)'],
    ['githubApi',    'GitHub API release-notes (5k/hr limit)'],
  ];
  for (const [key, label] of counters) {
    const factor = (H[key] / SH[key]).toFixed(0);
    console.log(row(label, String(H[key]), String(SH[key]), `${factor}×`));
  }

  console.log('');
  console.log('### Rate-limit headroom (6-hour window)\n');

  console.log('Docker Hub pull quota (manifest HEAD only — auth/tag-list calls are NOT quota-counted):');
  console.log(`  Authenticated ceiling (200/6h):`);
  console.log(`    Hourly cadence:   ${H.hubPulls} pulls → ${pct(H.hubPulls, CEILINGS.hubPullsAuth)}% used, ${headroom(H.hubPulls, CEILINGS.hubPullsAuth)}`);
  console.log(`    6-hourly cadence: ${SH.hubPulls} pulls → ${pct(SH.hubPulls, CEILINGS.hubPullsAuth)}% used, ${headroom(SH.hubPulls, CEILINGS.hubPullsAuth)}`);
  console.log(`  Anonymous ceiling (100/6h):`);
  console.log(`    Hourly cadence:   ${H.hubPulls} pulls → ${pct(H.hubPulls, CEILINGS.hubPullsAnon)}% used, ${headroom(H.hubPulls, CEILINGS.hubPullsAnon)}`);
  console.log(`    6-hourly cadence: ${SH.hubPulls} pulls → ${pct(SH.hubPulls, CEILINGS.hubPullsAnon)}% used, ${headroom(SH.hubPulls, CEILINGS.hubPullsAnon)}`);
  console.log('');

  console.log('Docker Hub auth + tag-list (hubOther — no documented quota; soft rate-limited):');
  console.log(`  Hourly cadence:   ${H.hubOther} req`);
  console.log(`  6-hourly cadence: ${SH.hubOther} req`);
  console.log('');

  console.log('GHCR registry (no documented per-account quota for authenticated users;');
  console.log('  anonymous traffic is rate-limited at undocumented thresholds — source of Cesc\'s 429s):');
  console.log(`  Hourly cadence:   ${H.ghcrRegistry} req`);
  console.log(`  6-hourly cadence: ${SH.ghcrRegistry} req`);
  console.log(`  Speedup: ${(H.ghcrRegistry / SH.ghcrRegistry).toFixed(0)}× fewer requests against GHCR per 6h window`);
  console.log('');

  console.log(`GitHub REST API release-notes (5,000/hr authenticated → ${CEILINGS.githubApi.toLocaleString()}/6h ceiling):`);
  console.log(`  Hourly cadence:   ${H.githubApi} req → ${pct(H.githubApi, CEILINGS.githubApi)}% used, ${headroom(H.githubApi, CEILINGS.githubApi)}`);
  console.log(`  6-hourly cadence: ${SH.githubApi} req → ${pct(SH.githubApi, CEILINGS.githubApi)}% used, ${headroom(SH.githubApi, CEILINGS.githubApi)}`);
  console.log('');

  console.log('### Summary\n');
  console.log(`- Hub pull quota (auth 200/6h): hourly=${H.hubPulls} pulls (${pct(H.hubPulls, CEILINGS.hubPullsAuth)}%), 6-hourly=${SH.hubPulls} pulls (${pct(SH.hubPulls, CEILINGS.hubPullsAuth)}%) — comfortable headroom at both cadences`);
  console.log(`- Hub pull quota (anon 100/6h): hourly=${H.hubPulls} pulls (${pct(H.hubPulls, CEILINGS.hubPullsAnon)}%), 6-hourly=${SH.hubPulls} pulls (${pct(SH.hubPulls, CEILINGS.hubPullsAnon)}%) — comfortable headroom at both cadences`);
  console.log(`- GHCR registry calls: ${H.ghcrRegistry} → ${SH.ghcrRegistry} per 6h window (${(H.ghcrRegistry / SH.ghcrRegistry).toFixed(0)}× reduction) — where Cesc's 429s originated (#342)`);
  console.log(`- GitHub API release-notes: ${H.githubApi} → ${SH.githubApi} per 6h window (${(H.githubApi / SH.githubApi).toFixed(0)}× reduction, ${pct(H.githubApi, CEILINGS.githubApi)}% → ${pct(SH.githubApi, CEILINGS.githubApi)}% of ceiling)`);
  console.log(`- 6× reduction across all counters — primary benefit is cutting GHCR + GitHub API chatter, not Hub pull quota headroom`);
  console.log('');
}

main();
