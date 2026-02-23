// @ts-nocheck
import { collectDefaultMetrics, register } from 'prom-client';

import logger from '../log/index.js';

const log = logger.child({ component: 'prometheus' });

import { getPrometheusConfiguration } from '../configuration/index.js';
import * as audit from './audit.js';
import * as compatibility from './compatibility.js';
import * as container from './container.js';
import * as containerActions from './container-actions.js';
import * as rollback from './rollback.js';
import * as registry from './registry.js';
import * as trigger from './trigger.js';
import * as watcher from './watcher.js';
import * as webhook from './webhook.js';

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
  compatibility.init();
  container.init();
  registry.init();
  trigger.init();
  watcher.init();
  audit.init();
  containerActions.init();
  webhook.init();
  rollback.init();
}

/**
 * Return all metrics as string for Prometheus scrapping.
 * @returns {string}
 */
export async function output() {
  return register.metrics();
}
