import { Writable } from 'node:stream';
import pino from 'pino';
import pinoPretty from 'pino-pretty';
import { getLogBufferEnabled, getLogFormat, getLogLevel } from '../configuration/index.js';
import { isObservationMode } from '../runtime/observation-mode.js';
import { addEntry } from './buffer.js';
import { TEXT_LOG_TIMESTAMP_TRANSLATE_TIME } from './display-timestamp.js';
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
  // The one-shot `scan` command keeps stdout for its own output.
  const observing = isObservationMode();
  const target = observing ? process.stderr : process.stdout;
  if (getLogFormat() === 'json') {
    return target;
  }
  return pinoPretty({
    colorize: Boolean(target.isTTY),
    ...(observing ? { destination: process.stderr.fd } : {}),
    sync: true,
    singleLine: true,
    translateTime: TEXT_LOG_TIMESTAMP_TRANSLATE_TIME,
  });
}

function createLogStreams() {
  const level = getLogLevel();
  const streams: { stream: Writable; level: string }[] = [{ stream: createMainLogStream(), level }];
  if (getLogBufferEnabled()) {
    streams.push({ stream: bufferStream, level });
  }
  return streams;
}

const logger = pino(
  { name: 'drydock', level: getLogLevel() },
  pino.multistream(createLogStreams()),
);
setWarnLogger(logger);

export default logger;
