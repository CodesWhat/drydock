import semver from 'semver';
import logger from '../log/index.js';
import { classifyTagPrecision } from '../tag/precision.js';
import * as storeContainer from './container.js';

const log = logger.child({ component: 'store' });
const TAG_PRECISION_BACKFILL_VERSION = '1.5.0';

function backfillMissingTagPrecision() {
  const containers = storeContainer.getContainersRaw();

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
 * Data migration function.
 * @param from version
 * @param to version
 */
export function migrate(from?: string, to?: string) {
  log.info('Migrate data between schema versions');
  if (shouldBackfillMissingTagPrecision(from, to)) {
    backfillMissingTagPrecision();
  }
}
