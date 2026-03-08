import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REPORTS = [
  {
    input: 'app/coverage/lcov.info',
    output: 'coverage/codecov-app.lcov.info',
    prefix: 'app/',
  },
  {
    input: 'ui/coverage/lcov.info',
    output: 'coverage/codecov-ui.lcov.info',
    prefix: 'ui/',
  },
];

function normalizeSourceFilePath(path, prefix) {
  if (path.startsWith('/')) {
    return path;
  }

  if (path.startsWith(prefix)) {
    return path;
  }

  return `${prefix}${path}`;
}

function normalizeReport(content, prefix) {
  return content.replace(/^SF:(.+)$/gm, (_, sourceFilePath) => {
    return `SF:${normalizeSourceFilePath(sourceFilePath, prefix)}`;
  });
}

function validateReportSourcePaths(content) {
  const missing = new Set();
  const matches = content.matchAll(/^SF:(.+)$/gm);

  for (const match of matches) {
    const sourceFilePath = match[1];

    if (sourceFilePath.startsWith('/')) {
      continue;
    }

    if (!existsSync(resolve(process.cwd(), sourceFilePath))) {
      missing.add(sourceFilePath);
    }
  }

  if (missing.size > 0) {
    const sample = Array.from(missing).slice(0, 10);
    throw new Error(
      `Normalized coverage paths do not exist in repository: ${sample.join(', ')}`,
    );
  }
}

function writeNormalizedReport({ input, output, prefix }) {
  if (!existsSync(input)) {
    throw new Error(`Coverage report not found: ${input}`);
  }

  const original = readFileSync(input, 'utf8');
  const normalized = normalizeReport(original, prefix);

  validateReportSourcePaths(normalized);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, normalized);

  console.log(`Prepared ${output} from ${input} (${prefix})`);
}

for (const report of REPORTS) {
  writeNormalizedReport(report);
}
