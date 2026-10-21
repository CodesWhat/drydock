import fs from 'node:fs';

// Merge per-workspace .coverage-gaps.<workspace>.json reports into one file.
// Shared by the CI aggregating job; mirrors combine_gap_reports in
// scripts/pre-push-coverage.sh. A shard that met its thresholds writes no
// report, so a missing input is skipped rather than an error.
function parseArgs(argv) {
  const args = { out: null, inputs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else {
      args.inputs.push(argv[index]);
    }
  }
  if (!args.out) {
    throw new Error('Missing required --out argument');
  }
  return args;
}

const { out, inputs } = parseArgs(process.argv.slice(2));
const merged = [];
for (const file of inputs) {
  if (!fs.existsSync(file)) continue;
  merged.push(...JSON.parse(fs.readFileSync(file, 'utf8')));
}
fs.writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
