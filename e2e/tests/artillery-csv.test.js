const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');
const { parse } = require('csv-parse');

test('duplicate CSV headers remain own properties without replacing the record prototype', async () => {
  const [record] = await promisify(parse)('__proto__,__proto__,name\na,b,example\n', {
    columns: true,
    group_columns_by_name: true,
  });
  assert.equal(Object.getPrototypeOf(record), Object.prototype);
  assert.equal(Object.hasOwn(record, '__proto__'), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(record, '__proto__').value, ['a', 'b']);
  assert.equal(record.name, 'example');
});

test('Artillery prepares a CSV payload using the patched parser', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'drydock-csv-payload-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const previous = global.artillery;
  global.artillery = { testRunId: 'csv-compatibility' };
  t.after(() => {
    if (previous === undefined) delete global.artillery;
    else global.artillery = previous;
  });
  const csvPath = join(directory, 'users.csv');
  const configPath = join(directory, 'scenario.json');
  writeFileSync(csvPath, 'name,count\n"Doe, Jane",2\n\n');
  writeFileSync(
    configPath,
    JSON.stringify({
      config: {
        target: 'http://127.0.0.1:1',
        phases: [{ duration: 1, arrivalCount: 1 }],
        payload: { path: csvPath, fields: ['name', 'count'], skipHeader: true },
      },
      scenarios: [{ flow: [{ get: { url: '/' } }] }],
    }),
  );
  const { default: prepare } = await import(
    '../node_modules/artillery/dist/lib/util/prepare-test-execution-plan.js'
  );
  const plan = await prepare([configPath], {});
  assert.deepEqual(plan.config.payload[0].data, [['Doe, Jane', 2]]);
});
