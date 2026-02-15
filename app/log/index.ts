
import { Writable } from 'node:stream';
import pino from 'pino';
import { getLogLevel } from '../configuration/index.js';
import { addEntry } from './buffer.js';

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

const logger = pino(
  { name: 'drydock', level: getLogLevel() },
  pino.multistream([{ stream: process.stdout }, { stream: bufferStream }]),
);

export default logger;
