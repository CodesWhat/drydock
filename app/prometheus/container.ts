import { Gauge, register } from 'prom-client';
import {
  registerContainerAdded,
  registerContainerRemoved,
  registerContainerUpdated,
} from '../event/index.js';
import log from '../log/index.js';
import { flatten } from '../model/container.js';
import * as storeContainer from '../store/container.js';

let gaugeContainer;
let shouldRebuildGaugeOnCollect = true;
const gaugeContainerLabelsById = new Map();
const containerEventDeregistrations: Array<() => void> = [];

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

function clearContainerEventRegistrations() {
  while (containerEventDeregistrations.length > 0) {
    const deregister = containerEventDeregistrations.pop();
    deregister?.();
  }
}

function getContainerMetricLabels(container) {
  const flatContainer = flatten(container);
  return Object.keys(flatContainer)
    .filter((key) => containerLabelSet.has(key))
    .reduce((obj, key) => {
      obj[key] = flatContainer[key];
      return obj;
    }, {});
}

function upsertContainerMetric(container) {
  if (!gaugeContainer) {
    return;
  }

  try {
    const gaugeLabels = getContainerMetricLabels(container);
    const containerId = typeof container?.id === 'string' ? container.id : undefined;
    if (containerId) {
      const previousGaugeLabels = gaugeContainerLabelsById.get(containerId);
      if (previousGaugeLabels) {
        gaugeContainer.remove(previousGaugeLabels);
      }
      gaugeContainerLabelsById.set(containerId, gaugeLabels);
    }
    gaugeContainer.set(gaugeLabels, 1);
  } catch (e) {
    shouldRebuildGaugeOnCollect = true;
    log.warn(`${container?.id} - Error when adding container to the metrics (${e.message})`);
    log.debug(e);
  }
}

function removeContainerMetric(container) {
  if (!gaugeContainer) {
    return;
  }

  const containerId = typeof container?.id === 'string' ? container.id : undefined;
  if (!containerId) {
    shouldRebuildGaugeOnCollect = true;
    return;
  }

  const previousGaugeLabels = gaugeContainerLabelsById.get(containerId);
  if (!previousGaugeLabels) {
    shouldRebuildGaugeOnCollect = true;
    return;
  }

  gaugeContainer.remove(previousGaugeLabels);
  gaugeContainerLabelsById.delete(containerId);
}

function rebuildContainerGaugeFromStore() {
  if (!gaugeContainer) {
    return;
  }

  gaugeContainer.reset();
  gaugeContainerLabelsById.clear();
  shouldRebuildGaugeOnCollect = false;
  storeContainer.getContainers().forEach((container) => {
    upsertContainerMetric(container);
  });
}

function registerContainerMetricEventHandlers() {
  containerEventDeregistrations.push(
    registerContainerAdded((container) => {
      if (shouldRebuildGaugeOnCollect) {
        return;
      }
      upsertContainerMetric(container);
    }),
  );
  containerEventDeregistrations.push(
    registerContainerUpdated((container) => {
      if (shouldRebuildGaugeOnCollect) {
        return;
      }
      upsertContainerMetric(container);
    }),
  );
  containerEventDeregistrations.push(
    registerContainerRemoved((container) => {
      if (shouldRebuildGaugeOnCollect) {
        return;
      }
      removeContainerMetric(container);
    }),
  );
}

/**
 * Init Container prometheus gauge.
 * @returns {Gauge<string>}
 */
export function init() {
  clearContainerEventRegistrations();
  gaugeContainerLabelsById.clear();
  shouldRebuildGaugeOnCollect = true;

  // Replace gauge if init is called more than once
  if (gaugeContainer) {
    register.removeSingleMetric(gaugeContainer.name);
  }
  gaugeContainer = new Gauge({
    name: 'dd_containers',
    help: 'The watched containers',
    labelNames: containerLabelNames,
    collect() {
      if (!shouldRebuildGaugeOnCollect) {
        return;
      }
      rebuildContainerGaugeFromStore();
    },
  });
  registerContainerMetricEventHandlers();
  return gaugeContainer;
}

export function _resetPrometheusContainerStateForTests() {
  clearContainerEventRegistrations();
  gaugeContainerLabelsById.clear();
  if (gaugeContainer) {
    register.removeSingleMetric(gaugeContainer.name);
  }
  gaugeContainer = undefined;
  shouldRebuildGaugeOnCollect = true;
}

export function _upsertContainerMetricForTests(container) {
  upsertContainerMetric(container);
}

export function _removeContainerMetricForTests(container) {
  removeContainerMetric(container);
}

export function _rebuildContainerGaugeFromStoreForTests() {
  rebuildContainerGaugeFromStore();
}
