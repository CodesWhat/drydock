// @ts-nocheck
import pino from 'pino';
import { getLogLevel } from '../configuration/index.js';

// Init Pino logger
const logger = pino({
    name: 'drydock',
    level: getLogLevel(),
});

export default logger;
