import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Artillery 2.0.34 still imports the default export removed by csv-parse 5.
// Keep its CSV payload support while overriding the vulnerable parser to 7.0.2.
const directory =
  process.argv[2] ?? fileURLToPath(new URL('../e2e/node_modules/artillery', import.meta.url));
const imports = [
  ['dist/lib/cmds/run.js', '_csv'],
  ['dist/lib/util/prepare-test-execution-plan.js', 'csv'],
];
const changes = imports.map(([file, alias]) => {
  const path = join(directory, file);
  const source = readFileSync(path, 'utf8');
  const before = `import ${alias} from 'csv-parse';`;
  const after = `import { parse as ${alias} } from 'csv-parse';`;
  if (source.includes(after)) return { path, source, patched: source };
  if (!source.includes(before)) {
    throw new Error(
      `Unexpected Artillery csv-parse import in ${file}; review the compatibility patch`,
    );
  }
  return { path, source, patched: source.replace(before, after) };
});
for (const { path, source, patched } of changes) {
  if (source !== patched) writeFileSync(path, patched);
}
