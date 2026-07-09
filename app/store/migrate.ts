import semver from 'semver';
import logger from '../log/index.js';
import { classifyTagPrecision } from '../tag/precision.js';
import * as storeContainer from './container.js';

const log = logger.child({ component: 'store' });
const TAG_PRECISION_BACKFILL_VERSION = '1.5.0';
const TRIGGER_LABEL_CATEGORY_RESCOPE_VERSION = '1.6.0';

function backfillMissingTagPrecision() {
  const containers = storeContainer.getContainersRaw().map(storeContainer.cloneContainer);

  for (const container of containers) {
    const tag = container.image?.tag;
    if (!tag || tag.tagPrecision !== undefined) {
      continue;
    }

    storeContainer.updateContainer({
      ...container,
      image: {
        ...container.image,
        tag: {
          ...tag,
          tagPrecision: classifyTagPrecision(tag.value, container.transformTags),
        },
      },
    });
  }
}

function shouldBackfillMissingTagPrecision(from?: string, to?: string) {
  if (
    typeof to !== 'string' ||
    !semver.valid(to) ||
    semver.lt(to, TAG_PRECISION_BACKFILL_VERSION)
  ) {
    return false;
  }

  if (typeof from !== 'string') {
    return false;
  }

  return semver.valid(from) ? semver.lt(from, TAG_PRECISION_BACKFILL_VERSION) : true;
}

/**
 * Re-derive the four category-scoped trigger label fields (#494) for
 * containers left over from before the dd.action / dd.notification label
 * split collapsed into a single triggerInclude/triggerExclude field. Only
 * touches containers that don't already have a scoped field —
 * updateContainer() applies the same label-driven normalization
 * (store/container.ts), which recovers the notification value the old
 * collapsed mirror discarded, or falls back to the mirror for label-less
 * rows.
 */
function rederiveTriggerLabelCategoryFields() {
  const containers = storeContainer.getContainersRaw().map(storeContainer.cloneContainer);

  for (const container of containers) {
    const hasScopedTriggerLabelField =
      container.actionTriggerInclude !== undefined ||
      container.actionTriggerExclude !== undefined ||
      container.notificationTriggerInclude !== undefined ||
      container.notificationTriggerExclude !== undefined;
    if (hasScopedTriggerLabelField) {
      continue;
    }

    storeContainer.updateContainer(container);
  }
}

function shouldRederiveTriggerLabelCategoryFields(from?: string, to?: string) {
  if (
    typeof to !== 'string' ||
    !semver.valid(to) ||
    semver.lt(to, TRIGGER_LABEL_CATEGORY_RESCOPE_VERSION)
  ) {
    return false;
  }

  if (typeof from !== 'string') {
    return false;
  }

  return semver.valid(from) ? semver.lt(from, TRIGGER_LABEL_CATEGORY_RESCOPE_VERSION) : true;
}

export function repairDataOnStartup() {
  backfillMissingTagPrecision();
}

/**
 * Data migration function.
 * @param from version
 * @param to version
 */
export function migrate(from?: string, to?: string) {
  log.info('Migrate data between schema versions');
  if (shouldBackfillMissingTagPrecision(from, to)) {
    backfillMissingTagPrecision();
  }
  if (shouldRederiveTriggerLabelCategoryFields(from, to)) {
    rederiveTriggerLabelCategoryFields();
  }
}
