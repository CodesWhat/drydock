import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    print: false,
    workspace: null,
    write: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      args.workspace = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--write') {
      args.write = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--print') {
      args.print = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.workspace) {
    throw new Error('Missing required --workspace argument');
  }

  return args;
}

function normalizeFilePath(repoRoot, filename) {
  return path.normalize(path.isAbsolute(filename) ? filename : path.resolve(repoRoot, filename));
}

function parseLcovFile(repoRoot, lcovPath) {
  const details = new Map();
  if (!fs.existsSync(lcovPath)) {
    return details;
  }

  const lines = fs.readFileSync(lcovPath, 'utf8').split(/\r?\n/);
  let currentFile = null;

  for (const line of lines) {
    if (line.startsWith('SF:')) {
      currentFile = normalizeFilePath(repoRoot, line.slice(3));
      if (!details.has(currentFile)) {
        details.set(currentFile, {
          uncoveredBranchLines: new Set(),
          uncoveredBranches: [],
          uncoveredLines: new Set(),
        });
      }
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith('DA:')) {
      const [lineNumber, hits] = line
        .slice(3)
        .split(',', 2)
        .map((value) => Number.parseInt(value, 10));
      if (hits === 0) {
        details.get(currentFile).uncoveredLines.add(lineNumber);
      }
      continue;
    }

    if (line.startsWith('BRDA:')) {
      const [lineNumberText, blockNumberText, branchNumberText, hitsText] = line.slice(5).split(',');
      const lineNumber = Number.parseInt(lineNumberText, 10);
      const hits = hitsText === '-' ? 0 : Number.parseInt(hitsText, 10);
      if (hits === 0) {
        const entry = details.get(currentFile);
        entry.uncoveredBranchLines.add(lineNumber);
        entry.uncoveredBranches.push({
          line: lineNumber,
          block: Number.parseInt(blockNumberText, 10),
          branch: Number.parseInt(branchNumberText, 10),
        });
      }
    }
  }

  return details;
}

function toMetricGap(data) {
  return { pct: data.pct, covered: data.covered, total: data.total };
}

function collectGaps(repoRoot, workspace) {
  const summaryPath = path.join(repoRoot, workspace, 'coverage', 'coverage-summary.json');
  const lcovPath = path.join(repoRoot, workspace, 'coverage', 'lcov.info');

  if (!fs.existsSync(summaryPath)) {
    return [];
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const lcovDetails = parseLcovFile(repoRoot, lcovPath);
  const gaps = [];

  for (const [file, data] of Object.entries(summary)) {
    if (file === 'total') {
      continue;
    }

    const uncovered = {};
    let hasGap = false;

    for (const metric of ['lines', 'statements', 'branches', 'functions']) {
      if (data[metric]?.pct < 100) {
        uncovered[metric] = toMetricGap(data[metric]);
        hasGap = true;
      }
    }

    if (!hasGap) {
      continue;
    }

    const normalized = normalizeFilePath(repoRoot, file);
    const detail = lcovDetails.get(normalized);

    gaps.push({
      file: path.relative(repoRoot, normalized),
      ...uncovered,
      uncoveredLines: detail ? Array.from(detail.uncoveredLines).sort((a, b) => a - b) : [],
      uncoveredBranchLines: detail
        ? Array.from(detail.uncoveredBranchLines).sort((a, b) => a - b)
        : [],
      uncoveredBranches: detail ? detail.uncoveredBranches : [],
    });
  }

  return gaps.sort((left, right) => left.file.localeCompare(right.file));
}

function printGaps(workspace, gaps) {
  if (gaps.length === 0) {
    return;
  }

  console.error('');
  console.error(`┌──────────────── ${workspace.toUpperCase()} COVERAGE GAPS ────────────────┐`);
  console.error('│  Fix these files before rerunning this shard.           │');
  console.error('└─────────────────────────────────────────────────────────┘');
  console.error('');

  for (const gap of gaps) {
    const metrics = Object.entries(gap)
      .filter(([key]) => ['lines', 'statements', 'branches', 'functions'].includes(key))
      .map(([key, value]) => `${key}: ${value.pct}% (${value.covered}/${value.total})`)
      .join(', ');

    console.error(`  ${gap.file}`);
    console.error(`    ${metrics}`);
    if (gap.uncoveredLines.length > 0) {
      console.error(`    uncovered lines: ${gap.uncoveredLines.join(', ')}`);
    }
    if (gap.uncoveredBranchLines.length > 0) {
      console.error(`    uncovered branch lines: ${gap.uncoveredBranchLines.join(', ')}`);
    }
  }
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = process.cwd();
const gaps = collectGaps(repoRoot, args.workspace);

if (args.write) {
  fs.writeFileSync(args.write, JSON.stringify(gaps, null, 2) + '\n');
}

if (args.print) {
  printGaps(args.workspace, gaps);
}
