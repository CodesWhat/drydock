// @ts-nocheck
import { Gauge, register } from 'prom-client';
import log from '../log/index.js';
import { flatten } from '../model/container.js';
import * as storeContainer from '../store/container.js';

let gaugeContainer;

const containerLabelNames = [
  'agent',
  'display_icon',
  'display_name',
  'error_message',
  'exclude_tags',
  'id',
  'image_architecture',
  'image_created',
  'image_digest_repo',
  'image_digest_value',
  'image_digest_watch',
  'image_id',
  'image_name',
  'image_os',
  'image_registry_lookup_image',
  'image_registry_name',
  'image_registry_url',
  'image_tag_semver',
  'image_tag_value',
  'image_variant',
  'include_tags',
  'labels',
  'link_template',
  'link',
  'name',
  'result_created',
  'result_digest',
  'result_link',
  'result_tag',
  'status',
  'transform_tags',
  'trigger_exclude',
  'trigger_include',
  'update_available',
  'update_kind_kind',
  'update_kind_local_value',
  'update_kind_remote_value',
  'update_kind_semver_diff',
  'watcher',
];

const containerLabelSet = new Set(containerLabelNames);

/**
 * Populate gauge.
 */
function populateGauge() {
  gaugeContainer.reset();
  storeContainer.getContainers().forEach((container) => {
    try {
      const flatContainer = flatten(container);
      const gaugeLabels = Object.keys(flatContainer)
        .filter((key) => containerLabelSet.has(key))
        .reduce((obj, key) => {
          obj[key] = flatContainer[key];
          return obj;
        }, {});
      gaugeContainer.set(gaugeLabels, 1);
    } catch (e) {
      log.warn(`${container.id} - Error when adding container to the metrics (${e.message})`);
      log.debug(e);
    }
  });
}

/**
 * Init Container prometheus gauge.
 * @returns {Gauge<string>}
 */
export function init() {
  // Replace gauge if init is called more than once
  if (gaugeContainer) {
    register.removeSingleMetric(gaugeContainer.name);
  }
  gaugeContainer = new Gauge({
    name: 'dd_containers',
    help: 'The watched containers',
    labelNames: containerLabelNames,
  });
  log.debug('Start container metrics interval');
  setInterval(populateGauge, 5000);
  populateGauge();
  return gaugeContainer;
}
