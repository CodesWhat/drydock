#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanupFleetAgents } from './lib/cleanup-fleet-agents.mjs';

const DEFAULTS = {
  agents: 8,
  duration: '45s',
  execPerAgent: 3,
  rssGrowthThresholdBytes: 128 * 1024 * 1024,
  heapGrowthThresholdBytes: 64 * 1024 * 1024,
  output: 'portwing-fleet-soak.json',
};

function fail(message) {
  throw new Error(`fleet-soak: ${message}`);
}

function parsePositiveInteger(value, name) {
  if (!/^[0-9]+$/.test(value)) {
    fail(`invalid ${name}: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(`invalid ${name}: ${value}`);
  }
  return parsed;
}

function parseDuration(value) {
  const match = /^([0-9]+)(ms|s|m|h)$/.exec(value);
  if (!match) {
    fail(`invalid --duration: ${value}`);
  }
  const amount = Number(match[1]);
  const multipliers = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  const milliseconds = amount * multipliers[match[2]];
  if (milliseconds < 15_000) {
    fail('--duration must be at least 15s');
  }
  return milliseconds;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        fail(`missing value for ${arg}`);
      }
      return argv[index];
    };
    switch (arg) {
      case '--portwing-bin':
        options.portwingBin = resolve(next());
        break;
      case '--mockdocker-bin':
        options.mockDockerBin = resolve(next());
        break;
      case '--portwing-repo':
        options.portwingRepository = resolve(next());
        break;
      case '--agents':
        options.agents = parsePositiveInteger(next(), '--agents');
        break;
      case '--duration':
        options.duration = next();
        break;
      case '--exec-per-agent':
        options.execPerAgent = parsePositiveInteger(next(), '--exec-per-agent');
        break;
      case '--rss-growth-threshold-bytes':
        options.rssGrowthThresholdBytes = parsePositiveInteger(
          next(),
          '--rss-growth-threshold-bytes',
        );
        break;
      case '--heap-growth-threshold-bytes':
        options.heapGrowthThresholdBytes = parsePositiveInteger(
          next(),
          '--heap-growth-threshold-bytes',
        );
        break;
      case '--output':
        options.output = resolve(next());
        break;
      case '--help':
      case '-h':
        process.stdout.write(
          [
            'Usage: scripts/portwing-fleet-soak.mjs --portwing-bin PATH --mockdocker-bin PATH [options]',
            '',
            '  --portwing-repo PATH',
            '  --agents N',
            '  --duration 45s|30m|4h',
            '  --exec-per-agent N',
            '  --rss-growth-threshold-bytes N',
            '  --heap-growth-threshold-bytes N',
            '  --output PATH',
            '',
          ].join('\n'),
        );
        process.exit(0);
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  if (!options.portwingBin || !options.mockDockerBin) {
    fail('--portwing-bin and --mockdocker-bin are required');
  }
  for (const [name, path] of [
    ['portwing binary', options.portwingBin],
    ['mockdocker binary', options.mockDockerBin],
  ]) {
    if (!statSync(path).isFile()) {
      fail(`${name} is not a file: ${path}`);
    }
  }
  options.durationMs = parseDuration(options.duration);
  return options;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitFor(description, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(50);
  }
  fail(
    `timed out waiting for ${description}${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
  );
}

function childProcess(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', options.stdout ?? 'ignore', options.stderr ?? 'ignore'],
  });
  child.on('error', (error) => {
    process.stderr.write(`fleet-soak: child error (${command}): ${error.message}\n`);
  });
  return child;
}

function rssBytes(pid) {
  if (!pid) {
    return 0;
  }
  const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0) {
    return 0;
  }
  const kibibytes = Number(result.stdout.trim());
  return Number.isFinite(kibibytes) ? kibibytes * 1024 : 0;
}

function threadCount(pid) {
  if (!pid) {
    return 0;
  }
  try {
    return (
      readFileSync(`/proc/${pid}/status`, 'utf8')
        .split('\n')
        .map((line) => /^Threads:\s+([0-9]+)$/.exec(line))
        .find(Boolean)?.[1] ?? 0
    );
  } catch {
    return 0;
  }
}

function gitCommit(cwd) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function closeAdapterSessions(adapter, sessionIds) {
  const sessions = adapter?.execSessions;
  if (!(sessions instanceof Map)) {
    return;
  }
  for (const sessionId of sessionIds) {
    sessions.get(sessionId)?.close();
  }
}

const options = parseArgs(process.argv.slice(2));
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(repositoryRoot, 'app');
process.chdir(join(appRoot, 'dist'));
const portwingRepository = options.portwingRepository;
const runDirectory = mkdtempSync(join(tmpdir(), 'portwing-fleet-soak-'));
const socketPath = join(runDirectory, 'docker.sock');
const privateKeyPath = join(runDirectory, 'agent.key');
const mockLogPath = join(runDirectory, 'mockdocker.log');
const controller = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end('{"status":"ok"}\n');
});

const children = new Map();
let mockDocker;
let sampler;
let controllerAddress;
let getAgents;
let removeAgent;
let deregisterAgentComponents;
let clearNonceCacheForTesting;
let assertionFailure;
const evidence = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  passed: false,
  configuration: {
    agents: options.agents,
    duration: options.duration,
    execPerAgent: options.execPerAgent,
    rssGrowthThresholdBytes: options.rssGrowthThresholdBytes,
    heapGrowthThresholdBytes: options.heapGrowthThresholdBytes,
  },
  revisions: {
    drydock: gitCommit(repositoryRoot),
    portwing: portwingRepository ? gitCommit(portwingRepository) : 'unknown',
  },
  phases: {
    initialConnections: 0,
    execSessionsStarted: 0,
    execOutputFrames: 0,
    slowConsumerReconnects: 0,
    reconnectStorms: 0,
    reconnectsObserved: 0,
  },
  resources: {
    controllerHeap: {},
    agentRss: {},
    maxAgentThreads: 0,
  },
  assertions: [],
};

function activeChildren() {
  return [...children.values()].filter((child) => child.exitCode === null);
}

function aggregateAgentRss() {
  return activeChildren().reduce((total, child) => total + rssBytes(child.pid), 0);
}

function sampleResources() {
  const heap = process.memoryUsage().heapUsed;
  const rss = aggregateAgentRss();
  evidence.resources.controllerHeap.maximum = Math.max(
    evidence.resources.controllerHeap.maximum ?? 0,
    heap,
  );
  evidence.resources.agentRss.maximum = Math.max(evidence.resources.agentRss.maximum ?? 0, rss);
  for (const child of activeChildren()) {
    evidence.resources.maxAgentThreads = Math.max(
      evidence.resources.maxAgentThreads,
      Number(threadCount(child.pid)),
    );
  }
}

function recordAssertion(name, passed, detail) {
  evidence.assertions.push({ name, passed, detail });
  if (!passed && !assertionFailure) {
    assertionFailure = `${name}: ${detail}`;
  }
}

function spawnAgent(index) {
  const name = `fleet-agent-${index}`;
  const logPath = join(runDirectory, `${name}.log`);
  const logFile = openSync(logPath, 'a', 0o600);
  const child = childProcess(options.portwingBin, [], {
    env: {
      ...process.env,
      AGENT_ID: name,
      AGENT_NAME: name,
      BIND_ADDRESS: '127.0.0.1',
      DD_POLL_INTERVAL: '2',
      DOCKER_SOCKET: socketPath,
      DRYDOCK_URL: `http://127.0.0.1:${controllerAddress.port}`,
      // portwing v0.9.9+ refuses plaintext controller URLs in edge mode unless
      // this opt-in is set; the soak dials loopback over http by design.
      ALLOW_INSECURE_EDGE_URL: 'true',
      LOG_LEVEL: 'warn',
      MAX_RECONNECT_DELAY: '2',
      NO_COLOR: '1',
      PORT: '0',
      PRIVATE_KEY_FILE: privateKeyPath,
      RECONNECT_DELAY: '1',
    },
    stdout: logFile,
    stderr: logFile,
  });
  closeSync(logFile);
  children.set(name, child);
  return child;
}

async function run() {
  const gatewayModule = await import(pathToFileURL(join(appRoot, 'dist/api/portwing-ws.js')).href);
  const managerModule = await import(pathToFileURL(join(appRoot, 'dist/agent/manager.js')).href);
  const registryModule = await import(pathToFileURL(join(appRoot, 'dist/registry/index.js')).href);
  const storeModule = await import(pathToFileURL(join(appRoot, 'dist/store/index.js')).href);
  const { createPortwingWsGateway, clearNonceCacheForTesting: clearNonceCache } = gatewayModule;
  ({ getAgents, removeAgent } = managerModule);
  ({ deregisterAgentComponents } = registryModule);
  clearNonceCacheForTesting = clearNonceCache;
  await storeModule.init({ memory: true });

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  });
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPublicKey = publicDer.subarray(12);
  const keyId = createHash('sha256').update(rawPublicKey).digest().subarray(0, 8).toString('hex');
  const keyRecord = {
    keyId,
    pubkey: rawPublicKey.toString('base64'),
    label: 'fleet-soak',
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };

  const gateway = createPortwingWsGateway({
    serverConfiguration: {},
    getAgentKeys: {
      getKey: (candidate) => (candidate === keyId ? keyRecord : null),
    },
  });
  controller.on('upgrade', (request, socket, head) => {
    gateway.handleUpgrade(request, socket, head);
  });
  await new Promise((resolvePromise, reject) => {
    controller.once('error', reject);
    controller.listen(0, '127.0.0.1', () => {
      controller.off('error', reject);
      resolvePromise();
    });
  });
  controllerAddress = controller.address();

  const mockLog = openSync(mockLogPath, 'a', 0o600);
  mockDocker = childProcess(options.mockDockerBin, ['-socket', socketPath], {
    stdout: mockLog,
    stderr: mockLog,
  });
  closeSync(mockLog);
  await waitFor('mock Docker socket', () => {
    try {
      return statSync(socketPath).isSocket();
    } catch {
      return false;
    }
  });

  for (let index = 0; index < options.agents; index += 1) {
    spawnAgent(index);
  }
  await waitFor(
    `${options.agents} initial agents`,
    () => getAgents().length === options.agents,
    30_000,
  );
  evidence.phases.initialConnections = getAgents().length;
  await sleep(1000);

  if (typeof global.gc === 'function') {
    global.gc();
  }
  evidence.resources.controllerHeap.baseline = process.memoryUsage().heapUsed;
  evidence.resources.agentRss.baseline = aggregateAgentRss();
  const soakDeadline = Date.now() + options.durationMs;
  sampleResources();
  sampler = setInterval(sampleResources, 1000);

  const firstExecSessionIds = new Map();
  for (const agent of getAgents()) {
    const sessionIds = [];
    for (let index = 0; index < options.execPerAgent; index += 1) {
      const sessionId = await agent.edgeAdapter.startExec('c0000000001', ['sh', '-c', 'cat'], {
        tty: true,
        outputCallback: () => {
          evidence.phases.execOutputFrames += 1;
        },
      });
      sessionIds.push(sessionId);
      evidence.phases.execSessionsStarted += 1;
    }
    firstExecSessionIds.set(agent, sessionIds);
  }
  await waitFor(
    'initial exec output from every session',
    () => evidence.phases.execOutputFrames >= options.agents * options.execPerAgent,
  );
  await sleep(Math.min(5000, Math.max(1000, Math.floor(options.durationMs / 8))));
  for (const [agent, sessionIds] of firstExecSessionIds) {
    closeAdapterSessions(agent.edgeAdapter, sessionIds);
  }

  const slowAgentName = 'fleet-agent-0';
  const slowAgent = getAgents().find((agent) => agent.name === slowAgentName);
  if (!slowAgent) {
    fail(`missing ${slowAgentName}`);
  }
  const slowAdapter = slowAgent.edgeAdapter;
  const serverSocket = slowAdapter?.ws?._socket;
  if (!serverSocket?.pause || !serverSocket?.resume) {
    fail('production EdgeAgentAdapter WebSocket does not expose a pausable socket');
  }
  serverSocket.pause();
  slowAdapter.streamContainerLogs(
    'c0000000001',
    { follow: true, timestamps: true },
    {
      onChunk: () => {},
      onEnd: () => {},
      onError: () => {},
    },
  );
  await sleep(3500);
  serverSocket.resume();
  const reconnectedSlowAgent = await waitFor(
    'slow-consumer eviction and reconnect',
    () => {
      const candidate = getAgents().find((agent) => agent.name === slowAgentName);
      return candidate && candidate !== slowAgent ? candidate : undefined;
    },
    25_000,
  );
  evidence.phases.slowConsumerReconnects = reconnectedSlowAgent ? 1 : 0;
  evidence.phases.reconnectsObserved += 1;

  const stormCycles = 2;
  for (let cycle = 0; cycle < stormCycles; cycle += 1) {
    const before = new Map(getAgents().map((agent) => [agent.name, agent]));
    for (const agent of before.values()) {
      agent.edgeAdapter?.ws?.close(1012, 'fleet soak reconnect storm');
    }
    await waitFor(
      `reconnect storm ${cycle + 1}`,
      () =>
        [...before.entries()].every(([name, previous]) => {
          const current = getAgents().find((agent) => agent.name === name);
          return current && current !== previous;
        }),
      30_000,
    );
    evidence.phases.reconnectStorms += 1;
    evidence.phases.reconnectsObserved += before.size;
  }

  const sustainedExecSessionIds = new Map();
  for (const agent of getAgents()) {
    const sessionIds = [];
    for (let index = 0; index < options.execPerAgent; index += 1) {
      sessionIds.push(
        await agent.edgeAdapter.startExec('c0000000001', ['sh', '-c', 'cat'], {
          tty: true,
          outputCallback: () => {
            evidence.phases.execOutputFrames += 1;
          },
        }),
      );
      evidence.phases.execSessionsStarted += 1;
    }
    sustainedExecSessionIds.set(agent, sessionIds);
  }

  const remaining = Math.max(1000, soakDeadline - Date.now());
  await sleep(remaining);
  for (const [agent, sessionIds] of sustainedExecSessionIds) {
    closeAdapterSessions(agent.edgeAdapter, sessionIds);
  }
  await sleep(1000);
  sampleResources();
  clearInterval(sampler);
  sampler = undefined;

  if (typeof global.gc === 'function') {
    global.gc();
  }
  evidence.resources.controllerHeap.final = process.memoryUsage().heapUsed;
  evidence.resources.agentRss.final = aggregateAgentRss();
  evidence.resources.controllerHeap.growth =
    evidence.resources.controllerHeap.final - evidence.resources.controllerHeap.baseline;
  evidence.resources.agentRss.growth =
    evidence.resources.agentRss.final - evidence.resources.agentRss.baseline;

  recordAssertion(
    'real fleet connected',
    evidence.phases.initialConnections === options.agents,
    `${evidence.phases.initialConnections}/${options.agents} agents`,
  );
  recordAssertion(
    'sustained concurrent exec completed',
    evidence.phases.execOutputFrames >= options.agents * options.execPerAgent,
    `${evidence.phases.execOutputFrames} output frames across ${evidence.phases.execSessionsStarted} sessions`,
  );
  recordAssertion(
    'slow consumer triggered bounded reconnect',
    evidence.phases.slowConsumerReconnects === 1,
    `${evidence.phases.slowConsumerReconnects} observed reconnect`,
  );
  recordAssertion(
    'reconnect storms recovered',
    evidence.phases.reconnectStorms === stormCycles,
    `${evidence.phases.reconnectStorms}/${stormCycles} storms recovered`,
  );
  recordAssertion(
    'aggregate agent RSS growth bounded',
    evidence.resources.agentRss.growth <= options.rssGrowthThresholdBytes,
    `${evidence.resources.agentRss.growth} <= ${options.rssGrowthThresholdBytes} bytes`,
  );
  recordAssertion(
    'controller heap growth bounded',
    evidence.resources.controllerHeap.growth <= options.heapGrowthThresholdBytes,
    `${evidence.resources.controllerHeap.growth} <= ${options.heapGrowthThresholdBytes} bytes`,
  );

  if (assertionFailure) {
    fail(assertionFailure);
  }
  evidence.passed = true;
}

async function cleanup() {
  if (sampler) {
    clearInterval(sampler);
  }
  try {
    await cleanupFleetAgents({
      agents: [...(getAgents?.() ?? [])],
      deregisterAgentComponents,
      removeAgent,
      onError: (name, error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`fleet-soak: component cleanup failed for ${name}: ${message}\n`);
      },
    });
  } catch {
    // best effort
  }
  for (const child of activeChildren()) {
    child.kill('SIGTERM');
  }
  if (mockDocker?.exitCode === null) {
    mockDocker.kill('SIGTERM');
  }
  await Promise.race([
    Promise.allSettled(
      [...children.values(), ...(mockDocker ? [mockDocker] : [])].map(
        (child) =>
          new Promise((resolvePromise) => {
            if (child.exitCode !== null) {
              resolvePromise();
              return;
            }
            child.once('exit', resolvePromise);
          }),
      ),
    ),
    sleep(3000),
  ]);
  for (const child of [...children.values(), ...(mockDocker ? [mockDocker] : [])]) {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
  await new Promise((resolvePromise) => controller.close(() => resolvePromise()));
  clearNonceCacheForTesting?.();
  rmSync(runDirectory, { recursive: true, force: true });
}

try {
  await run();
} catch (error) {
  evidence.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  await cleanup();
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
