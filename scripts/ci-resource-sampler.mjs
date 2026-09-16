import { readdir, readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

function numericField(contents, key) {
  const line = contents.split('\n').find((entry) => entry.startsWith(`${key}:`));
  const value = line
    ?.slice(key.length + 1)
    .trim()
    .split(/\s+/)[0];
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

export async function collectResources(procRoot = '/proc', workdir = process.cwd()) {
  const memory = await readOptional(join(procRoot, 'meminfo'));
  const memoryKiB = {};
  for (const key of ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']) {
    const value = numericField(memory, key);
    if (value !== undefined) memoryKiB[key] = value;
  }

  let diskBytes = null;
  try {
    const disk = await statfs(workdir);
    diskBytes = { available: disk.bavail * disk.bsize, total: disk.blocks * disk.bsize };
  } catch {
    // Missing diagnostics must not affect the test command's result.
  }

  const processes = [];
  const entries = await readdir(procRoot).catch(() => []);
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const status = await readOptional(join(procRoot, entry, 'status'));
    const rssKiB = numericField(status, 'VmRSS');
    const ppid = numericField(status, 'PPid');
    if (rssKiB !== undefined && ppid !== undefined) {
      processes.push({ pid: Number(entry), ppid, rssKiB });
    }
  }
  processes.sort((left, right) => right.rssKiB - left.rssKiB || left.pid - right.pid);
  return { at: new Date().toISOString(), memoryKiB, diskBytes, processes: processes.slice(0, 5) };
}

async function parentIdentity(pid, procRoot) {
  const contents = await readOptional(join(procRoot, String(pid), 'stat'));
  const closingParen = contents.lastIndexOf(')');
  if (closingParen < 0) return null;
  const fields = contents
    .slice(closingParen + 1)
    .trim()
    .split(/\s+/);
  const startTime = fields[19];
  return /^\d+$/.test(startTime ?? '') ? { state: fields[0], startTime } : null;
}

export async function parentIsAlive(pid, expectedStartTime = null, procRoot = '/proc') {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== 'EPERM') return false;
  }
  if (expectedStartTime === null) return true;
  const current = await parentIdentity(pid, procRoot);
  return (
    current !== null &&
    !['Z', 'X', 'x'].includes(current.state) &&
    current.startTime === expectedStartTime
  );
}

async function main(args) {
  const [parent, interval = '15000', count = '80'] = args;
  const values = [parent, interval, count];
  if (
    args.length < 1 ||
    args.length > 3 ||
    values.some((value) => !/^\d+$/.test(value ?? '')) ||
    values.some((value) => !Number.isSafeInteger(Number(value)) || Number(value) <= 0) ||
    Number(parent) > 2147483647 ||
    Number(interval) > 15000 ||
    Number(count) > 80
  ) {
    console.error('Usage: ci-resource-sampler.mjs parent-pid [interval-ms<=15000] [samples<=80]');
    return 2;
  }
  const parentPid = Number(parent);
  const initialParent = await parentIdentity(parentPid, '/proc');
  for (
    let index = 0;
    index < Number(count) && (await parentIsAlive(parentPid, initialParent?.startTime ?? null));
    index++
  ) {
    console.log(`CI_RESOURCE ${JSON.stringify(await collectResources())}`);
    if (index + 1 < Number(count)) await setTimeout(Number(interval));
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
