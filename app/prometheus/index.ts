// @ts-nocheck
import { collectDefaultMetrics, register } from 'prom-client';

import logger from '../log/index.js';
const log = logger.child({ component: 'prometheus' });
import { getPrometheusConfiguration } from '../configuration/index.js';
import * as container from './container.js';
import * as trigger from './trigger.js';
import * as watcher from './watcher.js';
import * as registry from './registry.js';
import * as audit from './audit.js';

/**
 * Start the Prometheus registry.
 */
export function init() {
    const prometheusConfiguration = getPrometheusConfiguration();
    if (!prometheusConfiguration.enabled) {
        log.info('Prometheus monitoring disabled');
        return;
    }
    log.info('Init Prometheus module');
    collectDefaultMetrics();
    container.init();
    registry.init();
    trigger.init();
    watcher.init();
    audit.init();
}

/**
 * Return all metrics as string for Prometheus scrapping.
 * @returns {string}
 */
export async function output() {
    return register.metrics();
}
