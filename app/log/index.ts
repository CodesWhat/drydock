import { Writable } from 'node:stream';
import pino from 'pino';
import pinoPretty from 'pino-pretty';
import { getLogBufferEnabled, getLogFormat, getLogLevel } from '../configuration/index.js';
import { addEntry } from './buffer.js';
import { setWarnLogger } from './warn.js';

export function parseLogChunk(chunk: Buffer | string) {
  try {
    const obj = JSON.parse(chunk.toString());
    addEntry({
      timestamp: obj.time || Date.now(),
      level: pino.levels.labels[obj.level] || 'info',
      component: obj.component || obj.name || 'drydock',
      msg: obj.msg || '',
    });
  } catch {
    /* ignore parse errors */
  }
}

const bufferStream = new Writable({
  write(chunk, _encoding, callback) {
    parseLogChunk(chunk);
    callback();
  },
});

function createMainLogStream() {
  if (getLogFormat() === 'json') {
    return process.stdout;
  }
  return pinoPretty({
    colorize: Boolean(process.stdout.isTTY),
    sync: true,
  });
}

function createLogStreams() {
  const streams = [{ stream: createMainLogStream() }];
  if (getLogBufferEnabled()) {
    streams.push({ stream: bufferStream });
  }
  return streams;
}

const logger = pino(
  { name: 'drydock', level: getLogLevel() },
  pino.multistream(createLogStreams()),
);
setWarnLogger(logger);

export default logger;
